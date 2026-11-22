use crate::security::backup::{RegistryHive, RegistryOriginalValue};

use super::registry::RegistrySpec;
use super::{RegistryTweak, RegistryTweakEntry, Tweak, TweakCategory, TweakImpact, TweakRisk};

pub fn tweaks() -> Vec<Box<dyn Tweak>> {
    vec![
        // 1. Disable LLMNR (EnableMulticast = 0)
        Box::new(RegistryTweak {
            id: "security_disable_llmnr",
            name: "Desativar LLMNR (Link-Local Multicast Name Resolution)",
            category: TweakCategory::Security,
            description: "Desliga a resolução multicast local (EnableMulticast=0), impedindo ataques de envenenamento LLMNR e captura de hashes NTLMv2 em redes compartilhadas.",
            benchmark_note: "CIS Benchmark / Microsoft Security Baseline: fecha o vetor #1 de spoofing local (Responder) e reduz tráfego multicast ocioso.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SOFTWARE\Policies\Microsoft\Windows NT\DNSClient",
                    "EnableMulticast",
                    0,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 2. Disable Legacy SMBv1 Protocol
        Box::new(RegistryTweak {
            id: "security_disable_smbv1",
            name: "Desativar Protocolo Legado SMBv1 no Servidor Lanman",
            category: TweakCategory::Security,
            description: "Força SMB1=0 em LanmanServer\\Parameters garantindo que apenas SMBv2/v3 criptografados sejam negociados.",
            benchmark_note: "Microsoft Security Baseline / CISA: elimina permanentemente a superfície de exploits críticos como EternalBlue/WannaCry.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters",
                    "SMB1",
                    0,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 3. Restrict Anonymous / Null Sessions (SAM & Shares)
        Box::new(RegistryTweak {
            id: "security_restrict_null_sessions",
            name: "Restringir Sessões Anônimas e Nulas (SAM e Shares)",
            category: TweakCategory::Security,
            description: "Bloqueia enumeração não autenticada de compartilhamentos, named pipes e contas locais via RestrictNullSessAccess=1 e RestrictAnonymous=1.",
            benchmark_note: "CIS Level 1 / DISA STIG: endurece o subsistema LSA e LanmanServer sem impacto mensurável de CPU.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters",
                        "RestrictNullSessAccess",
                        1,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SYSTEM\CurrentControlSet\Control\Lsa",
                        "RestrictAnonymous",
                        1,
                    ),
                    RegistryOriginalValue::Dword(0),
                ),
            ],
        }),
        // 4. Require SMB Client Cryptographic Signing
        Box::new(RegistryTweak {
            id: "security_require_smb_signing",
            name: "Exigir Assinatura Criptográfica SMB no Cliente",
            category: TweakCategory::Security,
            description: "Habilita assinatura obrigatória de pacotes SMB (RequireSecuritySignature=1) no cliente LanmanWorkstation contra ataques SMB Relay / MITM.",
            benchmark_note: "Microsoft Security Baseline (Windows 11 24H2+): protege integridade de conexões de rede local com aceleração AES-NI.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters",
                    "RequireSecuritySignature",
                    1,
                ),
                RegistryOriginalValue::Dword(0),
            )],
        }),
        // 5. Enable Automatic DNS-over-HTTPS (DoH)
        Box::new(RegistryTweak {
            id: "security_enable_dns_over_https",
            name: "Ativar DNS-over-HTTPS (DoH) Automático no Sistema",
            category: TweakCategory::Security,
            description: "Define EnableAutoDoh=2 no serviço Dnscache para promover consultas DNS para HTTPS criptografado automaticamente quando o servidor (ex.: 1.1.1.1 / 8.8.8.8) suportar.",
            benchmark_note: "Microsoft Networking Security: impede DNS hijacking e inspeção em texto claro pelo ISP/roteador sem degradar throughput.",
            impact: TweakImpact::Medium,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Services\Dnscache\Parameters",
                    "EnableAutoDoh",
                    2,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 6. Disable WDigest Plaintext Credentials in LSASS Memory
        Box::new(RegistryTweak {
            id: "security_disable_wdigest_plaintext",
            name: "Bloquear Cache de Senhas em Texto Claro (WDigest)",
            category: TweakCategory::Security,
            description: "Garante UseLogonCredential=0 no provedor WDigest, impedindo armazenamento de credenciais em texto puro na memória do processo LSASS.",
            benchmark_note: "CIS Benchmark / MITRE ATT&CK M1043: mitigação essencial contra extração de credenciais em memória (Mimikatz).",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest",
                    "UseLogonCredential",
                    0,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 7. Disable AutoRun / AutoPlay Across All Drive Types
        Box::new(RegistryTweak {
            id: "security_disable_autorun",
            name: "Bloquear AutoRun e AutoPlay em Todas as Unidades",
            category: TweakCategory::Security,
            description: "Aplica máscara NoDriveTypeAutoRun=255 (0xFF) bloqueando execução automática de dispositivos USB, mídias removíveis e drives de rede.",
            benchmark_note: "CIS Level 1 / DISA STIG / CISA: previne execução automática de malware ao conectar pendrives.",
            impact: TweakImpact::High,
            risk: TweakRisk::Safe,
            requires_admin: true,
            entries: vec![RegistryTweakEntry::new(
                RegistrySpec::dword(
                    RegistryHive::Hklm,
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer",
                    "NoDriveTypeAutoRun",
                    255,
                ),
                RegistryOriginalValue::Absent,
            )],
        }),
        // 8. VBS / HVCI (Memory Integrity) Performance vs Security Toggle (Advanced)
        Box::new(RegistryTweak {
            id: "security_disable_vbs_hvci_gaming",
            name: "Desativar VBS / Memory Integrity (HVCI) para Máximo FPS",
            category: TweakCategory::Security,
            description: "Desabilita a camada de virtualização VBS e Integridade de Memória (HVCI) no DeviceGuard para recuperar overhead de CPU em jogos. Requer reinicialização.",
            benchmark_note: "CapFrameX / Tom's Hardware / Microsoft: recupera 3% a 10% de FPS médio e estabiliza 1% lows em cenários CPU-bound. ATENÇÃO: reduz isolamento de kernel e é incompatível com anti-cheats que exigem HVCI (ex.: Vanguard).",
            impact: TweakImpact::High,
            risk: TweakRisk::Advanced,
            requires_admin: true,
            entries: vec![
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SYSTEM\CurrentControlSet\Control\DeviceGuard",
                        "EnableVirtualizationBasedSecurity",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
                RegistryTweakEntry::new(
                    RegistrySpec::dword(
                        RegistryHive::Hklm,
                        r"SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity",
                        "Enabled",
                        0,
                    ),
                    RegistryOriginalValue::Dword(1),
                ),
            ],
        }),
    ]
}
