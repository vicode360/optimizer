use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, Networks, RefreshKind, System};
use tauri::{AppHandle, Emitter};

pub const TELEMETRY_EVENT_NAME: &str = "telemetry://tick";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryTick {
    pub timestamp: DateTime<Utc>,
    pub cpu_usage_percent: f32,
    pub cpu_per_core_percent: Vec<f32>,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub memory_percent: f32,
    pub network_rx_bytes_per_sec: u64,
    pub network_tx_bytes_per_sec: u64,
    pub uptime_seconds: u64,
}

pub fn collect_tick(
    sys: &mut System,
    networks: &mut Networks,
    elapsed_secs: f64,
) -> TelemetryTick {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    networks.refresh(true);

    let cpu_per_core_percent: Vec<f32> = sys.cpus().iter().map(|c| c.cpu_usage()).collect();
    let cpu_usage_percent = sys.global_cpu_usage();

    let memory_total_bytes = sys.total_memory();
    let memory_used_bytes = sys.used_memory();
    let memory_percent = if memory_total_bytes > 0 {
        ((memory_used_bytes as f64 / memory_total_bytes as f64) * 100.0) as f32
    } else {
        0.0
    };

    let safe_elapsed = elapsed_secs.max(0.1);
    let mut rx_delta: u64 = 0;
    let mut tx_delta: u64 = 0;
    for (_name, data) in networks.iter() {
        rx_delta = rx_delta.saturating_add(data.received());
        tx_delta = tx_delta.saturating_add(data.transmitted());
    }

    let network_rx_bytes_per_sec = ((rx_delta as f64) / safe_elapsed).round() as u64;
    let network_tx_bytes_per_sec = ((tx_delta as f64) / safe_elapsed).round() as u64;

    TelemetryTick {
        timestamp: Utc::now(),
        cpu_usage_percent,
        cpu_per_core_percent,
        memory_used_bytes,
        memory_total_bytes,
        memory_percent,
        network_rx_bytes_per_sec,
        network_tx_bytes_per_sec,
        uptime_seconds: System::uptime(),
    }
}

pub fn spawn_telemetry_stream(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let refresh = RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything());
        let mut sys = System::new_with_specifics(refresh);
        let mut networks = Networks::new_with_refreshed_list();
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Primeira amostra de aquecimento para delta válido de CPU/rede
        interval.tick().await;
        sys.refresh_cpu_usage();
        networks.refresh(true);
        let mut last_tick = Instant::now();

        loop {
            interval.tick().await;
            let now = Instant::now();
            let elapsed = now.duration_since(last_tick).as_secs_f64();
            last_tick = now;

            let tick = collect_tick(&mut sys, &mut networks, elapsed);
            let _ = app.emit(TELEMETRY_EVENT_NAME, &tick);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_valid_telemetry_tick_shape() {
        let refresh = RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything());
        let mut sys = System::new_with_specifics(refresh);
        let mut networks = Networks::new_with_refreshed_list();

        let tick = collect_tick(&mut sys, &mut networks, 1.0);
        assert!(tick.memory_total_bytes > 0);
        assert!(tick.memory_percent >= 0.0 && tick.memory_percent <= 100.0);
        assert!(!tick.cpu_per_core_percent.is_empty());

        let json = serde_json::to_string(&tick).unwrap();
        assert!(json.contains("\"cpuUsagePercent\""));
        assert!(json.contains("\"cpuPerCorePercent\""));
        assert!(json.contains("\"networkRxBytesPerSec\""));
        assert!(json.contains("\"networkTxBytesPerSec\""));
    }
}
