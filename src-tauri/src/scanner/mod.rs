pub mod benchmark;
pub mod diagnostics;
pub mod hardware;
pub mod peripherals;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemScanReport {
    pub scanned_at: DateTime<Utc>,
    pub hardware: hardware::HardwareSummary,
    pub peripherals: peripherals::PeripheralsSummary,
    pub diagnostics: Vec<diagnostics::DiagnosticFinding>,
}

pub fn run_full_scan() -> AppResult<SystemScanReport> {
    let hardware = hardware::collect_hardware_summary()?;
    let peripherals = peripherals::collect_peripherals_summary()?;
    let diagnostics = diagnostics::analyze_system(&hardware, &peripherals);

    Ok(SystemScanReport {
        scanned_at: Utc::now(),
        hardware,
        peripherals,
        diagnostics,
    })
}
