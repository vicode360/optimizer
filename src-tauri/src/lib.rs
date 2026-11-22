pub mod error;
pub mod netlab;
pub mod scanner;
pub mod security;
pub mod startup;
pub mod telemetry;
pub mod tweaks;
pub mod updater;

use std::sync::{Arc, Mutex};

use error::{AppError, AppResult};
use netlab::{
    DnsBenchmarkEntry, MtuDiscoveryResult, NicDriverProperty, QosGamePolicy, RouteProbeResult,
    RouteTraceReport,
};
use scanner::benchmark::BenchmarkSnapshot;
use scanner::SystemScanReport;
use security::admin::PrivilegeStatus;
use security::backup::{self, BackupSession, BackupSessionSummary};
use startup::{StartupItem, StartupToggleResult};
use tweaks::{ApplyTweaksResult, RevertSessionResult, TweakItem};
use updater::UpdateCheckResult;

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
            AppError::InvalidOperation("Já existe uma operação do sistema em andamento.".into())
        })?;
        startup::set_startup_item_enabled(item_id, enabled)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao alterar item de inicialização: {e}")))?
}

#[tauri::command]
async fn probe_game_routes() -> AppResult<Vec<RouteProbeResult>> {
    tauri::async_runtime::spawn_blocking(netlab::probe_game_routes)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao sondar rotas: {e}")))?
}

#[tauri::command]
async fn trace_route_hops(target_host: String) -> AppResult<RouteTraceReport> {
    tauri::async_runtime::spawn_blocking(move || netlab::trace_route_hops(target_host))
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao traçar rota: {e}")))?
}

#[tauri::command]
async fn run_multi_dns_benchmark() -> AppResult<Vec<DnsBenchmarkEntry>> {
    tauri::async_runtime::spawn_blocking(netlab::run_multi_dns_benchmark)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha no benchmark DNS: {e}")))?
}

#[tauri::command]
async fn apply_custom_dns_provider(
    lock: tauri::State<'_, TweakOperationLock>,
    primary_ip: String,
    secondary_ip: String,
    provider_name: String,
) -> AppResult<String> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation("Operação do sistema em andamento.".into())
        })?;
        netlab::apply_custom_dns_provider(primary_ip, secondary_ip, provider_name)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao aplicar DNS: {e}")))?
}

#[tauri::command]
async fn discover_optimal_mtu() -> AppResult<MtuDiscoveryResult> {
    tauri::async_runtime::spawn_blocking(netlab::discover_optimal_mtu)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao descobrir MTU: {e}")))?
}

#[tauri::command]
async fn apply_optimal_mtu(
    lock: tauri::State<'_, TweakOperationLock>,
    interface_alias: String,
    mtu: u32,
) -> AppResult<String> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation("Operação do sistema em andamento.".into())
        })?;
        netlab::apply_optimal_mtu(interface_alias, mtu)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao aplicar MTU: {e}")))?
}

#[tauri::command]
async fn list_qos_policies() -> AppResult<Vec<QosGamePolicy>> {
    tauri::async_runtime::spawn_blocking(netlab::list_qos_policies)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao listar políticas QoS: {e}")))?
}

#[tauri::command]
async fn add_qos_game_policy(
    lock: tauri::State<'_, TweakOperationLock>,
    game_name: String,
    exe_name: String,
) -> AppResult<QosGamePolicy> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation("Operação do sistema em andamento.".into())
        })?;
        netlab::add_qos_game_policy(game_name, exe_name)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao adicionar QoS: {e}")))?
}

#[tauri::command]
async fn remove_qos_game_policy(
    lock: tauri::State<'_, TweakOperationLock>,
    policy_name: String,
) -> AppResult<()> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation("Operação do sistema em andamento.".into())
        })?;
        netlab::remove_qos_game_policy(policy_name)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao remover QoS: {e}")))?
}

#[tauri::command]
async fn list_nic_driver_tweaks() -> AppResult<Vec<NicDriverProperty>> {
    tauri::async_runtime::spawn_blocking(netlab::list_nic_driver_tweaks)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao ler driver NIC: {e}")))?
}

#[tauri::command]
async fn apply_nic_driver_tweak(
    lock: tauri::State<'_, TweakOperationLock>,
    subkey: String,
    value_name: String,
    desired_value: String,
    friendly_name: String,
) -> AppResult<String> {
    let op_lock = Arc::clone(&lock.0);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = op_lock.try_lock().map_err(|_| {
            AppError::InvalidOperation("Operação do sistema em andamento.".into())
        })?;
        netlab::apply_nic_driver_tweak(subkey, value_name, desired_value, friendly_name)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao aplicar ajuste NIC: {e}")))?
}

#[tauri::command]
async fn flush_network_stack() -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(netlab::flush_network_stack)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao limpar pilha de rede: {e}")))?
}

#[tauri::command]
async fn check_github_updates() -> AppResult<UpdateCheckResult> {
    tauri::async_runtime::spawn_blocking(updater::check_github_updates)
        .await
        .map_err(|e| AppError::InvalidOperation(format!("Falha ao verificar atualizações: {e}")))?
}

#[tauri::command]
async fn download_and_launch_update(
    asset_url: String,
    sha256_sums_url: Option<String>,
    expected_filename: String,
) -> AppResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        updater::download_and_launch_update(asset_url, sha256_sums_url, expected_filename)
    })
    .await
    .map_err(|e| AppError::InvalidOperation(format!("Falha ao baixar atualização: {e}")))?
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
            probe_game_routes,
            trace_route_hops,
            run_multi_dns_benchmark,
            apply_custom_dns_provider,
            discover_optimal_mtu,
            apply_optimal_mtu,
            list_qos_policies,
            add_qos_game_policy,
            remove_qos_game_policy,
            list_nic_driver_tweaks,
            apply_nic_driver_tweak,
            flush_network_stack,
            check_github_updates,
            download_and_launch_update,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar aplicação Tauri");
}
