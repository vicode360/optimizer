use crate::security::backup::{RegistryHive, RegistryOriginalValue};

use super::registry::RegistrySpec;
use super::services::{SERVICE_START_AUTO, SERVICE_START_DEMAND};
use super::{
    RegistryTweak, RegistryTweakEntry, ServiceTweak, Tweak, TweakCategory, TweakImpact, TweakRisk,
};

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        // 1. Disable Telemetry Services (DiagTrack & dmwappushservice)
        Box::new(ServiceTweak {
            id: "debloat_telemetry_services",
            name: "Desativar Serviços de Telemetria (DiagTrack e dmwappushservice)",
            category: TweakCategory::Debloat,
            description: "Para e desabilita via Win32 SCM os serviços de coleta diagnóstica Connected User Experiences and Telemetry e WAP Push.",
            benchmark_note: "Playbooks AtlasOS/WinUtil: elimina wakes periódicos de CPU/disco e envios contínuos de pacotes diagnósticos.",
            impact: TweakImpact::High,
            risk: TweakRisk::Moderate,
            services: &[
                ("DiagTrack", SERVICE_START_AUTO),
                ("dmwappushservice", SERVICE_START_DEMAND),
            ],
            extra_registry: vec![],
            require_system_ssd: false,
        }),
        // 2. Telemetry Policy Minimum (AllowTelemetry = 0)
        Box::new(RegistryTweak {
            id: "debloat_telemetry_policy",
            name: "Política de Telemetria no Nível Mínimo (AllowTelemetry=0)",
            category: TweakCategory::Debloat,
            description: "Aplica políticas de DataCollection reduzindo envio de telemetria ao nível mínimo permitido e silenciando prompts de feedback.",
            benchmark_note: "CIS Benchmark / Microsoft Enterprise Policy: reduz coleta diagnóstica em segundo plano.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\DataCollection",
                        "AllowTelemetry",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\DataCollection",
                        "DoNotShowFeedbackNotifications",
                        1,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 3. Disable Bing Web Search in Start Menu
        Box::new(RegistryTweak {
            id: "debloat_disable_bing_search",
            name: "Desativar Busca Web/Bing no Menu Iniciar",
            category: TweakCategory::Debloat,
            description: "Mantém a busca do Menu Iniciar estritamente local, eliminando requisições HTTPS externas ao Bing a cada tecla digitada.",
            benchmark_note: "Resposta instantânea do Menu Iniciar e redução de processos SearchHost/WebView em background.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Policies\Microsoft\Windows\Explorer",
                        "DisableSearchBoxSuggestions",
                        1,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Search",
                        "BingSearchEnabled",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 4. Disable Cortana & Copilot Background Hooks
        Box::new(RegistryTweak {
            id: "debloat_disable_copilot_cortana",
            name: "Desativar Cortana e Windows Copilot em Segundo Plano",
            category: TweakCategory::Debloat,
            description: "Desliga a inicialização e integração do Copilot/Cortana no shell do Windows via políticas oficiais.",
            benchmark_note: "Economiza processos WebView2 ociosos e memória residente no Explorer.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\Windows Search",
                        "AllowCortana",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot",
                        "TurnOffWindowsCopilot",
                        1,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 5. Disable Consumer Features, Lock Screen Ads & Silent App Installs
        Box::new(RegistryTweak {
            id: "debloat_disable_consumer_features",
            name: "Desativar Consumer Features, Sugestões e Instalações Silenciosas",
            category: TweakCategory::Debloat,
            description: "Bloqueia recomendações promocionais da Microsoft Store, dicas na tela de bloqueio e instalação silenciosa de apps patrocinados.",
            benchmark_note: "WinUtil / Microsoft CloudContent Policy: impede downloads automáticos de bloatware em segundo plano.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\CloudContent",
                        "DisableWindowsConsumerFeatures",
                        1,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
                        "SubscribedContent-338389Enabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
                        "SystemPaneSuggestionsEnabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
                        "SoftLandingEnabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
                        "SilentInstalledAppsEnabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
            ],
        }),
        // 6. Disable Activity History Collection
        Box::new(RegistryTweak {
            id: "debloat_disable_activity_history",
            name: "Desativar Coleta e Sincronização de Histórico de Atividade",
            category: TweakCategory::Debloat,
            description: "Desliga o feed de atividades locais e o upload do histórico de uso de aplicativos para a nuvem da Microsoft.",
            benchmark_note: "Reduz escritas contínuas no banco SQLite de ActivityCache e tráfego de sincronização.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\System",
                        "EnableActivityFeed",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\System",
                        "PublishUserActivities",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SOFTWARE\Policies\Microsoft\Windows\System",
                        "UploadUserActivities",
                        0,
                    ),
                    RegistryOriginalValue::Absent,
                ),
            ],
        }),
        // 7. Disable Background UWP Apps
        Box::new(RegistryTweak {
            id: "debloat_disable_background_uwp_apps",
            name: "Bloquear Execução de Apps UWP em Segundo Plano",
            category: TweakCategory::Debloat,
            description: "Define GlobalUserDisabled=1 impedindo que aplicativos da Microsoft Store permaneçam ativos em memória sem uso.",
            benchmark_note: "AtlasOS / WinUtil: libera RAM residente e evita spikes aleatórios de CPU causados por tarefas UWP em background.",
            impact: TweakImpact::High,
            risk: TweakRisk::Moderate,
            requires_admin: false,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications",
                        "GlobalUserDisabled",
                        1,
                    ),
                    RegistryOriginalValue::Dword(0),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hkcu,
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Search",
                        "BackgroundAppGlobalToggle",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
            ],
        }),
        // 8. Disable Windows Error Reporting (WerSvc) & MapsBroker
        Box::new(ServiceTweak {
            id: "debloat_disable_wer_and_maps",
            name: "Desativar Windows Error Reporting (WerSvc) e MapsBroker",
            category: TweakCategory::Debloat,
            description: "Desativa os serviços de relatório automático de falhas (WerSvc), gerenciador de mapas offline (MapsBroker) e serviços legados Fax/RetailDemo quando presentes.",
            benchmark_note: "Elimina geração pesada de memory dumps após crashes de jogos e processos de atualização de mapas não utilizados.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Safe,
            services: &[
                ("WerSvc", SERVICE_START_DEMAND),
                ("MapsBroker", SERVICE_START_AUTO),
                ("Fax", SERVICE_START_DEMAND),
                ("RetailDemo", SERVICE_START_DEMAND),
            ],
            extra_registry: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SOFTWARE\Microsoft\Windows\Windows Error Reporting",
                    "Disabled",
                    1,
                ),
                RegistryOriginalValue::Absent,
            )],
            require_system_ssd: false,
        }),
        // 9. Disable SysMain (Superfetch) ONLY when system drive is SSD/NVMe
        Box::new(ServiceTweak {
            id: "debloat_disable_sysmain_ssd",
            name: "Desativar SysMain (Superfetch) em Sistemas com SSD/NVMe",
            category: TweakCategory::Debloat,
            description: "Para e desativa o serviço de pré-carregamento preditivo SysMain somente quando o volume do sistema for SSD/NVMe (evitando I/O de leitura/escrita desnecessário).",
            benchmark_note: "Em SSDs NVMe/SATA modernos a leitura aleatória já é sub-milissegundo; desativar SysMain reduz tráfego de background e uso de RAM em cache especulativo.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Moderate,
            services: &[("SysMain", SERVICE_START_AUTO)],
            extra_registry: vec![],
            require_system_ssd: true,
        }),
    ]
}
