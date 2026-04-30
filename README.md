# iOS Simulator for Codex++

Adds an **iOS Simulator** entry to Codex's right-panel `+` menu, alongside
`Open file` and `Browser`. Selecting it opens a real-feeling tab that
mirrors the booted iOS simulator **headlessly** (no `Simulator.app`
window) and forwards taps, swipes, and hardware buttons back to the
device.

This is a [Codex++](https://github.com/b-nnett/codex-plusplus) tweak —
install Codex++ first, then drop this directory into
`~/Library/Application Support/codex-plusplus/tweaks/`.

## Requirements

- macOS with **Xcode** installed (Command-Line Tools alone aren't enough
  — the tweak needs `SimulatorKit.framework`, which only ships with the
  full Xcode).
- `sudo xcode-select -s /Applications/Xcode.app` if you've previously
  pointed the toolchain at the CLT.
- At least one downloaded iOS runtime / simulator device.

The tweak runs a preflight check on first open and surfaces a one-line
error with a fix-it hint if any of the above is missing.

## How it works

- **UI.** A `MutationObserver` clones the existing `+` menu entry into
  an "iOS Simulator" item, then injects a sibling tab + tabpanel into
  Codex's right-panel React tree. The injected tab participates in
  Codex's native drag-to-reorder, close-on-hover, and selection wiring.
- **Capture.** A small Swift helper
  (`helpers/sim-capture.swift` → `helpers/sim-capture`) attaches to
  `CoreSimulator`'s `SimDisplayIOSurfaceRenderable` and JPEG-encodes
  frames straight from the device's IOSurface. Frames are length-prefixed
  on stdout and forwarded to the renderer over IPC at native pixel
  resolution (e.g. 1170×2532 for an iPhone 16e).
- **Input.** An Objective-C helper (`helpers/sim-input.m` →
  `helpers/sim-input`) ports `FBSimulatorIndigoHID`: it builds Indigo
  binary structs for touch / keyboard / hardware-button events and
  posts them via `SimDeviceLegacyHIDClient` over a mach port. Pointer
  events on the mirror surface are scaled CSS px → device point →
  device pixel before being forwarded.
- **Device picker.** Toolbar lists every installed simulator with a
  `● Booted` indicator. Selecting another device shuts the current one
  down, boots the new one, and restarts the capture stream.

## Why a parallel tab?

Codex's right-panel tab system is React-internal in a 2.8 MB minified
Vite bundle whose chunk hashes rotate every release. Patching the
bundle to add a real tab type would break on every Codex update. The
parallel injection is robust across releases — visually identical,
draggable, closable, and reconciled against React selection through a
`MutationObserver`.

## Permissions

- **Screen Recording** is **not** required — capture goes through
  `CoreSimulator` IOSurface, not display capture.
- The first run compiles the helpers via `swiftc` / `clang` from your
  Xcode install. Subsequent runs reuse the cached binaries.

## Security model

- All long-running native processes are spawned by the tweak's main
  process and killed on `stop()`.
- The `simctl` IPC channel only accepts a small whitelist of
  subcommands (`boot`, `shutdown`) and validates UDIDs against a
  regex. Screenshots go through a dedicated handler that resolves the
  destination path against `~/Desktop` server-side; the renderer
  cannot request writes to arbitrary filesystem locations.
- Helpers are signed with the user's local toolchain; nothing is
  fetched from the network.

## Files

- `index.js` — renderer + main tweak entry (menu injection, tab/panel
  mount, toolbar, mirror surface, pointer scaling, device picker, IPC
  bridge, preflight).
- `helpers/sim-capture.swift` — headless frame source.
- `helpers/sim-input.m` — Indigo HID input forwarder.
- `manifest.json` — tweak metadata.

## License

MIT.
