use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    pub name: String,
    pub version: String,
    pub hostname: String,
    pub arch: String,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub brand: String,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub frequency_mhz: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub driver_version: String,
    pub vram_bytes: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub kind: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub is_removable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapterInfo {
    pub name: String,
    pub mac_address: String,
    pub total_received_bytes: u64,
    pub total_transmitted_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerPlanInfo {
    pub guid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSummary {
    pub os: OsInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub gpus: Vec<GpuInfo>,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetworkAdapterInfo>,
    pub power_plan: PowerPlanInfo,
}

pub fn collect_hardware_summary() -> AppResult<HardwareSummary> {
    let refresh = RefreshKind::nothing()
        .with_cpu(CpuRefreshKind::everything())
        .with_memory(MemoryRefreshKind::everything());
    let mut sys = System::new_with_specifics(refresh);
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(120));
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let os = OsInfo {
        name: System::name().unwrap_or_else(|| "Windows".into()),
        version: System::os_version().unwrap_or_else(|| "Desconhecida".into()),
        hostname: System::host_name().unwrap_or_else(|| "localhost".into()),
        arch: System::cpu_arch(),
        uptime_seconds: System::uptime(),
    };

    let cpus = sys.cpus();
    let cpu = CpuInfo {
        brand: cpus
            .first()
            .map(|c| c.brand().trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "CPU Desconhecida".into()),
        physical_cores: sys.physical_core_count().unwrap_or(cpus.len()),
        logical_cores: cpus.len(),
        frequency_mhz: cpus.first().map(|c| c.frequency()).unwrap_or(0),
        usage_percent: sys.global_cpu_usage(),
    };

    let memory = MemoryInfo {
        total_bytes: sys.total_memory(),
        used_bytes: sys.used_memory(),
        available_bytes: sys.available_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
    };

    let disks_list = Disks::new_with_refreshed_list();
    let disks = disks_list
        .iter()
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().to_string(),
            mount_point: d.mount_point().to_string_lossy().to_string(),
            file_system: d.file_system().to_string_lossy().to_string(),
            kind: format!("{:?}", d.kind()),
            total_bytes: d.total_space(),
            available_bytes: d.available_space(),
            is_removable: d.is_removable(),
        })
        .collect();

    let networks_list = Networks::new_with_refreshed_list();
    let networks = networks_list
        .iter()
        .map(|(name, data)| NetworkAdapterInfo {
            name: name.clone(),
            mac_address: data.mac_address().to_string(),
            total_received_bytes: data.total_received(),
            total_transmitted_bytes: data.total_transmitted(),
        })
        .collect();

    let (gpus, power_plan) = std::thread::scope(|s| {
        let h_gpus = s.spawn(query_gpus_wmi);
        let h_plan = s.spawn(read_active_power_plan);
        (
            h_gpus.join().unwrap_or_default(),
            h_plan.join().unwrap_or_else(|_| read_active_power_plan()),
        )
    });

    Ok(HardwareSummary {
        os,
        cpu,
        memory,
        gpus,
        disks,
        networks,
        power_plan,
    })
}

fn decode_vram_bytes_from_raw(bytes: &[u8]) -> Option<u64> {
    if bytes.len() >= 8 {
        let val = u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]);
        if val > 0 {
            return Some(val);
        }
    } else if bytes.len() == 4 {
        let val = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as u64;
        if val > 0 {
            return Some(val);
        }
    }
    None
}

fn read_gpu_vram_map_from_registry() -> HashMap<String, u64> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let mut map = HashMap::new();
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let class_path = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";
    let Ok(class_key) = hklm.open_subkey_with_flags(class_path, KEY_READ) else {
        return map;
    };

    for sub in class_key.enum_keys().flatten() {
        if !sub.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let sub_path = format!(r"{class_path}\{sub}");
        let Ok(adapter_key) = hklm.open_subkey_with_flags(&sub_path, KEY_READ) else {
            continue;
        };

        let desc: String = adapter_key
            .get_value("DriverDesc")
            .or_else(|_| adapter_key.get_value("HardwareInformation.AdapterString"))
            .unwrap_or_default();
        let norm_desc = desc.trim().to_lowercase();
        if norm_desc.is_empty() {
            continue;
        }

        let vram = adapter_key
            .get_raw_value("HardwareInformation.qwMemorySize")
            .ok()
            .and_then(|raw| decode_vram_bytes_from_raw(&raw.bytes))
            .or_else(|| {
                adapter_key
                    .get_raw_value("HardwareInformation.MemorySize")
                    .ok()
                    .and_then(|raw| decode_vram_bytes_from_raw(&raw.bytes))
            });

        if let Some(bytes) = vram {
            let entry = map.entry(norm_desc).or_insert(0);
            *entry = (*entry).max(bytes);
        }
    }

    map
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WmiVideoController {
    name: Option<String>,
    driver_version: Option<String>,
    #[serde(rename = "AdapterRAM")]
    adapter_ram: Option<u64>,
    status: Option<String>,
}

fn query_gpus_wmi() -> Vec<GpuInfo> {
    let reg_vram_map = read_gpu_vram_map_from_registry();
    let Ok(com) = wmi::COMLibrary::new() else {
        return Vec::new();
    };
    let Ok(wmi_con) = wmi::WMIConnection::new(com) else {
        return Vec::new();
    };
    let rows: Vec<WmiVideoController> = wmi_con
        .raw_query("SELECT Name, DriverVersion, AdapterRAM, Status FROM Win32_VideoController")
        .unwrap_or_default();

    rows.into_iter()
        .map(|r| {
            let name = r.name.unwrap_or_else(|| "GPU Desconhecida".into());
            let wmi_vram = r.adapter_ram.unwrap_or(0);
            let reg_vram = reg_vram_map
                .get(&name.trim().to_lowercase())
                .copied()
                .unwrap_or(0);
            GpuInfo {
                name,
                driver_version: r.driver_version.unwrap_or_else(|| "-".into()),
                vram_bytes: reg_vram.max(wmi_vram),
                status: r.status.unwrap_or_else(|| "OK".into()),
            }
        })
        .collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WmiPowerPlan {
    element_name: Option<String>,
    #[serde(rename = "InstanceID")]
    instance_id: Option<String>,
}

pub fn read_active_power_plan() -> PowerPlanInfo {
    let from_wmi = std::thread::spawn(|| -> Option<PowerPlanInfo> {
        let com = wmi::COMLibrary::new().ok()?;
        let wmi_con = wmi::WMIConnection::with_namespace_path(r"ROOT\CIMV2\power", com).ok()?;
        let rows: Vec<WmiPowerPlan> = wmi_con
            .raw_query("SELECT ElementName, InstanceID FROM Win32_PowerPlan WHERE IsActive = True")
            .ok()?;

        let first = rows.into_iter().next()?;
        let raw_id = first.instance_id.unwrap_or_default();
        let guid = raw_id
            .split('{')
            .nth(1)
            .and_then(|s| s.split('}').next())
            .unwrap_or(&raw_id)
            .to_string();

        Some(PowerPlanInfo {
            guid,
            name: first.element_name.unwrap_or_else(|| "Desconhecido".into()),
        })
    })
    .join()
    .ok()
    .flatten();

    if let Some(plan) = from_wmi {
        return plan;
    }

    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let guid = hklm
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes")
        .and_then(|k| k.get_value::<String, _>("ActivePowerScheme"))
        .unwrap_or_else(|_| "unknown".into());

    PowerPlanInfo {
        name: resolve_known_power_plan_name(&guid),
        guid,
    }
}

fn resolve_known_power_plan_name(guid: &str) -> String {
    match guid.trim().to_ascii_lowercase().as_str() {
        "381b4222-f694-41f0-9685-ff5bb260df2e" => "Equilibrado".into(),
        "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" => "Alto Desempenho".into(),
        "a1841308-3541-4fab-bc81-f71556f20b4a" => "Economia de Energia".into(),
        "e9a42b02-d5df-448d-aa00-03f14749eb61" => "Desempenho Máximo (Ultimate Performance)".into(),
        other => format!("Plano ({other})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_64bit_vram_above_4gib_and_32bit_fallback() {
        let twelve_gib: u64 = 12 * 1024 * 1024 * 1024;
        assert_eq!(
            decode_vram_bytes_from_raw(&twelve_gib.to_le_bytes()),
            Some(twelve_gib)
        );
        let two_gib: u32 = 2 * 1024 * 1024 * 1024;
        assert_eq!(
            decode_vram_bytes_from_raw(&two_gib.to_le_bytes()),
            Some(two_gib as u64)
        );
        assert_eq!(decode_vram_bytes_from_raw(&0u64.to_le_bytes()), None);
    }
}
