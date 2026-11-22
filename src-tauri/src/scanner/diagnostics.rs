use serde::Serialize;

use crate::security::backup::{RegistryHive, RegistryOriginalValue};
use crate::tweaks::registry::read_original_value;
use crate::tweaks::services::{read_service_start_type, SERVICE_START_DISABLED};

use super::hardware::HardwareSummary;
use super::peripherals::PeripheralsSummary;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Optimal,
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticFinding {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub severity: DiagnosticSeverity,
    pub recommended_tweak_ids: Vec<String>,
}

pub fn analyze_system(
    hardware: &HardwareSummary,
    peripherals: &PeripheralsSummary,
) -> Vec<DiagnosticFinding> {
    let mut findings = Vec::new();

    let high_refresh = peripherals.monitors.iter().any(|m| m.refresh_rate_hz >= 120);
    let active_plan_lower = hardware.power_plan.name.to_lowercase();
    let is_high_perf_plan = active_plan_lower.contains("ultimate")
        || active_plan_lower.contains("desempenho máximo")
        || active_plan_lower.contains("high performance")
        || active_plan_lower.contains("alto desempenho");

    if !is_high_perf_plan {
        findings.push(DiagnosticFinding {
            id: "diag_power_plan".into(),
            title: "Plano de energia pode limitar boost de CPU".into(),
            detail: format!(
                "Plano ativo: '{}'.{} Alterar para Ultimate Performance reduz latência de C-states e melhora consistência de frametime.",
                hardware.power_plan.name,
                if high_refresh {
                    " Monitor de alta taxa (>=120 Hz) detectado."
                } else {
                    ""
                }
            ),
            severity: if high_refresh {
                DiagnosticSeverity::Warning
            } else {
                DiagnosticSeverity::Info
            },
            recommended_tweak_ids: vec![
                "power_ultimate_performance".into(),
                "power_disable_usb_selective_suspend".into(),
            ],
        });
    } else {
        findings.push(DiagnosticFinding {
            id: "diag_power_plan_ok".into(),
            title: "Plano de energia de alto desempenho ativo".into(),
            detail: format!(
                "Esquema '{}' operando sem limitação agressiva de C-states.",
                hardware.power_plan.name
            ),
            severity: DiagnosticSeverity::Optimal,
            recommended_tweak_ids: vec![],
        });
    }

    let ram_usage_pct = if hardware.memory.total_bytes > 0 {
        (hardware.memory.used_bytes as f64 / hardware.memory.total_bytes as f64) * 100.0
    } else {
        0.0
    };

    if ram_usage_pct >= 65.0 || hardware.memory.total_bytes <= 16 * 1024 * 1024 * 1024 {
        findings.push(DiagnosticFinding {
            id: "diag_memory_pressure".into(),
            title: "Pressão de memória ou Standby List acumulando cache".into(),
            detail: format!(
                "Uso atual de RAM em {:.0}% ({:.1} GB de {:.1} GB). Purga real da Standby List e priorização MMCSS ajudam em sessões prolongadas.",
                ram_usage_pct,
                hardware.memory.used_bytes as f64 / 1_073_741_824.0,
                hardware.memory.total_bytes as f64 / 1_073_741_824.0,
            ),
            severity: if ram_usage_pct >= 80.0 {
                DiagnosticSeverity::Warning
            } else {
                DiagnosticSeverity::Info
            },
            recommended_tweak_ids: vec![
                "memory_standby_cleanup".into(),
                "registry_mmcss_gaming".into(),
            ],
        });
    }

    if let Some(low_disk) = hardware.disks.iter().find(|d| {
        d.total_bytes > 0 && ((d.available_bytes as f64 / d.total_bytes as f64) * 100.0) < 15.0
    }) {
        findings.push(DiagnosticFinding {
            id: "diag_disk_low_space".into(),
            title: format!("Espaço livre reduzido em {}", low_disk.mount_point),
            detail: format!(
                "Restam apenas {:.1} GB livres de {:.1} GB. SSDs próximos da capacidade total sofrem queda de escrita e garbage collection.",
                low_disk.available_bytes as f64 / 1_073_741_824.0,
                low_disk.total_bytes as f64 / 1_073_741_824.0
            ),
            severity: DiagnosticSeverity::Warning,
            recommended_tweak_ids: vec!["power_disable_hibernation".into()],
        });
    }

    // Diagnóstico real de latência (GameDVR, Timer Resolution, Mouse Accel, Nagle, Telemetria)
    let mut latency_recs = Vec::new();
    let gamedvr_off = matches!(
        read_original_value(&RegistryHive::Hkcu, r"System\GameConfigStore", "GameDVR_Enabled"),
        RegistryOriginalValue::Dword(0)
    );
    if !gamedvr_off {
        latency_recs.push("registry_disable_gamedvr".into());
    }

    let global_timer_on = matches!(
        read_original_value(
            &RegistryHive::Hklm,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\kernel",
            "GlobalTimerResolutionRequests"
        ),
        RegistryOriginalValue::Dword(1)
    );
    if !global_timer_on {
        latency_recs.push("gaming_global_timer_resolution".into());
    }

    let mouse_speed_raw = matches!(
        read_original_value(&RegistryHive::Hkcu, r"Control Panel\Mouse", "MouseSpeed"),
        RegistryOriginalValue::String(ref s) if s.trim() == "0"
    );
    let mouse_t1_raw = matches!(
        read_original_value(&RegistryHive::Hkcu, r"Control Panel\Mouse", "MouseThreshold1"),
        RegistryOriginalValue::String(ref s) if s.trim() == "0"
    );
    let mouse_t2_raw = matches!(
        read_original_value(&RegistryHive::Hkcu, r"Control Panel\Mouse", "MouseThreshold2"),
        RegistryOriginalValue::String(ref s) if s.trim() == "0"
    );
    if !(mouse_speed_raw && mouse_t1_raw && mouse_t2_raw) {
        latency_recs.push("registry_disable_mouse_accel".into());
    }

    let throttling_off = matches!(
        read_original_value(
            &RegistryHive::Hklm,
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile",
            "NetworkThrottlingIndex"
        ),
        RegistryOriginalValue::Dword(0xFFFF_FFFF)
    );
    if !throttling_off {
        latency_recs.push("network_tcp_nodelay".into());
    }

    if let Some(start_type) = read_service_start_type("DiagTrack") {
        if start_type != SERVICE_START_DISABLED {
            latency_recs.push("debloat_telemetry_services".into());
        }
    }

    if !latency_recs.is_empty() {
        findings.push(DiagnosticFinding {
            id: "diag_gaming_capture_net".into(),
            title: "Otimizações de latência DPC, kernel timer e rede pendentes".into(),
            detail: format!(
                "{} otimização(ões) de alto impacto detectada(s) fora do estado recomendado (GameDVR, Timer Resolution, Raw Mouse, TCPNoDelay ou Telemetria).",
                latency_recs.len()
            ),
            severity: DiagnosticSeverity::Info,
            recommended_tweak_ids: latency_recs,
        });
    } else {
        findings.push(DiagnosticFinding {
            id: "diag_gaming_capture_net_ok".into(),
            title: "Pilha de latência gaming e rede calibrada".into(),
            detail: "GameDVR, GlobalTimerResolutionRequests, Raw Mouse, NetworkThrottlingIndex e DiagTrack já estão otimizados.".into(),
            severity: DiagnosticSeverity::Optimal,
            recommended_tweak_ids: vec![],
        });
    }

    // Diagnóstico real de Hardening de Segurança (LLMNR & SMBv1)
    let mut security_recs = Vec::new();
    let llmnr_off = matches!(
        read_original_value(
            &RegistryHive::Hklm,
            r"SOFTWARE\Policies\Microsoft\Windows NT\DNSClient",
            "EnableMulticast"
        ),
        RegistryOriginalValue::Dword(0)
    );
    if !llmnr_off {
        security_recs.push("security_disable_llmnr".into());
    }

    let smbv1_off = matches!(
        read_original_value(
            &RegistryHive::Hklm,
            r"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters",
            "SMB1"
        ),
        RegistryOriginalValue::Dword(0)
    );
    if !smbv1_off {
        security_recs.push("security_disable_smbv1".into());
    }

    if !security_recs.is_empty() {
        findings.push(DiagnosticFinding {
            id: "diag_security_baseline".into(),
            title: "Controles CIS/Microsoft Security Baseline recomendados".into(),
            detail: "Desativar LLMNR (EnableMulticast=0) e garantir SMBv1 bloqueado reduz a superfície de ataque em redes locais sem custo de FPS.".into(),
            severity: DiagnosticSeverity::Info,
            recommended_tweak_ids: security_recs,
        });
    }

    findings
}
