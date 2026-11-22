use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
use winreg::RegKey;

use crate::error::{AppError, AppResult};
use crate::security::backup::BackupTarget;

pub const SERVICE_START_AUTO: u32 = 2;
pub const SERVICE_START_DEMAND: u32 = 3;
pub const SERVICE_START_DISABLED: u32 = 4;

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn read_service_start_type(service_name: &str) -> Option<u32> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path = format!(r"SYSTEM\CurrentControlSet\Services\{service_name}");
    let key = hklm.open_subkey_with_flags(&path, KEY_READ).ok()?;
    key.get_value::<u32, _>("Start").ok()
}

pub fn service_exists(service_name: &str) -> bool {
    read_service_start_type(service_name).is_some()
}

#[cfg(windows)]
pub fn is_service_running(service_name: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus, SC_MANAGER_CONNECT,
        SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_STATUS,
    };

    unsafe {
        let Ok(scm) = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT) else {
            return false;
        };
        let wide_name = to_wide(service_name);
        let service = OpenServiceW(scm, PCWSTR(wide_name.as_ptr()), SERVICE_QUERY_STATUS);
        let running = match service {
            Ok(svc) => {
                let mut status = SERVICE_STATUS::default();
                let ok = QueryServiceStatus(svc, &mut status).is_ok();
                let _ = CloseServiceHandle(svc);
                ok && status.dwCurrentState == SERVICE_RUNNING
            }
            Err(_) => false,
        };
        let _ = CloseServiceHandle(scm);
        running
    }
}

#[cfg(not(windows))]
pub fn is_service_running(_service_name: &str) -> bool {
    false
}

pub fn snapshot_service(service_name: &str) -> Option<BackupTarget> {
    let original_start_type = read_service_start_type(service_name)?;
    let was_running = is_service_running(service_name);
    Some(BackupTarget::ServiceStartType {
        service_name: service_name.to_string(),
        original_start_type,
        was_running,
    })
}

pub fn are_services_disabled(service_names: &[&str]) -> bool {
    let mut found_any = false;
    for svc in service_names {
        if let Some(start_type) = read_service_start_type(svc) {
            found_any = true;
            if start_type != SERVICE_START_DISABLED {
                return false;
            }
        }
    }
    found_any
}

#[cfg(windows)]
pub fn configure_service(
    service_name: &str,
    start_type: u32,
    desired_running: Option<bool>,
) -> AppResult<()> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{
        ERROR_SERVICE_ALREADY_RUNNING, ERROR_SERVICE_CANNOT_ACCEPT_CTRL, ERROR_SERVICE_NOT_ACTIVE,
    };
    use windows::Win32::System::Services::{
        ChangeServiceConfigW, CloseServiceHandle, ControlService, OpenSCManagerW, OpenServiceW,
        StartServiceW, SC_MANAGER_CONNECT, SERVICE_CHANGE_CONFIG, SERVICE_CONTROL_STOP,
        SERVICE_NO_CHANGE, SERVICE_QUERY_STATUS, SERVICE_START, SERVICE_START_TYPE, SERVICE_STATUS,
        SERVICE_STOP,
    };

    unsafe {
        let scm = OpenSCManagerW(PCWSTR::null(), PCWSTR::null(), SC_MANAGER_CONNECT).map_err(
            |e| AppError::WindowsApi(format!("OpenSCManagerW falhou para '{service_name}': {e}")),
        )?;

        let wide_name = to_wide(service_name);
        let access = SERVICE_CHANGE_CONFIG
            | SERVICE_QUERY_STATUS
            | match desired_running {
                Some(true) => SERVICE_START,
                Some(false) => SERVICE_STOP,
                None => 0,
            };

        let svc = match OpenServiceW(scm, PCWSTR(wide_name.as_ptr()), access) {
            Ok(handle) => handle,
            Err(e) => {
                let _ = CloseServiceHandle(scm);
                return Err(AppError::WindowsApi(format!(
                    "OpenServiceW falhou para '{service_name}': {e}"
                )));
            }
        };

        let change_res = ChangeServiceConfigW(
            svc,
            windows::Win32::System::Services::ENUM_SERVICE_TYPE(SERVICE_NO_CHANGE),
            SERVICE_START_TYPE(start_type),
            windows::Win32::System::Services::SERVICE_ERROR(SERVICE_NO_CHANGE),
            PCWSTR::null(),
            PCWSTR::null(),
            None,
            PCWSTR::null(),
            PCWSTR::null(),
            PCWSTR::null(),
            PCWSTR::null(),
        );

        if let Err(e) = change_res {
            let _ = CloseServiceHandle(svc);
            let _ = CloseServiceHandle(scm);
            return Err(AppError::WindowsApi(format!(
                "ChangeServiceConfigW falhou para '{service_name}': {e}"
            )));
        }

        let state_res = match desired_running {
            Some(true) => match StartServiceW(svc, None) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == ERROR_SERVICE_ALREADY_RUNNING.to_hresult() => Ok(()),
                Err(e) => Err(AppError::WindowsApi(format!(
                    "StartServiceW falhou para '{service_name}': {e}"
                ))),
            },
            Some(false) => {
                let mut status = SERVICE_STATUS::default();
                match ControlService(svc, SERVICE_CONTROL_STOP, &mut status) {
                    Ok(()) => Ok(()),
                    Err(e)
                        if e.code() == ERROR_SERVICE_NOT_ACTIVE.to_hresult()
                            || e.code() == ERROR_SERVICE_CANNOT_ACCEPT_CTRL.to_hresult() =>
                    {
                        Ok(())
                    }
                    Err(e) => Err(AppError::WindowsApi(format!(
                        "ControlService(STOP) falhou para '{service_name}': {e}"
                    ))),
                }
            }
            None => Ok(()),
        };

        let _ = CloseServiceHandle(svc);
        let _ = CloseServiceHandle(scm);
        state_res
    }
}

#[cfg(not(windows))]
pub fn configure_service(
    _service_name: &str,
    _start_type: u32,
    _desired_running: Option<bool>,
) -> AppResult<()> {
    Err(AppError::InvalidOperation(
        "Controle de serviços disponível apenas no Windows.".into(),
    ))
}

pub fn disable_service(service_name: &str) -> AppResult<()> {
    configure_service(service_name, SERVICE_START_DISABLED, Some(false))
}

pub fn revert_service_target(
    service_name: &str,
    original_start_type: u32,
    was_running: bool,
) -> AppResult<()> {
    let run_action = if was_running { Some(true) } else { None };
    configure_service(service_name, original_start_type, run_action)
}
