pub mod debloat_services;
pub mod gaming_scheduler;
pub mod gpu_directx;
pub mod input_peripherals;
pub mod memory_power;
pub mod network_tcp;
pub mod registry;
pub mod security_hardening;
pub mod services;
pub mod system_ops;

use std::collections::{HashMap, HashSet};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::scanner::hardware::read_active_power_plan;
use crate::security::admin::require_admin;
use crate::security::backup::{self, BackupEntry, BackupTarget, RegistryOriginalValue};

use self::registry::{
    apply_spec, is_spec_applied, nic_class_subkeys, pci_display_msi_subkeys,
    read_windows_build_number, revert_registry_target, snapshot_spec_checked,
    usb_hid_power_subkeys, RegistrySpec,
};
use self::services::{
    are_services_disabled, disable_service, revert_service_target, service_exists, snapshot_service,
    SERVICE_START_AUTO,
};
use self::system_ops::{
    create_system_restore_point, is_plan_high_performance, query_active_dns_adapters_fast,
    query_netsh_tcp_global_map, revert_dns_target, revert_power_plan, set_fsutil_behavior,
    set_hibernation, set_netsh_ip_global, set_netsh_supplemental_provider, set_netsh_tcp_global,
    set_power_setting_indices, set_scheduled_task_enabled, ActiveDnsAdapter, SystemSpecs,
};

pub const TWEAK_PROGRESS_EVENT: &str = "tweak://progress";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TweakCategory {
    Gaming,
    Gpu,
    Network,
    Power,
    Input,
    Debloat,
    Security,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TweakRisk {
    Safe,
    Moderate,
    Advanced,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TweakImpact {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakItem {
    pub id: String,
    pub title: String,
    pub description: String,
    pub technical_detail: String,
    pub benchmark_note: String,
    pub category: TweakCategory,
    pub impact: TweakImpact,
    pub risk: TweakRisk,
    pub requires_admin: bool,
    pub reversible: bool,
    pub applied: bool,
    pub applicable: bool,
    pub hardware_note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakProgressEvent {
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub tweak_id: Option<String>,
    pub tweak_title: Option<String>,
    pub message: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakOperationFailure {
    pub tweak_id: String,
    pub tweak_title: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTweaksResult {
    pub session_id: String,
    pub backup_path: String,
    pub applied_ids: Vec<String>,
    pub failures: Vec<TweakOperationFailure>,
    pub restore_point_created: bool,
    pub restore_point_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevertSessionResult {
    pub session_id: String,
    pub reverted_count: usize,
    pub failures: Vec<TweakOperationFailure>,
    pub marked_restored: bool,
}

pub struct TweakEvalContext {
    pub specs: SystemSpecs,
    pub tcp_global: HashMap<String, String>,
    pub active_scheme_guid: String,
    pub high_perf_active: bool,
    pub windows_build: u32,
    pub pci_display_subkeys: Vec<String>,
    pub nic_subkeys: Vec<String>,
    pub usb_hid_subkeys: Vec<String>,
    pub active_dns_adapters: Vec<ActiveDnsAdapter>,
}

impl TweakEvalContext {
    pub fn collect() -> Self {
        let (specs, tcp_global, active_plan, reg_info) = std::thread::scope(|s| {
            let h_specs = s.spawn(SystemSpecs::detect);
            let h_tcp = s.spawn(query_netsh_tcp_global_map);
            let h_plan = s.spawn(read_active_power_plan);
            let h_reg = s.spawn(|| {
                (
                    read_windows_build_number(),
                    pci_display_msi_subkeys(),
                    nic_class_subkeys(),
                    usb_hid_power_subkeys(),
                    query_active_dns_adapters_fast(),
                )
            });

            (
                h_specs.join().unwrap_or_else(|_| SystemSpecs::detect()),
                h_tcp.join().unwrap_or_default(),
                h_plan.join().unwrap_or_else(|_| read_active_power_plan()),
                h_reg.join().unwrap_or_else(|_| {
                    (
                        read_windows_build_number(),
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                    )
                }),
            )
        });

        let high_perf_active = is_plan_high_performance(&active_plan);
        let (
            windows_build,
            pci_display_subkeys,
            nic_subkeys,
            usb_hid_subkeys,
            active_dns_adapters,
        ) = reg_info;

        Self {
            specs,
            tcp_global,
            active_scheme_guid: active_plan.guid,
            high_perf_active,
            windows_build,
            pci_display_subkeys,
            nic_subkeys,
            usb_hid_subkeys,
            active_dns_adapters,
        }
    }
}

pub trait Tweak: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn category(&self) -> TweakCategory;
    fn description(&self) -> &'static str;
    fn technical_detail(&self) -> String;
    fn technical_detail_with_ctx(&self, _ctx: &TweakEvalContext) -> String {
        self.technical_detail()
    }
    fn benchmark_note(&self) -> &'static str;
    fn impact(&self) -> TweakImpact;
    fn risk(&self) -> TweakRisk;

    fn requires_admin(&self) -> bool {
        true
    }

    fn reversible(&self) -> bool {
        true
    }

    fn hardware_note(&self, _ctx: &TweakEvalContext) -> Option<String> {
        None
    }

    fn is_applicable(&self, _ctx: &TweakEvalContext) -> bool {
        true
    }

    fn is_applied(&self) -> Result<bool, String>;

    fn is_applied_with_ctx(&self, _ctx: &TweakEvalContext) -> Result<bool, String> {
        self.is_applied()
    }

    fn apply(&self) -> Result<(), String>;

    fn revert(&self) -> Result<(), String>;

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>>;
}

#[derive(Debug, Clone)]
pub struct RegistryTweakEntry {
    pub spec: RegistrySpec,
    pub default_value: RegistryOriginalValue,
}

impl RegistryTweakEntry {
    pub fn new(spec: RegistrySpec, default_value: RegistryOriginalValue) -> Self {
        Self {
            spec,
            default_value,
        }
    }
}

pub struct RegistryTweak {
    pub id: &'static str,
    pub name: &'static str,
    pub category: TweakCategory,
    pub description: &'static str,
    pub benchmark_note: &'static str,
    pub impact: TweakImpact,
    pub risk: TweakRisk,
    pub requires_admin: bool,
    pub entries: Vec<RegistryTweakEntry>,
}

impl Tweak for RegistryTweak {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn category(&self) -> TweakCategory {
        self.category
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn technical_detail(&self) -> String {
        self.entries
            .iter()
            .map(|e| e.spec.format_path())
            .collect::<Vec<_>>()
            .join("\n")
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

    fn requires_admin(&self) -> bool {
        self.requires_admin
    }

    fn is_applied(&self) -> Result<bool, String> {
        Ok(!self.entries.is_empty() && self.entries.iter().all(|e| is_spec_applied(&e.spec)))
    }

    fn apply(&self) -> Result<(), String> {
        for entry in &self.entries {
            apply_spec(&entry.spec).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn revert(&self) -> Result<(), String> {
        for entry in self.entries.iter().rev() {
            revert_registry_target(
                &entry.spec.hive,
                &entry.spec.subkey,
                &entry.spec.value_name,
                &entry.default_value,
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        self.entries
            .iter()
            .map(|e| snapshot_spec_checked(&e.spec))
            .collect()
    }
}

pub struct ServiceTweak {
    pub id: &'static str,
    pub name: &'static str,
    pub category: TweakCategory,
    pub description: &'static str,
    pub benchmark_note: &'static str,
    pub impact: TweakImpact,
    pub risk: TweakRisk,
    pub services: &'static [(&'static str, u32)],
    pub extra_registry: Vec<RegistryTweakEntry>,
    pub require_system_ssd: bool,
}

impl Tweak for ServiceTweak {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn category(&self) -> TweakCategory {
        self.category
    }

    fn description(&self) -> &'static str {
        self.description
    }

    fn technical_detail(&self) -> String {
        let mut lines: Vec<String> = self
            .services
            .iter()
            .map(|(svc, _)| {
                format!(
                    r"Win32 SCM :: HKLM\SYSTEM\CurrentControlSet\Services\{svc} -> Start=4 (Disabled)"
                )
            })
            .collect();
        for reg in &self.extra_registry {
            lines.push(reg.spec.format_path());
        }
        lines.join("\n")
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

    fn hardware_note(&self, ctx: &TweakEvalContext) -> Option<String> {
        if self.require_system_ssd {
            if ctx.specs.system_drive_is_ssd {
                Some(format!(
                    "Volume do sistema detectado como {}. Seguro desativar SysMain.",
                    ctx.specs.system_drive_kind
                ))
            } else {
                Some(format!(
                    "Disco do sistema detectado como {} (não SSD). Desativar SysMain em HDD degrada inicialização.",
                    ctx.specs.system_drive_kind
                ))
            }
        } else {
            None
        }
    }

    fn is_applicable(&self, ctx: &TweakEvalContext) -> bool {
        let any_service_present = self.services.iter().any(|(svc, _)| service_exists(svc));
        if !any_service_present && self.extra_registry.is_empty() {
            return false;
        }
        if self.require_system_ssd {
            ctx.specs.system_drive_is_ssd
        } else {
            true
        }
    }

    fn is_applied(&self) -> Result<bool, String> {
        let names: Vec<&str> = self.services.iter().map(|(s, _)| *s).collect();
        let svcs_ok = are_services_disabled(&names);
        let reg_ok = self
            .extra_registry
            .iter()
            .all(|entry| is_spec_applied(&entry.spec));
        Ok(svcs_ok && reg_ok)
    }

    fn apply(&self) -> Result<(), String> {
        let mut touched = 0usize;
        for (svc, _) in self.services {
            if service_exists(svc) {
                disable_service(svc).map_err(|e| e.to_string())?;
                touched += 1;
            }
        }
        for reg in &self.extra_registry {
            apply_spec(&reg.spec).map_err(|e| e.to_string())?;
            touched += 1;
        }
        if touched == 0 {
            return Err("Nenhum dos serviços-alvo foi encontrado nesta edição do Windows.".into());
        }
        Ok(())
    }

    fn revert(&self) -> Result<(), String> {
        for reg in self.extra_registry.iter().rev() {
            revert_registry_target(
                &reg.spec.hive,
                &reg.spec.subkey,
                &reg.spec.value_name,
                &reg.default_value,
            )
            .map_err(|e| e.to_string())?;
        }
        for (svc, default_start) in self.services.iter().rev() {
            if service_exists(svc) {
                revert_service_target(svc, *default_start, *default_start == SERVICE_START_AUTO)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    fn capture_backup(&self) -> AppResult<Vec<BackupTarget>> {
        let mut targets = Vec::new();
        for (svc, _) in self.services {
            if let Some(t) = snapshot_service(svc) {
                targets.push(t);
            }
        }
        for reg in &self.extra_registry {
            targets.push(snapshot_spec_checked(&reg.spec)?);
        }
        if targets.is_empty() {
            return Err(AppError::InvalidOperation(format!(
                "Nenhum serviço ou chave-alvo encontrado para '{}'.",
                self.name
            )));
        }
        Ok(targets)
    }
}

pub fn build_catalog() -> Vec<Box<dyn Tweak>> {
    let mut all: Vec<Box<dyn Tweak>> = Vec::with_capacity(60);
    all.extend(gaming_scheduler::tweaks());
    all.extend(gpu_directx::tweaks());
    all.extend(network_tcp::tweaks());
    all.extend(memory_power::tweaks());
    all.extend(input_peripherals::tweaks());
    all.extend(debloat_services::tweaks());
    all.extend(security_hardening::tweaks());
    all
}

pub fn find_tweak_by_id<'a>(
    catalog: &'a [Box<dyn Tweak>],
    id: &str,
) -> Option<&'a dyn Tweak> {
    catalog.iter().find(|t| t.id() == id).map(|b| b.as_ref())
}

pub fn list_tweaks() -> AppResult<Vec<TweakItem>> {
    let ctx = TweakEvalContext::collect();
    let catalog = build_catalog();

    Ok(catalog
        .iter()
        .map(|tweak| {
            let applied = tweak.is_applied_with_ctx(&ctx).unwrap_or(false);
            let applicable = tweak.is_applicable(&ctx);
            TweakItem {
                id: tweak.id().to_string(),
                title: tweak.name().to_string(),
                description: tweak.description().to_string(),
                technical_detail: tweak.technical_detail_with_ctx(&ctx),
                benchmark_note: tweak.benchmark_note().to_string(),
                category: tweak.category(),
                impact: tweak.impact(),
                risk: tweak.risk(),
                requires_admin: tweak.requires_admin(),
                reversible: tweak.reversible(),
                applied,
                applicable,
                hardware_note: tweak.hardware_note(&ctx),
            }
        })
        .collect())
}

fn validate_tweak_ids<'a>(
    catalog: &'a [Box<dyn Tweak>],
    tweak_ids: &[String],
) -> AppResult<Vec<&'a dyn Tweak>> {
    if tweak_ids.is_empty() {
        return Err(AppError::InvalidOperation(
            "Selecione ao menos um tweak antes de aplicar.".into(),
        ));
    }

    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for id in tweak_ids {
        if !seen.insert(id.clone()) {
            continue;
        }
        let tweak = find_tweak_by_id(catalog, id).ok_or_else(|| {
            AppError::InvalidOperation(format!("Tweak desconhecido no catálogo: '{id}'."))
        })?;
        selected.push(tweak);
    }

    Ok(selected)
}

fn emit_progress(app: &AppHandle, event: TweakProgressEvent) {
    let _ = app.emit(TWEAK_PROGRESS_EVENT, event);
}

pub fn apply_tweaks(
    app: &AppHandle,
    tweak_ids: Vec<String>,
    session_label: Option<String>,
    create_restore_point: bool,
) -> AppResult<ApplyTweaksResult> {
    require_admin()?;

    let catalog = build_catalog();
    let selected = validate_tweak_ids(&catalog, &tweak_ids)?;
    let ctx = TweakEvalContext::collect();
    for tweak in &selected {
        if !tweak.is_applicable(&ctx) {
            return Err(AppError::InvalidOperation(format!(
                "O tweak '{}' não é aplicável a este hardware ou versão do Windows.",
                tweak.name()
            )));
        }
    }

    let total = selected.len();
    let label = session_label
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("Lote de otimização ({total} tweaks)"));

    let mut restore_point_created = false;
    let mut restore_point_warning = None;
    if create_restore_point {
        emit_progress(
            app,
            TweakProgressEvent {
                phase: "backingUp".into(),
                current: 0,
                total,
                tweak_id: None,
                tweak_title: None,
                message: "Criando Ponto de Restauração do Windows (VSS)...".into(),
                session_id: None,
            },
        );
        match create_system_restore_point(&format!("Optimizer - {label}")) {
            Ok(()) => restore_point_created = true,
            Err(err) => {
                restore_point_warning = Some(format!(
                    "Aviso VSS: não foi possível criar o Ponto de Restauração do Windows ({err}). O snapshot atômico JSON continuará normalmente."
                ));
            }
        }
    }

    let backup_dir = backup::default_backup_dir()?;
    let mut session = backup::BackupSession {
        session_id: uuid::Uuid::new_v4().to_string(),
        created_at: chrono::Utc::now(),
        restored_at: None,
        label,
        entries: Vec::with_capacity(total),
    };
    let backup_path = backup_dir
        .join(format!("{}.json", session.session_id))
        .to_string_lossy()
        .to_string();

    let mut applied_ids = Vec::new();
    let mut failures = Vec::new();
    let mut persisted_session = false;

    for (idx, tweak) in selected.iter().enumerate() {
        emit_progress(
            app,
            TweakProgressEvent {
                phase: "backingUp".into(),
                current: idx + 1,
                total,
                tweak_id: Some(tweak.id().to_string()),
                tweak_title: Some(tweak.name().to_string()),
                message: format!(
                    "Capturando snapshot de {} ({}/{total})...",
                    tweak.name(),
                    idx + 1
                ),
                session_id: Some(session.session_id.clone()),
            },
        );

        let targets = match tweak.capture_backup() {
            Ok(t) => t,
            Err(err) => {
                failures.push(TweakOperationFailure {
                    tweak_id: tweak.id().to_string(),
                    tweak_title: tweak.name().to_string(),
                    error: format!("Falha ao capturar snapshot: {err}"),
                });
                continue;
            }
        };

        session.entries.push(BackupEntry {
            tweak_id: tweak.id().to_string(),
            tweak_title: tweak.name().to_string(),
            targets: targets.clone(),
            restored_at: None,
        });

        // Persiste o backup atomicamente em disco ANTES de executar qualquer mutação.
        if let Err(err) = backup::write_session_atomic(&backup_dir, &session) {
            session.entries.pop();
            failures.push(TweakOperationFailure {
                tweak_id: tweak.id().to_string(),
                tweak_title: tweak.name().to_string(),
                error: format!("Falha ao gravar backup antes da mutação: {err}"),
            });
            continue;
        }
        persisted_session = true;

        emit_progress(
            app,
            TweakProgressEvent {
                phase: "applying".into(),
                current: idx + 1,
                total,
                tweak_id: Some(tweak.id().to_string()),
                tweak_title: Some(tweak.name().to_string()),
                message: format!("Aplicando {} ({}/{total})...", tweak.name(), idx + 1),
                session_id: Some(session.session_id.clone()),
            },
        );

        match tweak.apply() {
            Ok(()) => applied_ids.push(tweak.id().to_string()),
            Err(err) => {
                // Reverte imediatamente eventuais mutações parciais deste tweak.
                let mut rollback_clean = true;
                for target in targets.iter().rev() {
                    if revert_single_target(target).is_err() {
                        rollback_clean = false;
                    }
                }
                if rollback_clean {
                    session.entries.pop();
                    if !session.entries.is_empty() {
                        let _ = backup::write_session_atomic(&backup_dir, &session);
                    }
                }
                failures.push(TweakOperationFailure {
                    tweak_id: tweak.id().to_string(),
                    tweak_title: tweak.name().to_string(),
                    error: err,
                });
            }
        }
    }

    let keep_backup = persisted_session && !session.entries.is_empty();
    if persisted_session && !keep_backup {
        let _ = backup::delete_session_in(&backup_dir, &session.session_id);
    }

    emit_progress(
        app,
        TweakProgressEvent {
            phase: if failures.is_empty() {
                "completed".into()
            } else {
                "failed".into()
            },
            current: total,
            total,
            tweak_id: None,
            tweak_title: None,
            message: if failures.is_empty() {
                format!(
                    "{} tweak(s) aplicados com backup atômico salvo.",
                    applied_ids.len()
                )
            } else if !keep_backup {
                format!(
                    "Nenhum tweak aplicado ({} falha(s)). Nenhuma alteração persistida.",
                    failures.len()
                )
            } else {
                format!(
                    "{} aplicados, {} falha(s). Backup preservado para reversão.",
                    applied_ids.len(),
                    failures.len()
                )
            },
            session_id: if keep_backup {
                Some(session.session_id.clone())
            } else {
                None
            },
        },
    );

    Ok(ApplyTweaksResult {
        session_id: if keep_backup {
            session.session_id
        } else {
            String::new()
        },
        backup_path: if keep_backup {
            backup_path
        } else {
            String::new()
        },
        applied_ids,
        failures,
        restore_point_created,
        restore_point_warning,
    })
}

fn revert_single_target(target: &BackupTarget) -> AppResult<()> {
    match target {
        BackupTarget::RegistryValue {
            hive,
            subkey,
            value_name,
            original,
        } => revert_registry_target(hive, subkey, value_name, original),
        BackupTarget::ServiceStartType {
            service_name,
            original_start_type,
            was_running,
        } => revert_service_target(service_name, *original_start_type, *was_running),
        BackupTarget::PowerPlan {
            original_scheme_guid,
            ..
        } => revert_power_plan(original_scheme_guid),
        BackupTarget::PowerSettingValue {
            scheme_guid,
            subgroup_guid,
            setting_guid,
            original_ac_index,
            original_dc_index,
        } => set_power_setting_indices(
            scheme_guid,
            subgroup_guid,
            setting_guid,
            *original_ac_index,
            Some(*original_dc_index),
        ),
        BackupTarget::HibernationState { was_enabled } => set_hibernation(*was_enabled),
        BackupTarget::FsutilBehavior {
            key,
            original_value,
        } => set_fsutil_behavior(key, *original_value),
        BackupTarget::NetshTcpGlobal {
            setting,
            original_value,
        } => set_netsh_tcp_global(setting, original_value),
        BackupTarget::NetshSupplementalTcp {
            template,
            original_provider,
        } => set_netsh_supplemental_provider(template, original_provider),
        BackupTarget::NetshIpGlobal {
            family,
            setting,
            original_value,
        } => set_netsh_ip_global(family, setting, original_value),
        BackupTarget::NetAdapterDns {
            interface_alias,
            was_dhcp,
            original_servers,
        } => revert_dns_target(interface_alias, *was_dhcp, original_servers),
        BackupTarget::ScheduledTaskState {
            task_path,
            was_enabled,
        } => set_scheduled_task_enabled(task_path, *was_enabled),
        BackupTarget::SnapshotNote { .. } => Ok(()),
    }
}

pub fn revert_session(app: &AppHandle, session_id: String) -> AppResult<RevertSessionResult> {
    require_admin()?;

    let backup_dir = backup::default_backup_dir()?;
    let session = backup::load_session_from(&backup_dir, &session_id)?;
    let pending_entries: Vec<&BackupEntry> = session
        .entries
        .iter()
        .rev()
        .filter(|e| e.restored_at.is_none())
        .collect();
    let total = pending_entries.len();

    let mut reverted_count = 0usize;
    let mut failures = Vec::new();

    for (idx, entry) in pending_entries.into_iter().enumerate() {
        emit_progress(
            app,
            TweakProgressEvent {
                phase: "reverting".into(),
                current: idx + 1,
                total,
                tweak_id: Some(entry.tweak_id.clone()),
                tweak_title: Some(entry.tweak_title.clone()),
                message: format!("Revertendo {} ({}/{total})...", entry.tweak_title, idx + 1),
                session_id: Some(session.session_id.clone()),
            },
        );

        let mut entry_failed = false;
        for target in entry.targets.iter().rev() {
            if let Err(err) = revert_single_target(target) {
                entry_failed = true;
                failures.push(TweakOperationFailure {
                    tweak_id: entry.tweak_id.clone(),
                    tweak_title: entry.tweak_title.clone(),
                    error: err.to_string(),
                });
            }
        }

        if !entry_failed {
            reverted_count += 1;
            let _ = backup::mark_entry_restored_in(&backup_dir, &session.session_id, &entry.tweak_id);
        }
    }

    let marked_restored = if failures.is_empty() {
        backup::mark_session_restored_in(&backup_dir, &session.session_id)?;
        true
    } else {
        false
    };

    emit_progress(
        app,
        TweakProgressEvent {
            phase: if failures.is_empty() {
                "completed".into()
            } else {
                "failed".into()
            },
            current: total,
            total,
            tweak_id: None,
            tweak_title: None,
            message: if failures.is_empty() {
                format!("{reverted_count} tweak(s) restaurados para o estado original.")
            } else {
                format!(
                    "{reverted_count} restaurado(s), {} falha(s) durante a reversão.",
                    failures.len()
                )
            },
            session_id: Some(session.session_id.clone()),
        },
    );

    Ok(RevertSessionResult {
        session_id: session.session_id,
        reverted_count,
        failures,
        marked_restored,
    })
}

pub fn revert_single_tweak(
    app: &AppHandle,
    session_id: Option<String>,
    tweak_id: String,
) -> AppResult<RevertSessionResult> {
    require_admin()?;

    let backup_dir = backup::default_backup_dir()?;
    let target_session_id = match session_id.filter(|s| !s.trim().is_empty()) {
        Some(id) => id,
        None => backup::find_latest_active_session_for_tweak_in(&backup_dir, &tweak_id)?
            .ok_or_else(|| {
                AppError::BackupError(format!(
                    "Nenhuma sessão de backup ativa encontrada para o item '{tweak_id}'."
                ))
            })?,
    };

    let session = backup::load_session_from(&backup_dir, &target_session_id)?;
    let entry = session
        .entries
        .iter()
        .find(|e| e.tweak_id == tweak_id)
        .ok_or_else(|| {
            AppError::BackupError(format!(
                "O item '{tweak_id}' não existe na sessão '{target_session_id}'."
            ))
        })?;

    emit_progress(
        app,
        TweakProgressEvent {
            phase: "reverting".into(),
            current: 1,
            total: 1,
            tweak_id: Some(entry.tweak_id.clone()),
            tweak_title: Some(entry.tweak_title.clone()),
            message: format!("Revertendo {}...", entry.tweak_title),
            session_id: Some(session.session_id.clone()),
        },
    );

    let mut failures = Vec::new();
    for target in entry.targets.iter().rev() {
        if let Err(err) = revert_single_target(target) {
            failures.push(TweakOperationFailure {
                tweak_id: entry.tweak_id.clone(),
                tweak_title: entry.tweak_title.clone(),
                error: err.to_string(),
            });
        }
    }

    let (reverted_count, marked_restored) = if failures.is_empty() {
        let (_, all_done) =
            backup::mark_entry_restored_in(&backup_dir, &session.session_id, &tweak_id)?;
        (1usize, all_done)
    } else {
        (0usize, false)
    };

    emit_progress(
        app,
        TweakProgressEvent {
            phase: if failures.is_empty() {
                "completed".into()
            } else {
                "failed".into()
            },
            current: 1,
            total: 1,
            tweak_id: Some(entry.tweak_id.clone()),
            tweak_title: Some(entry.tweak_title.clone()),
            message: if failures.is_empty() {
                format!("{} restaurado para o estado original.", entry.tweak_title)
            } else {
                format!("Falha ao reverter {}.", entry.tweak_title)
            },
            session_id: Some(session.session_id.clone()),
        },
    );

    Ok(RevertSessionResult {
        session_id: session.session_id,
        reverted_count,
        failures,
        marked_restored,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_at_least_50_unique_real_tweaks_and_covers_diagnostics() {
        let catalog = build_catalog();
        assert!(
            catalog.len() >= 50,
            "Esperava >= 50 tweaks auditados, mas encontrou {}",
            catalog.len()
        );

        let mut seen = HashSet::new();
        for tweak in &catalog {
            assert!(
                seen.insert(tweak.id()),
                "ID duplicado no catálogo: {}",
                tweak.id()
            );
            assert!(!tweak.name().is_empty());
            assert!(!tweak.description().is_empty());
            assert!(!tweak.technical_detail().is_empty());
            assert!(!tweak.benchmark_note().is_empty());
        }

        let required_by_diagnostics = [
            "power_ultimate_performance",
            "power_disable_usb_selective_suspend",
            "power_disable_hibernation",
            "memory_standby_cleanup",
            "registry_mmcss_gaming",
            "registry_disable_gamedvr",
            "registry_disable_mouse_accel",
            "network_tcp_nodelay",
            "debloat_telemetry_services",
            "gaming_global_timer_resolution",
            "security_disable_llmnr",
            "security_disable_smbv1",
        ];

        for req in required_by_diagnostics {
            assert!(
                find_tweak_by_id(&catalog, req).is_some(),
                "Diagnóstico recomenda '{req}', mas ele não existe no catálogo."
            );
        }
    }

    #[test]
    fn rejects_empty_and_unknown_tweak_ids_and_deduplicates() {
        let catalog = build_catalog();
        assert!(validate_tweak_ids(&catalog, &[]).is_err());
        assert!(validate_tweak_ids(&catalog, &["tweak_inexistente".into()]).is_err());

        let deduped = validate_tweak_ids(
            &catalog,
            &[
                "registry_disable_gamedvr".into(),
                "registry_disable_gamedvr".into(),
                "network_tcp_nodelay".into(),
            ],
        )
        .unwrap();
        assert_eq!(deduped.len(), 2);
        assert_eq!(deduped[0].id(), "registry_disable_gamedvr");
        assert_eq!(deduped[1].id(), "network_tcp_nodelay");
    }
}
