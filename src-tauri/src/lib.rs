pub mod error;
pub mod scanner;
pub mod security;
pub mod startup;
pub mod telemetry;
pub mod tweaks;

use std::sync::{Arc, Mutex};

use error::{AppError, AppResult};
use scanner::benchmark::BenchmarkSnapshot;
use scanner::SystemScanReport;
use security::admin::PrivilegeStatus;
use security::backup::{self, BackupSession, BackupSessionSummary};
use startup::{StartupItem, StartupToggleResult};
use tweaks::{ApplyTweaksResult, RevertSessionResult, TweakItem};

struct TweakOperationLock(Arc<Mutex<()>>);

#[tauri::command]
fn get_privilege_status() -> AppResult<PrivilegeStatus> {
    security::admin::get_privilege_status()
}

#[tauri::command]
async fn request_admin_elevation(app: tauri::AppHandle) -> AppResult<()> {
    let elevated = tauri::async_runtime::spawn_blocking(security::admin::is_elevated)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao verificar privilégios: {e}")))??;
    if elevated {
        return Ok(());
    }

    tauri::async_runtime::spawn_blocking(security::admin::relaunch_as_admin)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao solicitar elevação UAC: {e}")))??;

    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn run_system_scan() -> AppResult<SystemScanReport> {
    tauri::async_runtime::spawn_blocking(scanner::run_full_scan)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha na thread de scan: {e}")))?
}

#[tauri::command]
async fn run_system_benchmark() -> AppResult<BenchmarkSnapshot> {
    tauri::async_runtime::spawn_blocking(scanner::benchmark::run_system_benchmark)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao executar benchmark: {e}")))?
}

#[tauri::command]
fn list_backups() -> AppResult<Vec<BackupSessionSummary>> {
    let dir = backup::default_backup_dir()?;
    backup::list_sessions_in(&dir)
}

#[tauri::command]
fn get_backup_session(session_id: String) -> AppResult<BackupSession> {
    let dir = backup::default_backup_dir()?;
    backup::load_session_from(&dir, &session_id)
}

#[tauri::command]
fn get_backup_directory() -> AppResult<String> {
    let dir = backup::default_backup_dir()?;
    backup::ensure_backup_dir(&dir)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn list_tweaks() -> AppResult<Vec<TweakItem>> {
    tauri::async_runtime::spawn_blocking(tweaks::list_tweaks)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao ler catálogo de tweaks: {e}")))?
}

#[tauri::command]
async fn apply_tweaks(
    app: tauri::AppHandle,
    lock: tauri::State<'_, TweakOperationLock>,
    tweak_ids: Vec<String>,
    session_label: Option<String>,
    create_restore_point: Option<bool>,
) -> AppResult<ApplyTweaksResult> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation(
                "Já existe uma operação de aplicação ou reversão de tweaks em andamento.".into(),
            )
        })?;
        tweaks::apply_tweaks(
            &app,
            tweak_ids,
            session_label,
            create_restore_point.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao aplicar tweaks: {e}")))?
}

#[tauri::command]
async fn revert_backup_session(
    app: tauri::AppHandle,
    lock: tauri::State<'_, TweakOperationLock>,
    session_id: String,
) -> AppResult<RevertSessionResult> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation(
                "Já existe uma operação de aplicação ou reversão de tweaks em andamento.".into(),
            )
        })?;
        tweaks::revert_session(&app, session_id)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao reverter sessão: {e}")))?
}

#[tauri::command]
async fn revert_single_tweak(
    app: tauri::AppHandle,
    lock: tauri::State<'_, TweakOperationLock>,
    session_id: Option<String>,
    tweak_id: String,
) -> AppResult<RevertSessionResult> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation(
                "Já existe uma operação de aplicação ou reversão de tweaks em andamento.".into(),
            )
        })?;
        tweaks::revert_single_tweak(&app, session_id, tweak_id)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao reverter tweak: {e}")))?
}

#[tauri::command]
async fn list_startup_items() -> AppResult<Vec<StartupItem>> {
    tauri::async_runtime::spawn_blocking(startup::list_startup_items)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao listar inicialização: {e}")))?
}

#[tauri::command]
async fn set_startup_item_enabled(
    lock: tauri::State<'_, TweakOperationLock>,
    item_id: String,
    enabled: bool,
) -> AppResult<StartupToggleResult> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation(
                "Já existe uma operação do sistema em andamento.".into(),
            )
        })?;
        startup::set_startup_item_enabled(item_id, enabled)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao alterar item de inicialização: {e}")))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TweakOperationLock(Arc::new(Mutex::new(()))))
        .setup(|app| {
            telemetry::spawn_telemetry_stream(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_privilege_status,
            request_admin_elevation,
            run_system_scan,
            run_system_benchmark,
            list_backups,
            get_backup_session,
            get_backup_directory,
            list_tweaks,
            apply_tweaks,
            revert_backup_session,
            revert_single_tweak,
            list_startup_items,
            set_startup_item_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar aplicação Tauri");
}
