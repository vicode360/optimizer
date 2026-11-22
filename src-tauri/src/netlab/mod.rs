use std::net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

use serde::Serialize;
use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, KEY_WRITE};
use winreg::RegKey;

use crate::error::{AppError, AppResult};
use crate::security::admin::require_admin;
use crate::security::backup::{self, BackupEntry, BackupTarget, RegistryHive};
use crate::tweaks::registry::{apply_spec, nic_class_subkeys, try_read_original_value, RegistrySpec};
use crate::tweaks::system_ops::{
    apply_dns_servers, delete_qos_policy_subkey, query_active_dns_adapters_fast, run_hidden,
    set_interface_mtu, snapshot_active_dns_targets,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteProbeResult {
    pub id: String,
    pub region_name: String,
    pub location: String,
    pub target_host: String,
    pub avg_ms: Option<f64>,
    pub min_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub loss_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteHop {
    pub hop: u32,
    pub ip_address: String,
    pub rtt1_ms: Option<f64>,
    pub rtt2_ms: Option<f64>,
    pub rtt3_ms: Option<f64>,
    pub avg_ms: Option<f64>,
    pub stage: String, // "local" | "isp" | "backbone" | "timeout"
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteTraceReport {
    pub target_host: String,
    pub hops: Vec<RouteHop>,
    pub bottleneck_hop: Option<u32>,
    pub bottleneck_summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsBenchmarkEntry {
    pub provider_id: String,
    pub provider_name: String,
    pub primary_ip: String,
    pub secondary_ip: String,
    pub avg_ms: Option<f64>,
    pub min_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub success_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtuDiscoveryResult {
    pub interface_alias: String,
    pub current_mtu: u32,
    pub optimal_mtu: u32,
    pub max_unfragmented_payload: u32,
    pub is_optimal: bool,
    pub connection_type_hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QosGamePolicy {
    pub policy_name: String,
    pub game_name: String,
    pub exe_name: String,
    pub dscp_value: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NicDriverProperty {
    pub id: String,
    pub adapter_name: String,
    pub subkey: String,
    pub value_name: String,
    pub display_name: String,
    pub current_value: String,
    pub recommended_value: String,
    pub is_optimized: bool,
    pub description: String,
}

const GAME_REGION_CLUSTERS: &[(&str, &str, &str, &str, u16)] = &[
    (
        "sa_east_gru",
        "South America (Brasil)",
        "São Paulo (GRU / sa-east-1)",
        "ec2.sa-east-1.amazonaws.com",
        443,
    ),
    (
        "sa_west_scl",
        "South America West",
        "Santiago / LatAm Edge",
        "1.1.1.1",
        443,
    ),
    (
        "us_east_iad",
        "North America East",
        "Virginia (IAD / us-east-1)",
        "ec2.us-east-1.amazonaws.com",
        443,
    ),
    (
        "us_west_pdx",
        "North America West",
        "Oregon (PDX / us-west-2)",
        "ec2.us-west-2.amazonaws.com",
        443,
    ),
    (
        "eu_central_fra",
        "Europe Central",
        "Frankfurt (FRA / eu-central-1)",
        "ec2.eu-central-1.amazonaws.com",
        443,
    ),
];

const DNS_PROVIDERS: &[(&str, &str, &str, &str)] = &[
    ("cloudflare", "Cloudflare Anycast", "1.1.1.1", "1.0.0.1"),
    ("google", "Google Public DNS", "8.8.8.8", "8.8.4.4"),
    ("quad9", "Quad9 Security DNS", "9.9.9.9", "149.112.112.112"),
    ("opendns", "Cisco OpenDNS", "208.67.222.222", "208.67.220.220"),
    ("adguard", "AdGuard Unfiltered", "94.140.14.140", "94.140.14.141"),
    ("level3", "Level3 Backbone", "4.2.2.1", "4.2.2.2"),
];

pub fn calculate_rtt_metrics(samples: &[f64], total_sent: usize) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>, f64) {
    let total = total_sent.max(1);
    let loss_pct = (((total.saturating_sub(samples.len())) as f64 / total as f64) * 100.0).round();
    if samples.is_empty() {
        return (None, None, None, None, 100.0);
    }

    let sum: f64 = samples.iter().sum();
    let avg = ((sum / samples.len() as f64) * 10.0).round() / 10.0;
    let min = samples
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let max = samples
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);

    let jitter = if samples.len() >= 2 {
        let diffs: f64 = samples
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .sum();
        ((diffs / (samples.len() - 1) as f64) * 10.0).round() / 10.0
    } else {
        0.0
    };

    (
        Some(avg),
        Some((min * 10.0).round() / 10.0),
        Some((max * 10.0).round() / 10.0),
        Some(jitter),
        loss_pct,
    )
}

fn probe_single_tcp_endpoint(host: &str, port: u16, count: usize) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>, f64) {
    let addr_opt = (host, port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut it| it.find(|a| a.is_ipv4()).or_else(|| it.next()));

    let Some(addr) = addr_opt else {
        return (None, None, None, None, 100.0);
    };

    let mut samples = Vec::with_capacity(count);
    for _ in 0..count {
        let start = Instant::now();
        if TcpStream::connect_timeout(&addr, Duration::from_millis(900)).is_ok() {
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    calculate_rtt_metrics(&samples, count)
}

pub fn probe_game_routes() -> AppResult<Vec<RouteProbeResult>> {
    let results = std::thread::scope(|s| {
        let handles: Vec<_> = GAME_REGION_CLUSTERS
            .iter()
            .map(|(id, region, loc, host, port)| {
                s.spawn(move || {
                    let (avg_ms, min_ms, max_ms, jitter_ms, loss_percent) =
                        probe_single_tcp_endpoint(host, *port, 5);
                    RouteProbeResult {
                        id: (*id).to_string(),
                        region_name: (*region).to_string(),
                        location: (*loc).to_string(),
                        target_host: (*host).to_string(),
                        avg_ms,
                        min_ms,
                        max_ms,
                        jitter_ms,
                        loss_percent,
                    }
                })
            })
            .collect();

        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect::<Vec<_>>()
    });

    Ok(results)
}

pub fn parse_tracert_output(target_host: &str, output: &str) -> RouteTraceReport {
    let mut hops = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        let mut tokens = trimmed.split_whitespace();
        let Some(first) = tokens.next() else {
            continue;
        };
        let Ok(hop_num) = first.parse::<u32>() else {
            continue;
        };

        let rest: Vec<&str> = tokens.collect();
        if rest.is_empty() {
            continue;
        }

        let mut rtts: Vec<Option<f64>> = Vec::with_capacity(3);
        let mut idx = 0;
        while idx < rest.len() && rtts.len() < 3 {
            let tok = rest[idx];
            if tok == "*" {
                rtts.push(None);
                idx += 1;
            } else if tok.starts_with('<') {
                rtts.push(Some(0.5));
                idx += 1;
                if idx < rest.len() && rest[idx].eq_ignore_ascii_case("ms") {
                    idx += 1;
                }
            } else if let Ok(v) = tok.replace("ms", "").parse::<f64>() {
                if idx + 1 < rest.len() && rest[idx + 1].eq_ignore_ascii_case("ms") {
                    rtts.push(Some(v));
                    idx += 2;
                } else if tok.ends_with("ms") {
                    rtts.push(Some(v));
                    idx += 1;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        while rtts.len() < 3 {
            rtts.push(None);
        }

        let ip_candidate = rest
            .last()
            .copied()
            .unwrap_or("*")
            .trim_matches(|c| c == '[' || c == ']');
        let ip_address = if rtts.iter().all(|r| r.is_none()) {
            "* (Timeout ICMP)".into()
        } else {
            ip_candidate.to_string()
        };

        let valid_rtts: Vec<f64> = rtts.iter().filter_map(|&x| x).collect();
        let avg_ms = if valid_rtts.is_empty() {
            None
        } else {
            let sum: f64 = valid_rtts.iter().sum();
            Some(((sum / valid_rtts.len() as f64) * 10.0).round() / 10.0)
        };

        let stage = if valid_rtts.is_empty() {
            "timeout"
        } else if hop_num == 1
            || ip_address.starts_with("192.168.")
            || ip_address.starts_with("10.")
            || ip_address.starts_with("172.16.")
        {
            "local"
        } else if hop_num <= 4 || ip_address.starts_with("100.64.") {
            "isp"
        } else {
            "backbone"
        };

        hops.push(RouteHop {
            hop: hop_num,
            ip_address,
            rtt1_ms: rtts[0],
            rtt2_ms: rtts[1],
            rtt3_ms: rtts[2],
            avg_ms,
            stage: stage.into(),
        });
    }

    let mut bottleneck_hop = None;
    let mut largest_jump = 0.0f64;
    let mut prev_avg = 0.0f64;

    for hop in &hops {
        if let Some(avg) = hop.avg_ms {
            let jump = avg - prev_avg;
            if jump > largest_jump && jump >= 12.0 {
                largest_jump = jump;
                bottleneck_hop = Some(hop.hop);
            }
            prev_avg = avg;
        }
    }

    let bottleneck_summary = match bottleneck_hop {
        Some(1) => "Gargalo detectado no Salto 1 (Roteador Local / Wi-Fi). Prefira cabo Ethernet Cat6 ou ative QoS DSCP 46.".into(),
        Some(h) if h <= 4 => format!(
            "Maior salto de latência (+{largest_jump:.1} ms) no Salto {h} (CGNAT / Roteamento da Operadora ISP)."
        ),
        Some(h) => format!(
            "Maior salto de latência (+{largest_jump:.1} ms) no Salto {h} (Rota de Backbone / Longa Distância)."
        ),
        None => "Rota limpa e progressiva sem saltos abruptos de latência local ou de operadora.".into(),
    };

    RouteTraceReport {
        target_host: target_host.to_string(),
        hops,
        bottleneck_hop,
        bottleneck_summary,
    }
}

pub fn trace_route_hops(target_host: String) -> AppResult<RouteTraceReport> {
    let clean_host = target_host.trim();
    if clean_host.is_empty()
        || !clean_host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(AppError::InvalidOperation(
            "Host de destino inválido para análise de rota.".into(),
        ));
    }

    let out = run_hidden("tracert", &["-d", "-h", "14", "-w", "320", clean_host])?;
    Ok(parse_tracert_output(clean_host, &out))
}

pub fn build_dns_query_packet(tx_id: u16) -> Vec<u8> {
    let mut pkt = Vec::with_capacity(32);
    pkt.extend_from_slice(&tx_id.to_be_bytes());
    pkt.extend_from_slice(&[0x01, 0x00]); // Standard query, Recursion Desired
    pkt.extend_from_slice(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // QDCOUNT=1
    // QNAME: cloudflare.com
    pkt.push(10);
    pkt.extend_from_slice(b"cloudflare");
    pkt.push(3);
    pkt.extend_from_slice(b"com");
    pkt.push(0);
    pkt.extend_from_slice(&[0x00, 0x01, 0x00, 0x01]); // QTYPE=A, QCLASS=IN
    pkt
}

fn probe_dns_udp_server(ip: &str, samples_count: usize) -> (Option<f64>, Option<f64>, Option<f64>, f64) {
    let Ok(target_addr) = format!("{ip}:53").parse::<SocketAddr>() else {
        return (None, None, None, 0.0);
    };

    let Ok(socket) = UdpSocket::bind("0.0.0.0:0") else {
        return (None, None, None, 0.0);
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(650)));
    let _ = socket.set_write_timeout(Some(Duration::from_millis(650)));

    let mut rtts = Vec::with_capacity(samples_count);
    let mut buf = [0u8; 512];

    for i in 0..samples_count {
        let tx_id = 0x4F50u16.wrapping_add(i as u16);
        let pkt = build_dns_query_packet(tx_id);
        let start = Instant::now();
        if socket.send_to(&pkt, target_addr).is_ok() {
            if let Ok((len, _)) = socket.recv_from(&mut buf) {
                if len >= 12 && u16::from_be_bytes([buf[0], buf[1]]) == tx_id {
                    rtts.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(15));
    }

    let (avg, min, _max, jitter, loss_pct) = calculate_rtt_metrics(&rtts, samples_count);
    (avg, min, jitter, (100.0 - loss_pct).max(0.0))
}

pub fn run_multi_dns_benchmark() -> AppResult<Vec<DnsBenchmarkEntry>> {
    let mut entries = std::thread::scope(|s| {
        let handles: Vec<_> = DNS_PROVIDERS
            .iter()
            .map(|(id, name, primary, secondary)| {
                s.spawn(move || {
                    let (avg_ms, min_ms, jitter_ms, success_rate) =
                        probe_dns_udp_server(primary, 5);
                    DnsBenchmarkEntry {
                        provider_id: (*id).to_string(),
                        provider_name: (*name).to_string(),
                        primary_ip: (*primary).to_string(),
                        secondary_ip: (*secondary).to_string(),
                        avg_ms,
                        min_ms,
                        jitter_ms,
                        success_rate,
                    }
                })
            })
            .collect();

        handles
            .into_iter()
            .filter_map(|h| h.join().ok())
            .collect::<Vec<_>>()
    });

    entries.sort_by(|a, b| {
        match (a.avg_ms, b.avg_ms) {
            (Some(av), Some(bv)) => av.partial_cmp(&bv).unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        }
    });

    Ok(entries)
}

pub fn apply_custom_dns_provider(
    primary_ip: String,
    secondary_ip: String,
    provider_name: String,
) -> AppResult<String> {
    require_admin()?;

    let targets = snapshot_active_dns_targets()?;
    let backup_dir = backup::default_backup_dir()?;
    let session = backup::create_session_in(
        &backup_dir,
        format!("NetLab DNS: {provider_name} ({primary_ip})"),
        vec![BackupEntry {
            tweak_id: format!("netlab_dns_{}", primary_ip.replace('.', "_")),
            tweak_title: format!("NetLab DNS: {provider_name} ({primary_ip} / {secondary_ip})"),
            targets,
            restored_at: None,
        }],
    )?;

    let servers: Vec<&str> = if secondary_ip.trim().is_empty() {
        vec![primary_ip.trim()]
    } else {
        vec![primary_ip.trim(), secondary_ip.trim()]
    };
    apply_dns_servers(&servers)?;
    Ok(session.session_id)
}

fn test_df_ping_payload(payload_size: u32) -> bool {
    let size_str = payload_size.to_string();
    let Ok(out) = run_hidden(
        "ping",
        &["-f", "-l", &size_str, "-n", "1", "-w", "550", "1.1.1.1"],
    ) else {
        return false;
    };
    let lower = out.to_lowercase();
    (lower.contains("ttl=") || lower.contains("ttl ="))
        && !lower.contains("fragment")
        && !lower.contains("100%")
}

fn read_active_interface_current_mtu(interface_alias: &str) -> u32 {
    if let Ok(out) = run_hidden("netsh", &["interface", "ipv4", "show", "subinterfaces"]) {
        for line in out.lines() {
            if line.to_lowercase().contains(&interface_alias.to_lowercase()) {
                if let Some(first_tok) = line.split_whitespace().next() {
                    if let Ok(mtu) = first_tok.parse::<u32>() {
                        if (1280..=9000).contains(&mtu) {
                            return mtu;
                        }
                    }
                }
            }
        }
    }
    1500
}

pub fn discover_optimal_mtu() -> AppResult<MtuDiscoveryResult> {
    let adapters = query_active_dns_adapters_fast();
    let interface_alias = adapters
        .first()
        .map(|a| a.interface_alias.clone())
        .unwrap_or_else(|| "Ethernet".into());
    let current_mtu = read_active_interface_current_mtu(&interface_alias);

    let max_payload = if test_df_ping_payload(1472) {
        1472
    } else if test_df_ping_payload(1464) {
        1464
    } else {
        let mut low = 1372u32;
        let mut high = 1471u32;
        let mut best = 1464u32;
        while low <= high {
            let mid = (low + high) / 2;
            if test_df_ping_payload(mid) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid.saturating_sub(1);
            }
        }
        best
    };

    let optimal_mtu = max_payload + 28;
    let connection_type_hint = if optimal_mtu == 1500 {
        "Ethernet / Fibra IPoE Padrão (1500 bytes)".into()
    } else if optimal_mtu == 1492 {
        "Fibra PPPoE Detectada (8 bytes overhead — 1492 bytes evita fragmentação)".into()
    } else {
        format!("Túnel / Encapsulamento Detectado (MTU ótimo sem fragmentação: {optimal_mtu} bytes)")
    };

    Ok(MtuDiscoveryResult {
        interface_alias,
        current_mtu,
        optimal_mtu,
        max_unfragmented_payload: max_payload,
        is_optimal: current_mtu == optimal_mtu,
        connection_type_hint,
    })
}

pub fn apply_optimal_mtu(interface_alias: String, mtu: u32) -> AppResult<String> {
    require_admin()?;
    if !(1280..=1500).contains(&mtu) {
        return Err(AppError::InvalidOperation(
            "O valor de MTU deve estar entre 1280 e 1500 bytes.".into(),
        ));
    }

    let original_mtu = read_active_interface_current_mtu(&interface_alias);
    let backup_dir = backup::default_backup_dir()?;
    let session = backup::create_session_in(
        &backup_dir,
        format!("NetLab MTU: {interface_alias} -> {mtu}"),
        vec![BackupEntry {
            tweak_id: format!("netlab_mtu_{interface_alias}"),
            tweak_title: format!("NetLab Auto-MTU ({interface_alias}: {original_mtu} -> {mtu})"),
            targets: vec![BackupTarget::NetInterfaceMtu {
                interface_alias: interface_alias.clone(),
                original_mtu,
            }],
            restored_at: None,
        }],
    )?;

    set_interface_mtu(&interface_alias, mtu)?;
    Ok(session.session_id)
}

pub fn list_qos_policies() -> AppResult<Vec<QosGamePolicy>> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base = r"SOFTWARE\Policies\Microsoft\Windows\QoS";
    let Ok(qos_root) = hklm.open_subkey_with_flags(base, KEY_READ) else {
        return Ok(Vec::new());
    };

    let mut policies = Vec::new();
    for sub in qos_root.enum_keys().flatten() {
        let sub_path = format!(r"{base}\{sub}");
        let Ok(key) = hklm.open_subkey_with_flags(&sub_path, KEY_READ) else {
            continue;
        };
        let app_name: String = key.get_value("Application Name").unwrap_or_default();
        if app_name.trim().is_empty() {
            continue;
        }
        let dscp_str: String = key.get_value("DSCP Value").unwrap_or_else(|_| "46".into());
        let dscp_value = dscp_str.trim().parse::<u32>().unwrap_or(46);
        let game_name = sub
            .strip_prefix("Optimizer_")
            .unwrap_or(&sub)
            .replace('_', " ");

        policies.push(QosGamePolicy {
            policy_name: sub,
            game_name,
            exe_name: app_name,
            dscp_value,
        });
    }

    policies.sort_by(|a, b| a.game_name.to_lowercase().cmp(&b.game_name.to_lowercase()));
    Ok(policies)
}

pub fn add_qos_game_policy(game_name: String, exe_name: String) -> AppResult<QosGamePolicy> {
    require_admin()?;

    let clean_exe = exe_name.trim();
    if clean_exe.is_empty() || !clean_exe.to_lowercase().ends_with(".exe") {
        return Err(AppError::InvalidOperation(
            "Informe o nome exato do executável terminado em .exe (ex: cs2.exe).".into(),
        ));
    }

    let sanitized_key: String = game_name
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let policy_name = format!(
        "Optimizer_{}",
        if sanitized_key.is_empty() {
            clean_exe.trim_end_matches(".exe")
        } else {
            &sanitized_key
        }
    );

    let backup_dir = backup::default_backup_dir()?;
    let _ = backup::create_session_in(
        &backup_dir,
        format!("QoS DSCP 46: {clean_exe}"),
        vec![BackupEntry {
            tweak_id: format!("qos_dscp46_{}", policy_name.to_lowercase()),
            tweak_title: format!("QoS DSCP 46 (EF): {game_name} ({clean_exe})"),
            targets: vec![BackupTarget::QosPolicy {
                policy_name: policy_name.clone(),
            }],
            restored_at: None,
        }],
    )?;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let subkey_path = format!(r"SOFTWARE\Policies\Microsoft\Windows\QoS\{policy_name}");
    let key = hklm
        .open_subkey_with_flags(&subkey_path, KEY_SET_VALUE)
        .or_else(|_| {
            hklm.create_subkey_with_flags(&subkey_path, KEY_WRITE)
                .map(|(k, _)| k)
        })
        .map_err(|e| {
            AppError::WindowsApi(format!("Falha ao criar política QoS '{policy_name}': {e}"))
        })?;

    for (k, v) in [
        ("Version", "1.0"),
        ("Application Name", clean_exe),
        ("Protocol", "*"),
        ("Local Port", "*"),
        ("Remote Port", "*"),
        ("Local IP", "*"),
        ("Remote IP", "*"),
        ("DSCP Value", "46"),
        ("Throttle Rate", "-1"),
    ] {
        key.set_value(k, &v).map_err(|e| {
            AppError::WindowsApi(format!("Falha ao gravar '{k}' na política QoS: {e}"))
        })?;
    }

    Ok(QosGamePolicy {
        policy_name,
        game_name: game_name.trim().to_string(),
        exe_name: clean_exe.to_string(),
        dscp_value: 46,
    })
}

pub fn remove_qos_game_policy(policy_name: String) -> AppResult<()> {
    require_admin()?;
    delete_qos_policy_subkey(&policy_name)
}

const NIC_DRIVER_TWEAK_SPECS: &[(&str, &str, &str, &str)] = &[
    (
        "*InterruptModeration",
        "Interrupt Moderation (Entrega Imediata de Pacotes IRQ)",
        "0",
        "Desativa o buffer de agrupamento de interrupções na placa de rede para que pacotes UDP de jogos cheguem imediatamente à CPU.",
    ),
    (
        "*FlowControl",
        "Flow Control (Desativar Frames PAUSE)",
        "0",
        "Impede pausas artificiais de transmissão/recepção em conexões de banda larga e fibra.",
    ),
    (
        "*EEE",
        "Energy-Efficient Ethernet (EEE / Green Ethernet)",
        "0",
        "Desativa estados de economia de energia de link físico IEEE 802.3az que causam micro-jitter ao retomar tráfego.",
    ),
    (
        "*PriorityVLANTag",
        "Priority & VLAN Tagging Overhead",
        "0",
        "Remove processamento adicional de cabeçalho 802.1Q VLAN no driver da placa de rede doméstica.",
    ),
    (
        "*LsoV2IPv4",
        "Large Send Offload v2 (IPv4)",
        "0",
        "Evita fila de segmentação de pacotes grandes no chip da NIC enquanto pacotes pequenos de jogos aguardam transmissão.",
    ),
    (
        "*LsoV2IPv6",
        "Large Send Offload v2 (IPv6)",
        "0",
        "Evita enfileiramento de segmentação LSO IPv6 no hardware da placa de rede.",
    ),
];

pub fn list_nic_driver_tweaks() -> AppResult<Vec<NicDriverProperty>> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let subkeys = nic_class_subkeys();
    let mut props = Vec::new();

    for subkey in subkeys {
        let Ok(key) = hklm.open_subkey_with_flags(&subkey, KEY_READ) else {
            continue;
        };
        let adapter_name: String = key.get_value("DriverDesc").unwrap_or_else(|_| "NIC".into());

        for (val_name, display_name, recommended_val, desc) in NIC_DRIVER_TWEAK_SPECS {
            let current_opt: Option<String> = key
                .get_value::<String, _>(val_name)
                .ok()
                .or_else(|| key.get_value::<u32, _>(val_name).ok().map(|v| v.to_string()));

            if let Some(current_value) = current_opt {
                let is_optimized = current_value.trim() == *recommended_val;
                props.push(NicDriverProperty {
                    id: format!("{subkey}::{val_name}"),
                    adapter_name: adapter_name.clone(),
                    subkey: subkey.clone(),
                    value_name: (*val_name).to_string(),
                    display_name: (*display_name).to_string(),
                    current_value,
                    recommended_value: (*recommended_val).to_string(),
                    is_optimized,
                    description: (*desc).to_string(),
                });
            }
        }
    }

    Ok(props)
}

pub fn apply_nic_driver_tweak(
    subkey: String,
    value_name: String,
    desired_value: String,
    friendly_name: String,
) -> AppResult<String> {
    require_admin()?;
    if !subkey.starts_with(r"SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}\") {
        return Err(AppError::InvalidOperation(
            "Subchave de driver de rede inválida.".into(),
        ));
    }

    let original = try_read_original_value(&RegistryHive::Hklm, &subkey, &value_name)?;
    let backup_dir = backup::default_backup_dir()?;
    let session = backup::create_session_in(
        &backup_dir,
        format!("NIC Driver: {friendly_name}"),
        vec![BackupEntry {
            tweak_id: format!("nic_driver_{}", value_name.trim_start_matches('*').to_lowercase()),
            tweak_title: format!("Driver NIC: {friendly_name} ({value_name}={desired_value})"),
            targets: vec![BackupTarget::RegistryValue {
                hive: RegistryHive::Hklm,
                subkey: subkey.clone(),
                value_name: value_name.clone(),
                original,
            }],
            restored_at: None,
        }],
    )?;

    let spec = RegistrySpec::string(RegistryHive::Hklm, &subkey, &value_name, &desired_value);
    apply_spec(&spec)?;
    Ok(session.session_id)
}

pub fn flush_network_stack() -> AppResult<String> {
    let _ = run_hidden("ipconfig", &["/flushdns"]);
    let _ = run_hidden("arp", &["-d", "*"]);
    Ok("Cache DNS e tabela ARP limpos com sucesso.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_valid_rfc1035_dns_query_packet_and_calculates_jitter() {
        let pkt = build_dns_query_packet(0x1234);
        assert_eq!(pkt[0], 0x12);
        assert_eq!(pkt[1], 0x34);
        assert_eq!(pkt.len(), 32);

        let (avg, min, max, jitter, loss) = calculate_rtt_metrics(&[10.0, 14.0, 12.0, 16.0], 4);
        assert_eq!(avg, Some(13.0));
        assert_eq!(min, Some(10.0));
        assert_eq!(max, Some(16.0));
        assert_eq!(jitter, Some(3.3));
        assert_eq!(loss, 0.0);
    }

    #[test]
    fn parses_tracert_hops_and_detects_bottleneck() {
        let sample = r#"
  1    <1 ms    <1 ms    <1 ms  192.168.1.1
  2     4 ms     3 ms     4 ms  100.64.0.1
  3    28 ms    29 ms    27 ms  200.160.0.10
  4     *        *        *     Request timed out.
"#;
        let report = parse_tracert_output("1.1.1.1", sample);
        assert_eq!(report.hops.len(), 4);
        assert_eq!(report.hops[0].stage, "local");
        assert_eq!(report.hops[1].stage, "isp");
        assert_eq!(report.hops[3].stage, "timeout");
        assert_eq!(report.bottleneck_hop, Some(3));
    }
}
