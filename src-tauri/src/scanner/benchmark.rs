use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;
use sysinfo::{MemoryRefreshKind, RefreshKind, System};

use crate::error::AppResult;
use crate::scanner::hardware::read_active_power_plan;
use crate::tweaks::system_ops::{
    query_active_dns_adapters_fast, query_netsh_supplemental_provider, query_netsh_tcp_global_map,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSnapshot {
    pub captured_at: DateTime<Utc>,
    pub timer_avg_ms: f64,
    pub timer_p95_ms: f64,
    pub timer_jitter_ms: f64,
    pub dns_latency_ms: Option<f64>,
    pub primary_dns_server: String,
    pub memory_available_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub memory_percent: f32,
    pub power_plan_name: String,
    pub tcp_autotuning: String,
    pub tcp_rss: String,
    pub tcp_rsc: String,
    pub tcp_congestion_provider: String,
}

fn measure_timer_sleep_stats(samples: usize) -> (f64, f64, f64) {
    let count = samples.max(5);
    let mut durations_ms = Vec::with_capacity(count);
    for _ in 0..count {
        let start = Instant::now();
        std::thread::sleep(Duration::from_millis(1));
        durations_ms.push(start.elapsed().as_secs_f64() * 1000.0);
    }

    durations_ms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let sum: f64 = durations_ms.iter().sum();
    let avg = sum / (count as f64);
    let p95_idx = ((count as f64) * 0.95).floor() as usize;
    let p95 = durations_ms[p95_idx.min(count - 1)];
    let jitter = (durations_ms[count - 1] - durations_ms[0]).max(0.0);

    (
        (avg * 100.0).round() / 100.0,
        (p95 * 100.0).round() / 100.0,
        (jitter * 100.0).round() / 100.0,
    )
}

fn measure_dns_resolution_ms() -> Option<f64> {
    let hosts = [
        "one.one.one.one:443",
        "dns.google:443",
        "www.microsoft.com:443",
    ];
    let mut timings = Vec::new();
    for host in hosts {
        let start = Instant::now();
        if let Ok(mut iter) = host.to_socket_addrs() {
            if iter.next().is_some() {
                timings.push(start.elapsed().as_secs_f64() * 1000.0);
            }
        }
    }
    if timings.is_empty() {
        return None;
    }
    timings.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = timings[timings.len() / 2];
    Some((median * 100.0).round() / 100.0)
}

pub fn run_system_benchmark() -> AppResult<BenchmarkSnapshot> {
    let ((timer_avg_ms, timer_p95_ms, timer_jitter_ms), dns_latency_ms, tcp_map, provider) =
        std::thread::scope(|s| {
            let h_timer = s.spawn(|| measure_timer_sleep_stats(20));
            let h_dns = s.spawn(measure_dns_resolution_ms);
            let h_tcp = s.spawn(query_netsh_tcp_global_map);
            let h_prov = s.spawn(|| {
                query_netsh_supplemental_provider("Internet").unwrap_or_else(|| "default".into())
            });

            (
                h_timer.join().unwrap_or((1.0, 1.0, 0.0)),
                h_dns.join().unwrap_or(None),
                h_tcp.join().unwrap_or_default(),
                h_prov.join().unwrap_or_else(|_| "default".into()),
            )
        });

    let sys = System::new_with_specifics(
        RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()),
    );
    let memory_total_bytes = sys.total_memory();
    let memory_used_bytes = sys.used_memory();
    let memory_available_bytes = sys.available_memory();
    let memory_percent = if memory_total_bytes > 0 {
        ((memory_used_bytes as f64 / memory_total_bytes as f64) * 100.0) as f32
    } else {
        0.0
    };

    let active_plan = read_active_power_plan();
    let adapters = query_active_dns_adapters_fast();
    let primary_dns_server = adapters
        .iter()
        .find_map(|a| a.server_addresses.first().cloned())
        .unwrap_or_else(|| "DHCP / Auto".into());

    Ok(BenchmarkSnapshot {
        captured_at: Utc::now(),
        timer_avg_ms,
        timer_p95_ms,
        timer_jitter_ms,
        dns_latency_ms,
        primary_dns_server,
        memory_available_bytes,
        memory_used_bytes,
        memory_total_bytes,
        memory_percent,
        power_plan_name: active_plan.name,
        tcp_autotuning: tcp_map
            .get("autotuninglevel")
            .cloned()
            .unwrap_or_else(|| "normal".into()),
        tcp_rss: tcp_map
            .get("rss")
            .cloned()
            .unwrap_or_else(|| "enabled".into()),
        tcp_rsc: tcp_map
            .get("rsc")
            .cloned()
            .unwrap_or_else(|| "enabled".into()),
        tcp_congestion_provider: provider,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_timer_sleep_stats_within_sane_bounds() {
        let (avg, p95, jitter) = measure_timer_sleep_stats(6);
        assert!(avg >= 0.5 && avg < 100.0);
        assert!(p95 >= avg);
        assert!(jitter >= 0.0);
    }
}
