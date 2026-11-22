import type {
  AppLocale,
  DiagnosticFinding,
  TweakItem,
} from "../types/system";

const TWEAK_EN: Record<
  string,
  { title: string; description: string; benchmarkNote: string }
> = {
  registry_mmcss_gaming: {
    title: "MMCSS Gaming & Real-Time Priority",
    description:
      "Reserves 100% of multimedia CPU cycles for foreground applications (SystemResponsiveness=0) and sets Tasks\\Games to GPU Priority 8 and High Scheduling Category.",
    benchmarkNote:
      "Microsoft MMCSS / Frame-pacing benchmarks: reduces 1% and 0.1% low frame-time spikes under background thread contention.",
  },
  gaming_win32_priority_separation: {
    title: "Win32PrioritySeparation (Short Foreground Quantum 0x26)",
    description:
      "Configures the Windows NT scheduler for short, variable foreground quantums with 3:1 foreground boost (0x26 / 38 decimal).",
    benchmarkNote:
      "Windows Internals (Russinovich) & latency testing: improves input responsiveness and foreground thread scheduling.",
  },
  gaming_global_timer_resolution: {
    title: "Global High-Resolution Kernel Timer (Win11)",
    description:
      "Enables GlobalTimerResolutionRequests=1 so high-precision timer requests (0.5ms / 1ms) apply globally across threads on Windows 11.",
    benchmarkNote:
      "Eliminates sleep jitter caused by Windows 11 per-process timer isolation.",
  },
  registry_disable_gamedvr: {
    title: "Disable GameDVR & Background Capture",
    description:
      "Disables Xbox GameDVR background video encoding and AppCapture hooks that intercept DXGI swapchains.",
    benchmarkNote:
      "Removes continuous GPU encoder polling and DWM capture hooks during gameplay.",
  },
  gaming_disable_power_throttling: {
    title: "Disable Kernel Power Throttling (EcoQoS)",
    description:
      "Sets PowerThrottlingOff=1 to prevent Windows from down-clocking background audio, VoIP, or helper threads into EcoQoS efficiency cores.",
    benchmarkNote:
      "Prevents micro-stutters on hybrid Intel/AMD architectures during multi-threaded loads.",
  },
  gaming_disable_fullscreen_optimizations: {
    title: "Disable Global Fullscreen Optimizations (FSO)",
    description:
      "Configures GameConfigStore to prefer exclusive fullscreen presentation over DWM-redirected borderless conversion where supported.",
    benchmarkNote:
      "Reduces DWM composition overhead in legacy DX9/DX11 competitive titles.",
  },
  gaming_disable_game_bar_tips: {
    title: "Disable Xbox Game Bar Startup Overlay & Tips",
    description:
      "Disables Game Bar startup tips, overlay notifications, and auto-launch triggers on controller input.",
    benchmarkNote:
      "Prevents background UWP overlay wakeups during fullscreen focus transitions.",
  },
  gaming_mmcss_audio_priority: {
    title: "MMCSS Pro Audio Low-Latency Profile",
    description:
      "Elevates MMCSS Audio and Pro Audio task scheduling priorities to prevent WASAPI buffer underruns.",
    benchmarkNote:
      "LatencyMon: reduces audio buffer crackles and DPC scheduling delay under high CPU load.",
  },
  gaming_split_svchost_threshold: {
    title: "Optimize SvcHostSplitThresholdInKB to Physical RAM",
    description:
      "Aligns the svchost.exe process split threshold with installed physical RAM to consolidate service hosts and reduce idle context switches.",
    benchmarkNote:
      "AtlasOS / WinUtil: consolidates 40–70 redundant svchost.exe processes, saving kernel handles and page-table overhead.",
  },
  gpu_enable_hags: {
    title: "Enable Hardware-Accelerated GPU Scheduling (HAGS)",
    description:
      "Sets HwSchMode=2 so the GPU hardware scheduler manages VRAM queues directly, reducing CPU scheduling overhead and required for DLSS 3 / FSR 3 Frame Generation.",
    benchmarkNote:
      "Microsoft WDDM 2.7+: reduces CPU draw-call submission latency (reboot required).",
  },
  gpu_disable_mpo: {
    title: "Disable Multi-Plane Overlay (MPO Fix)",
    description:
      "Sets OverlayTestMode=5 in DWM to prevent multi-plane hardware composition flicker, black screens, and VRR stutters on multi-monitor setups.",
    benchmarkNote:
      "NVIDIA/AMD official driver advisory for resolving DWM micro-stutter in borderless and multi-monitor VRR setups.",
  },
  gpu_msi_mode_display: {
    title: "Enable PCIe MSI Mode (Message Signaled Interrupts) for GPU",
    description:
      "Configures active MSI-capable PCI Display adapters to use Message Signaled Interrupts (MSISupported=1) instead of legacy line-based IRQ sharing.",
    benchmarkNote:
      "LatencyMon DPC/ISR analysis: lowers dxgkrnl.sys and GPU driver ISR execution latency.",
  },
  gpu_tdr_delay: {
    title: "Extend GPU Driver TDR Timeout (TdrDelay=10s)",
    description:
      "Increases Timeout Detection and Recovery thresholds (TdrDelay/TdrDdiDelay=10s) so transient heavy shader compilation spikes do not reset the display driver.",
    benchmarkNote:
      "Prevents false-positive DXGI_ERROR_DEVICE_HUNG crashes during Unreal Engine 5 / DX12 shader compilation.",
  },
  gpu_windowed_optimizations: {
    title: "DirectX Flip Model & Windowed VRR Optimizations",
    description:
      "Enables SwapEffectUpgradeEnable=1 and VRROptimizeEnable=1 while preserving existing DirectX user flags.",
    benchmarkNote:
      "Microsoft DirectX DevBlog: brings borderless windowed presentation latency down to exclusive fullscreen levels.",
  },
  gpu_disable_transparency_dwm: {
    title: "Disable DWM Acrylic / Mica Shell Transparency",
    description:
      "Disables Windows shell blur and transparency effects (EnableTransparency=0) to free DWM compositor bandwidth and VRAM.",
    benchmarkNote:
      "Reduces background dwm.exe GPU utilization when overlays or secondary displays are active.",
  },
  gpu_disable_dwm_animations: {
    title: "Disable Window Minimize/Maximize & Shell Animations",
    description:
      "Disables MinAnimate and taskbar animation delays for instantaneous window focus switching.",
    benchmarkNote:
      "Eliminates 150–250ms synthetic UI transition delays in Desktop Window Manager.",
  },
  gpu_disable_miracast_polling: {
    title: "Disable Miracast Virtual Display Polling",
    description:
      "Disables WDDM wireless display Miracast polling when wireless projection is not used.",
    benchmarkNote:
      "Removes periodic virtual display enumeration queries in DXGKrnl.",
  },
  network_tcp_nodelay: {
    title: "Disable Nagle's Algorithm (TCPNoDelay + TcpAckFrequency=1)",
    description:
      "Sets TcpAckFrequency=1, TCPNoDelay=1, and TcpDelAckTicks=0 on active NICs plus NetworkThrottlingIndex=0xFFFFFFFF to eliminate 40–200ms packet coalescing delays.",
    benchmarkNote:
      "RFC 896 / Wireshark tick analysis: eliminates delayed-ACK buffering for small game and RPC packets.",
  },
  network_dns_cloudflare: {
    title: "Low-Latency Cloudflare Anycast DNS (1.1.1.1 / 1.0.0.1)",
    description:
      "Configures Cloudflare IPv4 DNS on active network adapters, flushes DNS cache, and snapshots original DHCP/static state.",
    benchmarkNote:
      "DNSPerf Global: consistently ranks among the lowest global DNS resolution latencies (<15ms).",
  },
  network_dns_google: {
    title: "Low-Latency Google Public DNS (8.8.8.8 / 8.8.4.4)",
    description:
      "Configures Google Public IPv4 DNS on active network adapters, flushes DNS cache, and snapshots original DHCP/static state.",
    benchmarkNote:
      "High-availability anycast resolver with full DNSSEC and DoH support.",
  },
  network_disable_nic_power_saving: {
    title: "Disable Network Adapter Power Saving & EEE",
    description:
      "Sets PnPCapabilities=24 (0x18) on active physical network adapters to prevent Windows from powering down the NIC or entering low-power link states.",
    benchmarkNote:
      "Eliminates packet-burst wakeup jitter on PCIe Ethernet and Wi-Fi adapters.",
  },
  network_disable_delivery_optimization: {
    title: "Disable Windows Update P2P Delivery Optimization",
    description:
      "Sets DODownloadMode=0 so Windows Update does not upload update chunks to other peers in the background.",
    benchmarkNote:
      "Prevents sudden upload bandwidth saturation and bufferbloat spikes during online sessions.",
  },
  network_tcp_autotuning_normal: {
    title: "Enforce TCP Receive Window Auto-Tuning (Normal)",
    description:
      "Ensures netsh int tcp autotuninglevel=normal so TCP window scaling adapts to high-bandwidth links without stalling.",
    benchmarkNote:
      "RFC 7323: disabling auto-tuning caps throughput to 64 KiB windows; 'normal' is the optimal Microsoft baseline.",
  },
  network_tcp_rss_enabled: {
    title: "Enable Receive-Side Scaling (Multi-Core NIC Queues)",
    description:
      "Enables netsh int tcp rss=enabled so network packet interrupts distribute across multiple CPU cores instead of saturating Core 0.",
    benchmarkNote:
      "Microsoft Networking Guidelines: prevents Core 0 DPC bottlenecks under high packet rates.",
  },
  network_tcp_rsc_disabled: {
    title: "Disable Receive Segment Coalescing (RSC Low-Latency)",
    description:
      "Sets netsh int tcp rsc=disabled so the NIC forwards packets immediately to the stack instead of holding them to merge segments.",
    benchmarkNote:
      "Reduces per-packet delivery jitter on Wi-Fi and gigabit Ethernet adapters.",
  },
  network_tcp_ecn_disabled: {
    title: "Disable ECN Capability for Gaming UDP/TCP Compatibility",
    description:
      "Sets netsh int tcp ecncapability=disabled to avoid packet drops on legacy consumer routers and ISP middleboxes.",
    benchmarkNote:
      "Prevents connection resets on routers that drop ECN-marked SYN packets.",
  },
  network_tcp_congestion_bbr2: {
    title: "TCP BBRv2 Congestion Control Provider (Win11 22H2+)",
    description:
      "Configures Google BBRv2 model-based congestion control on Internet/InternetCustom templates (with loopbacklargemtu safeguard) to mitigate bufferbloat.",
    benchmarkNote:
      "ACM / Google BBRv2 papers: reduces queue delay under load while preserving throughput.",
  },
  power_ultimate_performance: {
    title: "Activate Ultimate Performance Power Plan",
    description:
      "Duplicates and activates the hidden Microsoft Ultimate Performance scheme (e9a42b02-...) to eliminate C-state and frequency ramp-up latency.",
    benchmarkNote:
      "Microsoft Workstation Power Policy: stabilizes CPU clock frequency and frame-time consistency.",
  },
  power_disable_hibernation: {
    title: "Disable Hibernation & Fast Startup (Frees hiberfil.sys)",
    description:
      "Runs powercfg /hibernate off, reclaiming gigabytes of SSD space and ensuring clean kernel/driver initialization on cold boot.",
    benchmarkNote:
      "Frees ~40% of installed RAM in disk space and prevents hybrid-boot driver DPC corruption.",
  },
  power_disable_usb_selective_suspend: {
    title: "Disable USB Selective Suspend",
    description:
      "Disables USB hub selective suspend on AC and DC in the active power plan to prevent peripheral and DAC wakeup drops.",
    benchmarkNote:
      "Eliminates brief USB disconnects and xHCI controller latency spikes.",
  },
  power_disable_pcie_aspm: {
    title: "Disable PCI Express Link State Power Management (ASPM)",
    description:
      "Disables PCIe L0s/L1 link power saving on AC power to prevent bus wakeup latency on discrete GPUs and NVMe drives.",
    benchmarkNote:
      "PCI-SIG / LatencyMon: eliminates PCIe bus transition stalls under variable GPU load.",
  },
  power_processor_min_state_100: {
    title: "Processor Minimum Performance State 100% (AC)",
    description:
      "Keeps minimum CPU performance floor at 100% on AC wall power while leaving DC battery settings untouched.",
    benchmarkNote:
      "Eliminates P-state ramp-up delay during rapid scene transitions (increases idle power draw).",
  },
  memory_standby_cleanup: {
    title: "Purge RAM Standby List (NtSetSystemInformation)",
    description:
      "Acquires SeProfileSingleProcessPrivilege and invokes NtSetSystemInformation(MemoryPurgeStandbyList) to flush cached standby pages on demand.",
    benchmarkNote:
      "Same native NT mechanism as ISLC: eliminates free-memory exhaustion stutters without touching the pagefile.",
  },
  storage_disable_ntfs_last_access: {
    title: "Disable NTFS Last Access Timestamp Updates",
    description:
      "Disables writing last-access metadata timestamps on every file read (fsutil behavior set disablelastaccess 1).",
    benchmarkNote:
      "Reduces background metadata write IOPS and extends SSD endurance (TBW).",
  },
  storage_disable_8dot3_and_verify_trim: {
    title: "Disable Legacy 8.3 Short Names & Verify NVMe TRIM",
    description:
      "Disables legacy MS-DOS 8.3 short filename generation and ensures immediate TRIM notifications (DisableDeleteNotify=0).",
    benchmarkNote:
      "Speeds up directory enumeration in folders with thousands of game assets and maintains SSD write performance.",
  },
  registry_disable_mouse_accel: {
    title: "True 1:1 Raw Mouse Input (Disable Pointer Acceleration)",
    description:
      "Sets MouseSpeed=0, MouseThreshold1=0, MouseThreshold2=0 and writes exact 40-byte MarkC 1:1 linear SmoothMouseX/YCurve tables.",
    benchmarkNote:
      "Guarantees 1:1 physical-to-pixel cursor movement even in games without Raw Input.",
  },
  input_keyboard_repeat_fast: {
    title: "Minimize Keyboard Repeat Delay & Maximize Rate",
    description:
      "Sets KeyboardDelay=0 (250ms minimum) and KeyboardSpeed=31 (~30 chars/sec maximum) in HKCU\\Control Panel\\Keyboard.",
    benchmarkNote:
      "Improves responsiveness for rapid key repeat and movement inputs.",
  },
  input_disable_sticky_keys: {
    title: "Disable Sticky Keys Shortcut Prompt (5x Shift)",
    description:
      "Clears hotkey activation flags in StickyKeys (Flags=506) so pressing Shift 5 times never steals fullscreen focus.",
    benchmarkNote:
      "Prevents accidental desktop focus loss during gameplay.",
  },
  input_disable_filter_keys: {
    title: "Disable Filter Keys & Bounce Delay Prompt",
    description:
      "Sets FilterKeys Flags=122 to disable hold-Right-Shift popup prompts and key-repeat debounce filtering.",
    benchmarkNote:
      "Ensures zero artificial input filtering on fast mechanical or optical switches.",
  },
  input_disable_toggle_keys: {
    title: "Disable Toggle Keys Beep Prompt (5s NumLock)",
    description:
      "Sets ToggleKeys Flags=58 to disable the 5-second NumLock accessibility prompt.",
    benchmarkNote:
      "Completes accessibility hotkey hardening for fullscreen applications.",
  },
  input_disable_usb_hid_idle_suspend: {
    title: "Disable USB HID Device Idle Power Management",
    description:
      "Sets EnhancedPowerManagementEnabled=0 on enumerated USB HID devices to stop Windows from suspending 1000Hz–8000Hz gaming mice and keyboards.",
    benchmarkNote:
      "Eliminates first-movement wake lag on wireless 2.4GHz dongles and high-polling-rate mice.",
  },
  debloat_telemetry_services: {
    title: "Disable Connected Telemetry Services (DiagTrack & WAP Push)",
    description:
      "Stops and disables DiagTrack (Connected User Experiences and Telemetry) and dmwappushservice via Win32 SCM.",
    benchmarkNote:
      "Removes periodic disk/network telemetry bursts and background ETW trace uploads.",
  },
  debloat_telemetry_policy: {
    title: "Reduce Diagnostic Telemetry Collection Policy (AllowTelemetry=0)",
    description:
      "Configures DataCollection policies (AllowTelemetry=0) and disables the Compatibility Telemetry Runner.",
    benchmarkNote:
      "Prevents CompatTelRunner.exe from causing high CPU and disk usage spikes.",
  },
  debloat_disable_bing_search: {
    title: "Disable Start Menu Bing Web Search & Cortana Web Results",
    description:
      "Sets DisableSearchBoxSuggestions=1 and BingSearchEnabled=0 so Start Menu searches remain local and instantaneous.",
    benchmarkNote:
      "Eliminates HTTPS SearchHost.exe queries on every keystroke in the Start Menu.",
  },
  debloat_disable_copilot_cortana: {
    title: "Disable Windows Copilot & Cortana Background Agents",
    description:
      "Sets TurnOffWindowsCopilot=1 and AllowCortana=0 via policy keys.",
    benchmarkNote:
      "Frees WebView2 memory and background shell processes.",
  },
  debloat_disable_consumer_features: {
    title: "Disable Windows Consumer Features & Lock Screen Ads",
    description:
      "Disables automatic installation of promoted store apps (DisableWindowsConsumerFeatures=1) and lock screen tips/ads.",
    benchmarkNote:
      "Prevents silent background downloads of promotional UWP packages.",
  },
  debloat_disable_activity_history: {
    title: "Disable Timeline Activity History Sync",
    description:
      "Disables PublishUserActivities and UploadUserActivities in HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System.",
    benchmarkNote:
      "Reduces background I/O and cloud activity logging.",
  },
  debloat_disable_background_uwp_apps: {
    title: "Disable Global Background Execution for UWP Store Apps",
    description:
      "Sets GlobalUserDisabled=1 in BackgroundAccessApplications so non-active Store apps do not run background tasks.",
    benchmarkNote:
      "Reclaims RAM and reduces background context switches from dormant UWP apps.",
  },
  debloat_disable_wer_and_maps: {
    title: "Disable Windows Error Reporting (WerSvc) & Offline Maps Broker",
    description:
      "Disables WerSvc crash dump uploader and MapsBroker background downloader via Win32 SCM.",
    benchmarkNote:
      "Prevents heavy disk compression and upload spikes after application crashes.",
  },
  debloat_disable_sysmain_ssd: {
    title: "Disable SysMain (Superfetch) on NVMe/SSD System Drives",
    description:
      "Disables the SysMain prefetcher service (only applicable when the system drive is detected as an SSD/NVMe).",
    benchmarkNote:
      "On fast NVMe SSDs, avoids redundant background RAM cache preloading and disk writes.",
  },
  security_disable_llmnr: {
    title: "Disable Multicast Name Resolution (LLMNR — CIS Hardening)",
    description:
      "Sets EnableMulticast=0 in DNSClient policy to prevent link-local spoofing and NTLM hash capture on local networks.",
    benchmarkNote:
      "CIS Windows Benchmark L1: blocks Responder/LLMNR poisoning attacks with zero performance cost.",
  },
  security_disable_smbv1: {
    title: "Disable Legacy SMBv1 Protocol Driver",
    description:
      "Sets SMB1=0 in LanmanServer\\Parameters to permanently block the vulnerable SMBv1 dialect (WannaCry / EternalBlue vector).",
    benchmarkNote:
      "Microsoft Security Baseline & CIS L1 mandatory hardening control.",
  },
  security_restrict_null_sessions: {
    title: "Restrict Anonymous SAM & Share Enumeration (Null Sessions)",
    description:
      "Sets RestrictAnonymous=1 and RestrictAnonymousSAM=1 in LSA to block unauthenticated network enumeration.",
    benchmarkNote:
      "CIS Benchmark L1: prevents anonymous reconnaissance of local accounts and shares.",
  },
  security_require_smb_signing: {
    title: "Require SMB Packet Signing on Client Connections",
    description:
      "Enables RequireSecuritySignature=1 on LanmanWorkstation to prevent Man-in-the-Middle SMB relay attacks.",
    benchmarkNote:
      "Microsoft Security Baseline: cryptographic integrity verification for outbound SMB traffic.",
  },
  security_enable_dns_over_https: {
    title: "Enable Automatic DNS-over-HTTPS (DoH Encryption)",
    description:
      "Sets EnableAutoDoh=2 in Dnscache\\Parameters so Windows automatically upgrades to encrypted DoH when supported by the configured DNS resolver.",
    benchmarkNote:
      "Encrypts DNS queries against local network snooping and ISP tampering.",
  },
  security_disable_wdigest_plaintext: {
    title: "Disable WDigest Cleartext Credential Caching in LSASS",
    description:
      "Sets UseLogonCredential=0 in WDigest so plaintext passwords are never cached in LSASS memory.",
    benchmarkNote:
      "Mitigates credential dumping attacks (Mimikatz) with zero runtime overhead.",
  },
  security_disable_autorun: {
    title: "Disable AutoRun / AutoPlay Across All Drive Types",
    description:
      "Sets NoDriveTypeAutoRun=255 (0xFF) to block automatic execution from removable USB and optical media.",
    benchmarkNote:
      "CIS Benchmark L1: blocks removable-media malware propagation.",
  },
  security_disable_vbs_hvci_gaming: {
    title: "Disable VBS / Memory Integrity (HVCI) for Maximum Gaming FPS",
    description:
      "Sets EnableVirtualizationBasedSecurity=0 and HypervisorEnforcedCodeIntegrity=0 (Trade-off: gains 5–12% CPU-bound gaming FPS at the cost of hypervisor memory isolation; reboot required).",
    benchmarkNote:
      "Tom's Hardware / TechSpot benchmarks: eliminates nested page-table translation overhead in CPU-bound games.",
  },
};

const DIAGNOSTIC_EN: Record<string, { title: string; detail: string }> = {
  diag_power_plan: {
    title: "Active power plan may throttle CPU boost clocks",
    detail:
      "Switching to Ultimate Performance reduces C-state wakeup latency and improves frame-time consistency.",
  },
  diag_power_plan_ok: {
    title: "High-performance power scheme active",
    detail:
      "Active power plan is operating without aggressive C-state frequency throttling.",
  },
  diag_memory_pressure: {
    title: "Memory pressure or Standby List cache accumulation",
    detail:
      "Purging the Standby List and prioritizing MMCSS helps prevent free-memory exhaustion stutters in long sessions.",
  },
  diag_disk_low_space: {
    title: "Low free space on system storage volume",
    detail:
      "SSDs near full capacity experience write amplification and slower garbage collection. Disabling hibernation frees several GiB.",
  },
  diag_gaming_capture_net: {
    title: "Pending DPC latency, kernel timer, and network optimizations",
    detail:
      "High-impact latency tweaks (GameDVR, GlobalTimerResolutionRequests, Raw Mouse, TCPNoDelay, or Telemetry) can be optimized.",
  },
  diag_gaming_capture_net_ok: {
    title: "Gaming latency and network stack calibrated",
    detail:
      "GameDVR, GlobalTimerResolutionRequests, Raw Mouse, NetworkThrottlingIndex, and DiagTrack are already optimized.",
  },
  diag_security_baseline: {
    title: "Recommended CIS / Microsoft Security Baseline controls",
    detail:
      "Disabling LLMNR (EnableMulticast=0) and blocking SMBv1 reduces local network attack surface with zero FPS cost.",
  },
};

export const REBOOT_REQUIRED_TWEAK_IDS = new Set([
  "gpu_enable_hags",
  "gpu_disable_mpo",
  "gpu_msi_mode_display",
  "gaming_split_svchost_threshold",
  "security_disable_vbs_hvci_gaming",
  "security_disable_smbv1",
]);

export function localizeTweak(item: TweakItem, locale: AppLocale): TweakItem {
  if (locale === "pt") return item;
  const en = TWEAK_EN[item.id];
  if (!en) return item;
  return {
    ...item,
    title: en.title,
    description: en.description,
    benchmarkNote: en.benchmarkNote,
  };
}

export function localizeDiagnostic(
  finding: DiagnosticFinding,
  locale: AppLocale
): DiagnosticFinding {
  if (locale === "pt") return finding;
  const en = DIAGNOSTIC_EN[finding.id];
  if (!en) return finding;
  return {
    ...finding,
    title: en.title,
    detail: en.detail,
  };
}

export const UI_COPY = {
  pt: {
    nav: {
      diagnostics: "Diagnóstico",
      netlab: "NetLab (Ping & QoS)",
      hardware: "Hardware",
      telemetry: "Telemetria",
      startup: "Inicialização",
      tweaks: "Tweaks",
      backups: "Backups",
      verifyingToken: "Verificando token...",
      admin: "Administrador",
      standardUser: "Usuário padrão",
      elevateBtn: "Elevar como Admin",
      waitingUac: "Aguardando UAC...",
      checkUpdates: "Verificar Atualizações",
    },
    topBar: {
      diagnosticsTitle: "Diagnóstico",
      diagnosticsSub:
        "Saúde do sistema, benchmark antes/depois e recomendações reais",
      netlabTitle: "NetLab — Rotas, Ping, QoS DSCP 46 & Auto-MTU",
      netlabSub:
        "Priorização de pacotes de jogos (Pacer.sys EF), análise de rota Hop-by-Hop, benchmark DNS UDP e eliminação de fragmentação",
      hardwareTitle: "Hardware e periféricos",
      hardwareSub: "Inventário nativo via sysinfo, WMI e Win32 GDI (VRAM 64-bit)",
      telemetryTitle: "Telemetria ao vivo",
      telemetrySub:
        "Monitoramento contínuo de CPU, memória, Kernel Timer e tráfego de rede (1 Hz)",
      startupTitle: "Inicialização e tarefas agendadas",
      startupSub:
        "Controle reversível de StartupApproved (Run) e tarefas do Windows com backup atômico",
      backupsTitle: "Backups e segurança",
      backupsSub: "Snapshots atômicos gravados em %AppData%/optimizer/backups",
      tweaksTitle: "Tweaks do sistema",
      tweaksSub:
        "58 otimizações auditadas com backup atômico prévio e reversão unitária ou em lote",
      scanning: "ESCANEANDO",
      stream1Hz: "STREAM 1 HZ",
      standby: "STANDBY",
      lastScan: "Último scan",
      rescan: "Reescanear",
      scanningBtn: "Escaneando",
    },
    benchmark: {
      title: "Benchmark Antes & Depois (Prova Real)",
      subtitle:
        "Meça jitter real do scheduler (Sleep 1ms), latência de resolução DNS e memória livre antes e depois de aplicar otimizações",
      captureBaseline: "Capturar Baseline (Antes)",
      captureComparison: "Medir Agora (Depois)",
      clearBaseline: "Limpar",
      running: "Medindo...",
      metric: "Métrica Real",
      before: "Antes (Baseline)",
      after: "Depois (Atual)",
      delta: "Delta (Ganho)",
      timerAvg: "Timer Sleep 1ms (Média)",
      timerP95: "Timer Sleep 1ms (P95)",
      timerJitter: "Jitter do Scheduler",
      dnsLatency: "Latência de Resolução DNS",
      freeRam: "Memória RAM Disponível",
      powerPlan: "Plano de Energia Ativo",
      tcpStack: "Pilha TCP (Provedor / RSC)",
      emptyHint:
        "Clique em 'Capturar Baseline (Antes)' antes de aplicar seus tweaks para registrar o estado inicial e comparar o ganho real.",
    },
    startup: {
      headerTitle: "Gerenciador de Inicialização & Tarefas Agendadas",
      headerDesc:
        "Desative programas de boot (preservando a chave original via StartupApproved) e tarefas agendadas de telemetria com backup atômico automático.",
      searchPlaceholder: "Buscar programa, caminho ou tarefa agendada...",
      all: "Todos",
      registryRun: "Registro (Run)",
      scheduledTasks: "Tarefas Agendadas",
      enabled: "Ativo",
      disabled: "Desativado",
      disableBtn: "Desativar",
      enableBtn: "Ativar",
      refreshBtn: "Atualizar",
      empty: "Nenhum item de inicialização encontrado para este filtro.",
    },
  },
  en: {
    nav: {
      diagnostics: "Diagnostics",
      netlab: "NetLab (Ping & QoS)",
      hardware: "Hardware",
      telemetry: "Telemetry",
      startup: "Startup",
      tweaks: "Tweaks",
      backups: "Backups",
      verifyingToken: "Checking token...",
      admin: "Administrator",
      standardUser: "Standard User",
      elevateBtn: "Elevate as Admin",
      waitingUac: "Waiting for UAC...",
      checkUpdates: "Check for Updates",
    },
    topBar: {
      diagnosticsTitle: "Diagnostics",
      diagnosticsSub:
        "System health, before/after benchmark, and real state recommendations",
      netlabTitle: "NetLab — Routes, Ping, QoS DSCP 46 & Auto-MTU",
      netlabSub:
        "Game packet prioritization (Pacer.sys EF), Hop-by-Hop route inspector, UDP DNS benchmark, and fragmentation removal",
      hardwareTitle: "Hardware & Peripherals",
      hardwareSub: "Native inventory via sysinfo, WMI, and Win32 GDI (64-bit VRAM)",
      telemetryTitle: "Live Telemetry",
      telemetrySub:
        "Continuous 1 Hz CPU, memory, Kernel Timer, and network throughput monitoring",
      startupTitle: "Startup & Scheduled Tasks",
      startupSub:
        "Reversible StartupApproved (Run) and scheduled task control with atomic backups",
      backupsTitle: "Backups & Rollback Vault",
      backupsSub: "Atomic snapshots stored in %AppData%/optimizer/backups",
      tweaksTitle: "System Tweaks",
      tweaksSub:
        "58 audited zero-placebo optimizations with atomic pre-mutation backup and per-tweak rollback",
      scanning: "SCANNING",
      stream1Hz: "STREAM 1 HZ",
      standby: "STANDBY",
      lastScan: "Last scan",
      rescan: "Rescan",
      scanningBtn: "Scanning",
    },
    benchmark: {
      title: "Before & After Benchmark (Live Proof)",
      subtitle:
        "Measure real scheduler jitter (1ms Sleep), DNS resolution latency, and available RAM before and after applying tweaks",
      captureBaseline: "Capture Baseline (Before)",
      captureComparison: "Measure Now (After)",
      clearBaseline: "Clear",
      running: "Measuring...",
      metric: "Measured Metric",
      before: "Before (Baseline)",
      after: "After (Current)",
      delta: "Delta (Gain)",
      timerAvg: "1ms Timer Sleep (Average)",
      timerP95: "1ms Timer Sleep (P95)",
      timerJitter: "Scheduler Jitter",
      dnsLatency: "DNS Resolution Latency",
      freeRam: "Available Physical RAM",
      powerPlan: "Active Power Plan",
      tcpStack: "TCP Stack (Provider / RSC)",
      emptyHint:
        "Click 'Capture Baseline (Before)' prior to applying tweaks to record your initial baseline and compare real measurable gains.",
    },
    startup: {
      headerTitle: "Startup Programs & Scheduled Tasks Manager",
      headerDesc:
        "Disable boot programs (preserving original Registry entries via StartupApproved) and telemetry scheduled tasks with automatic atomic backups.",
      searchPlaceholder: "Search program, command path, or scheduled task...",
      all: "All",
      registryRun: "Registry (Run)",
      scheduledTasks: "Scheduled Tasks",
      enabled: "Enabled",
      disabled: "Disabled",
      disableBtn: "Disable",
      enableBtn: "Enable",
      refreshBtn: "Refresh",
      empty: "No startup items found for the selected filter.",
    },
  },
} as const;
