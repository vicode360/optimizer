use crate::error::AppResult;
use crate::security::backup::{BackupTarget, RegistryHive, RegistryOriginalValue};

use super::registry::{
    apply_spec, is_spec_applied, revert_registry_target, snapshot_spec, RegistrySpec,
};
use super::system_ops::{recommended_svchost_split_kb, SystemSpecs};
use super::{
    RegistryTweak, RegistryTweakEntry, Tweak, TweakCategory, TweakEvalContext, TweakImpact,
    TweakRisk,
};

struct DynamicSvcHostSplitTweak;

impl DynamicSvcHostSplitTweak {
    const SUBKEY: &'static str = r"SYSTEM\CurrentControlSet\Control";
    const VALUE: &'static str = "SvcHostSplitThresholdInKB";
    const DEFAULT_WIN_KB: u32 = 3_670_016; // ~3.5 GiB padrão do Windows

    fn desired_spec(&self, total_ram_kb: u32) -> RegistrySpec {
        RegistrySpec::dword(
            RegistryHive::Hklm,
            Self::SUBKEY,
            Self::VALUE,
            recommended_svchost_split_kb(total_ram_kb),
        )
    }
}

impl Tweak for DynamicSvcHostSplitTweak {
    fn id(&self) -> &'static str {
        "gaming_split_svchost_threshold"
    }

    fn name(&self) -> &'static str {
        "Otimizar SvcHostSplitThresholdInKB pela RAM Física"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Gaming
    }

    fn description(&self) -> &'static str {
        "Alinha o limiar de divisão de processos svchost.exe à memória RAM física instalada para consolidar serviços e reduzir dezenas de context switches ociosos."
    }

    fn technical_detail(&self) -> String {
        let specs = SystemSpecs::detect();
        let kb = recommended_svchost_split_kb(specs.total_ram_kb);
        format!(
            r"HKLM\SYSTEM\CurrentControlSet\Control :: SvcHostSplitThresholdInKB -> REG_DWORD={kb} (RAM detectada: {:.1} GiB)",
            specs.total_ram_gb
        )
    }

    fn technical_detail_with_ctx(&self, ctx: &TweakEvalContext) -> String {
        let kb = recommended_svchost_split_kb(ctx.specs.total_ram_kb);
        format!(
            r"HKLM\SYSTEM\CurrentControlSet\Control :: SvcHostSplitThresholdInKB -> REG_DWORD={kb} (RAM detectada: {:.1} GiB)",
            ctx.specs.total_ram_gb
        )
    }

    fn benchmark_note(&self) -> &'static str {
        "AtlasOS / WinUtil: reduz 40–70 processos svchost.exe redundantes em sistemas com 16–64 GiB de RAM, economizando handles e memória de tabela de páginas."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::Medium
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Moderate
    }

    fn hardware_note(&self, ctx: &TweakEvalContext) -> Option<String> {
        Some(format!(
            "Valor calculado automaticamente: {} KiB ({:.1} GiB de RAM física).",
            recommended_svchost_split_kb(ctx.specs.total_ram_kb),
            ctx.specs.total_ram_gb
        ))
    }

    fn is_applied(&self) -> Result<bool, String> {
        let specs = SystemSpecs::detect();
        Ok(is_spec_applied(&self.desired_spec(specs.total_ram_kb)))
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        Ok(is_spec_applied(&self.desired_spec(ctx.specs.total_ram_kb)))
    }

    fn apply(&self) -> Result<(), String> {
        let specs = SystemSpecs::detect();
        apply_spec(&self.desired_spec(specs.total_ram_kb)).map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        revert_registry_target(
            &RegistryHive::Hklm,
            Self::SUBKEY,
            Self::VALUE,
            &RegistryOriginalValue::Dword(Self::DEFAULT_WIN_KB),
        )
        .map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let specs = SystemSpecs::detect();
        Ok(vec![snapshot_spec(&self.desired_spec(specs.total_ram_kb))])
    }
}

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        // 1. MMCSS Gaming Priority & SystemResponsiveness
        Box::new(RegistryTweak {
            id: "registry_mmcss_gaming",
            name: "MMCSS: Prioridade Máxima para Jogos e SystemResponsiveness",
            category: TweakCategory::Gaming,
            description: "Reserva 90% do tempo de CPU do Multimedia Class Scheduler Service para tarefas em tempo real e eleva prioridade de CPU, GPU e I/O na fila Games.",
            benchmark_note: "Documentação Microsoft MMCSS: reduz starvation de threads de renderização e melhora consistência de 1% lows sob carga mista.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile",
                        "SystemResponsiveness",
                        10,
                    ),
                    RegistryOriginalValue::Dword(20),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games",
                        "GPU Priority",
                        8,
                    ),
                    RegistryOriginalValue::Dword(8),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games",
                        "Priority",
                        6,
                    ),
                    RegistryOriginalValue::Dword(2),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games",
                        "Scheduling Category",
                        "High",
                    ),
                    RegistryOriginalValue::String("Medium".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Games",
                        "SFIO Priority",
                        "High",
                    ),
                    RegistryOriginalValue::String("Normal".into()),
                ),
            ],
        }),
        // 2. Win32PrioritySeparation = 0x26 (38 decimal)
        Box::new(RegistryTweak {
            id: "gaming_win32_priority_separation",
            name: "Quantum Curto de CPU para Foreground (Win32PrioritySeparation 0x26)",
            category: TweakCategory::Gaming,
            description: "Configura o agendador do kernel NT para quantums curtos e variáveis com boost máximo para o aplicativo em primeiro plano.",
            benchmark_note: "Playbooks AtlasOS/ReviOS & CapFrameX: reduz latência de alternância de threads interativas e suaviza frametimes sob tarefas paralelas.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Control\PriorityControl",
                    "Win32PrioritySeparation",
                    38, // 0x26
                ),
                RegistryOriginalValue::Dword(2),
            )],
        }),
        // 3. GlobalTimerResolutionRequests = 1 (Windows 11 Kernel Timer Resolution)
        Box::new(RegistryTweak {
            id: "gaming_global_timer_resolution",
            name: "Resolução Global de Timer do Kernel (GlobalTimerResolutionRequests)",
            category: TweakCategory::Gaming,
            description: "Restaura o comportamento global de solicitações NtSetTimerResolution no Windows 11, evitando quedas bruscas do clock de 0.5–1ms para 15.6ms.",
            benchmark_note: "Blur Busters / MeasureSleep: elimina variação dente-de-serra de 15.6ms em Sleep(1) e estabiliza pacing em monitores 144–360 Hz.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\kernel",
                    "GlobalTimerResolutionRequests",
                    1,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 4. Disable GameDVR & Background Recording
        Box::new(RegistryTweak {
            id: "registry_disable_gamedvr",
            name: "Desativar GameDVR e Gravação em Segundo Plano",
            category: TweakCategory::Gaming,
            description: "Desliga a captura contínua de frames e áudio do Xbox GameDVR via registro de usuário e política global.",
            benchmark_note: "Elimina overhead constante de encoder NVENC/VCE e cópias extras de buffer DXGI em VRAM.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"System\GameConfigStore",
                        "GameDVR_Enabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR",
                        "AppCaptureEnabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\GameDVR",
                        "AllowGameDVR",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 5. Disable Power Throttling
        Box::new(RegistryTweak {
            id: "gaming_disable_power_throttling",
            name: "Desativar Power Throttling do Windows Scheduler",
            category: TweakCategory::Gaming,
            description: "Impede que o agendador reduza frequência ou mova processos auxiliares críticos (Discord, anti-cheat, áudio) para estados de economia agressiva.",
            benchmark_note: "Essencial em CPUs híbridas (Intel P/E-cores e AMD dual-CCD) para evitar picos de latência DPC e travamentos de áudio.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Control\Power\PowerThrottling",
                    "PowerThrottlingOff",
                    1,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 6. Disable Fullscreen Optimizations Globally
        Box::new(RegistryTweak {
            id: "gaming_disable_fullscreen_optimizations",
            name: "Desativar Fullscreen Optimizations Globalmente",
            category: TweakCategory::Gaming,
            description: "Instrói o GameConfigStore a respeitar tela cheia exclusiva clássica (FSE) em jogos DX9/DX11 que não usam flip model moderno.",
            benchmark_note: "Reduz 1–2 frames de buffering do compositor DWM em motores legados (CS/Source/DX9).",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Moderate,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"System\GameConfigStore",
                        "GameDVR_FSEBehaviorMode",
                        2,
                    ),
                    RegistryOriginalValue::Dword(0),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"System\GameConfigStore",
                        "GameDVR_HonorUserFSEBehaviorMode",
                        1,
                    ),
                    RegistryOriginalValue::Dword(0),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"System\GameConfigStore",
                        "GameDVR_DXGIHonorFSEWindowsCompatible",
                        1,
                    ),
                    RegistryOriginalValue::Dword(0),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"System\GameConfigStore",
                        "GameDVR_FSEBehavior",
                        2,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 7. Disable Game Bar Overlay & Tips (Keep Game Mode ON)
        Box::new(RegistryTweak {
            id: "gaming_disable_game_bar_tips",
            name: "Desativar Overlay e Dicas do Game Bar (Manter Game Mode)",
            category: TweakCategory::Gaming,
            description: "Remove popups e hooks do painel Game Bar enquanto mantém o Windows Game Mode ativo para priorização de núcleo.",
            benchmark_note: "Evita injeção de overlay UWP em jogos competitivos sem perder otimizações de núcleo do Game Mode.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\GameBar",
                        "UseNexusForGameBarEnabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\GameBar",
                        "ShowStartupPanel",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\GameBar",
                        "AutoGameModeEnabled",
                        1,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
            ],
        }),
        // 8. MMCSS Audio Pipeline Priority
        Box::new(RegistryTweak {
            id: "gaming_mmcss_audio_priority",
            name: "MMCSS Pro Audio: Prioridade Alta para Pipeline de Áudio",
            category: TweakCategory::Gaming,
            description: "Eleva prioridade de escalonamento e I/O da fila Audio no MMCSS para evitar estalos e atraso sonoro quando a CPU está em 90–100%.",
            benchmark_note: "Recomendado em guias LatencyMon / DAW de baixa latência para estabilizar buffers WASAPI.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Audio",
                        "GPU Priority",
                        8,
                    ),
                    RegistryOriginalValue::Dword(8),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Audio",
                        "Priority",
                        6,
                    ),
                    RegistryOriginalValue::Dword(6),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Audio",
                        "Scheduling Category",
                        "High",
                    ),
                    RegistryOriginalValue::String("Medium".into()),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::string(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile\Tasks\Audio",
                        "SFIO Priority",
                        "High",
                    ),
                    RegistryOriginalValue::String("Normal".into()),
                ),
            ],
        }),
        // 9. Dynamic SvcHostSplitThresholdInKB
        Box::new(DynamicSvcHostSplitTweak),
    ]
}
