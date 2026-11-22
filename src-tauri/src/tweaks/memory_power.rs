use sysinfo::{MemoryRefreshKind, RefreshKind, System};

use crate::error::AppResult;
use crate::scanner::hardware::read_active_power_plan;
use crate::security::backup::BackupTarget;

use super::system_ops::{
    apply_ultimate_performance, is_hibernation_enabled, is_high_performance_active,
    purge_standby_list, query_fsutil_behavior, query_power_setting_indices,
    read_fsutil_registry_value, revert_power_plan, set_fsutil_behavior, set_hibernation,
    set_power_setting_indices, snapshot_power_plan, BALANCED_PERF_GUID, SETTING_PCIE_ASPM,
    SETTING_PROC_MIN_STATE, SETTING_USB_SELECTIVE_SUSPEND, SUBGROUP_PCIE, SUBGROUP_PROCESSOR,
    SUBGROUP_USB,
};
use super::{Tweak, TweakCategory, TweakEvalContext, TweakImpact, TweakRisk};

// ============================================================================
// 1. Ultimate Performance Power Plan
// ============================================================================

struct UltimatePerformanceTweak;

impl Tweak for UltimatePerformanceTweak {
    fn id(&self) -> &'static str {
        "power_ultimate_performance"
    }

    fn name(&self) -> &'static str {
        "Ativar Plano de Energia Ultimate Performance"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Power
    }

    fn description(&self) -> &'static str {
        "Duplica e ativa o esquema oculto Ultimate Performance (e9a42b02-...) para eliminar micro-latências de transição de C-states e boost de clock."
    }

    fn technical_detail(&self) -> String {
        "powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 && powercfg /setactive <guid>".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Documentação Microsoft Workstation Power Policy: reduz latência de acordar núcleos e estabiliza frametimes em monitores de alta taxa."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Safe
    }

    fn is_applied(&self) -> Result<bool, String> {
        Ok(is_high_performance_active())
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        Ok(ctx.high_perf_active)
    }

    fn apply(&self) -> Result<(), String> {
        apply_ultimate_performance()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        revert_power_plan(BALANCED_PERF_GUID).map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        Ok(vec![snapshot_power_plan()?])
    }
}

// ============================================================================
// 2. Disable Hibernation & Fast Startup
// ============================================================================

struct DisableHibernationTweak;

impl Tweak for DisableHibernationTweak {
    fn id(&self) -> &'static str {
        "power_disable_hibernation"
    }

    fn name(&self) -> &'static str {
        "Desativar Hibernação e Fast Startup (libera hiberfil.sys)"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Power
    }

    fn description(&self) -> &'static str {
        "Desativa hibernação (powercfg /hibernate off), removendo o arquivo hiberfil.sys (vários GiB no SSD) e impedindo que o Fast Startup preserve estado corrompido de drivers no kernel."
    }

    fn technical_detail(&self) -> String {
        "powercfg /hibernate off (HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power :: HibernateEnabled=0)".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Libera 40% da RAM instalada em espaço SSD/NVMe e elimina bugs de DPC/drivers acumulados por inicialização híbrida (Fast Startup)."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Moderate
    }

    fn is_applied(&self) -> Result<bool, String> {
        Ok(!is_hibernation_enabled())
    }

    fn apply(&self) -> Result<(), String> {
        set_hibernation(false).map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        set_hibernation(true).map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        Ok(vec![BackupTarget::HibernationState {
            was_enabled: is_hibernation_enabled(),
        }])
    }
}

// ============================================================================
// 3..5. Advanced Power Setting Index Tweak (USB Suspend, PCIe ASPM, CPU Min)
// ============================================================================

struct PowerSettingTweak {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    benchmark_note: &'static str,
    impact: TweakImpact,
    risk: TweakRisk,
    subgroup_guid: &'static str,
    setting_guid: &'static str,
    desired_ac: u32,
    desired_dc: Option<u32>,
    default_ac: u32,
    default_dc: u32,
}

impl Tweak for PowerSettingTweak {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Power
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn technical_detail(&self) -> String {
        match self.desired_dc {
            Some(dc) => format!(
                "powercfg /setacvalueindex <scheme> {} {} {}\npowercfg /setdcvalueindex <scheme> {} {} {}",
                self.subgroup_guid,
                self.setting_guid,
                self.desired_ac,
                self.subgroup_guid,
                self.setting_guid,
                dc
            ),
            None => format!(
                "powercfg /setacvalueindex <scheme> {} {} {} (DC preservado)",
                self.subgroup_guid, self.setting_guid, self.desired_ac
            ),
        }
    }

    fn benchmark_note(&self) -> &'static str {
        self.benchmark_note
    }

    fn impact(&self) -> TweakImpact {
        self.impact
    }

    fn risk(&self) -> TweakRisk {
        self.risk
    }

    fn is_applied(&self) -> Result<bool, String> {
        let active = read_active_power_plan();
        if active.guid.is_empty() || active.guid == "unknown" {
            return Ok(false);
        }
        let Ok((ac, dc)) =
            query_power_setting_indices(&active.guid, self.subgroup_guid, self.setting_guid)
        else {
            return Ok(false);
        };
        let dc_ok = self.desired_dc.map(|want| dc == want).unwrap_or(true);
        Ok(ac == self.desired_ac && dc_ok)
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        if ctx.active_scheme_guid.is_empty() || ctx.active_scheme_guid == "unknown" {
            return Ok(false);
        }
        let Ok((ac, dc)) = query_power_setting_indices(
            &ctx.active_scheme_guid,
            self.subgroup_guid,
            self.setting_guid,
        ) else {
            return Ok(false);
        };
        let dc_ok = self.desired_dc.map(|want| dc == want).unwrap_or(true);
        Ok(ac == self.desired_ac && dc_ok)
    }

    fn apply(&self) -> Result<(), String> {
        let active = read_active_power_plan();
        set_power_setting_indices(
            &active.guid,
            self.subgroup_guid,
            self.setting_guid,
            self.desired_ac,
            self.desired_dc,
        )
        .map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        let active = read_active_power_plan();
        set_power_setting_indices(
            &active.guid,
            self.subgroup_guid,
            self.setting_guid,
            self.default_ac,
            Some(self.default_dc),
        )
        .map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let active = read_active_power_plan();
        if active.guid.is_empty() || active.guid == "unknown" {
            return Err(crate::error::AppError::BackupError(
                "Não foi possível identificar o plano de energia ativo para backup.".into(),
            ));
        }
        let (orig_ac, orig_dc) =
            query_power_setting_indices(&active.guid, self.subgroup_guid, self.setting_guid)?;

        Ok(vec![BackupTarget::PowerSettingValue {
            scheme_guid: active.guid,
            subgroup_guid: self.subgroup_guid.to_string(),
            setting_guid: self.setting_guid.to_string(),
            original_ac_index: orig_ac,
            original_dc_index: orig_dc,
        }])
    }
}

// ============================================================================
// 6. Standby List Purge via NtSetSystemInformation
// ============================================================================

struct StandbyListPurgeTweak;

impl Tweak for StandbyListPurgeTweak {
    fn id(&self) -> &'static str {
        "memory_standby_cleanup"
    }

    fn name(&self) -> &'static str {
        "Purga Real da Standby List (NtSetSystemInformation)"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Power
    }

    fn description(&self) -> &'static str {
        "Habilita SeProfileSingleProcessPrivilege e invoca NtSetSystemInformation(MemoryPurgeStandbyList) para esvaziar páginas em espera acumuladas sem tocar no pagefile."
    }

    fn technical_detail(&self) -> String {
        "ntdll.dll :: NtSetSystemInformation(SystemMemoryListInformation=80, MemoryPurgeStandbyList=4) + SeProfileSingleProcessPrivilege".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Mesmo mecanismo técnico do Intelligent Standby List Cleaner (ISLC): elimina stutters por esgotamento de Free Memory em sessões longas."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::Medium
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Safe
    }

    fn reversible(&self) -> bool {
        true
    }

    fn hardware_note(&self, _ctx: &TweakEvalContext) -> Option<String> {
        Some("Ação instantânea sob demanda (o Windows repovoa o cache naturalmente após a purga).".into())
    }

    fn is_applied(&self) -> Result<bool, String> {
        // Ação sob demanda; sempre pode ser reexecutada quando houver pressão de Standby.
        Ok(false)
    }

    fn apply(&self) -> Result<(), String> {
        purge_standby_list().map(|_| ()).map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        // Ação de purga volátil não altera configuração persistente.
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let sys = System::new_with_specifics(
            RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()),
        );
        Ok(vec![BackupTarget::SnapshotNote {
            description: "RAM disponível antes da purga de Standby List (NtSetSystemInformation)".into(),
            original_value: format!(
                "{:.2} GiB livres de {:.2} GiB",
                sys.available_memory() as f64 / 1_073_741_824.0,
                sys.total_memory() as f64 / 1_073_741_824.0
            ),
        }])
    }
}

// ============================================================================
// 7 & 8. NTFS Behavior (fsutil)
// ============================================================================

struct FsutilBehaviorTweak {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    benchmark_note: &'static str,
    impact: TweakImpact,
    risk: TweakRisk,
    fsutil_entries: &'static [(&'static str, u32, u32)], // (key, desired, default)
    ssd_hint: bool,
}

impl Tweak for FsutilBehaviorTweak {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Power
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn technical_detail(&self) -> String {
        self.fsutil_entries
            .iter()
            .map(|(k, desired, _)| format!("fsutil behavior set {k} {desired}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn benchmark_note(&self) -> &'static str {
        self.benchmark_note
    }

    fn impact(&self) -> TweakImpact {
        self.impact
    }

    fn risk(&self) -> TweakRisk {
        self.risk
    }

    fn hardware_note(&self, ctx: &TweakEvalContext) -> Option<String> {
        if self.ssd_hint {
            Some(format!(
                "Disco do sistema: {}. TRIM mantém desempenho de escrita aleatória em SSDs/NVMe.",
                ctx.specs.system_drive_kind
            ))
        } else {
            None
        }
    }

    fn is_applied(&self) -> Result<bool, String> {
        for (key, desired, _) in self.fsutil_entries {
            let current = read_fsutil_registry_value(key)
                .or_else(|| query_fsutil_behavior(key).ok());
            if current != Some(*desired) {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn apply(&self) -> Result<(), String> {
        for (key, desired, _) in self.fsutil_entries {
            set_fsutil_behavior(key, *desired).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn revert(&self) -> Result<(), String> {
        for (key, _, default_val) in self.fsutil_entries.iter().rev() {
            set_fsutil_behavior(key, *default_val).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let mut targets = Vec::new();
        for (key, _, _) in self.fsutil_entries {
            let original = query_fsutil_behavior(key)?;
            targets.push(BackupTarget::FsutilBehavior {
                key: (*key).to_string(),
                original_value: original,
            });
        }
        Ok(targets)
    }
}

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        // 1. Ultimate Performance
        Box::new(UltimatePerformanceTweak),
        // 2. Disable Hibernation
        Box::new(DisableHibernationTweak),
        // 3. Disable USB Selective Suspend
        Box::new(PowerSettingTweak {
            id: "power_disable_usb_selective_suspend",
            name: "Desativar Suspensão Seletiva de Portas USB",
            description: "Impede que o controlador USB suspenda portas ociosas no plano de energia ativo (AC e DC), evitando atraso de despertar em periféricos e DACs.",
            benchmark_note: "Microsoft USB Power Management / LatencyMon: elimina desconexões breves e picos de DPC em controladores xHCI.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            subgroup_guid: SUBGROUP_USB,
            setting_guid: SETTING_USB_SELECTIVE_SUSPEND,
            desired_ac: 0,
            desired_dc: Some(0),
            default_ac: 1,
            default_dc: 1,
        }),
        // 4. Disable PCIe ASPM (Link State Power Management)
        Box::new(PowerSettingTweak {
            id: "power_disable_pcie_aspm",
            name: "Desativar PCI Express Link State Power Management (ASPM)",
            description: "Desativa estados de economia de link PCIe (L0s/L1) na tomada (AC) para impedir latência de reativação do barramento da GPU e SSD NVMe.",
            benchmark_note: "Documentação PCI-SIG / LatencyMon: reduz latência de interrupções PCIe em GPUs discretas e adaptadores de rede PCIe.",
            impact: TweakImpact::High,
            risk: TweakRisk::Moderate,
            subgroup_guid: SUBGROUP_PCIE,
            setting_guid: SETTING_PCIE_ASPM,
            desired_ac: 0,
            desired_dc: None,
            default_ac: 1,
            default_dc: 2,
        }),
        // 5. Processor Minimum State 100% on AC
        Box::new(PowerSettingTweak {
            id: "power_processor_min_state_100",
            name: "Estado Mínimo do Processador em 100% (AC)",
            description: "Mantém o piso de desempenho da CPU em 100% quando conectado à energia (AC), preservando o perfil de bateria (DC) intacto.",
            benchmark_note: "Elimina atraso de rampa de frequência (P-state ramp-up) em cenas de transição rápida. Avançado: aumenta consumo em idle.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Advanced,
            subgroup_guid: SUBGROUP_PROCESSOR,
            setting_guid: SETTING_PROC_MIN_STATE,
            desired_ac: 100,
            desired_dc: None,
            default_ac: 5,
            default_dc: 5,
        }),
        // 6. Real Standby List Purge
        Box::new(StandbyListPurgeTweak),
        // 7. Disable NTFS Last Access Timestamp
        Box::new(FsutilBehaviorTweak {
            id: "storage_disable_ntfs_last_access",
            name: "Desativar NTFS Last Access Timestamp",
            description: "Desabilita a gravação do carimbo de último acesso em arquivos NTFS, eliminando escritas redundantes de metadados a cada leitura.",
            benchmark_note: "Documentação Microsoft NTFS: reduz IOPS de escrita em segundo plano e prolonga vida útil (TBW) de SSDs/NVMe.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            fsutil_entries: &[("disablelastaccess", 1, 2)],
            ssd_hint: false,
        }),
        // 8. Disable 8.3 Short Names & Ensure TRIM Enabled
        Box::new(FsutilBehaviorTweak {
            id: "storage_disable_8dot3_and_verify_trim",
            name: "Desativar Nomes Curtos 8.3 e Garantir TRIM Ativo",
            description: "Desliga a geração legada de nomes curtos MS-DOS 8.3 no NTFS e garante o envio imediato de comandos TRIM (DisableDeleteNotify=0) ao SSD.",
            benchmark_note: "Microsoft Storage Performance: acelera enumeração de diretórios com milhares de assets e mantém garbage collection NVMe saudável.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            fsutil_entries: &[("disable8dot3", 1, 2), ("disabledeletenotify", 0, 0)],
            ssd_hint: true,
        }),
    ]
}
