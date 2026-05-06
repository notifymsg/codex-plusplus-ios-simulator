# iOS Simulator for Codex++

A Codex++ tweak that adds an **iOS Simulator** tab to Codex's right panel.

It mirrors a booted iOS simulator without opening `Simulator.app`, forwards
touch and keyboard input, and lets you annotate simulator UI elements directly
into Codex comments.

## Install

Install [Codex++](https://github.com/b-nnett/codex-plusplus), then place this
folder in:

```text
~/Library/Application Support/codex-plusplus/tweaks/
```

Requirements:

- macOS with full **Xcode** installed.
- `sudo xcode-select -s /Applications/Xcode.app` if your machine points at the
  Command Line Tools.
- At least one downloaded iOS simulator runtime/device.

The tweak runs a preflight check the first time you open it and shows a short
fix hint if something is missing.

## Open

Use the right-panel `+` menu and choose **iOS Simulator**. The row appears below
the divider, next to Codex's other panel tools.

You can also use `Cmd+Y`.

## Features

- Native Codex right-panel tab and panel.
- Headless simulator mirroring through CoreSimulator IOSurface.
- Tap, drag, swipe, keyboard, Home, Lock, Side Button, Siri, and screenshot
  controls.
- Device picker for switching between installed simulators.
- Optional auto-boot when no simulator is running.
- Local helper binaries compiled from source on first use.

## Annotations

Annotation mode helps you point an agent at a specific part of the simulator UI.

Open the simulator panel, click the annotation button, select an element, and
write a comment. The tweak sends that through Codex's native comment UI with:

- element label and role
- simulator id
- element frame
- marker point
- viewport size

This is useful for comments like "fix this button layout" or "why is this label
truncated?" without having to describe coordinates manually.

Annotations use the simulator accessibility tree where possible, so they work
best when the app under test has useful labels and identifiers.

## Notes

- Screen Recording permission is not required.
- Nothing is fetched from the network.
- Helper binaries are compiled locally and cached under
  `~/Library/Caches/co.bennett.ios-simulator/`.
- Long-running helper processes are stopped when the tweak stops.
- Simulator control is limited to the small set of commands the tweak needs.

## Files

- `index.js` - main Codex++ tweak.
- `helpers/sim-capture.swift` - headless frame capture helper.
- `helpers/sim-input.m` - touch, keyboard, and hardware-button helper.
- `manifest.json` - tweak metadata.

## License

MIT
