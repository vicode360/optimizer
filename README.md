# Optimizer — Windows System Console

> Native Windows desktop application built with **Rust**, **Tauri v2**, **React 19**, **TypeScript**, and **Tailwind CSS v4** (Neobrutalism UI) for hardware diagnostics, live telemetry, and reversible system optimization.

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg?style=flat-square&color=05E17A)](LICENSE)
[![Rust](https://img.shields.io/badge/Backend-Rust%20%2B%20Tauri%20v2-black.svg?style=flat-square&color=5294FF)](src-tauri/Cargo.toml)
[![Frontend](https://img.shields.io/badge/UI-React%2019%20%2B%20Neobrutalism-black.svg?style=flat-square&color=FACC00)](package.json)

---

## Core Principles

- **Zero Placebos:** Every optimization maps to a documented Windows kernel, Registry, Service Control Manager (SCM), `powercfg`, `netsh`, `fsutil`, or Win32/NT API mechanism. Unsubstantiated registry myths (e.g., `IRQ8Priority`, `AlwaysUnloadDLL`, `IoPageLockLimit`, `DisableDynamicTick`) are strictly excluded.
- **Backup Before Mutation:** No Registry value, Windows Service, power plan, DNS setting, or TCP/IP parameter is modified without first capturing its exact pre-mutation state and persisting an atomic JSON snapshot (`MoveFileExW`) in `%AppData%\optimizer\backups\`.
- **Full LIFO Rollback:** Every applied session can be inspected down to exact keys/values and reverted cleanly in reverse order, either per session or across all active sessions.
- **Local-First & Zero Telemetry:** No external analytics, no cloud accounts, no background network calls. Everything runs locally on your machine.
- **Explicit Transparency:** Each tweak exposes an expandable technical drawer showing the exact Registry path, command, Win32 API call, privilege level, and benchmark/engineering rationale.

---

## Features

### 1. System Diagnostics, Native Hardware Inventory & Before/After Benchmark
- Reads CPU, RAM, swap, GPUs (including 64-bit `HardwareInformation.qwMemorySize` VRAM > 4 GiB), disks, network adapters, active power plan, monitors (`EnumDisplaySettingsW`), and input devices (`Win32_PnPEntity`) via `sysinfo`, WMI, and Win32 GDI.
- **Integrated Before & After Benchmark:** Measures real 1ms kernel timer sleep average/P95/jitter, live DNS resolution latency, available RAM, active power scheme, and TCP stack state before and after applying optimizations.
- **Bilingual Interface (`PT-BR` / `EN-US`) & Light/Dark Neobrutalism Themes:** Instant zero-latency language and theme switching in the top bar.

### 2. Real-Time Telemetry (1 Hz)
- Streams global CPU load, per-logical-core usage, memory utilization, active network RX/TX throughput, and system uptime over Tauri IPC (`telemetry://tick`).

### 3. Startup Programs & Scheduled Tasks Manager
- Inspects `HKCU Run`, `HKLM Run`, `HKLM Run32` (toggled non-destructively via Windows `StartupApproved\Run` binary flags without deleting Registry entries), and Windows telemetry/updater Scheduled Tasks (`schtasks`), with automatic atomic backup in `%AppData%\optimizer\backups\`.

### 4. 58 Audited, Reversible System Tweaks
Organized across 7 modular Rust backend engines (`src-tauri/src/tweaks/`) with instant search, category filters, risk levels (`SAFE`, `MODERATE`, `ADVANCED`), optional **Windows System Restore Point (VSS)** creation, **single-tweak rollback**, and curated presets:

| Module | Count | Examples |
| --- | :---: | --- |
| **CPU & Gaming** (`gaming_scheduler.rs`) | 9 | MMCSS Gaming/Audio Priority, `Win32PrioritySeparation`, `GlobalTimerResolutionRequests`, GameDVR, Power Throttling, dynamic `SvcHostSplitThresholdInKB` |
| **GPU & DirectX** (`gpu_directx.rs`) | 8 | HAGS, MPO toggle, PCIe GPU MSI Mode (existing MSI-capable devices only), TDR Delay, non-destructive DirectX Windowed Flip/VRR merge, DWM overhead reduction |
| **Network & TCP/IP** (`network_tcp.rs`) | 10 | Nagle (`TCPNoDelay`/`TcpAckFrequency`), Cloudflare/Google IPv4 DNS with DHCP rollback, NIC `PnPCapabilities`, Delivery Optimization P2P, RSS/RSC/ECN/Auto-Tuning, BBRv2 (Windows 11 22H2+ build check) |
| **Power, Memory & Storage** (`memory_power.rs`) | 8 | Ultimate Performance scheme, Hibernation/Fast Startup, USB Selective Suspend, PCIe ASPM, Standby List purge via `NtSetSystemInformation`, NTFS `disablelastaccess`, `disable8dot3` & TRIM verification |
| **Peripherals & Input** (`input_peripherals.rs`) | 6 | Raw 1:1 mouse input + exact 40-byte MarkC linear curves, keyboard repeat latency, Accessibility prompt flags, USB HID idle suspend |
| **Debloat & Services** (`debloat_services.rs`) | 9 | Telemetry policy/services (`DiagTrack`), Start Menu Bing search, Copilot/Consumer features, Activity History, background UWP apps, SysMain (automatically gated to SSD/NVMe system drives) |
| **Security Hardening** (`security_hardening.rs`) | 8 | CIS/Microsoft Baseline controls: disable LLMNR, SMBv1, Null Sessions, WDigest cleartext credentials, AutoRun; enforce SMB Signing & DoH Auto; optional VBS/HVCI trade-off |

### 4. Atomic Backup Vault
- Lists every saved snapshot session in `%AppData%\optimizer\backups\`, inspects exact captured values (`REG_DWORD`, `REG_QWORD`, `REG_SZ`, `REG_EXPAND_SZ`, `REG_BINARY`, `REG_MULTI_SZ`, `Absent`, SCM start types, `powercfg` AC/DC indices, `fsutil`, `netsh`, and IPv4 DNS), and performs 2-step confirmed rollbacks.

---

## Tech Stack

- **Backend:** Rust (2021), Tauri v2, `windows` (Win32 APIs), `winreg`, `sysinfo`, `wmi`, `tokio`, `serde`, `chrono`, `uuid`, `thiserror`
- **Frontend:** React 19, TypeScript (strict), Vite, Tailwind CSS v4 (Neobrutalism Light & Dark themes), `@base-ui/react`, `lucide-react`, bundled `@fontsource/dm-sans` and `@fontsource-variable/jetbrains-mono`
- **Testing:** Cargo unit tests (`cargo test --lib`) + Vitest & Testing Library (`npm test`)

---

## Requirements & Development

### Prerequisites
- **Windows 10 / 11 (x64)**
- **Node.js 20+** and **npm**
- **Rust toolchain** (`rustup`, MSVC Build Tools)
- **WebView2 Runtime** (pre-installed on Windows 11 and modern Windows 10)

### Commands

```bash
# Install frontend dependencies
npm install

# Run desktop app in development mode
npm run tauri dev

# Frontend checks & stress tests
npm run typecheck
npm run lint
npm test
npm run build

# Rust backend check & unit tests
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Build production installer (.msi / .exe)
npm run tauri build
```

---

## Responsible Use & Disclaimer

Optimizer modifies Windows Registry keys, system services, power settings, and network parameters when explicitly triggered by an elevated Administrator session. While every tweak is backed up atomically prior to modification and designed for clean reversal, **always review the technical drawer and risk level (`SAFE`, `MODERATE`, `ADVANCED`) before applying changes**, especially `ADVANCED` tweaks or security trade-offs on corporate/managed devices.

See [SECURITY.md](SECURITY.md) for our security architecture and vulnerability disclosure policy.

---

## License

Released under the [MIT License](LICENSE).
