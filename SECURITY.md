# Security Policy

## Architectural Guarantees

Optimizer is designed as a transparent, local-only Windows desktop utility:

1. **Zero Outbound Telemetry:** The application makes no external HTTP requests, sends no analytics, and loads no remote fonts or scripts.
2. **Strict Content Security Policy (CSP):** WebView2 runs with `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:`.
3. **Explicit UAC Elevation:** Read-only diagnostics, hardware scanning, telemetry, and backup inspection work under a standard user token. System mutations (`apply_tweaks` and `revert_backup_session`) strictly verify Win32 token elevation (`TokenElevation`) on the Rust backend before modifying OS state.
4. **Atomic Backup Before Mutation:** Before any tweak writes to the Registry, Service Control Manager, `powercfg`, `netsh`, `fsutil`, or DNS configuration, its original state is captured and persisted atomically using `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` in `%AppData%\optimizer\backups\`.
5. **Path Traversal Protection:** Backup session identifiers are validated to allow only ASCII alphanumeric, `-`, and `_` characters before resolving filesystem paths.
6. **Concurrency Lock:** Mutating IPC commands are serialized by a backend mutex (`TweakOperationLock`) to prevent interleaved state mutations or corrupted snapshots.

## Reporting a Vulnerability

If you discover a security issue, privilege boundary bug, or unsafe rollback edge case, please open a private security advisory on GitHub or contact the maintainer directly rather than posting exploit details publicly.

Please include:
- Windows version and build number (`winver`)
- Steps to reproduce
- Affected tweak ID or Rust/TypeScript module
- Expected vs. actual behavior
