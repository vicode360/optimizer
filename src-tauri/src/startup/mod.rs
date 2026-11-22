use serde::Serialize;
use winreg::enums::{RegType, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, KEY_WRITE};
use winreg::{RegKey, RegValue};

use crate::error::{AppError, AppResult};
use crate::security::admin::require_admin;
use crate::security::backup::{self, BackupEntry, BackupTarget, RegistryHive};
use crate::tweaks::registry::try_read_original_value;
use crate::tweaks::system_ops::{run_hidden, set_scheduled_task_enabled};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StartupSource {
    HkcuRun,
    HklmRun,
    HklmRun32,
    ScheduledTask,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    pub command_or_path: String,
    pub location_label: String,
    pub source: StartupSource,
    pub enabled: bool,
    pub requires_admin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupToggleResult {
    pub id: String,
    pub enabled: bool,
    pub backup_session_id: Option<String>,
}

const KNOWN_TELEMETRY_AND_UPDATER_TASKS: &[(&str, &str)] = &[
    (
        r"\Microsoft\Windows\Application Experience\Microsoft Compatibility Appraiser",
        "Microsoft Compatibility Appraiser (Telemetria de Compatibilidade)",
    ),
    (
        r"\Microsoft\Windows\Application Experience\ProgramDataUpdater",
        "ProgramDataUpdater (Coleta de Dados de Aplicativos)",
    ),
    (
        r"\Microsoft\Windows\Customer Experience Improvement Program\Consolidator",
        "CEIP Consolidator (Programa de Aperfeiçoamento da Experiência)",
    ),
    (
        r"\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip",
        "USB CEIP (Telemetria de Barramento USB)",
    ),
    (
        r"\Microsoft\Windows\DiskDiagnostic\Microsoft-Windows-DiskDiagnosticDataCollector",
        "Coletor de Diagnóstico de Disco para Microsoft",
    ),
    (
        r"\Microsoft\Windows\Feedback\Siuf\DmClient",
        "Feedback Hub SIUF DmClient",
    ),
    (
        r"\Microsoft\Windows\Maps\MapsUpdateTask",
        "Atualização Automática de Mapas Offline",
    ),
];

pub fn is_startup_approved_binary_enabled(bytes: &[u8]) -> bool {
    match bytes.first().copied() {
        Some(b) => (b & 0x01) == 0,
        None => true,
    }
}

pub fn encode_startup_approved_binary(enabled: bool) -> Vec<u8> {
    if enabled {
        vec![0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    } else {
        vec![0x03, 0x00, 0x00, 0x00, 0x00, 0x80, 0xD5, 0x7A, 0x7E, 0x3D, 0xDB, 0x01]
    }
}

fn read_registry_run_group(
    hive: RegistryHive,
    run_subkey: &str,
    approved_subkey: &str,
    source: StartupSource,
    prefix: &str,
    location_label: &str,
    requires_admin: bool,
) -> Vec<StartupItem> {
    let root = match hive {
        RegistryHive::Hkcu => RegKey::predef(HKEY_CURRENT_USER),
        RegistryHive::Hklm => RegKey::predef(HKEY_LOCAL_MACHINE),
    };

    let Ok(run_key) = root.open_subkey_with_flags(run_subkey, KEY_READ) else {
        return Vec::new();
    };
    let approved_key = root.open_subkey_with_flags(approved_subkey, KEY_READ).ok();

    let mut items = Vec::new();
    for (val_name, reg_val) in run_key.enum_values().flatten() {
        if val_name.trim().is_empty() {
            continue;
        }
        let command_str = match reg_val.vtype {
            RegType::REG_SZ | RegType::REG_EXPAND_SZ => {
                let u16_slice: Vec<u16> = reg_val
                    .bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                let end = u16_slice
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(u16_slice.len());
                String::from_utf16_lossy(&u16_slice[..end])
            }
            _ => continue,
        };

        let enabled = approved_key
            .as_ref()
            .and_then(|k| k.get_raw_value(&val_name).ok())
            .map(|raw| is_startup_approved_binary_enabled(&raw.bytes))
            .unwrap_or(true);

        items.push(StartupItem {
            id: format!("{prefix}::{val_name}"),
            name: val_name,
            command_or_path: command_str,
            location_label: location_label.to_string(),
            source,
            enabled,
            requires_admin,
        });
    }

    items
}

fn query_scheduled_task_items() -> Vec<StartupItem> {
    let mut items = Vec::new();
    for (task_path, friendly_name) in KNOWN_TELEMETRY_AND_UPDATER_TASKS {
        if let Ok(out) = run_hidden("schtasks", &["/Query", "/TN", task_path, "/FO", "CSV", "/NH"])
        {
            let lower = out.to_lowercase();
            let disabled = lower.contains("disabled")
                || lower.contains("desabilitado")
                || lower.contains("desativado");
            items.push(StartupItem {
                id: format!("task::{task_path}"),
                name: (*friendly_name).to_string(),
                command_or_path: (*task_path).to_string(),
                location_label: "Agendador de Tarefas (Windows)".into(),
                source: StartupSource::ScheduledTask,
                enabled: !disabled,
                requires_admin: true,
            });
        }
    }
    items
}

pub fn list_startup_items() -> AppResult<Vec<StartupItem>> {
    let mut all = Vec::new();
    all.extend(read_registry_run_group(
        RegistryHive::Hkcu,
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        StartupSource::HkcuRun,
        "hkcu_run",
        "HKCU :: Run (Usuário Atual)",
        false,
    ));
    all.extend(read_registry_run_group(
        RegistryHive::Hklm,
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        StartupSource::HklmRun,
        "hklm_run",
        "HKLM :: Run (Sistema 64-bit)",
        true,
    ));
    all.extend(read_registry_run_group(
        RegistryHive::Hklm,
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32",
        StartupSource::HklmRun32,
        "hklm_run32",
        "HKLM :: Run32 (WOW64 32-bit)",
        true,
    ));
    all.extend(query_scheduled_task_items());

    all.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(all)
}

pub fn set_startup_item_enabled(item_id: String, enabled: bool) -> AppResult<StartupToggleResult> {
    let (prefix, key_name) = item_id.split_once("::").ok_or_else(|| {
        AppError::InvalidOperation(format!("Identificador de item inválido: '{item_id}'."))
    })?;

    if prefix == "task" {
        require_admin()?;
        let backup_dir = backup::default_backup_dir()?;
        let session = backup::create_session_in(
            &backup_dir,
            format!(
                "Inicialização: {} ({})",
                key_name,
                if enabled { "Ativar" } else { "Desativar" }
            ),
            vec![BackupEntry {
                tweak_id: item_id.clone(),
                tweak_title: format!("Tarefa Agendada: {key_name}"),
                targets: vec![BackupTarget::ScheduledTaskState {
                    task_path: key_name.to_string(),
                    was_enabled: !enabled,
                }],
                restored_at: None,
            }],
        )?;

        set_scheduled_task_enabled(key_name, enabled)?;
        return Ok(StartupToggleResult {
            id: item_id,
            enabled,
            backup_session_id: Some(session.session_id),
        });
    }

    let (hive, approved_subkey, needs_admin) = match prefix {
        "hkcu_run" => (
            RegistryHive::Hkcu,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
            false,
        ),
        "hklm_run" => (
            RegistryHive::Hklm,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
            true,
        ),
        "hklm_run32" => (
            RegistryHive::Hklm,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32",
            true,
        ),
        _ => {
            return Err(AppError::InvalidOperation(format!(
                "Prefixo de inicialização desconhecido: '{prefix}'."
            )))
        }
    };

    if needs_admin {
        require_admin()?;
    }

    let original = try_read_original_value(&hive, approved_subkey, key_name)?;
    let backup_dir = backup::default_backup_dir()?;
    let session = backup::create_session_in(
        &backup_dir,
        format!(
            "Startup Run: {} ({})",
            key_name,
            if enabled { "Ativar" } else { "Desativar" }
        ),
        vec![BackupEntry {
            tweak_id: item_id.clone(),
            tweak_title: format!("Startup Run: {key_name}"),
            targets: vec![BackupTarget::RegistryValue {
                hive: hive.clone(),
                subkey: approved_subkey.to_string(),
                value_name: key_name.to_string(),
                original,
            }],
            restored_at: None,
        }],
    )?;

    let root = match hive {
        RegistryHive::Hkcu => RegKey::predef(HKEY_CURRENT_USER),
        RegistryHive::Hklm => RegKey::predef(HKEY_LOCAL_MACHINE),
    };
    let key = root
        .open_subkey_with_flags(approved_subkey, KEY_SET_VALUE)
        .or_else(|_| {
            root.create_subkey_with_flags(approved_subkey, KEY_WRITE)
                .map(|(k, _)| k)
        })
        .map_err(|e| {
            AppError::WindowsApi(format!(
                "Falha ao abrir StartupApproved '{approved_subkey}': {e}"
            ))
        })?;

    let raw = RegValue {
        bytes: encode_startup_approved_binary(enabled),
        vtype: RegType::REG_BINARY,
    };
    key.set_raw_value(key_name, &raw).map_err(|e| {
        AppError::WindowsApi(format!("Falha ao gravar status de '{key_name}': {e}"))
    })?;

    Ok(StartupToggleResult {
        id: item_id,
        enabled,
        backup_session_id: Some(session.session_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_decodes_windows_startup_approved_binary_flags() {
        let enabled_bytes = encode_startup_approved_binary(true);
        assert_eq!(enabled_bytes.len(), 12);
        assert!(is_startup_approved_binary_enabled(&enabled_bytes));

        let disabled_bytes = encode_startup_approved_binary(false);
        assert_eq!(disabled_bytes.len(), 12);
        assert!(!is_startup_approved_binary_enabled(&disabled_bytes));
        assert!(is_startup_approved_binary_enabled(&[]));
    }
}
