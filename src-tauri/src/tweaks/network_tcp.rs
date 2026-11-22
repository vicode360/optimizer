use crate::error::{AppError, AppResult};
use crate::security::backup::{BackupTarget, RegistryHive, RegistryOriginalValue};

use super::registry::{
    active_tcpip_interface_subkeys, apply_spec, is_spec_applied, nic_class_subkeys,
    revert_registry_target, snapshot_spec, RegistrySpec,
};
use super::system_ops::{
    adapters_match_primary_dns, apply_dns_servers, query_active_dns_adapters,
    query_netsh_ip_global, query_netsh_supplemental_provider, query_netsh_tcp_global_map,
    revert_all_active_dns_to_dhcp, set_netsh_ip_global, set_netsh_supplemental_provider,
    set_netsh_tcp_global, snapshot_active_dns_targets,
};
use super::{
    RegistryTweak, RegistryTweakEntry, Tweak, TweakCategory, TweakEvalContext, TweakImpact,
    TweakRisk,
};

struct TcpNoDelayTweak;

impl TcpNoDelayTweak {
    fn specs(&self) -> Vec<RegistrySpec> {
        let mut specs = vec![RegistrySpec::dword(
            RegistryHive::Hklm,
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile",
            "NetworkThrottlingIndex",
            0xFFFF_FFFF,
        )];

        for subkey in active_tcpip_interface_subkeys() {
            specs.push(RegistrySpec::dword(
                RegistryHive::Hklm,
                &subkey,
                "TcpAckFrequency",
                1,
            ));
            specs.push(RegistrySpec::dword(
                RegistryHive::Hklm,
                &subkey,
                "TCPNoDelay",
                1,
            ));
            specs.push(RegistrySpec::dword(
                RegistryHive::Hklm,
                &subkey,
                "TcpDelAckTicks",
                0,
            ));
        }

        specs
    }
}

impl Tweak for TcpNoDelayTweak {
    fn id(&self) -> &'static str {
        "network_tcp_nodelay"
    }

    fn name(&self) -> &'static str {
        "Desativar Algoritmo de Nagle (TCPNoDelay) e Network Throttling"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Network
    }

    fn description(&self) -> &'static str {
        "Remove o agrupamento de pacotes TCP (Nagle) e o atraso de ACK nas interfaces ativas, além de remover o teto de 10 pacotes/ms do MMCSS NetworkThrottlingIndex."
    }

    fn technical_detail(&self) -> String {
        r"HKLM\...\Multimedia\SystemProfile :: NetworkThrottlingIndex -> 0xFFFFFFFF
HKLM\...\Tcpip\Parameters\Interfaces\<ativa> :: TcpAckFrequency=1, TCPNoDelay=1, TcpDelAckTicks=0"
            .into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Reduz RTT efetivo em jogos baseados em TCP/MMOs ao enviar pacotes pequenos imediatamente sem aguardar 200ms de Delayed ACK."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Moderate
    }

    fn is_applied(&self) -> Result<bool, String> {
        let specs = self.specs();
        Ok(!specs.is_empty() && specs.iter().all(is_spec_applied))
    }

    fn apply(&self) -> Result<(), String> {
        for spec in &self.specs() {
            apply_spec(spec).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn revert(&self) -> Result<(), String> {
        revert_registry_target(
            &RegistryHive::Hklm,
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile",
            "NetworkThrottlingIndex",
            &RegistryOriginalValue::Dword(10),
        )
        .map_err(|e| e.to_string())?;
        for subkey in active_tcpip_interface_subkeys() {
            for val in ["TcpAckFrequency", "TCPNoDelay", "TcpDelAckTicks"] {
                revert_registry_target(
                    &RegistryHive::Hklm,
                    &subkey,
                    val,
                    &RegistryOriginalValue::Absent,
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        Ok(self.specs().iter().map(snapshot_spec).collect())
    }
}

struct DnsProviderTweak {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    benchmark_note: &'static str,
    servers: &'static [&'static str],
}

impl Tweak for DnsProviderTweak {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Network
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn technical_detail(&self) -> String {
        format!(
            "PowerShell :: Set-DnsClientServerAddress -ServerAddresses @({}) + ipconfig /flushdns",
            self.servers.join(", ")
        )
    }

    fn benchmark_note(&self) -> &'static str {
        self.benchmark_note
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::Medium
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Safe
    }

    fn is_applicable(&self, ctx: &TweakEvalContext) -> bool {
        !ctx.active_dns_adapters.is_empty()
    }

    fn is_applied(&self) -> Result<bool, String> {
        let adapters = query_active_dns_adapters().map_err(|e| e.to_string())?;
        Ok(adapters_match_primary_dns(&adapters, self.servers[0]))
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        Ok(adapters_match_primary_dns(
            &ctx.active_dns_adapters,
            self.servers[0],
        ))
    }

    fn apply(&self) -> Result<(), String> {
        apply_dns_servers(self.servers).map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        revert_all_active_dns_to_dhcp().map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        snapshot_active_dns_targets()
    }
}

struct NicPowerSavingTweak;

impl NicPowerSavingTweak {
    fn specs(&self) -> Vec<RegistrySpec> {
        nic_class_subkeys()
            .into_iter()
            .map(|subkey| RegistrySpec::dword(RegistryHive::Hklm, &subkey, "PnPCapabilities", 24))
            .collect()
    }
}

impl Tweak for NicPowerSavingTweak {
    fn id(&self) -> &'static str {
        "network_disable_nic_power_saving"
    }

    fn name(&self) -> &'static str {
        "Desativar Economia de Energia do Adaptador de Rede (PnPCapabilities)"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Network
    }

    fn description(&self) -> &'static str {
        "Define PnPCapabilities=24 (0x18) nos adaptadores físicos de rede para impedir que o Windows desligue a NIC em ociosidade."
    }

    fn technical_detail(&self) -> String {
        r"HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}\00xx :: PnPCapabilities -> REG_DWORD=24 (0x18)".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Documentação Microsoft NDIS: evita picos de latência (wakeup delay) e desconexões breves causadas por gerenciamento de energia da NIC."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Safe
    }

    fn is_applicable(&self, ctx: &TweakEvalContext) -> bool {
        !ctx.nic_subkeys.is_empty()
    }

    fn is_applied(&self) -> Result<bool, String> {
        let specs = self.specs();
        Ok(!specs.is_empty() && specs.iter().all(is_spec_applied))
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        if ctx.nic_subkeys.is_empty() {
            return Ok(false);
        }
        Ok(ctx.nic_subkeys.iter().all(|subkey| {
            is_spec_applied(&RegistrySpec::dword(
                RegistryHive::Hklm,
                subkey,
                "PnPCapabilities",
                24,
            ))
        }))
    }

    fn apply(&self) -> Result<(), String> {
        let specs = self.specs();
        if specs.is_empty() {
            return Err("Nenhum adaptador de rede físico encontrado na classe Net.".into());
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
                "Nenhum adaptador de rede físico encontrado para backup.".into(),
            ));
        }
        Ok(specs.iter().map(snapshot_spec).collect())
    }
}

struct NetshTcpGlobalTweak {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    benchmark_note: &'static str,
    impact: TweakImpact,
    risk: TweakRisk,
    setting: &'static str,
    desired_value: &'static str,
    default_value: &'static str,
}

impl Tweak for NetshTcpGlobalTweak {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Network
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn technical_detail(&self) -> String {
        format!("netsh int tcp set global {}={}", self.setting, self.desired_value)
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
        let map = query_netsh_tcp_global_map();
        Ok(map
            .get(self.setting)
            .map(|v| v.eq_ignore_ascii_case(self.desired_value))
            .unwrap_or(false))
    }

    fn is_applied_with_ctx(&self, ctx: &TweakEvalContext) -> Result<bool, String> {
        Ok(ctx
            .tcp_global
            .get(self.setting)
            .map(|v| v.eq_ignore_ascii_case(self.desired_value))
            .unwrap_or(false))
    }

    fn apply(&self) -> Result<(), String> {
        set_netsh_tcp_global(self.setting, self.desired_value).map_err(|e| e.to_string())
    }

    fn revert(&self) -> Result<(), String> {
        set_netsh_tcp_global(self.setting, self.default_value).map_err(|e| e.to_string())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let map = query_netsh_tcp_global_map();
        let original = map
            .get(self.setting)
            .cloned()
            .unwrap_or_else(|| self.default_value.to_string());
        Ok(vec![BackupTarget::NetshTcpGlobal {
            setting: self.setting.to_string(),
            original_value: original,
        }])
    }
}

struct TcpBbr2Tweak;

impl TcpBbr2Tweak {
    const MIN_WIN11_22H2_BUILD: u32 = 22621;
}

impl Tweak for TcpBbr2Tweak {
    fn id(&self) -> &'static str {
        "network_tcp_congestion_bbr2"
    }

    fn name(&self) -> &'static str {
        "Provedor de Congestionamento TCP BBRv2 (Internet)"
    }

    fn category(&self) -> TweakCategory {
        TweakCategory::Network
    }

    fn description(&self) -> &'static str {
        "Ativa o algoritmo model-based Google BBRv2 nos templates TCP Internet/InternetCustom (com mitigação de loopbacklargemtu) para reduzir bufferbloat sob carga."
    }

    fn technical_detail(&self) -> String {
        "netsh int tcp set supplemental template=Internet congestionprovider=bbr2\nnetsh int tcp set supplemental template=InternetCustom congestionprovider=bbr2\nnetsh int ipv4 set global loopbacklargemtu=disable\nnetsh int ipv6 set global loopbacklargemtu=disable".into()
    }

    fn benchmark_note(&self) -> &'static str {
        "Papers ACM/Google BBRv2: reduz latência de fila (bufferbloat) e mantém throughput em links com perda moderada. Avançado: reverta para CUBIC se notar incompatibilidade com VPNs ou proxies locais."
    }

    fn impact(&self) -> TweakImpact {
        TweakImpact::High
    }

    fn risk(&self) -> TweakRisk {
        TweakRisk::Advanced
    }

    fn hardware_note(&self, ctx: &TweakEvalContext) -> Option<String> {
        if ctx.windows_build < Self::MIN_WIN11_22H2_BUILD {
            Some(format!(
                "Requer Windows 11 22H2+ (build >= 22621). Build atual: {}.",
                ctx.windows_build
            ))
        } else {
            Some(format!("Windows build {} compatível com BBRv2.", ctx.windows_build))
        }
    }

    fn is_applicable(&self, ctx: &TweakEvalContext) -> bool {
        ctx.windows_build >= Self::MIN_WIN11_22H2_BUILD
    }

    fn is_applied(&self) -> Result<bool, String> {
        Ok(query_netsh_supplemental_provider("Internet")
            .map(|p| p.eq_ignore_ascii_case("bbr2"))
            .unwrap_or(false))
    }

    fn apply(&self) -> Result<(), String> {
        set_netsh_supplemental_provider("Internet", "bbr2").map_err(|e| e.to_string())?;
        set_netsh_supplemental_provider("InternetCustom", "bbr2").map_err(|e| e.to_string())?;
        set_netsh_ip_global("ipv4", "loopbacklargemtu", "disable").map_err(|e| e.to_string())?;
        set_netsh_ip_global("ipv6", "loopbacklargemtu", "disable").map_err(|e| e.to_string())?;
        Ok(())
    }

    fn revert(&self) -> Result<(), String> {
        set_netsh_supplemental_provider("Internet", "cubic").map_err(|e| e.to_string())?;
        set_netsh_supplemental_provider("InternetCustom", "cubic").map_err(|e| e.to_string())?;
        set_netsh_ip_global("ipv4", "loopbacklargemtu", "enable").map_err(|e| e.to_string())?;
        set_netsh_ip_global("ipv6", "loopbacklargemtu", "enable").map_err(|e| e.to_string())?;
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let orig_internet =
            query_netsh_supplemental_provider("Internet").unwrap_or_else(|| "cubic".into());
        let orig_custom = query_netsh_supplemental_provider("InternetCustom")
            .unwrap_or_else(|| orig_internet.clone());
        let orig_v4_mtu = query_netsh_ip_global("ipv4", "loopbacklargemtu")
            .unwrap_or_else(|| "enable".into());
        let orig_v6_mtu = query_netsh_ip_global("ipv6", "loopbacklargemtu")
            .unwrap_or_else(|| "enable".into());

        Ok(vec![
            BackupTarget::NetshSupplementalTcp {
                template: "Internet".into(),
                original_provider: orig_internet,
            },
            BackupTarget::NetshSupplementalTcp {
                template: "InternetCustom".into(),
                original_provider: orig_custom,
            },
            BackupTarget::NetshIpGlobal {
                family: "ipv4".into(),
                setting: "loopbacklargemtu".into(),
                original_value: orig_v4_mtu,
            },
            BackupTarget::NetshIpGlobal {
                family: "ipv6".into(),
                setting: "loopbacklargemtu".into(),
                original_value: orig_v6_mtu,
            },
        ])
    }
}

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        Box::new(TcpNoDelayTweak),
        Box::new(DnsProviderTweak {
            id: "network_dns_cloudflare",
            name: "DNS de Baixa Latência Cloudflare (1.1.1.1 / 1.0.0.1)",
            description: "Configura servidores DNS Cloudflare anycast nas interfaces ativas com limpeza de cache DNS e backup do estado DHCP original.",
            benchmark_note: "DNSPerf Global: consistentemente entre os menores tempos médios de resolução DNS (<15ms).",
            servers: &["1.1.1.1", "1.0.0.1"],
        }),
        Box::new(DnsProviderTweak {
            id: "network_dns_google",
            name: "DNS de Baixa Latência Google (8.8.8.8 / 8.8.4.4)",
            description: "Configura servidores DNS públicos Google nas interfaces ativas com limpeza de cache DNS e backup do estado DHCP original.",
            benchmark_note: "Alternativa anycast de alta disponibilidade com suporte completo a DNSSEC e DoH.",
            servers: &["8.8.8.8", "8.8.4.4"],
        }),
        Box::new(NicPowerSavingTweak),
        Box::new(RegistryTweak {
            id: "network_disable_delivery_optimization",
            name: "Desativar Delivery Optimization P2P do Windows Update",
            category: TweakCategory::Network,
            description: "Define DODownloadMode=0 impedindo que o Windows compartilhe atualizações via P2P em segundo plano e sature o upload.",
            benchmark_note: "Evita picos súbitos de bufferbloat e ping causados por uploads P2P de atualizações durante sessões online.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization",
                    "DODownloadMode",
                    0,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        Box::new(NetshTcpGlobalTweak {
            id: "network_tcp_autotuning_normal",
            name: "TCP Receive Window Auto-Tuning (normal)",
            description: "Garante que o ajuste dinâmico de janela TCP permaneça em 'normal' para maximizar throughput sem estrangulamento artificial.",
            benchmark_note: "Documentação Microsoft Networking: desativar auto-tuning reduz severamente velocidade em conexões de alta largura de banda (>100 Mbps).",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            setting: "autotuninglevel",
            desired_value: "normal",
            default_value: "normal",
        }),
        Box::new(NetshTcpGlobalTweak {
            id: "network_tcp_rss_enabled",
            name: "Ativar Receive Side Scaling (RSS)",
            description: "Distribui o processamento de interrupções e pacotes recebidos da placa de rede entre múltiplos núcleos de CPU.",
            benchmark_note: "Microsoft NDIS / LatencyMon: impede saturação DPC do Core 0 sob tráfego de rede intenso.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            setting: "rss",
            desired_value: "enabled",
            default_value: "enabled",
        }),
        Box::new(NetshTcpGlobalTweak {
            id: "network_tcp_rsc_disabled",
            name: "Desativar Receive Segment Coalescing (RSC)",
            description: "Impede que a NIC ou driver agrupe múltiplos pacotes TCP antes de entregá-los ao sistema operacional.",
            benchmark_note: "Reduz jitter e latência de entrega de pacotes interativos em jogos competitivos (elimina buffering no driver da NIC).",
            impact: TweakImpact::High,
            risk: TweakRisk::Moderate,
            setting: "rsc",
            desired_value: "disabled",
            default_value: "enabled",
        }),
        Box::new(NetshTcpGlobalTweak {
            id: "network_tcp_ecn_disabled",
            name: "Desativar ECN Capability Global",
            description: "Mantém Explicit Congestion Notification desativado para evitar retransmissões e descartes em roteadores/firewalls domésticos incompatíveis.",
            benchmark_note: "Evita stalls de handshake TCP em equipamentos residenciais que descartam bits ECN.",
            impact: TweakImpact::Low,
            risk: TweakRisk::Moderate,
            setting: "ecncapability",
            desired_value: "disabled",
            default_value: "disabled",
        }),
        Box::new(TcpBbr2Tweak),
    ]
}
