use crate::error::{AppError, AppResult};
use crate::security::backup::{BackupTarget, RegistryHive, RegistryOriginalValue};

use super::registry::{
    apply_spec, is_spec_applied, revert_registry_target, snapshot_spec, usb_hid_power_subkeys,
    RegistrySpec,
};
use super::{
    RegistryTweak, RegistryTweakEntry, Tweak, TweakCategory, TweakEvalContext, TweakImpact,
    TweakRisk,
};

/// Curva linear exata 1:1 MarkC (100% escala, Windows 6/11) para eliminar aceleração residual.
pub const MARKC_SMOOTH_MOUSE_X: [u8; 40] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0xCC, 0x0C, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x80, 0x99, 0x19, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x66, 0x26, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x33, 0x33, 0x00, 0x00, 0x00, 0x00, 0x00,
];

pub const MARKC_SMOOTH_MOUSE_Y: [u8; 40] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x38, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x70, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA8, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xE0, 0x00, 0x00, 0x00, 0x00, 0x00,
];

struct UsbHidIdleSuspendTweak;

impl UsbHidIdleSuspendTweak {
    fn specs(&self) -> Vec<RegistrySpec> {
        usb_hid_power_subkeys()
            .into_iter()
            .map(|subkey| {
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    &subkey,
                    "EnhancedPowerManagementEnabled",
                    0,
                )
            })
            .collect()
    }
}

impl Tweak for UsbHidIdleSuspendTweak {
    fn id(&self) -> &'static str {
        "input_disable_usb_hid_idle_suspend"
    }

    fn name(&self) -> &'static str {
        "Desativar Suspensão Ociosa em Dispositivos USB/HID"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Input
    }

    fn description(&self) -> &'static str {
        "Define EnhancedPowerManagementEnabled=0 nos Device Parameters de dispositivos USB que suportam suspensão agressiva, evitando micro-stutter ao mover mouses/teclados sem fio."
    }

    fn technical_detail(&self) -> String {
        r"HKLM\SYSTEM\CurrentControlSet\Enum\USB\*\*\Device Parameters :: EnhancedPowerManagementEnabled -> REG_DWORD=0".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Elimina latência de despertar (15–80ms) em receptores USB 2.4 GHz de mouses e teclados após períodos curtos sem movimento."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::Medium
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Moderate
    }

    fn hardware_note(&self, ctx: &TweakEvalContext) -> Option<String> {
        let count = ctx.usb_hid_subkeys.len();
        Some(format!(
            "{count} dispositivo(s) USB com EnhancedPowerManagementEnabled detectado(s)."
        ))
    }

    fn is_applicable(&self, ctx: &TweakEvalContext) -> bool {
        !ctx.usb_hid_subkeys.is_empty()
    }

    fn is_applied(&self) -> Result<bool, String> {
        let specs = self.specs();
        Ok(!specs.is_empty() && specs.iter().all(is_spec_applied))
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        if ctx.usb_hid_subkeys.is_empty() {
            return Ok(false);
        }
        Ok(ctx.usb_hid_subkeys.iter().all(|subkey| {
            is_spec_applied(&RegistrySpec::dword(
                RegistryHive::Hklm,
                subkey,
                "EnhancedPowerManagementEnabled",
                0,
            ))
        }))
    }

    fn apply(&self) -> Result<(), String> {
        let specs = self.specs();
        if specs.is_empty() {
            return Err(
                "Nenhum dispositivo USB com EnhancedPowerManagementEnabled foi encontrado.".into(),
            );
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
                &RegistryOriginalValue::Dword(1),
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let specs = self.specs();
        if specs.is_empty() {
            return Err(AppError::InvalidOperation(
                "Nenhum dispositivo USB elegível encontrado para backup.".into(),
            ));
        }
        Ok(specs.iter().map(snapshot_spec).collect())
    }
}

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        // 1. Mouse Acceleration Off + MarkC 1:1 Linear Curve
        Box::new(RegistryTweak {
            id: "registry_disable_mouse_accel",
            name: "Mouse Raw 1:1 (Sem Aceleração + Curva Linear MarkC)",
            category: TweakCategory::Input,
            description: "Desativa Enhance Pointer Precision (MouseSpeed=0, Thresholds=0) e grava curvas SmoothMouseX/Y lineares exatas 1:1 para rastreio consistente mesmo fora de Raw Input.",
            benchmark_note: "MarkC Mouse Fix / FPS competitivo: elimina aceleração não-linear do ponteiro em jogos sem Raw Input nativo (requer novo logon).",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::string(RegistryHive::Hkcu, r"Control Panel\Mouse", "MouseSpeed", "0"),
                    RegistryOriginalValue::String("1".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hkcu,
                        r"Control Panel\Mouse",
                        "MouseThreshold1",
                        "0",
                    ),
                    RegistryOriginalValue::String("6".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hkcu,
                        r"Control Panel\Mouse",
                        "MouseThreshold2",
                        "0",
                    ),
                    RegistryOriginalValue::String("10".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::binary(
                        RegistryHive::Hkcu,
                        r"Control Panel\Mouse",
                        "SmoothMouseXCurve",
                        MARKC_SMOOTH_MOUSE_X.to_vec(),
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::binary(
                        RegistryHive::Hkcu,
                        r"Control Panel\Mouse",
                        "SmoothMouseYCurve",
                        MARKC_SMOOTH_MOUSE_Y.to_vec(),
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 2. Fast Keyboard Repeat Delay & Speed
        Box::new(RegistryTweak {
            id: "input_keyboard_repeat_fast",
            name: "Minimizar Atraso de Repetição de Teclado",
            category: TweakCategory::Input,
            description: "Define KeyboardDelay=0 (~250ms mínimo nativo) e KeyboardSpeed=31 (~30 repetições/s) para resposta imediata ao segurar teclas.",
            benchmark_note: "Documentação Win32 Control Panel\\Keyboard: menor latência de repetição suportada nativamente sem filtros artificiais.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hkcu,
                        r"Control Panel\Keyboard",
                        "KeyboardDelay",
                        "0",
                    ),
                    RegistryOriginalValue::String("1".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hkcu,
                        r"Control Panel\Keyboard",
                        "KeyboardSpeed",
                        "31",
                    ),
                    RegistryOriginalValue::String("31".into()),
                ),
            ],
        }),
        // 3. Disable Sticky Keys Prompt
        Box::new(RegistryTweak {
            id: "input_disable_sticky_keys",
            name: "Desativar Atalho e Popup de Teclas de Aderência (Sticky Keys)",
            category: TweakCategory::Input,
            description: "Remove o gatilho Shift 5x que minimiza jogos em tela cheia durante movimentação/agachamento rápido.",
            benchmark_note: "Evita perda súbita de foco de janela (Alt+Tab forçado pelo diálogo de acessibilidade).",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::string(
                    RegistryHive::Hkcu,
                    r"Control Panel\Accessibility\StickyKeys",
                    "Flags",
                    "506",
                ),
                RegistryOriginalValue::String("510".into()),
            )],
        }),
        // 4. Disable Filter Keys Prompt
        Box::new(RegistryTweak {
            id: "input_disable_filter_keys",
            name: "Desativar Atalho e Popup de Teclas de Filtragem (Filter Keys)",
            category: TweakCategory::Input,
            description: "Desabilita o gatilho Shift direito por 8 segundos que ativa filtragem de teclas e atrasa o teclado.",
            benchmark_note: "Previne ativação acidental de debounce artificial de teclado em jogos.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::string(
                    RegistryHive::Hkcu,
                    r"Control Panel\Accessibility\Keyboard Response",
                    "Flags",
                    "122",
                ),
                RegistryOriginalValue::String("126".into()),
            )],
        }),
        // 5. Disable Toggle Keys Prompt
        Box::new(RegistryTweak {
            id: "input_disable_toggle_keys",
            name: "Desativar Atalho Sonoro de Teclas de Alternância (Toggle Keys)",
            category: TweakCategory::Input,
            description: "Desabilita o atalho NumLock por 5 segundos e alertas sonoros de Caps/Num/Scroll Lock.",
            benchmark_note: "Evita interrupções de áudio e diálogos inesperados em jogos competitivos.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::string(
                    RegistryHive::Hkcu,
                    r"Control Panel\Accessibility\ToggleKeys",
                    "Flags",
                    "58",
                ),
                RegistryOriginalValue::String("62".into()),
            )],
        }),
        // 6. Disable USB HID Idle Suspend
        Box::new(UsbHidIdleSuspendTweak),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markc_linear_curves_have_exact_40_byte_windows_format() {
        assert_eq!(MARKC_SMOOTH_MOUSE_X.len(), 40);
        assert_eq!(MARKC_SMOOTH_MOUSE_Y.len(), 40);
        assert_eq!(&MARKC_SMOOTH_MOUSE_X[0..8], &[0u8; 8]);
        assert_eq!(&MARKC_SMOOTH_MOUSE_Y[0..8], &[0u8; 8]);
        assert_eq!(MARKC_SMOOTH_MOUSE_Y[10], 0x38);
        assert_eq!(MARKC_SMOOTH_MOUSE_Y[34], 0xE0);
    }
}
