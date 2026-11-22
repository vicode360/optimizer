use crate::error::{AppError, AppResult};
use crate::security::backup::{BackupTarget, RegistryHive, RegistryOriginalValue};

use super::registry::{
    apply_spec, is_spec_applied, pci_display_msi_subkeys, read_original_value,
    revert_registry_target, snapshot_spec, RegistrySpec,
};
use super::{
    RegistryTweak, RegistryTweakEntry, Tweak, TweakCategory, TweakEvalContext, TweakImpact,
    TweakRisk,
};

struct GpuMsiModeTweak;

impl GpuMsiModeTweak {
    fn specs(&self) -> Vec<RegistrySpec> {
        pci_display_msi_subkeys()
            .into_iter()
            .map(|subkey| RegistrySpec::dword(RegistryHive::Hklm, &subkey, "MSISupported", 1))
            .collect()
    }
}

impl Tweak for GpuMsiModeTweak {
    fn id(&self) -> &'static str {
        "gpu_msi_mode_display"
    }

    fn name(&self) -> &'static str {
        "Ativar MSI Mode (Message Signaled Interrupts) na GPU PCIe"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Gpu
    }

    fn description(&self) -> &'static str {
        "Habilita interrupções sinalizadas por mensagem (MSI) em todos os controladores de vídeo PCIe detectados, eliminando compartilhamento de linhas IRQ legadas."
    }

    fn technical_detail(&self) -> String {
        r"HKLM\SYSTEM\CurrentControlSet\Enum\PCI\<GPU>\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties :: MSISupported -> REG_DWORD=1 (requer reinicialização)".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "LatencyMon / WDK: reduz drasticamente picos de execução ISR/DPC em nvlddmkm.sys e amdkmdag.sys."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Moderate
    }

    fn hardware_note(&self, ctx: &TweakEvalContext) -> Option<String> {
        let count = ctx.pci_display_subkeys.len();
        Some(format!(
            "{count} controlador(es) PCIe de vídeo detectado(s). Requer reinicialização após aplicar."
        ))
    }

    fn is_applicable(&self, ctx: &TweakEvalContext) -> bool {
        !ctx.pci_display_subkeys.is_empty()
    }

    fn is_applied(&self) -> Result<bool, String> {
        let specs = self.specs();
        Ok(!specs.is_empty() && specs.iter().all(is_spec_applied))
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        if ctx.pci_display_subkeys.is_empty() {
            return Ok(false);
        }
        Ok(ctx.pci_display_subkeys.iter().all(|subkey| {
            is_spec_applied(&RegistrySpec::dword(
                RegistryHive::Hklm,
                subkey,
                "MSISupported",
                1,
            ))
        }))
    }

    fn apply(&self) -> Result<(), String> {
        let specs = self.specs();
        if specs.is_empty() {
            return Err("Nenhum controlador PCIe de vídeo (Class=Display) encontrado.".into());
        }
        for spec in &specs {
            apply_spec(spec).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn revert(&self) -> Result<(), String> {
        for spec in self.specs() {
            revert_registry_target(
                &spec.hive,
                &spec.subkey,
                &spec.value_name,
                &RegistryOriginalValue::Dword(0),
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let specs = self.specs();
        if specs.is_empty() {
            return Err(AppError::InvalidOperation(
                "Nenhum controlador PCIe de vídeo encontrado para backup MSI.".into(),
            ));
        }
        Ok(specs.iter().map(snapshot_spec).collect())
    }
}

struct DirectXWindowedOptTweak;

impl DirectXWindowedOptTweak {
    const SUBKEY: &'static str = r"Software\Microsoft\DirectX\UserGpuPreferences";
    const VALUE_NAME: &'static str = "DirectXUserGlobalSettings";

    fn merge_settings(existing: &str) -> String {
        let mut pairs: Vec<(String, String)> = existing
            .split(';')
            .filter_map(|part| {
                let trimmed = part.trim();
                let (k, v) = trimmed.split_once('=')?;
                Some((k.trim().to_string(), v.trim().to_string()))
            })
            .collect();

        for (target_k, target_v) in [("SwapEffectUpgradeEnable", "1"), ("VRROptimizeEnable", "1")] {
            if let Some((_, val)) = pairs
                .iter_mut()
                .find(|(k, _)| k.eq_ignore_ascii_case(target_k))
            {
                *val = target_v.to_string();
            } else {
                pairs.push((target_k.to_string(), target_v.to_string()));
            }
        }

        let mut out = pairs
            .into_iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join(";");
        if !out.is_empty() {
            out.push(';');
        }
        out
    }

    fn has_required_settings(existing: &str) -> bool {
        let mut has_swap = false;
        let mut has_vrr = false;
        for part in existing.split(';') {
            if let Some((k, v)) = part.trim().split_once('=') {
                if k.trim().eq_ignore_ascii_case("SwapEffectUpgradeEnable") && v.trim() == "1" {
                    has_swap = true;
                }
                if k.trim().eq_ignore_ascii_case("VRROptimizeEnable") && v.trim() == "1" {
                    has_vrr = true;
                }
            }
        }
        has_swap && has_vrr
    }
}

impl Tweak for DirectXWindowedOptTweak {
    fn id(&self) -> &'static str {
        "gpu_windowed_optimizations"
    }

    fn name(&self) -> &'static str {
        "Otimizações DirectX Flip Model & VRR em Janela"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Gpu
    }

    fn description(&self) -> &'static str {
        "Ativa SwapEffectUpgradeEnable e VRROptimizeEnable preservando outras preferências DirectX já salvas pelo usuário."
    }

    fn technical_detail(&self) -> String {
        r"HKCU\Software\Microsoft\DirectX\UserGpuPreferences :: DirectXUserGlobalSettings += SwapEffectUpgradeEnable=1;VRROptimizeEnable=1;"
            .into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Microsoft DirectX DevBlog: reduz latência de apresentação em borderless windowed para o mesmo nível de fullscreen exclusivo."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Safe
    }

    fn requires_admin(&self) -> bool {
        false
    }

    fn is_applied(&self) -> Result<bool, String> {
        match read_original_value(&RegistryHive::Hkcu, Self::SUBKEY, Self::VALUE_NAME) {
            RegistryOriginalValue::String(s) => Ok(Self::has_required_settings(&s)),
            _ => Ok(false),
        }
    }

    fn apply(&self) -> Result<(), String> {
        let existing = match read_original_value(&RegistryHive::Hkcu, Self::SUBKEY, Self::VALUE_NAME)
        {
            RegistryOriginalValue::String(s) => s,
            _ => String::new(),
        };
        let merged = Self::merge_settings(&existing);
        let spec = RegistrySpec::string(RegistryHive::Hkcu, Self::SUBKEY, Self::VALUE_NAME, &merged);
        apply_spec(&spec).map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        revert_registry_target(
            &RegistryHive::Hkcu,
            Self::SUBKEY,
            Self::VALUE_NAME,
            &RegistryOriginalValue::Absent,
        )
        .map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let original =
            super::registry::try_read_original_value(&RegistryHive::Hkcu, Self::SUBKEY, Self::VALUE_NAME)?;
        Ok(vec![BackupTarget::RegistryValue {
            hive: RegistryHive::Hkcu,
            subkey: Self::SUBKEY.to_string(),
            value_name: Self::VALUE_NAME.to_string(),
            original,
        }])
    }
}

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        // 1. Hardware-Accelerated GPU Scheduling (HAGS)
        Box::new(RegistryTweak {
            id: "gpu_enable_hags",
            name: "Ativar Hardware-Accelerated GPU Scheduling (HAGS)",
            category: TweakCategory::Gpu,
            description: "Descarrega o agendamento de filas de renderização da CPU para o processador dedicado da GPU (WDDM 2.7+), reduzindo latência e liberando DLSS Frame Generation.",
            benchmark_note: "Documentação WDDM 2.7+ / Microsoft DirectX: reduz latência de submissão de frames em DX12 e Vulkan (requer reinicialização).",
            impact: TweakImpact::High,
            risk: TweakRisk::Moderate,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
                    "HwSchMode",
                    2,
                ),
                RegistryOriginalValue::Dword(1),
            )],
        }),
        // 2. Disable Multi-Plane Overlay (MPO)
        Box::new(RegistryTweak {
            id: "gpu_disable_mpo",
            name: "Desativar Multi-Plane Overlay (MPO)",
            category: TweakCategory::Gpu,
            description: "Define OverlayTestMode=5 no DWM para contornar bugs de planos sobrepostos responsáveis por flickering, telas pretas e micro-stutters em NVIDIA/AMD.",
            benchmark_note: "Workaround oficial documentado pela NVIDIA (KB 5157) e amplamente adotado em setups multi-monitor / VRR.",
            impact: TweakImpact::High,
            risk: TweakRisk::Moderate,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SOFTWARE\Microsoft\Windows\Dwm",
                    "OverlayTestMode",
                    5,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 3. GPU MSI Mode
        Box::new(GpuMsiModeTweak),
        // 4. TDR Delay (10s)
        Box::new(RegistryTweak {
            id: "gpu_tdr_delay",
            name: "Aumentar Tolerância de TDR do Driver de Vídeo (10s)",
            category: TweakCategory::Gpu,
            description: "Eleva TdrDelay e TdrDdiDelay de 2s para 10s, evitando reinicializações falsas do driver durante compilação pesada de shaders ou cargas intensas.",
            benchmark_note: "Documentação Microsoft WDK (TDR Registry Keys): previne crashes DXGI_ERROR_DEVICE_HUNG em compilação de pipelines DX12.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
                        "TdrDelay",
                        10,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
                        "TdrDdiDelay",
                        10,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 5. Windows 11 Optimizations for Windowed Games + VRR
        Box::new(DirectXWindowedOptTweak),
        // 6. Disable DWM Transparency
        Box::new(RegistryTweak {
            id: "gpu_disable_transparency_dwm",
            name: "Desativar Transparência Acrílica/Mica do Compositor DWM",
            category: TweakCategory::Gpu,
            description: "Remove efeitos de desfoque translúcido do Shell/DWM, reduzindo uso de VRAM e largura de banda do compositor durante jogos em janela.",
            benchmark_note: "Reduz consumo de GPU em segundo plano pelo dwm.exe em configurações com overlays ou segundo monitor ativo.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hkcu,
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                    "EnableTransparency",
                    0,
                ),
                RegistryOriginalValue::Dword(1),
            )],
        }),
        // 7. Disable Window Animations & Aero Peek
        Box::new(RegistryTweak {
            id: "gpu_disable_dwm_animations",
            name: "Desativar Animações de Janela e Aero Peek",
            category: TweakCategory::Gpu,
            description: "Elimina animações de minimizar/maximizar e pré-visualização de miniaturas na barra de tarefas para alternância Alt+Tab instantânea.",
            benchmark_note: "Reduz tempo de foco e composição de superfície no DWM durante Alt+Tab.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hkcu,
                        r"Control Panel\Desktop\WindowMetrics",
                        "MinAnimate",
                        "0",
                    ),
                    RegistryOriginalValue::String("1".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\DWM",
                        "EnableAeroPeek",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
            ],
        }),
        // 8. Disable Miracast Virtual Display Polling
        Box::new(RegistryTweak {
            id: "gpu_disable_miracast_polling",
            name: "Desativar Polling de Display Virtual Miracast",
            category: TweakCategory::Gpu,
            description: "Desabilita suporte de transmissão sem fio Miracast no driver gráfico WDDM quando não utilizado.",
            benchmark_note: "Remove consultas periódicas de display virtual no subsistema DXGKrnl.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Moderate,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
                    "PlatformSupportMiracast",
                    0,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_directx_global_settings_without_clobbering_other_flags() {
        let merged = DirectXWindowedOptTweak::merge_settings("AutoHDREnable=1;VRROptimizeEnable=0;");
        assert!(merged.contains("AutoHDREnable=1"));
        assert!(merged.contains("VRROptimizeEnable=1"));
        assert!(merged.contains("SwapEffectUpgradeEnable=1"));
        assert!(DirectXWindowedOptTweak::has_required_settings(&merged));
        assert!(DirectXWindowedOptTweak::has_required_settings(
            "VRROptimizeEnable=1;SwapEffectUpgradeEnable=1;"
        ));
    }
}
