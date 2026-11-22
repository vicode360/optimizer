use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RegistryHive {
    Hklm,
    Hkcu,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum RegistryOriginalValue {
    Dword(u32),
    Qword(u64),
    String(String),
    ExpandString(String),
    Binary(Vec<u8>),
    MultiString(Vec<String>),
    Absent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "targetType",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BackupTarget {
    RegistryValue {
        hive: RegistryHive,
        subkey: String,
        value_name: String,
        original: RegistryOriginalValue,
    },
    ServiceStartType {
        service_name: String,
        original_start_type: u32,
        was_running: bool,
    },
    PowerPlan {
        original_scheme_guid: String,
        original_scheme_name: String,
    },
    PowerSettingValue {
        scheme_guid: String,
        subgroup_guid: String,
        setting_guid: String,
        original_ac_index: u32,
        original_dc_index: u32,
    },
    HibernationState {
        was_enabled: bool,
    },
    FsutilBehavior {
        key: String,
        original_value: u32,
    },
    NetshTcpGlobal {
        setting: String,
        original_value: String,
    },
    NetshSupplementalTcp {
        template: String,
        original_provider: String,
    },
    NetshIpGlobal {
        family: String,
        setting: String,
        original_value: String,
    },
    NetAdapterDns {
        interface_alias: String,
        was_dhcp: bool,
        original_servers: Vec<String>,
    },
    ScheduledTaskState {
        task_path: String,
        was_enabled: bool,
    },
    NetInterfaceMtu {
        interface_alias: String,
        original_mtu: u32,
    },
    QosPolicy {
        policy_name: String,
    },
    SnapshotNote {
        description: String,
        original_value: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub tweak_id: String,
    pub tweak_title: String,
    pub targets: Vec<BackupTarget>,
    #[serde(default)]
    pub restored_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupSession {
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    pub restored_at: Option<DateTime<Utc>>,
    pub label: String,
    pub entries: Vec<BackupEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSessionSummary {
    pub session_id: String,
    pub created_at: DateTime<Utc>,
    pub restored_at: Option<DateTime<Utc>>,
    pub label: String,
    pub tweak_count: usize,
    pub file_path: String,
}

pub fn default_backup_dir() -> AppResult<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|p| PathBuf::from(p).join("AppData").join("Roaming"))
        })
        .ok_or_else(|| AppError::BackupError("Não foi possível resolver %AppData%.".into()))?;

    Ok(base.join("optimizer").join("backups"))
}

pub fn ensure_backup_dir(dir: &Path) -> AppResult<()> {
    if !dir.exists() {
        fs::create_dir_all(dir)?;
    }
    Ok(())
}

pub fn create_session_in(
    dir: &Path,
    label: impl Into<String>,
    entries: Vec<BackupEntry>,
) -> AppResult<BackupSession> {
    if entries.is_empty() {
        return Err(AppError::BackupError(
            "Não é permitido criar uma sessão de backup vazia.".into(),
        ));
    }

    ensure_backup_dir(dir)?;
    let session = BackupSession {
        session_id: Uuid::new_v4().to_string(),
        created_at: Utc::now(),
        restored_at: None,
        label: label.into(),
        entries,
    };

    write_session_atomic(dir, &session)?;
    Ok(session)
}

pub fn write_session_atomic(dir: &Path, session: &BackupSession) -> AppResult<PathBuf> {
    validate_session_id(&session.session_id)?;
    ensure_backup_dir(dir)?;

    let target_path = dir.join(format!("{}.json", session.session_id));
    let tmp_path = dir.join(format!("{}.json.tmp", session.session_id));
    let payload = serde_json::to_vec_pretty(session)?;

    {
        let mut file = File::create(&tmp_path)?;
        file.write_all(&payload)?;
        file.sync_all()?;
    }

    replace_file_atomic(&tmp_path, &target_path)?;
    Ok(target_path)
}

#[cfg(windows)]
fn replace_file_atomic(tmp_path: &Path, target_path: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let src: Vec<u16> = tmp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let dst: Vec<u16> = target_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        MoveFileExW(
            PCWSTR(src.as_ptr()),
            PCWSTR(dst.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|e| {
            let _ = fs::remove_file(tmp_path);
            AppError::BackupError(format!("Falha na troca atômica do backup: {e}"))
        })?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file_atomic(tmp_path: &Path, target_path: &Path) -> AppResult<()> {
    fs::rename(tmp_path, target_path)?;
    Ok(())
}

pub fn delete_session_in(dir: &Path, session_id: &str) -> AppResult<()> {
    validate_session_id(session_id)?;
    let path = dir.join(format!("{session_id}.json"));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn load_session_from(dir: &Path, session_id: &str) -> AppResult<BackupSession> {
    validate_session_id(session_id)?;
    let path = dir.join(format!("{session_id}.json"));
    if !path.exists() {
        return Err(AppError::BackupError(format!(
            "Sessão de backup '{session_id}' não encontrada."
        )));
    }

    let raw = fs::read_to_string(&path)?;
    let session: BackupSession = serde_json::from_str(&raw).map_err(|e| {
        AppError::BackupError(format!("Backup '{session_id}' corrompido: {e}"))
    })?;

    if session.session_id != session_id || session.entries.is_empty() {
        return Err(AppError::BackupError(format!(
            "Metadados inválidos na sessão '{session_id}'."
        )));
    }
    Ok(session)
}

pub fn mark_session_restored_in(dir: &Path, session_id: &str) -> AppResult<BackupSession> {
    let mut session = load_session_from(dir, session_id)?;
    let now = Utc::now();
    session.restored_at = Some(now);
    for entry in &mut session.entries {
        if entry.restored_at.is_none() {
            entry.restored_at = Some(now);
        }
    }
    write_session_atomic(dir, &session)?;
    Ok(session)
}

pub fn mark_entry_restored_in(
    dir: &Path,
    session_id: &str,
    tweak_id: &str,
) -> AppResult<(BackupSession, bool)> {
    let mut session = load_session_from(dir, session_id)?;
    let now = Utc::now();
    let mut found = false;
    for entry in &mut session.entries {
        if entry.tweak_id == tweak_id {
            entry.restored_at = Some(now);
            found = true;
        }
    }
    if !found {
        return Err(AppError::BackupError(format!(
            "Tweak '{tweak_id}' não encontrado na sessão '{session_id}'."
        )));
    }
    let all_restored = session.entries.iter().all(|e| e.restored_at.is_some());
    if all_restored {
        session.restored_at = Some(now);
    }
    write_session_atomic(dir, &session)?;
    Ok((session, all_restored))
}

pub fn find_latest_active_session_for_tweak_in(
    dir: &Path,
    tweak_id: &str,
) -> AppResult<Option<String>> {
    let summaries = list_sessions_in(dir)?;
    for summary in summaries {
        if summary.restored_at.is_some() {
            continue;
        }
        let Ok(session) = load_session_from(dir, &summary.session_id) else {
            continue;
        };
        if session
            .entries
            .iter()
            .any(|e| e.tweak_id == tweak_id && e.restored_at.is_none())
        {
            return Ok(Some(session.session_id));
        }
    }
    Ok(None)
}

pub fn list_sessions_in(dir: &Path) -> AppResult<Vec<BackupSessionSummary>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(session) = serde_json::from_str::<BackupSession>(&raw) else {
            continue;
        };

        summaries.push(BackupSessionSummary {
            session_id: session.session_id,
            created_at: session.created_at,
            restored_at: session.restored_at,
            label: session.label,
            tweak_count: session.entries.len(),
            file_path: path.to_string_lossy().to_string(),
        });
    }

    summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(summaries)
}

fn validate_session_id(session_id: &str) -> AppResult<()> {
    if session_id.is_empty()
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AppError::BackupError(
            "Identificador de sessão de backup inválido.".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_backup_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("optimizer_tests")
            .join(format!("{name}_{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn creates_loads_lists_replaces_and_deletes_atomically() {
        let dir = temp_backup_dir("atomic_cycle");
        let entry = BackupEntry {
            tweak_id: "registry_disable_gamedvr".into(),
            tweak_title: "Desativar GameDVR".into(),
            targets: vec![
                BackupTarget::RegistryValue {
                    hive: RegistryHive::Hkcu,
                    subkey: r"System\GameConfigStore".into(),
                    value_name: "GameDVR_Enabled".into(),
                    original: RegistryOriginalValue::Dword(1),
                },
                BackupTarget::RegistryValue {
                    hive: RegistryHive::Hkcu,
                    subkey: r"Control Panel\Mouse".into(),
                    value_name: "SmoothMouseXCurve".into(),
                    original: RegistryOriginalValue::Binary(vec![0, 1, 2, 3]),
                },
                BackupTarget::PowerSettingValue {
                    scheme_guid: "381b4222-f694-41f0-9685-ff5bb260df2e".into(),
                    subgroup_guid: "2a737441-1930-4402-8d77-b2bebba308a3".into(),
                    setting_guid: "48e6b7a6-50f5-4782-a5d4-53bb8f07e226".into(),
                    original_ac_index: 1,
                    original_dc_index: 1,
                },
                BackupTarget::HibernationState { was_enabled: true },
                BackupTarget::FsutilBehavior {
                    key: "disablelastaccess".into(),
                    original_value: 2,
                },
                BackupTarget::NetshTcpGlobal {
                    setting: "rsc".into(),
                    original_value: "enabled".into(),
                },
                BackupTarget::NetshSupplementalTcp {
                    template: "Internet".into(),
                    original_provider: "cubic".into(),
                },
                BackupTarget::NetshIpGlobal {
                    family: "ipv4".into(),
                    setting: "loopbacklargemtu".into(),
                    original_value: "enabled".into(),
                },
                BackupTarget::ScheduledTaskState {
                    task_path: r"\Microsoft\Windows\Customer Experience Improvement Program\Consolidator".into(),
                    was_enabled: true,
                },
            ],
            restored_at: None,
        };

        let second_entry = BackupEntry {
            tweak_id: "registry_mmcss_gaming".into(),
            tweak_title: "MMCSS".into(),
            targets: vec![],
            restored_at: None,
        };

        let created = create_session_in(&dir, "Lote Gaming", vec![entry, second_entry]).unwrap();
        assert!(created.restored_at.is_none());
        assert!(!dir.join(format!("{}.json.tmp", created.session_id)).exists());
        assert!(!dir.join(format!("{}.json.bak", created.session_id)).exists());

        let found_id =
            find_latest_active_session_for_tweak_in(&dir, "registry_disable_gamedvr").unwrap();
        assert_eq!(found_id.as_deref(), Some(created.session_id.as_str()));

        let (partial_sess, all_done) =
            mark_entry_restored_in(&dir, &created.session_id, "registry_disable_gamedvr").unwrap();
        assert!(!all_done);
        assert!(partial_sess.restored_at.is_none());
        assert!(partial_sess.entries[0].restored_at.is_some());

        let loaded = load_session_from(&dir, &created.session_id).unwrap();
        assert_eq!(loaded, partial_sess);

        let serialized = serde_json::to_string(&loaded).unwrap();
        assert!(serialized.contains("\"targetType\":\"netshIpGlobal\""));

        let restored = mark_session_restored_in(&dir, &created.session_id).unwrap();
        assert!(restored.restored_at.is_some());
        assert!(!dir.join(format!("{}.json.bak", created.session_id)).exists());

        delete_session_in(&dir, &created.session_id).unwrap();
        assert!(list_sessions_in(&dir).unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_empty_backup_session_and_path_traversal() {
        let dir = temp_backup_dir("validation");
        let empty = create_session_in(&dir, "Vazio", vec![]);
        assert!(matches!(empty, Err(AppError::BackupError(_))));

        let traversal = load_session_from(&dir, "../etc/passwd");
        assert!(matches!(traversal, Err(AppError::BackupError(_))));

        let _ = fs::remove_dir_all(&dir);
    }
}
