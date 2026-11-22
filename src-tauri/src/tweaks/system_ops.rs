use std::collections::HashMap;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Deserialize;
use sysinfo::{DiskKind, Disks, MemoryRefreshKind, RefreshKind, System};

use crate::error::{AppError, AppResult};
use crate::scanner::hardware::{read_active_power_plan, PowerPlanInfo};
use crate::security::backup::{BackupTarget, RegistryHive, RegistryOriginalValue};

use super::registry::read_original_value;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub const ULTIMATE_PERF_GUID: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";
pub const HIGH_PERF_GUID: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
pub const BALANCED_PERF_GUID: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";

pub const SUBGROUP_USB: &str = "2a737441-1930-4402-8d77-b2bebba308a3";
pub const SETTING_USB_SELECTIVE_SUSPEND: &str = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226";

pub const SUBGROUP_PCIE: &str = "501a4d13-42af-4429-9fd1-a8218c268e20";
pub const SETTING_PCIE_ASPM: &str = "ee12f906-d277-404b-b6da-e5fa1a576dc5";

pub const SUBGROUP_PROCESSOR: &str = "54533251-82be-4824-96c1-47b60b740d00";
pub const SETTING_PROC_MIN_STATE: &str = "893dee8e-2bef-41e0-89c6-b55d0929964c";

#[cfg(windows)]
pub fn decode_console_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(utf8) = std::str::from_utf8(bytes) {
        return utf8.to_string();
    }

    use windows::Win32::Globalization::{GetOEMCP, MultiByteToWideChar, MULTI_BYTE_TO_WIDE_CHAR_FLAGS};

    unsafe {
        let cp = GetOEMCP();
        let len = MultiByteToWideChar(cp, MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0), bytes, None);
        if len > 0 {
            let mut wide = vec![0u16; len as usize];
            let written =
                MultiByteToWideChar(cp, MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0), bytes, Some(&mut wide));
            if written > 0 {
                return String::from_utf16_lossy(&wide[..written as usize]);
            }
        }
    }

    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(not(windows))]
pub fn decode_console_bytes(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub fn run_hidden(program: &str, args: &[&str]) -> AppResult<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd
        .output()
        .map_err(|e| AppError::WindowsApi(format!("Falha ao executar '{program}': {e}")))?;

    let stdout = decode_console_bytes(&output.stdout).trim().to_string();
    let stderr = decode_console_bytes(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(AppError::WindowsApi(format!(
            "Comando '{program}' retornou erro ({}): {detail}",
            output.status
        )));
    }

    Ok(stdout)
}

#[derive(Debug, Clone)]
pub struct SystemSpecs {
    pub total_ram_kb: u32,
    pub total_ram_gb: f64,
    pub system_drive_is_ssd: bool,
    pub system_drive_kind: String,
}

#[cfg(windows)]
fn detect_ssd_via_wmi_storage() -> Option<bool> {
    #[derive(Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct MsftPhysicalDisk {
        media_type: Option<u16>,
        bus_type: Option<u16>,
    }

    std::thread::spawn(|| -> Option<bool> {
        let com = wmi::COMLibrary::new().ok()?;
        let wmi_con = wmi::WMIConnection::with_namespace_path(
            r"ROOT\Microsoft\Windows\Storage",
            com,
        )
        .ok()?;
        let disks: Vec<MsftPhysicalDisk> = wmi_con
            .raw_query("SELECT MediaType, BusType FROM MSFT_PhysicalDisk")
            .ok()?;
        if disks.is_empty() {
            return None;
        }
        let has_ssd = disks
            .iter()
            .any(|d| d.media_type == Some(4) || d.bus_type == Some(17));
        Some(has_ssd)
    })
    .join()
    .ok()
    .flatten()
}

#[cfg(not(windows))]
fn detect_ssd_via_wmi_storage() -> Option<bool> {
    None
}

impl SystemSpecs {
    pub fn detect() -> Self {
        let sys = System::new_with_specifics(
            RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()),
        );
        let total_bytes = sys.total_memory();
        let total_kb_u64 = total_bytes / 1024;
        let total_ram_kb = u32::try_from(total_kb_u64).unwrap_or(u32::MAX);
        let total_ram_gb = total_bytes as f64 / 1_073_741_824.0;

        let sys_drive = std::env::var("SystemDrive")
            .unwrap_or_else(|_| "C:".to_string())
            .to_ascii_uppercase();

        let disks = Disks::new_with_refreshed_list();
        let mut system_drive_is_ssd = false;
        let mut system_drive_kind = "Unknown".to_string();

        for disk in disks.list() {
            let mount = disk.mount_point().to_string_lossy().to_ascii_uppercase();
            if mount.starts_with(&sys_drive) {
                match disk.kind() {
                    DiskKind::SSD => {
                        system_drive_is_ssd = true;
                        system_drive_kind = "SSD".to_string();
                    }
                    DiskKind::HDD => {
                        system_drive_is_ssd = false;
                        system_drive_kind = "HDD".to_string();
                    }
                    DiskKind::Unknown(_) => {
                        if let Some(is_ssd) = detect_ssd_via_wmi_storage() {
                            system_drive_is_ssd = is_ssd;
                            system_drive_kind = if is_ssd {
                                "SSD (WMI)".to_string()
                            } else {
                                "HDD (WMI)".to_string()
                            };
                        } else {
                            system_drive_kind = "Unknown".to_string();
                        }
                    }
                }
                break;
            }
        }

        Self {
            total_ram_kb,
            total_ram_gb,
            system_drive_is_ssd,
            system_drive_kind,
        }
    }
}

pub fn recommended_svchost_split_kb(total_ram_kb: u32) -> u32 {
    let min_kb: u32 = 4 * 1024 * 1024;
    total_ram_kb.max(min_kb)
}

pub fn is_plan_high_performance(active: &PowerPlanInfo) -> bool {
    let guid = active.guid.to_ascii_lowercase();
    let name = active.name.to_ascii_lowercase();
    guid == ULTIMATE_PERF_GUID
        || guid == HIGH_PERF_GUID
        || name.contains("ultimate")
        || name.contains("desempenho máximo")
        || name.contains("desempenho maximo")
        || name.contains("high performance")
        || name.contains("alto desempenho")
}

pub fn snapshot_power_plan() -> AppResult<BackupTarget> {
    let mut active = read_active_power_plan();
    if active.guid.is_empty() || active.guid == "unknown" {
        if let Ok(out) = run_hidden("powercfg", &["/getactivescheme"]) {
            if let Some(guid) = extract_guid_from_line(&out) {
                active.guid = guid;
            }
        }
    }
    if active.guid.is_empty() || active.guid == "unknown" {
        return Err(AppError::BackupError(
            "Não foi possível identificar o GUID do plano de energia ativo para backup.".into(),
        ));
    }
    Ok(BackupTarget::PowerPlan {
        original_scheme_guid: active.guid,
        original_scheme_name: active.name,
    })
}

pub fn is_high_performance_active() -> bool {
    let active = read_active_power_plan();
    is_plan_high_performance(&active)
}

fn extract_guid_from_line(line: &str) -> Option<String> {
    for token in line.split_whitespace() {
        let trimmed = token.trim_matches(|c| c == '(' || c == ')' || c == '{' || c == '}');
        if trimmed.len() == 36 && trimmed.chars().filter(|&c| c == '-').count() == 4 {
            return Some(trimmed.to_ascii_lowercase());
        }
    }
    None
}

pub fn apply_ultimate_performance() -> AppResult<String> {
    let list_out = run_hidden("powercfg", &["/list"])?;
    let mut target_guid: Option<String> = None;

    for line in list_out.lines() {
        let lower = line.to_lowercase();
        if lower.contains(ULTIMATE_PERF_GUID)
            || lower.contains("ultimate performance")
            || lower.contains("desempenho máximo")
            || lower.contains("desempenho maximo")
        {
            if let Some(guid) = extract_guid_from_line(line) {
                target_guid = Some(guid);
                break;
            }
        }
    }

    if target_guid.is_none() {
        if let Ok(dup_out) = run_hidden("powercfg", &["-duplicatescheme", ULTIMATE_PERF_GUID]) {
            target_guid = extract_guid_from_line(&dup_out);
        }
    }

    let guid_to_activate = target_guid.unwrap_or_else(|| HIGH_PERF_GUID.to_string());
    if run_hidden("powercfg", &["/setactive", &guid_to_activate]).is_ok() {
        return Ok(guid_to_activate);
    }

    run_hidden("powercfg", &["/setactive", HIGH_PERF_GUID])?;
    Ok(HIGH_PERF_GUID.to_string())
}

pub fn revert_power_plan(original_scheme_guid: &str) -> AppResult<()> {
    if original_scheme_guid.is_empty() || original_scheme_guid == "unknown" {
        return Err(AppError::BackupError(
            "GUID do plano de energia original está vazio ou desconhecido.".into(),
        ));
    }
    run_hidden("powercfg", &["/setactive", original_scheme_guid])?;
    Ok(())
}

pub fn parse_powercfg_ac_dc_indices(output: &str) -> Option<(u32, u32)> {
    let mut hex_values = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(idx) = trimmed.rfind("0x") {
            let candidate = trimmed[idx + 2..].trim();
            if !candidate.is_empty() && candidate.chars().all(|c| c.is_ascii_hexdigit()) {
                if let Ok(val) = u32::from_str_radix(candidate, 16) {
                    hex_values.push(val);
                }
            }
        }
    }

    if hex_values.len() >= 2 {
        let len = hex_values.len();
        Some((hex_values[len - 2], hex_values[len - 1]))
    } else {
        None
    }
}

pub fn query_power_setting_indices(
    scheme_guid: &str,
    subgroup_guid: &str,
    setting_guid: &str,
) -> AppResult<(u32, u32)> {
    let out = run_hidden("powercfg", &["/q", scheme_guid, subgroup_guid, setting_guid])?;
    parse_powercfg_ac_dc_indices(&out).ok_or_else(|| {
        AppError::WindowsApi(format!(
            "Não foi possível extrair índices AC/DC para '{setting_guid}' no esquema '{scheme_guid}'."
        ))
    })
}

pub fn set_power_setting_indices(
    scheme_guid: &str,
    subgroup_guid: &str,
    setting_guid: &str,
    ac_index: u32,
    dc_index: Option<u32>,
) -> AppResult<()> {
    let ac_str = ac_index.to_string();
    run_hidden(
        "powercfg",
        &[
            "/setacvalueindex",
            scheme_guid,
            subgroup_guid,
            setting_guid,
            &ac_str,
        ],
    )?;

    if let Some(dc) = dc_index {
        let dc_str = dc.to_string();
        run_hidden(
            "powercfg",
            &[
                "/setdcvalueindex",
                scheme_guid,
                subgroup_guid,
                setting_guid,
                &dc_str,
            ],
        )?;
    }

    let active = read_active_power_plan();
    if active.guid.eq_ignore_ascii_case(scheme_guid) {
        run_hidden("powercfg", &["/setactive", scheme_guid])?;
    }
    Ok(())
}

pub fn is_hibernation_enabled() -> bool {
    match read_original_value(
        &RegistryHive::Hklm,
        r"SYSTEM\CurrentControlSet\Control\Power",
        "HibernateEnabled",
    ) {
        RegistryOriginalValue::Dword(v) => v != 0,
        _ => match read_original_value(
            &RegistryHive::Hklm,
            r"SYSTEM\CurrentControlSet\Control\Power",
            "HibernateEnabledDefault",
        ) {
            RegistryOriginalValue::Dword(v) => v != 0,
            _ => false,
        },
    }
}

pub fn set_hibernation(enabled: bool) -> AppResult<()> {
    let flag = if enabled { "on" } else { "off" };
    run_hidden("powercfg", &["/hibernate", flag])?;
    Ok(())
}

pub fn read_fsutil_registry_value(fsutil_key: &str) -> Option<u32> {
    let value_name = match fsutil_key {
        "disablelastaccess" => "NtfsDisableLastAccessUpdate",
        "disable8dot3" => "NtfsDisable8dot3NameCreation",
        "disabledeletenotify" => "DisableDeleteNotify",
        _ => return None,
    };

    match read_original_value(
        &RegistryHive::Hklm,
        r"SYSTEM\CurrentControlSet\Control\FileSystem",
        value_name,
    ) {
        RegistryOriginalValue::Dword(v) => {
            if fsutil_key == "disablelastaccess" {
                Some(v & 0x3)
            } else {
                Some(v)
            }
        }
        _ => None,
    }
}

pub fn parse_fsutil_query_value(output: &str) -> Option<u32> {
    for line in output.lines() {
        let rhs = line
            .split_once('=')
            .or_else(|| line.split_once(':'))
            .map(|(_, r)| r);
        if let Some(rhs) = rhs {
            if let Some(token) = rhs.split_whitespace().next() {
                if let Ok(v) = token.parse::<u32>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

pub fn query_fsutil_behavior(key: &str) -> AppResult<u32> {
    if let Some(v) = read_fsutil_registry_value(key) {
        return Ok(v);
    }
    let out = run_hidden("fsutil", &["behavior", "query", key])?;
    parse_fsutil_query_value(&out).ok_or_else(|| {
        AppError::WindowsApi(format!("Não foi possível interpretar fsutil query '{key}'."))
    })
}

pub fn set_fsutil_behavior(key: &str, value: u32) -> AppResult<()> {
    let val_str = value.to_string();
    run_hidden("fsutil", &["behavior", "set", key, &val_str])?;
    Ok(())
}

fn normalize_netsh_value(raw: &str) -> String {
    let lower = raw.trim().to_lowercase();
    match lower.as_str() {
        "habilitado" | "ativado" | "enabled" => "enabled".into(),
        "desabilitado" | "desativado" | "disabled" => "disabled".into(),
        "permitido" | "allowed" => "allowed".into(),
        "padrão" | "padrao" | "default" => "default".into(),
        "restrito" | "restricted" => "restricted".into(),
        "altamente restrito" | "highlyrestricted" => "highlyrestricted".into(),
        "experimental" => "experimental".into(),
        "normal" => "normal".into(),
        other => other.to_string(),
    }
}

pub fn parse_netsh_tcp_global(output: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let Some((lhs, rhs)) = line.split_once(':') else {
            continue;
        };
        let key_lower = lhs.trim().to_lowercase();
        let val = normalize_netsh_value(rhs);

        if key_lower.contains("auto-tuning")
            || key_lower.contains("ajuste automático")
            || key_lower.contains("ajuste automatico")
        {
            map.insert("autotuninglevel".into(), val);
        } else if key_lower.contains("receive-side scaling")
            || key_lower.contains("lado de recebimento")
        {
            map.insert("rss".into(), val);
        } else if key_lower.contains("receive segment coalescing")
            || key_lower.contains("aglutinação de segmento")
            || key_lower.contains("aglutinacao de segmento")
            || key_lower.contains("coalesc")
        {
            map.insert("rsc".into(), val);
        } else if key_lower.contains("ecn") {
            map.insert("ecncapability".into(), val);
        } else if key_lower.contains("1323")
            || key_lower.contains("timestamp")
            || key_lower.contains("carimbo")
        {
            map.insert("timestamps".into(), val);
        }
    }
    map
}

pub fn query_netsh_tcp_global_map() -> HashMap<String, String> {
    match run_hidden("netsh", &["int", "tcp", "show", "global"]) {
        Ok(out) => parse_netsh_tcp_global(&out),
        Err(_) => HashMap::new(),
    }
}

pub fn set_netsh_tcp_global(setting: &str, value: &str) -> AppResult<()> {
    let arg = format!("{setting}={value}");
    run_hidden("netsh", &["int", "tcp", "set", "global", &arg])?;
    Ok(())
}

pub fn parse_netsh_ip_global_setting(output: &str, setting: &str) -> Option<String> {
    let target = setting.to_lowercase();
    for line in output.lines() {
        let Some((lhs, rhs)) = line.split_once(':') else {
            continue;
        };
        let key = lhs.trim().to_lowercase();
        if target == "loopbacklargemtu"
            && (key.contains("loopback large mtu")
                || key.contains("mtu grande de loopback")
                || key.contains("loopbacklargemtu"))
        {
            let norm = normalize_netsh_value(rhs);
            return Some(if norm == "disabled" {
                "disable".into()
            } else {
                "enable".into()
            });
        }
    }
    None
}

pub fn query_netsh_ip_global(family: &str, setting: &str) -> Option<String> {
    let out = run_hidden("netsh", &["int", family, "show", "global"]).ok()?;
    parse_netsh_ip_global_setting(&out, setting)
}

pub fn set_netsh_ip_global(family: &str, setting: &str, value: &str) -> AppResult<()> {
    let lowered = value.to_ascii_lowercase();
    let normalized = match lowered.as_str() {
        "enabled" | "enable" => "enable",
        "disabled" | "disable" => "disable",
        other => other,
    };
    let arg = format!("{setting}={normalized}");
    run_hidden("netsh", &["int", family, "set", "global", &arg])?;
    Ok(())
}

pub fn parse_netsh_supplemental_provider(output: &str, template: &str) -> Option<String> {
    let mut in_template = false;
    let target = template.to_ascii_lowercase();

    for line in output.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        if lower.starts_with("template ") || lower.starts_with("modelo ") {
            in_template = lower.ends_with(&target) || lower.contains(&format!(" {target}"));
            continue;
        }

        if in_template {
            if let Some((lhs, rhs)) = trimmed.split_once(':') {
                let key = lhs.trim().to_lowercase();
                if key.contains("congestion") || key.contains("congestionamento") {
                    return Some(normalize_netsh_value(rhs));
                }
            }
        }
    }

    for line in output.lines() {
        if let Some((lhs, rhs)) = line.split_once(':') {
            let key = lhs.trim().to_lowercase();
            if key.contains("congestion") || key.contains("congestionamento") {
                return Some(normalize_netsh_value(rhs));
            }
        }
    }

    None
}

pub fn query_netsh_supplemental_provider(template: &str) -> Option<String> {
    let template_arg = format!("template={template}");
    let out = run_hidden("netsh", &["int", "tcp", "show", "supplemental", &template_arg]).ok()?;
    parse_netsh_supplemental_provider(&out, template)
}

pub fn set_netsh_supplemental_provider(template: &str, provider: &str) -> AppResult<()> {
    let tmpl_arg = format!("template={template}");
    let prov_arg = format!("congestionprovider={provider}");
    run_hidden(
        "netsh",
        &["int", "tcp", "set", "supplemental", &tmpl_arg, &prov_arg],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ActiveDnsAdapter {
    pub interface_alias: String,
    #[serde(default)]
    pub server_addresses: Vec<String>,
    #[serde(default)]
    pub is_dhcp: bool,
}

const PS_UTF8_PREAMBLE: &str =
    "$utf8NoBom = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = $utf8NoBom; $OutputEncoding = $utf8NoBom;";

pub fn query_active_dns_adapters() -> AppResult<Vec<ActiveDnsAdapter>> {
    let script = format!(
        r#"{PS_UTF8_PREAMBLE}
$adapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object {{ $_.Status -eq 'Up' }}
if (-not $adapters) {{
  $adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {{ $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Loopback' }}
}}
$result = @()
foreach ($a in $adapters) {{
  $dns = Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
  $servers = @()
  if ($dns -and $dns.ServerAddresses) {{ $servers = @($dns.ServerAddresses) }}
  $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($a.InterfaceGuid)"
  $staticNs = (Get-ItemProperty -Path $regPath -Name NameServer -ErrorAction SilentlyContinue).NameServer
  $isDhcp = [string]::IsNullOrWhiteSpace($staticNs)
  $result += [PSCustomObject]@{{
    InterfaceAlias = $a.Name
    ServerAddresses = $servers
    IsDhcp = $isDhcp
  }}
}}
if ($result.Count -eq 0) {{ '[]' }} else {{ ConvertTo-Json -InputObject @($result) -Compress }}
"#
    );

    let out = run_hidden(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
    )?;

    let trimmed = out.trim_start_matches('\u{FEFF}').trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(Vec::new());
    }

    let parsed: Vec<ActiveDnsAdapter> = serde_json::from_str(trimmed).map_err(|e| {
        AppError::WindowsApi(format!("Falha ao interpretar adaptadores DNS: {e}"))
    })?;
    Ok(parsed)
}

pub fn adapters_match_primary_dns(adapters: &[ActiveDnsAdapter], primary_ip: &str) -> bool {
    !adapters.is_empty()
        && adapters.iter().all(|a| {
            a.server_addresses
                .first()
                .map(|s| s == primary_ip)
                .unwrap_or(false)
        })
}

pub fn snapshot_active_dns_targets() -> AppResult<Vec<BackupTarget>> {
    let adapters = query_active_dns_adapters()?;
    if adapters.is_empty() {
        return Err(AppError::InvalidOperation(
            "Nenhum adaptador de rede ativo encontrado para configurar DNS.".into(),
        ));
    }

    Ok(adapters
        .into_iter()
        .map(|a| BackupTarget::NetAdapterDns {
            interface_alias: a.interface_alias,
            was_dhcp: a.is_dhcp,
            original_servers: a.server_addresses,
        })
        .collect())
}

fn sanitize_ps_single_quoted(input: &str) -> String {
    input.replace('\'', "''")
}

pub fn apply_dns_servers(servers: &[&str]) -> AppResult<()> {
    let adapters = query_active_dns_adapters()?;
    if adapters.is_empty() {
        return Err(AppError::InvalidOperation(
            "Nenhum adaptador de rede ativo encontrado para configurar DNS.".into(),
        ));
    }

    let joined = servers
        .iter()
        .map(|s| format!("'{}'", sanitize_ps_single_quoted(s)))
        .collect::<Vec<_>>()
        .join(",");

    for adapter in adapters {
        let escaped = sanitize_ps_single_quoted(&adapter.interface_alias);
        let cmd = format!(
            "{PS_UTF8_PREAMBLE} Set-DnsClientServerAddress -InterfaceAlias '{escaped}' -ServerAddresses @({joined})"
        );
        run_hidden(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-Command", &cmd],
        )?;
    }

    let _ = run_hidden("ipconfig", &["/flushdns"]);
    Ok(())
}

pub fn revert_dns_target(
    interface_alias: &str,
    was_dhcp: bool,
    original_servers: &[String],
) -> AppResult<()> {
    if was_dhcp || original_servers.is_empty() {
        let name_arg = format!("name={interface_alias}");
        run_hidden(
            "netsh",
            &["interface", "ipv4", "set", "dnsservers", &name_arg, "source=dhcp"],
        )?;
    } else {
        let escaped = sanitize_ps_single_quoted(interface_alias);
        let joined = original_servers
            .iter()
            .map(|s| format!("'{}'", sanitize_ps_single_quoted(s)))
            .collect::<Vec<_>>()
            .join(",");
        let cmd = format!(
            "{PS_UTF8_PREAMBLE} Set-DnsClientServerAddress -InterfaceAlias '{escaped}' -ServerAddresses @({joined})"
        );
        run_hidden(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-Command", &cmd],
        )?;
    }
    let _ = run_hidden("ipconfig", &["/flushdns"]);
    Ok(())
}

pub fn revert_all_active_dns_to_dhcp() -> AppResult<()> {
    let adapters = query_active_dns_adapters()?;
    for adapter in adapters {
        revert_dns_target(&adapter.interface_alias, true, &[])?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn purge_standby_list() -> AppResult<u64> {
    use std::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_NOT_ALL_ASSIGNED, HANDLE, LUID, NTSTATUS,
    };
    use windows::Win32::Security::{
        AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED,
        TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcessToken, SetProcessWorkingSetSize,
    };

    const SYSTEM_MEMORY_LIST_INFORMATION: u32 = 80;
    const MEMORY_PURGE_STANDBY_LIST: u32 = 4;

    #[link(name = "ntdll")]
    extern "system" {
        fn NtSetSystemInformation(
            system_information_class: u32,
            system_information: *mut c_void,
            system_information_length: u32,
        ) -> NTSTATUS;
    }

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()),
    );
    let before_avail = sys.available_memory();

    unsafe {
        let h_process = GetCurrentProcess();
        let mut h_token = HANDLE::default();
        OpenProcessToken(
            h_process,
            TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            &mut h_token,
        )
        .map_err(|e| AppError::WindowsApi(format!("OpenProcessToken falhou: {e}")))?;

        let priv_name: Vec<u16> = "SeProfileSingleProcessPrivilege"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut luid = LUID::default();
        let lookup_res =
            LookupPrivilegeValueW(PCWSTR::null(), PCWSTR(priv_name.as_ptr()), &mut luid);
        if let Err(e) = lookup_res {
            let _ = CloseHandle(h_token);
            return Err(AppError::WindowsApi(format!(
                "LookupPrivilegeValueW falhou: {e}"
            )));
        }

        let tp = TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: SE_PRIVILEGE_ENABLED,
            }],
        };

        let adj_res = AdjustTokenPrivileges(h_token, false, Some(&tp), 0, None, None);
        let last_err = GetLastError();
        let _ = CloseHandle(h_token);
        adj_res.map_err(|e| {
            AppError::WindowsApi(format!(
                "AdjustTokenPrivileges(SeProfileSingleProcessPrivilege) falhou: {e}"
            ))
        })?;
        if last_err == ERROR_NOT_ALL_ASSIGNED {
            return Err(AppError::AdminRequired(
                "Privilégio SeProfileSingleProcessPrivilege não disponível no token atual.".into(),
            ));
        }

        let mut command_value = MEMORY_PURGE_STANDBY_LIST;
        let status = NtSetSystemInformation(
            SYSTEM_MEMORY_LIST_INFORMATION,
            &mut command_value as *mut u32 as *mut c_void,
            std::mem::size_of::<u32>() as u32,
        );

        if status.0 != 0 {
            return Err(AppError::WindowsApi(format!(
                "NtSetSystemInformation(MemoryPurgeStandbyList) retornou NTSTATUS {:#010X}",
                status.0 as u32
            )));
        }

        let _ = SetProcessWorkingSetSize(h_process, usize::MAX, usize::MAX);
    }

    sys.refresh_memory();
    let after_avail = sys.available_memory();
    Ok(after_avail.saturating_sub(before_avail))
}

#[cfg(not(windows))]
pub fn purge_standby_list() -> AppResult<u64> {
    Err(AppError::InvalidOperation(
        "Purga de Standby List disponível apenas no Windows.".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_powercfg_ac_dc_in_en_and_pt_br() {
        let sample_en = r#"
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)
    Current AC Power Setting Index: 0x00000001
    Current DC Power Setting Index: 0x00000000
"#;
        assert_eq!(parse_powercfg_ac_dc_indices(sample_en), Some((1, 0)));

        let sample_pt = r#"
GUID do Esquema de Energia: 381b4222-f694-41f0-9685-ff5bb260df2e  (Equilibrado)
    Índice da Configuração Atual de Energia CA: 0x00000064
    Índice da Configuração Atual de Energia CC: 0x00000005
"#;
        assert_eq!(parse_powercfg_ac_dc_indices(sample_pt), Some((100, 5)));
    }

    #[test]
    fn parses_netsh_tcp_and_ip_global_in_en_and_pt_br() {
        let sample_pt = r#"
Estado de Dimensionamento no Lado de Recebimento : habilitado
Nível de Ajuste Automático da Janela de Recebimento : normal
Recurso ECN : desabilitado
Estado de Aglutinação de Segmento de Recebimento : desabilitado
"#;
        let map_pt = parse_netsh_tcp_global(sample_pt);
        assert_eq!(map_pt.get("rss").map(String::as_str), Some("enabled"));
        assert_eq!(
            map_pt.get("autotuninglevel").map(String::as_str),
            Some("normal")
        );
        assert_eq!(map_pt.get("rsc").map(String::as_str), Some("disabled"));
        assert_eq!(
            map_pt.get("ecncapability").map(String::as_str),
            Some("disabled")
        );

        let ip_en = "Loopback Large MTU                  : enabled\n";
        assert_eq!(
            parse_netsh_ip_global_setting(ip_en, "loopbacklargemtu").as_deref(),
            Some("enable")
        );
        let ip_pt = "MTU Grande de Loopback              : desabilitado\n";
        assert_eq!(
            parse_netsh_ip_global_setting(ip_pt, "loopbacklargemtu").as_deref(),
            Some("disable")
        );
    }

    #[test]
    fn calculates_svchost_split_threshold_dynamically() {
        assert_eq!(recommended_svchost_split_kb(2 * 1024 * 1024), 4 * 1024 * 1024);
        assert_eq!(recommended_svchost_split_kb(16 * 1024 * 1024), 16 * 1024 * 1024);
        assert_eq!(recommended_svchost_split_kb(32 * 1024 * 1024), 32 * 1024 * 1024);
    }

    #[test]
    fn decodes_utf8_and_non_utf8_console_bytes_without_panic() {
        let utf8 = "Nível de Ajuste Automático".as_bytes();
        assert_eq!(decode_console_bytes(utf8), "Nível de Ajuste Automático");

        // CP850/CP437 non-UTF8 bytes: should decode cleanly via active OEM code page without replacement chars.
        let non_utf8: &[u8] = &[0x41, 0x75, 0x74, 0x6F, 0x6D, 0xA0, 0x74, 0x69, 0x63, 0x6F];
        let decoded = decode_console_bytes(non_utf8);
        assert!(!decoded.contains('\u{FFFD}'));
        assert!(decoded.starts_with("Autom"));
        assert!(decoded.ends_with("tico"));
    }

    #[test]
    fn parses_fsutil_colon_and_equals_and_normalizes_pt_br_supplemental_provider() {
        assert_eq!(
            parse_fsutil_query_value("The registry state is: 1 (Disable 8dot3 name creation on all volumes)."),
            Some(1)
        );
        assert_eq!(
            parse_fsutil_query_value("NTFS DisableDeleteNotify = 0  (Disabled)"),
            Some(0)
        );
        let sample_pt = "Modelo Internet\nProvedor de Congestionamento : Padrão\n";
        assert_eq!(
            parse_netsh_supplemental_provider(sample_pt, "Internet").as_deref(),
            Some("default")
        );
    }
}
