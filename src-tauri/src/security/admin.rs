use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegeStatus {
    pub is_admin: bool,
    pub elevation_label: String,
    pub username: String,
}

#[cfg(windows)]
pub fn is_elevated() -> AppResult<bool> {
    use std::mem::size_of;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)
            .map_err(|e| AppError::WindowsApi(format!("OpenProcessToken falhou: {e}")))?;

        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned_len = 0u32;
        let res = GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned_len,
        );

        let _ = CloseHandle(token);

        res.map_err(|e| AppError::WindowsApi(format!("GetTokenInformation falhou: {e}")))?;
        Ok(elevation.TokenIsElevated != 0)
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> AppResult<bool> {
    Ok(false)
}

pub fn get_privilege_status() -> AppResult<PrivilegeStatus> {
    let is_admin = is_elevated()?;
    let username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(PrivilegeStatus {
        is_admin,
        elevation_label: if is_admin {
            "Administrador (Elevado)".to_string()
        } else {
            "Usuário Padrão (Somente Leitura)".to_string()
        },
        username,
    })
}

pub fn require_admin() -> AppResult<()> {
    if !is_elevated()? {
        return Err(AppError::AdminRequired(
            "Execute o Optimizer como Administrador para aplicar ou reverter alterações no sistema."
                .to_string(),
        ));
    }
    Ok(())
}

#[cfg(windows)]
pub fn relaunch_as_admin() -> AppResult<()> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe()
        .map_err(|e| AppError::WindowsApi(format!("Não foi possível localizar o executável atual: {e}")))?;
    let exe_str = exe.to_string_lossy();
    let verb: Vec<u16> = "runas\0".encode_utf16().collect();
    let file: Vec<u16> = exe_str.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let res = ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        if (res.0 as isize) <= 32 {
            return Err(AppError::AdminRequired(
                "Elevação UAC cancelada ou recusada pelo Windows.".into(),
            ));
        }
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_as_admin() -> AppResult<()> {
    Err(AppError::InvalidOperation(
        "Elevação UAC disponível apenas no Windows.".into(),
    ))
}
