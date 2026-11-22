use winreg::enums::{RegType, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, KEY_WRITE};
use winreg::{RegKey, RegValue};

use crate::error::{AppError, AppResult};
use crate::security::backup::{BackupTarget, RegistryHive, RegistryOriginalValue};

#[derive(Debug, Clone)]
pub enum DesiredRegistryValue {
    Dword(u32),
    Qword(u64),
    String(String),
    ExpandString(String),
    Binary(Vec<u8>),
    MultiString(Vec<String>),
}

#[derive(Debug, Clone)]
pub struct RegistrySpec {
    pub hive: RegistryHive,
    pub subkey: String,
    pub value_name: String,
    pub desired: DesiredRegistryValue,
}

impl RegistrySpec {
    pub fn dword(hive: RegistryHive, subkey: &str, value_name: &str, val: u32) -> Self {
        Self {
            hive,
            subkey: subkey.to_string(),
            value_name: value_name.to_string(),
            desired: DesiredRegistryValue::Dword(val),
        }
    }

    pub fn string(hive: RegistryHive, subkey: &str, value_name: &str, val: &str) -> Self {
        Self {
            hive,
            subkey: subkey.to_string(),
            value_name: value_name.to_string(),
            desired: DesiredRegistryValue::String(val.to_string()),
        }
    }

    pub fn binary(hive: RegistryHive, subkey: &str, value_name: &str, val: Vec<u8>) -> Self {
        Self {
            hive,
            subkey: subkey.to_string(),
            value_name: value_name.to_string(),
            desired: DesiredRegistryValue::Binary(val),
        }
    }

    pub fn format_path(&self) -> String {
        let hive_str = match self.hive {
            RegistryHive::Hklm => "HKLM",
            RegistryHive::Hkcu => "HKCU",
        };
        let val_str = match &self.desired {
            DesiredRegistryValue::Dword(v) => format!("REG_DWORD={v} (0x{v:X})"),
            DesiredRegistryValue::Qword(v) => format!("REG_QWORD={v}"),
            DesiredRegistryValue::String(s) => format!("REG_SZ=\"{s}\""),
            DesiredRegistryValue::ExpandString(s) => format!("REG_EXPAND_SZ=\"{s}\""),
            DesiredRegistryValue::Binary(b) => format!("REG_BINARY[{} bytes]", b.len()),
            DesiredRegistryValue::MultiString(v) => format!("REG_MULTI_SZ[{} itens]", v.len()),
        };
        format!(r"{hive_str}\{} :: {} -> {val_str}", self.subkey, self.value_name)
    }
}

fn open_hive(hive: &RegistryHive) -> RegKey {
    match hive {
        RegistryHive::Hklm => RegKey::predef(HKEY_LOCAL_MACHINE),
        RegistryHive::Hkcu => RegKey::predef(HKEY_CURRENT_USER),
    }
}

fn decode_utf16le_string(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let trimmed = match units.iter().position(|&c| c == 0) {
        Some(pos) => &units[..pos],
        None => &units[..],
    };
    String::from_utf16_lossy(trimmed)
}

fn encode_utf16le_string(s: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity((s.len() + 1) * 2);
    for unit in s.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes
}

fn decode_utf16le_multi_string(bytes: &[u8]) -> Vec<String> {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let mut out = Vec::new();
    let mut current = Vec::new();
    for u in units {
        if u == 0 {
            if current.is_empty() {
                break;
            }
            out.push(String::from_utf16_lossy(&current));
            current.clear();
        } else {
            current.push(u);
        }
    }
    out
}

fn encode_utf16le_multi_string(values: &[String]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for s in values {
        for unit in s.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.extend_from_slice(&0u16.to_le_bytes());
    }
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes
}

pub fn try_read_original_value(
    hive: &RegistryHive,
    subkey: &str,
    value_name: &str,
) -> AppResult<RegistryOriginalValue> {
    let root = open_hive(hive);
    let key = match root.open_subkey_with_flags(subkey, KEY_READ) {
        Ok(k) => k,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RegistryOriginalValue::Absent);
        }
        Err(e) => {
            return Err(AppError::WindowsApi(format!(
                "Falha ao ler chave '{subkey}' para backup: {e}"
            )));
        }
    };

    let raw = match key.get_raw_value(value_name) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RegistryOriginalValue::Absent);
        }
        Err(e) => {
            return Err(AppError::WindowsApi(format!(
                "Falha ao ler valor '{value_name}' em '{subkey}' para backup: {e}"
            )));
        }
    };

    Ok(match raw.vtype {
        RegType::REG_DWORD if raw.bytes.len() >= 4 => {
            let v = u32::from_le_bytes([raw.bytes[0], raw.bytes[1], raw.bytes[2], raw.bytes[3]]);
            RegistryOriginalValue::Dword(v)
        }
        RegType::REG_QWORD if raw.bytes.len() >= 8 => {
            let v = u64::from_le_bytes([
                raw.bytes[0],
                raw.bytes[1],
                raw.bytes[2],
                raw.bytes[3],
                raw.bytes[4],
                raw.bytes[5],
                raw.bytes[6],
                raw.bytes[7],
            ]);
            RegistryOriginalValue::Qword(v)
        }
        RegType::REG_SZ => RegistryOriginalValue::String(decode_utf16le_string(&raw.bytes)),
        RegType::REG_EXPAND_SZ => {
            RegistryOriginalValue::ExpandString(decode_utf16le_string(&raw.bytes))
        }
        RegType::REG_MULTI_SZ => {
            RegistryOriginalValue::MultiString(decode_utf16le_multi_string(&raw.bytes))
        }
        RegType::REG_BINARY => RegistryOriginalValue::Binary(raw.bytes),
        _ => RegistryOriginalValue::Binary(raw.bytes),
    })
}

pub fn read_original_value(
    hive: &RegistryHive,
    subkey: &str,
    value_name: &str,
) -> RegistryOriginalValue {
    try_read_original_value(hive, subkey, value_name).unwrap_or(RegistryOriginalValue::Absent)
}

fn open_or_create_write_key(root: &RegKey, subkey: &str) -> AppResult<RegKey> {
    root.open_subkey_with_flags(subkey, KEY_SET_VALUE)
        .or_else(|_| root.create_subkey_with_flags(subkey, KEY_WRITE).map(|(k, _)| k))
        .map_err(|e| AppError::WindowsApi(format!("Falha ao abrir/criar chave '{subkey}': {e}")))
}

pub fn is_spec_applied(spec: &RegistrySpec) -> bool {
    let current = read_original_value(&spec.hive, &spec.subkey, &spec.value_name);
    match (&spec.desired, current) {
        (DesiredRegistryValue::Dword(want), RegistryOriginalValue::Dword(got)) => *want == got,
        (DesiredRegistryValue::Qword(want), RegistryOriginalValue::Qword(got)) => *want == got,
        (DesiredRegistryValue::String(want), RegistryOriginalValue::String(got)) => {
            want.eq_ignore_ascii_case(got.trim())
        }
        (DesiredRegistryValue::ExpandString(want), RegistryOriginalValue::ExpandString(got)) => {
            want.eq_ignore_ascii_case(got.trim())
        }
        (DesiredRegistryValue::Binary(want), RegistryOriginalValue::Binary(got)) => *want == got,
        (DesiredRegistryValue::MultiString(want), RegistryOriginalValue::MultiString(got)) => {
            *want == got
        }
        _ => false,
    }
}

pub fn snapshot_spec_checked(spec: &RegistrySpec) -> AppResult<BackupTarget> {
    let original = try_read_original_value(&spec.hive, &spec.subkey, &spec.value_name)?;
    Ok(BackupTarget::RegistryValue {
        hive: spec.hive.clone(),
        subkey: spec.subkey.clone(),
        value_name: spec.value_name.clone(),
        original,
    })
}

pub fn snapshot_spec(spec: &RegistrySpec) -> BackupTarget {
    let original = read_original_value(&spec.hive, &spec.subkey, &spec.value_name);
    BackupTarget::RegistryValue {
        hive: spec.hive.clone(),
        subkey: spec.subkey.clone(),
        value_name: spec.value_name.clone(),
        original,
    }
}

pub fn apply_spec(spec: &RegistrySpec) -> AppResult<()> {
    let root = open_hive(&spec.hive);
    let key = open_or_create_write_key(&root, &spec.subkey)?;

    match &spec.desired {
        DesiredRegistryValue::Dword(v) => key.set_value(&spec.value_name, v).map_err(|e| {
            AppError::WindowsApi(format!(
                "Falha ao gravar DWORD '{}' em '{}': {e}",
                spec.value_name, spec.subkey
            ))
        })?,
        DesiredRegistryValue::Qword(v) => key.set_value(&spec.value_name, v).map_err(|e| {
            AppError::WindowsApi(format!(
                "Falha ao gravar QWORD '{}' em '{}': {e}",
                spec.value_name, spec.subkey
            ))
        })?,
        DesiredRegistryValue::String(s) => key.set_value(&spec.value_name, s).map_err(|e| {
            AppError::WindowsApi(format!(
                "Falha ao gravar STRING '{}' em '{}': {e}",
                spec.value_name, spec.subkey
            ))
        })?,
        DesiredRegistryValue::ExpandString(s) => {
            let raw = RegValue {
                bytes: encode_utf16le_string(s),
                vtype: RegType::REG_EXPAND_SZ,
            };
            key.set_raw_value(&spec.value_name, &raw).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao gravar EXPAND_SZ '{}' em '{}': {e}",
                    spec.value_name, spec.subkey
                ))
            })?;
        }
        DesiredRegistryValue::Binary(bytes) => {
            let raw = RegValue {
                bytes: bytes.clone(),
                vtype: RegType::REG_BINARY,
            };
            key.set_raw_value(&spec.value_name, &raw).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao gravar BINARY '{}' em '{}': {e}",
                    spec.value_name, spec.subkey
                ))
            })?;
        }
        DesiredRegistryValue::MultiString(list) => {
            let raw = RegValue {
                bytes: encode_utf16le_multi_string(list),
                vtype: RegType::REG_MULTI_SZ,
            };
            key.set_raw_value(&spec.value_name, &raw).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao gravar MULTI_SZ '{}' em '{}': {e}",
                    spec.value_name, spec.subkey
                ))
            })?;
        }
    }

    Ok(())
}

pub fn revert_registry_target(
    hive: &RegistryHive,
    subkey: &str,
    value_name: &str,
    original: &RegistryOriginalValue,
) -> AppResult<()> {
    let root = open_hive(hive);

    match original {
        RegistryOriginalValue::Absent => {
            if let Ok(key) = root.open_subkey_with_flags(subkey, KEY_WRITE) {
                match key.delete_value(value_name) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        return Err(AppError::WindowsApi(format!(
                            "Falha ao remover '{value_name}' em '{subkey}': {e}"
                        )));
                    }
                }
            }
            Ok(())
        }
        RegistryOriginalValue::Dword(v) => {
            let key = open_or_create_write_key(&root, subkey)?;
            key.set_value(value_name, v).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao restaurar DWORD '{value_name}' em '{subkey}': {e}"
                ))
            })
        }
        RegistryOriginalValue::Qword(v) => {
            let key = open_or_create_write_key(&root, subkey)?;
            key.set_value(value_name, v).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao restaurar QWORD '{value_name}' em '{subkey}': {e}"
                ))
            })
        }
        RegistryOriginalValue::String(s) => {
            let key = open_or_create_write_key(&root, subkey)?;
            key.set_value(value_name, s).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao restaurar STRING '{value_name}' em '{subkey}': {e}"
                ))
            })
        }
        RegistryOriginalValue::ExpandString(s) => {
            let key = open_or_create_write_key(&root, subkey)?;
            let raw = RegValue {
                bytes: encode_utf16le_string(s),
                vtype: RegType::REG_EXPAND_SZ,
            };
            key.set_raw_value(value_name, &raw).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao restaurar EXPAND_SZ '{value_name}' em '{subkey}': {e}"
                ))
            })
        }
        RegistryOriginalValue::Binary(bytes) => {
            let key = open_or_create_write_key(&root, subkey)?;
            let raw = RegValue {
                bytes: bytes.clone(),
                vtype: RegType::REG_BINARY,
            };
            key.set_raw_value(value_name, &raw).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao restaurar BINARY '{value_name}' em '{subkey}': {e}"
                ))
            })
        }
        RegistryOriginalValue::MultiString(list) => {
            let key = open_or_create_write_key(&root, subkey)?;
            let raw = RegValue {
                bytes: encode_utf16le_multi_string(list),
                vtype: RegType::REG_MULTI_SZ,
            };
            key.set_raw_value(value_name, &raw).map_err(|e| {
                AppError::WindowsApi(format!(
                    "Falha ao restaurar MULTI_SZ '{value_name}' em '{subkey}': {e}"
                ))
            })
        }
    }
}

pub fn read_windows_build_number() -> u32 {
    match read_original_value(
        &RegistryHive::Hklm,
        r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
        "CurrentBuildNumber",
    ) {
        RegistryOriginalValue::String(s) => s.trim().parse::<u32>().unwrap_or(0),
        _ => 0,
    }
}

pub fn active_tcpip_interface_subkeys() -> Vec<String> {
    let base = r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces";
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(parent) = hklm.open_subkey_with_flags(base, KEY_READ) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for guid in parent.enum_keys().flatten() {
        let subkey = format!(r"{base}\{guid}");
        let Ok(iface_key) = hklm.open_subkey_with_flags(&subkey, KEY_READ) else {
            continue;
        };

        let dhcp_ip: String = iface_key.get_value("DhcpIPAddress").unwrap_or_default();
        let static_ip: Vec<String> = iface_key.get_value("IPAddress").unwrap_or_default();

        let has_valid_dhcp = !dhcp_ip.is_empty() && dhcp_ip != "0.0.0.0";
        let has_valid_static = static_ip
            .iter()
            .any(|ip| !ip.is_empty() && ip != "0.0.0.0");

        if has_valid_dhcp || has_valid_static {
            result.push(subkey);
        }
    }

    result
}

pub fn nic_class_subkeys() -> Vec<String> {
    let base = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}";
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(parent) = hklm.open_subkey_with_flags(base, KEY_READ) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for name in parent.enum_keys().flatten() {
        if name.len() != 4 || !name.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let subkey = format!(r"{base}\{name}");
        let Ok(key) = hklm.open_subkey_with_flags(&subkey, KEY_READ) else {
            continue;
        };
        let desc: String = key.get_value("DriverDesc").unwrap_or_default();
        let instance_id: String = key.get_value("NetCfgInstanceId").unwrap_or_default();
        let lower = desc.to_ascii_lowercase();
        if !desc.is_empty()
            && !instance_id.is_empty()
            && !lower.contains("wan miniport")
            && !lower.contains("kernel debug")
        {
            result.push(subkey);
        }
    }
    result
}

pub fn pci_display_msi_subkeys() -> Vec<String> {
    let base = r"SYSTEM\CurrentControlSet\Enum\PCI";
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(pci_root) = hklm.open_subkey_with_flags(base, KEY_READ) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for dev in pci_root.enum_keys().flatten() {
        let dev_path = format!(r"{base}\{dev}");
        let Ok(dev_key) = hklm.open_subkey_with_flags(&dev_path, KEY_READ) else {
            continue;
        };
        for inst in dev_key.enum_keys().flatten() {
            let inst_path = format!(r"{dev_path}\{inst}");
            let Ok(inst_key) = hklm.open_subkey_with_flags(&inst_path, KEY_READ) else {
                continue;
            };
            let class: String = inst_key.get_value("Class").unwrap_or_default();
            let driver: String = inst_key.get_value("Driver").unwrap_or_default();
            let service: String = inst_key.get_value("Service").unwrap_or_default();
            let config_flags: u32 = inst_key.get_value("ConfigFlags").unwrap_or(0);
            let is_disabled = (config_flags & 0x1) != 0;
            if class.eq_ignore_ascii_case("Display")
                && !driver.is_empty()
                && !service.eq_ignore_ascii_case("BasicDisplay")
                && !is_disabled
            {
                let msi_path = format!(
                    r"{inst_path}\Device Parameters\Interrupt Management\MessageSignaledInterruptProperties"
                );
                if hklm.open_subkey_with_flags(&msi_path, KEY_READ).is_ok() {
                    result.push(msi_path);
                }
            }
        }
    }
    result
}

pub fn usb_hid_power_subkeys() -> Vec<String> {
    let base = r"SYSTEM\CurrentControlSet\Enum\USB";
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(usb_root) = hklm.open_subkey_with_flags(base, KEY_READ) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for dev in usb_root.enum_keys().flatten() {
        let dev_path = format!(r"{base}\{dev}");
        let Ok(dev_key) = hklm.open_subkey_with_flags(&dev_path, KEY_READ) else {
            continue;
        };
        for inst in dev_key.enum_keys().flatten() {
            let inst_path = format!(r"{dev_path}\{inst}");
            let Ok(inst_key) = hklm.open_subkey_with_flags(&inst_path, KEY_READ) else {
                continue;
            };
            let class: String = inst_key.get_value("Class").unwrap_or_default();
            let service: String = inst_key.get_value("Service").unwrap_or_default();
            if !class.eq_ignore_ascii_case("HIDClass") && !service.eq_ignore_ascii_case("HidUsb") {
                continue;
            }
            let params_path = format!(r"{inst_path}\Device Parameters");
            let Ok(params_key) = hklm.open_subkey_with_flags(&params_path, KEY_READ) else {
                continue;
            };
            if params_key
                .get_value::<u32, _>("EnhancedPowerManagementEnabled")
                .is_ok()
            {
                result.push(params_path);
            }
        }
    }
    result
}
