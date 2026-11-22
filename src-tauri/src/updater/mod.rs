use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::tweaks::system_ops::run_hidden;

const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/vicode360/optimizer/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub release_tag: String,
    pub release_name: String,
    pub update_available: bool,
    pub release_notes: String,
    pub html_url: String,
    pub published_at: String,
    pub setup_exe_url: Option<String>,
    pub setup_exe_name: Option<String>,
    pub portable_exe_url: Option<String>,
    pub sha256_sums_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubReleasePayload {
    tag_name: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    body: String,
    html_url: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    assets: Vec<GithubReleaseAsset>,
}

pub fn parse_semver_tuple(raw: &str) -> (u32, u32, u32) {
    let cleaned = raw.trim().trim_start_matches('v').trim_start_matches('V');
    let core = cleaned.split('-').next().unwrap_or(cleaned);
    let mut parts = core.split('.').map(|s| s.parse::<u32>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

pub fn is_newer_version(current: &str, candidate: &str) -> bool {
    parse_semver_tuple(candidate) > parse_semver_tuple(current)
}

pub fn extract_expected_sha256(sums_text: &str, filename: &str) -> Option<String> {
    let target = filename.trim().to_lowercase();
    for line in sums_text.lines() {
        let trimmed = line.trim();
        let mut parts = trimmed.split_whitespace();
        let hash = parts.next()?;
        let file_part = parts.last()?;
        let clean_file = file_part.trim_start_matches('*').to_lowercase();
        if clean_file == target && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

pub fn check_github_updates() -> AppResult<UpdateCheckResult> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let user_agent = format!("User-Agent: Optimizer/{current_version}");

    let raw_json = run_hidden(
        "curl.exe",
        &[
            "-sSL",
            "--max-time",
            "10",
            "-H",
            &user_agent,
            "-H",
            "Accept: application/vnd.github+json",
            GITHUB_LATEST_RELEASE_URL,
        ],
    )?;

    let payload: GithubReleasePayload = serde_json::from_str(&raw_json).map_err(|e| {
        AppError::WindowsApi(format!(
            "Não foi possível interpretar resposta do GitHub Releases: {e}"
        ))
    })?;

    let latest_version = payload
        .tag_name
        .trim()
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string();
    let update_available = is_newer_version(&current_version, &latest_version);

    let setup_asset = payload
        .assets
        .iter()
        .find(|a| a.name.ends_with("-setup.exe") || a.name.ends_with(".exe") && !a.name.contains("portable"));
    let portable_asset = payload
        .assets
        .iter()
        .find(|a| a.name.to_lowercase().contains("portable") && a.name.ends_with(".exe"));
    let sums_asset = payload
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("SHA256SUMS.txt"));

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        release_tag: payload.tag_name.clone(),
        release_name: if payload.name.trim().is_empty() {
            format!("Optimizer {}", payload.tag_name)
        } else {
            payload.name
        },
        update_available,
        release_notes: payload.body,
        html_url: payload.html_url,
        published_at: payload.published_at,
        setup_exe_url: setup_asset.map(|a| a.browser_download_url.clone()),
        setup_exe_name: setup_asset.map(|a| a.name.clone()),
        portable_exe_url: portable_asset.map(|a| a.browser_download_url.clone()),
        sha256_sums_url: sums_asset.map(|a| a.browser_download_url.clone()),
    })
}

pub fn download_and_launch_update(
    asset_url: String,
    sha256_sums_url: Option<String>,
    expected_filename: String,
) -> AppResult<String> {
    if !asset_url.starts_with("https://github.com/vicode360/optimizer/releases/download/") {
        return Err(AppError::InvalidOperation(
            "URL de atualização recusada: apenas downloads oficiais de github.com/vicode360/optimizer são permitidos.".into(),
        ));
    }

    let safe_name: String = expected_filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    if safe_name.is_empty() || !safe_name.to_lowercase().ends_with(".exe") {
        return Err(AppError::InvalidOperation(
            "Nome de instalador inválido.".into(),
        ));
    }

    let update_dir: PathBuf = std::env::temp_dir().join("optimizer_updates");
    fs::create_dir_all(&update_dir)?;
    let target_file = update_dir.join(&safe_name);
    let target_str = target_file.to_string_lossy().to_string();

    run_hidden(
        "curl.exe",
        &["-sSL", "--max-time", "120", "-o", &target_str, &asset_url],
    )?;

    if !target_file.exists() {
        return Err(AppError::WindowsApi(
            "O arquivo do instalador não foi encontrado após o download.".into(),
        ));
    }

    if let Some(sums_url) = sha256_sums_url {
        if sums_url.starts_with("https://github.com/vicode360/optimizer/releases/download/") {
            if let Ok(sums_content) =
                run_hidden("curl.exe", &["-sSL", "--max-time", "15", &sums_url])
            {
                if let Some(expected_hash) = extract_expected_sha256(&sums_content, &safe_name) {
                    let ps_cmd = format!(
                        "(Get-FileHash -LiteralPath '{}' -Algorithm SHA256).Hash.ToLower()",
                        target_str.replace('\'', "''")
                    );
                    let actual_hash = run_hidden(
                        "powershell.exe",
                        &["-NoProfile", "-NonInteractive", "-Command", &ps_cmd],
                    )?
                    .trim()
                    .to_ascii_lowercase();

                    if actual_hash != expected_hash {
                        let _ = fs::remove_file(&target_file);
                        return Err(AppError::InvalidOperation(format!(
                            "Falha na verificação de integridade SHA-256! Esperado: {expected_hash}, Obtido: {actual_hash}."
                        )));
                    }
                }
            }
        }
    }

    Command::new(&target_file)
        .spawn()
        .map_err(|e| AppError::WindowsApi(format!("Falha ao iniciar o instalador '{target_str}': {e}")))?;

    Ok(target_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_and_parses_sha256_sums_accurately() {
        assert!(is_newer_version("0.1.0", "v0.2.0"));
        assert!(is_newer_version("0.1.0", "0.1.1"));
        assert!(!is_newer_version("0.2.0", "v0.2.0"));
        assert!(!is_newer_version("0.2.1", "v0.1.9"));

        let sample_sums = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Optimizer_0.1.0_x64-setup.exe\n";
        assert_eq!(
            extract_expected_sha256(sample_sums, "Optimizer_0.1.0_x64-setup.exe").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        );
    }
}
