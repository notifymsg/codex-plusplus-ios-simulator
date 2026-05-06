/**
 * co.bennett.ios-simulator
 *
 * Adds an "iOS Simulator" tab to Codex's right-panel + menu.
 *
 * - Native Codex right-panel tab + panel when the renderer bridge is available,
 *   with the older DOM-injected tab kept as a fallback.
 * - Headless capture via CoreSimulator IOSurface (sim-capture helper). No
 *   Simulator.app window is launched.
 * - Touch / hardware-button forwarding via SimDeviceLegacyHIDClient
 *   (sim-input helper, ported FBSimulatorIndigoHID).
 * - Toolbar (Home / Screenshot / device picker), auto-boots a sensible
 *   default device on panel open if nothing is booted.
 */

"use strict";

const TWEAK_ATTR = "data-codexpp-ios-sim";
const STYLE_ID = "codexpp-ios-sim-style";
const PREV_DISPLAY_ATTR = "data-codexpp-ios-sim-prev-display";
const NATIVE_PANEL_HIDDEN_ATTR = "data-codexpp-ios-sim-native-hidden";
const RENDERER_STATE_KEY = "__codexpp_ios_sim_renderer_state__";
const SESSION_PANEL_OPEN_KEY = "__codexpp_ios_sim_panel_open__";
const PATCH_RENDERER_ASSET_KEY = "__codexpp_ios_sim_patch_renderer_asset__";
const RELOAD_TOKEN_KEY = "__codexpp_ios_sim_reload_token__";
const NATIVE_OPEN_FUNCTION_KEY = "__codexppIosSimOpenNativeTab";
const NATIVE_OPEN_EVENT = "__codexppIosSimOpenNativeTab";
const NATIVE_PANEL_MOUNTED_EVENT = "__codexppIosSimNativePanelMounted";
const NATIVE_PANEL_ACTIVE_EVENT = "__codexppIosSimNativePanelActiveChanged";
const NATIVE_TAB_ACTIVATED_EVENT = "__codexppIosSimNativeTabActivated";
const NATIVE_TAB_CLOSED_EVENT = "__codexppIosSimNativeTabClosed";
const NATIVE_PANEL_HOST_ATTR = "data-codexpp-ios-sim-native-panel-host";
const NATIVE_PANEL_ACTIVE_ATTR = "data-codexpp-ios-sim-native-active";
const TABLIST_WIRE_VERSION = "ios-sim-tab-selection-v2";
const MESSAGE_FOR_VIEW = "codex_desktop:message-for-view";
const MENU_LABEL = "iOS Simulator";
const PANEL_LABEL = "iOS Simulator";
const BROWSER_PATTERNS = [/^browser$/i, /^browser use$/i, /\bbrowser\b/i];
const MENU_ANCHOR_PATTERNS = [
  ...BROWSER_PATTERNS,
  /^open$/i,
  /^open file\b/i,
  /^new chat\b/i,
  /^browse files\b/i,
];
const PICKER_TITLE_PATTERNS = [/^new chat$/i, /^open file$/i, /^browse files$/i];
const PICKER_SUBTITLE = "Mirror the iOS Simulator in this pane";
const DEFAULT_AUTO_BOOT = true;
const OPEN_SHORTCUT_LABEL = "⌘Y";
const ANNOTATION_COLORS = [
  { border: "#38bdf8", rgb: "56, 189, 248" },
  { border: "#fb923c", rgb: "251, 146, 60" },
  { border: "#facc15", rgb: "250, 204, 21" },
  { border: "#22c55e", rgb: "34, 197, 94" },
  { border: "#ec4899", rgb: "236, 72, 153" },
  { border: "#a78bfa", rgb: "167, 139, 250" },
];
const ANNOTATION_CURSOR_SVG =
  '<svg width="26" height="25" viewBox="0 0 26 25" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M12.6504 0.824799C6.21496 0.824799 0.825466 5.77554 0.825195 12.0885C0.825245 14.2375 1.46183 16.2421 2.55176 17.943L2.02148 20.235L1.99316 20.3756C1.77603 21.655 2.78945 22.7791 4.02832 22.7691L4.0791 22.8209L4.53418 22.7047L7.12305 22.0426C8.77593 22.8778 10.6577 23.3531 12.6504 23.3531C19.086 23.3531 24.4754 18.4014 24.4756 12.0885C24.4753 5.77554 19.0858 0.824799 12.6504 0.824799Z" fill="#0285FF" stroke="white" stroke-width="1.65"/>' +
  "</svg>";
const ANNOTATION_CURSOR_CSS = `url("data:image/svg+xml,${encodeURIComponent(ANNOTATION_CURSOR_SVG)}") 13 12, crosshair`;

const PHONE_SVG =
  '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 rounded-2xs">' +
  '<rect x="6" y="3" width="8" height="14" rx="1.75" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M9 5h2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>' +
  '<circle cx="10" cy="14.5" r="0.75" fill="currentColor"/>' +
  "</svg>";
const PHONE_ICON =
  '<span aria-hidden="true" class="flex h-4 w-4 shrink-0 items-center justify-center">' +
  PHONE_SVG +
  "</span>";

const SVGS = {
  home:
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" class="icon-xs"><rect x="5.25" y="2.75" width="9.5" height="14.5" rx="2.25" stroke="currentColor" stroke-width="1.35"/><path d="M8.25 14.25h3.5" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/></svg>',
  // Camera — unchanged shape, slightly heavier strokes
  camera:
    '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" class="icon-xs"><path d="M7 5.5h6l1.1 1.5H16a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 4 7h1.9L7 5.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="10" cy="11.25" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg>',
  annotate:
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm shrink-0"><path d="M10.02 6.70483C9.66589 6.70516 9.37778 6.9928 9.37778 7.34698V9.36292H7.36187C7.00755 9.36292 6.71983 9.65081 6.71973 10.005C6.71973 10.3595 7.00749 10.6473 7.36187 10.6473H9.37778V12.6644C9.37812 13.0184 9.666 13.3061 10.02 13.3065C10.3742 13.3065 10.6619 13.0186 10.6621 12.6644V10.6473H12.6792C13.0337 10.6473 13.3214 10.3595 13.3214 10.005C13.3213 9.65081 13.0336 9.36292 12.6792 9.36292H10.6621V7.34698C10.6621 6.9926 10.3743 6.70483 10.02 6.70483Z" fill="currentColor"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M9.9994 2.43188C5.62998 2.43188 2.02393 5.78683 2.02393 10.0003C2.02401 11.5112 2.49346 12.9166 3.29509 14.0943C3.29768 14.0982 3.29903 14.1028 3.29986 14.1051V14.1086L2.80334 16.0339C2.61585 16.7426 3.27268 17.3856 3.97781 17.1845L3.97901 17.1856L6.08567 16.5961L6.08806 16.5949H6.09164C7.24756 17.2136 8.58138 17.5676 9.9994 17.5676C14.3687 17.5676 17.9746 14.2136 17.9748 10.0003C17.9748 5.78683 14.3688 2.43188 9.9994 2.43188ZM9.9994 3.71617C13.7302 3.71617 16.6906 6.56372 16.6906 10.0003C16.6904 13.4369 13.7301 16.2845 9.9994 16.2845C8.79575 16.2845 7.66933 15.9853 6.69678 15.4645L6.6932 15.4622L6.58339 15.4109C6.3226 15.3028 6.02191 15.2753 5.72998 15.3619L4.19027 15.7928L4.54238 14.4285L4.54118 14.4273C4.64035 14.0542 4.55881 13.6756 4.36215 13.3818L4.35857 13.377L4.12224 13.0022C3.6023 12.1093 3.30829 11.087 3.30821 10.0003C3.30821 6.56372 6.26865 3.71617 9.9994 3.71617Z" fill="currentColor"></path></svg>',
  // Chevron-down for picker
  chevron:
    '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" class="icon-xs"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:
    '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" class="icon-xs"><path d="M4.75 10.35 8.25 13.75 15.25 6.25" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  annotationCheck:
    '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm"><path d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z" fill="currentColor"></path></svg>',
  mic:
    '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon-xs"><path d="M15.7806 10.1963C16.1326 10.3011 16.3336 10.6714 16.2288 11.0234L16.1487 11.2725C15.3429 13.6262 13.2236 15.3697 10.6644 15.6299L10.6653 16.835H12.0833L12.2171 16.8486C12.5202 16.9106 12.7484 17.1786 12.7484 17.5C12.7484 17.8214 12.5202 18.0894 12.2171 18.1514L12.0833 18.165H7.91632C7.5492 18.1649 7.25128 17.8672 7.25128 17.5C7.25128 17.1328 7.5492 16.8351 7.91632 16.835H9.33527L9.33429 15.6299C6.775 15.3697 4.6558 13.6262 3.84992 11.2725L3.76984 11.0234L3.74445 10.8906C3.71751 10.5825 3.91011 10.2879 4.21808 10.1963C4.52615 10.1047 4.84769 10.2466 4.99347 10.5195L5.04523 10.6436L5.10871 10.8418C5.8047 12.8745 7.73211 14.335 9.99933 14.335C12.3396 14.3349 14.3179 12.7789 14.9534 10.6436L15.0052 10.5195C15.151 10.2466 15.4725 10.1046 15.7806 10.1963ZM12.2513 5.41699C12.2513 4.17354 11.2437 3.16521 10.0003 3.16504C8.75675 3.16504 7.74835 4.17343 7.74835 5.41699V9.16699C7.74853 10.4104 8.75685 11.418 10.0003 11.418C11.2436 11.4178 12.2511 10.4103 12.2513 9.16699V5.41699Z"></path></svg>',
  // Close X (matches native size)
  close:
    '<svg width="21" height="21" viewBox="0 0 21 21" fill="none" class="icon-xs"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.8 2.485A8.333 8.333 0 1 1 10.8 19.152a8.333 8.333 0 0 1 0-16.667zM9.008 7.518a.876.876 0 0 0-1.383 1.383L9.542 10.818l-1.917 1.916a.876.876 0 1 0 1.383 1.383L10.925 12.2l1.917 1.917a.876.876 0 1 0 1.382-1.383l-1.916-1.916 1.916-1.917a.876.876 0 0 0-1.382-1.383L10.925 9.434 9.008 7.518z" fill="currentColor"/></svg>',
  // Larger phone glyph for placeholder
  phoneLarge:
    '<svg width="96" height="96" viewBox="0 0 20 20" fill="none"><rect x="5.25" y="1.75" width="9.5" height="16.5" rx="2.25" stroke="currentColor" stroke-width="1.1"/><path d="M8.5 3.5h3" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/><rect x="8.25" y="15.75" width="3.5" height="0.6" rx="0.3" fill="currentColor"/></svg>',
};

module.exports = {
  async start(api) {
    this.api = api;
    this.cleanup = [];

    if (api.process === "main") {
      globalThis[PATCH_RENDERER_ASSET_KEY] = patchRendererAsset;
      registerMainHandlers(api, this);
      return;
    }

    // Hide the menu entry entirely on non-macOS hosts. The right tablist
    // never gains an iOS Simulator option there; everything else short-
    // circuits cleanly because no IPC channels are registered either.
    if (typeof process !== "undefined" && process.platform && process.platform !== "darwin") {
      api.log?.info?.("ios-sim disabled (platform=" + process.platform + ")");
      return;
    }

    globalThis[RENDERER_STATE_KEY]?.dispose?.();

    const rendererState = {
      api,
      cleanup: [],
      observer: null,
      panelOpen: false,
      pageHandle: null,
      disposed: false,
      dispose: () => disposeRendererState(rendererState),
    };
    globalThis[RENDERER_STATE_KEY] = rendererState;
    this._rendererState = rendererState;
    this.cleanup = rendererState.cleanup;

    injectStyles();
    rendererState.cleanup.push(() => document.getElementById(STYLE_ID)?.remove());
    rendererState.cleanup.push(() => removeSimPanel({ preserveOpenState: true }));
    registerSettingsPage(rendererState);

    await api.react.waitForElement?.("body", 10_000);

    rendererState.observer = new MutationObserver(() => {
      this.installMenuEntries();
      if (rendererState.panelOpen) {
        hideNativeSurfacesForOpenSimPanel();
        reassertSimSelection(rendererState);
        scheduleOpenPanelReconcile(rendererState);
      }
    });
    rendererState.observer.observe(document.body, { childList: true, subtree: true });
    rendererState.cleanup.push(() => rendererState.observer?.disconnect());

    installOpenShortcut(rendererState);
    installNativeTabBridge(rendererState);
    this.installMenuEntries();
    if (readStoredPanelOpen()) {
      restoreOpenPanel(rendererState);
    }
  },

  stop() {
    this.removeMainHandlers?.();
    this.removeMainHandlers = null;
    if (globalThis[PATCH_RENDERER_ASSET_KEY] === patchRendererAsset) {
      delete globalThis[PATCH_RENDERER_ASSET_KEY];
    }
    if (typeof document === "undefined") return;
    for (const dispose of this.cleanup ?? []) {
      try {
        dispose();
      } catch {}
    }
    this.cleanup = [];
    document.querySelectorAll(`[${TWEAK_ATTR}]`).forEach((node) => node.remove());
    removeSimPanel({ preserveOpenState: true });
    if (globalThis[RENDERER_STATE_KEY] === this._rendererState) {
      delete globalThis[RENDERER_STATE_KEY];
    }
  },

  installMenuEntries() {
    const processedScopes = new Set();
    for (const anchorButton of findMenuAnchorButtons()) {
      const scope = menuScopeFor(anchorButton) || anchorButton.parentElement || anchorButton;
      if (processedScopes.has(scope)) continue;
      processedScopes.add(scope);

      const existingEntry = findScopedSimMenuEntry(anchorButton);
      if (existingEntry instanceof HTMLElement) {
        placeMenuEntry(anchorButton, existingEntry);
        continue;
      }
      const simButton = anchorButton.cloneNode(true);
      simButton.setAttribute(TWEAK_ATTR, "menu-entry");
      simButton.setAttribute("aria-label", MENU_LABEL);
      rewriteMenuEntry(simButton);

      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        // The same gesture fires pointerdown → mousedown → click. We listen
        // to all three (capture phase) so we win over Codex's React handlers,
        // but we only want one activation per gesture.
        const now = Date.now();
        if (simButton.__codexppLastActivate && now - simButton.__codexppLastActivate < 400) return;
        simButton.__codexppLastActivate = now;
        closeTransientMenu(anchorButton);
        this.api?.log?.info?.("opening iOS Simulator side panel");
        openSimPanel(this.api);
      };

      simButton.addEventListener("pointerdown", activate, true);
      simButton.addEventListener("mousedown", activate, true);
      simButton.addEventListener("click", activate, true);
      placeMenuEntry(anchorButton, simButton);
    }
  },
};

function disposeRendererState(state) {
  if (!state || state.disposed) return;
  state.disposed = true;
  for (const dispose of state.cleanup.splice(0).reverse()) {
    try {
      dispose();
    } catch {}
  }
  state.pageHandle?.unregister?.();
  state.pageHandle = null;
  document.querySelectorAll(`[${TWEAK_ATTR}]`).forEach((node) => node.remove());
  removeSimPanel({ preserveOpenState: true });
}

function currentRendererState() {
  return globalThis[RENDERER_STATE_KEY] || null;
}

function setPanelOpen(value, options = {}) {
  const state = currentRendererState();
  if (state) state.panelOpen = Boolean(value);
  if (options.preserveOpenState) return;
  try {
    if (value) sessionStorage.setItem(SESSION_PANEL_OPEN_KEY, "1");
    else sessionStorage.removeItem(SESSION_PANEL_OPEN_KEY);
  } catch {}
}

function readStoredPanelOpen() {
  try {
    return sessionStorage.getItem(SESSION_PANEL_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function restoreOpenPanel(state) {
  if (!state?.api || state.__restoreTimer) return;
  let attempts = 0;
  const tick = () => {
    state.__restoreTimer = null;
    if (state.disposed || !readStoredPanelOpen()) return;
    setPanelOpen(true);
    if (!requestNativeSimTabOpen()) ensureSidePanelVisible();
    if (mountSimPanel(state.api)) return;
    attempts += 1;
    if (attempts >= 80) {
      state.api?.log?.warn?.("ios-sim restore gave up waiting for side panel host");
      return;
    }
    state.__restoreTimer = window.setTimeout(tick, attempts < 10 ? 100 : 250);
  };
  tick();
}

function scheduleOpenPanelReconcile(state) {
  if (state.__reconcileTimer) return;
  state.__reconcileTimer = window.setTimeout(() => {
    state.__reconcileTimer = null;
    if (state.disposed || !state.panelOpen) return;
    if (isSimPanelMounted()) return;
    try {
      ensureSidePanelVisible();
      mountSimPanel(state.api);
    } catch (error) {
      state.api?.log?.warn?.("ios-sim reconcile failed", String(error?.stack || error));
    }
  }, 50);
}

function isSimPanelMounted() {
  const tab = document.querySelector(`[${TWEAK_ATTR}="side-tab"]`);
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  if (!(panel instanceof HTMLElement) || !panel.isConnected) return false;
  if (panel.closest(`[${NATIVE_PANEL_HOST_ATTR}]`)) return true;
  return tab instanceof HTMLElement && tab.isConnected;
}

function reassertSimSelection(state) {
  if (!state?.panelOpen) return;
  const tab = document.querySelector(`[${TWEAK_ATTR}="side-tab"]`);
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  if (!(tab instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
  if (panel.style.display === "none") return;
  const tabButton = tab.querySelector('[role="tab"]');
  const panelHost = tab.closest(".flex.h-full.min-h-0.flex-col");
  if (!(panelHost instanceof HTMLElement)) return;

  syncNativeTabSelection(panelHost, null);
  tab.dataset.selected = "true";
  tabButton?.setAttribute("aria-selected", "true");
  tabButton?.classList.remove("text-token-text-secondary");
  tabButton?.classList.add("text-token-text-primary");
}

function hideNativeSurfacesForOpenSimPanel() {
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  if (!(panel instanceof HTMLElement)) return false;
  if (panel.style.display === "none") return false;
  const panelHost = findPanelHostForSimPanel(panel);
  if (!(panelHost instanceof HTMLElement)) return false;
  hideNativePanelSurfaces(panelHost, panel);
  return true;
}

function registerSettingsPage(state) {
  const api = state?.api;
  if (typeof api?.settings?.registerPage !== "function") return;
  state.pageHandle = api.settings.registerPage({
    id: "main",
    title: "iOS Simulator",
    description: "Right-panel simulator mirroring and boot behavior.",
    iconSvg:
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-sm inline-block align-middle" aria-hidden="true">' +
      '<rect x="5.75" y="2.75" width="8.5" height="14.5" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M8.75 5h2.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>' +
      '<path d="M9 15h2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>' +
      "</svg>",
    render(root) {
      renderSettings(root, state);
    },
  });
  state.cleanup.push(() => {
    state.pageHandle?.unregister?.();
    state.pageHandle = null;
  });
}

function renderSettings(root, state) {
  root.textContent = "";
  const section = settingsEl("section", "flex flex-col gap-2");
  section.appendChild(settingsTitle("Behavior"));

  const card = settingsEl("div", "rounded-lg border border-token-border-default bg-token-bg-secondary");
  card.append(
    settingsRow(
      "Auto-boot simulator",
      "Boot a sensible default iPhone when the iOS Simulator panel opens and no device is running.",
      nativeSwitch("Auto-boot simulator", readAutoBootEnabled(state.api), (next) => {
        state.api.storage.set("auto-boot", next);
      }),
    ),
    settingsRow(
      "Headless capture",
      "Mirror the booted simulator inside Codex without opening Simulator.app.",
      settingsBadge("Enabled"),
    ),
  );

  section.appendChild(card);
  root.appendChild(section);
}

function readAutoBootEnabled(api) {
  const value = api?.storage?.get?.("auto-boot");
  return typeof value === "boolean" ? value : DEFAULT_AUTO_BOOT;
}

function settingsTitle(text) {
  const node = settingsEl("div", "text-token-text-secondary px-1 text-xs font-semibold uppercase tracking-wide");
  node.textContent = text;
  return node;
}

function settingsRow(title, description, control) {
  const row = settingsEl("div", "flex items-center justify-between gap-4 p-3");
  const left = settingsEl("div", "flex min-w-0 flex-col gap-1");
  const label = settingsEl("div", "min-w-0 text-sm text-token-text-primary");
  label.textContent = title;
  const desc = settingsEl("div", "text-token-text-secondary min-w-0 text-sm");
  desc.textContent = description;
  left.append(label, desc);
  row.append(left, control);
  return row;
}

function nativeSwitch(label, initial, onChange) {
  const button = document.createElement("button");
  button.type = "button";
  button.role = "switch";
  button.setAttribute("aria-label", label);
  button.className =
    "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction";
  const track = document.createElement("span");
  track.className =
    "relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-200 ease-out";
  const knob = document.createElement("span");
  knob.className =
    "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out";
  track.appendChild(knob);

  let checked = Boolean(initial);
  const sync = () => {
    button.setAttribute("aria-checked", checked ? "true" : "false");
    track.style.background = checked
      ? "var(--color-token-bg-primary-inverted, #0A84FF)"
      : "color-mix(in srgb, currentColor 22%, transparent)";
    knob.style.transform = checked ? "translateX(12px)" : "translateX(2px)";
  };

  button.appendChild(track);
  button.addEventListener("click", () => {
    checked = !checked;
    sync();
    onChange?.(checked);
  });
  sync();
  return button;
}

function settingsBadge(text) {
  const badge = settingsEl(
    "span",
    "shrink-0 rounded-full border border-token-border-default px-2 py-0.5 text-xs text-token-text-secondary",
  );
  badge.textContent = text;
  return badge;
}

function settingsEl(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ── main process ────────────────────────────────────────────────────────

function registerMainHandlers(api, tweak) {
  if (process.platform !== "darwin") {
    api.log?.info?.("ios-sim main handlers skipped (platform=" + process.platform + ")");
    tweak.removeMainHandlers = () => {};
    return;
  }
  const { spawn, spawnSync } = require("node:child_process");
  const electron = require("electron");
  const { ipcMain, webContents } = electron;
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const disposers = [];
  const id = api.manifest?.id || "co.bennett.ios-simulator";
  const ch = (name) => `codexpp:${id}:${name}`;
  const channels = [
    "ios-sim:launch",
    "ios-sim:devices",
    "ios-sim:simctl",
    "ios-sim:screenshot",
    "ios-sim:capture:start",
    "ios-sim:capture:stop",
    "ios-sim:input:event",
    "ios-sim:preflight",
    "ios-sim:usage",
    "ios-sim:ax-snapshot",
    "ios-sim:annotation:open",
  ].map(ch);

  const firstLine = (s) =>
    ((s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0]) || "";

  installProtocolPatch(api, disposers);
  reloadExistingAppWindowsIfHotEnabled(api);

  function isSimulatorUsageCommand(command) {
    const first = String(command || "").trim().split(/\s+/)[0] || "";
    const base = path.basename(first);
    return (
      base === "Simulator" ||
      base === "sim-capture" ||
      base === "sim-input" ||
      base === "com.apple.CoreSimulator.CoreSimulatorService" ||
      command.includes("/Simulator.app/") ||
      command.includes("/CoreSimulator.framework/")
    );
  }

  function sampleSimulatorUsage() {
    return new Promise((resolve) => {
      const p = spawn("/bin/ps", ["-axo", "pid=,pcpu=,rss=,command="], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (b) => (out += b.toString("utf8")));
      p.stderr.on("data", (b) => (err += b.toString("utf8")));
      p.on("error", (e) => resolve({ ok: false, error: String(e) }));
      p.on("exit", (code) => {
        if (code !== 0) {
          resolve({ ok: false, code, stderr: firstLine(err) });
          return;
        }
        const processes = [];
        for (const line of out.split(/\r?\n/)) {
          const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
          if (!m) continue;
          const command = m[4] || "";
          if (!isSimulatorUsageCommand(command)) continue;
          processes.push({
            pid: Number(m[1]),
            cpu: Number(m[2]) || 0,
            rssKb: Number(m[3]) || 0,
            command: command.slice(0, 180),
          });
        }
        const cpu = processes.reduce((sum, proc) => sum + proc.cpu, 0);
        const rssBytes =
          processes.reduce((sum, proc) => sum + proc.rssKb, 0) * 1024;
        resolve({
          ok: true,
          cpu,
          rssBytes,
          processCount: processes.length,
          processes: processes.slice(0, 12),
        });
      });
    });
  }

  for (const c of channels) {
    try {
      ipcMain.removeHandler(c);
    } catch {}
  }

  // Capture state ------------------------------------------------------
  const helperSourceDir = path.join(__dirname, "helpers");
  const helperBuildDir = path.join(
    os.homedir(),
    "Library",
    "Caches",
    id,
    "helpers",
  );
  try {
    fs.mkdirSync(helperBuildDir, { recursive: true });
  } catch {}

  const swiftSrc = path.join(helperSourceDir, "sim-capture.swift");
  const helperBin = path.join(helperBuildDir, "sim-capture");
  const FRAME_CHANNEL = ch("ios-sim:capture:frame");
  const META_CHANNEL = ch("ios-sim:capture:meta");
  const STATUS_CHANNEL = ch("ios-sim:capture:status");

  const capture = (globalThis.__codexppIosSimCapture = globalThis.__codexppIosSimCapture || {
    proc: null,
    starting: false,
    lastMeta: null,
    lastFrame: null,
  });

  function broadcast(channel, ...args) {
    try {
      for (const wc of webContents.getAllWebContents()) {
        if (wc.isDestroyed?.()) continue;
        wc.send(channel, ...args);
      }
    } catch (e) {
      api.log?.warn?.("ios-sim broadcast failed", e);
    }
  }

  function sendStatus(payload) {
    broadcast(STATUS_CHANNEL, payload);
  }

  function ensureBinary() {
    if (!fs.existsSync(swiftSrc)) {
      return { ok: false, error: "missing sim-capture.swift" };
    }
    let needsBuild = !fs.existsSync(helperBin);
    if (!needsBuild) {
      const a = fs.statSync(helperBin).mtimeMs;
      const b = fs.statSync(swiftSrc).mtimeMs;
      if (b > a) needsBuild = true;
    }
    if (!needsBuild) return { ok: true };
    sendStatus({ kind: "compiling" });
    api.log?.info?.("ios-sim compiling helper");
    const r = spawnSync(
      "/usr/bin/swiftc",
      [
        "-O",
        "-framework", "ScreenCaptureKit",
        "-framework", "CoreImage",
        "-framework", "AppKit",
        "-framework", "CoreMedia",
        "-framework", "CoreVideo",
        swiftSrc,
        "-o", helperBin,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      api.log?.error?.("ios-sim compile failed", r.stderr);
      const head = firstLine(r.stderr) || firstLine(r.stdout) || "exit " + r.status;
      return { ok: false, error: "swiftc: " + head + " (see preload.log)" };
    }
    return { ok: true };
  }

  function stopCapture(reason) {
    if (capture.proc) {
      try {
        capture.proc.kill("SIGTERM");
      } catch {}
      capture.proc = null;
    }
    capture.starting = false;
    // Drop cached meta — otherwise the next start() re-broadcasts stale meta
    // (wrong device) before the fresh helper has emitted its own stream-started.
    capture.lastMeta = null;
    capture.lastFrame = null;
    if (reason) sendStatus({ kind: "stopped", reason });
  }

  function startCapture() {
    if (capture.proc) return { ok: true, status: "already-running" };
    if (capture.starting) return { ok: true, status: "starting" };
    const built = ensureBinary();
    if (!built.ok) {
      sendStatus({ kind: "error", error: built.error });
      return { ok: false, error: built.error };
    }
    capture.starting = true;
    sendStatus({ kind: "starting" });

    const proc = spawn(helperBin, [], { stdio: ["ignore", "pipe", "pipe"] });
    capture.proc = proc;
    capture.starting = false;

    // stdout: [u32 BE length][JPEG]
    let buf = Buffer.alloc(0);
    proc.stdout.on("data", (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0 || len > 8_000_000) {
          api.log?.warn?.("ios-sim bogus frame length", len);
          buf = Buffer.alloc(0);
          break;
        }
        if (buf.length < 4 + len) break;
        const jpeg = buf.subarray(4, 4 + len);
        // copy because we'll slice the underlying buffer
        capture.lastFrame = Buffer.from(jpeg);
        broadcast(FRAME_CHANNEL, capture.lastFrame);
        buf = buf.subarray(4 + len);
      }
    });

    let stderrLine = "";
    proc.stderr.on("data", (chunk) => {
      stderrLine += chunk.toString("utf8");
      let nl;
      while ((nl = stderrLine.indexOf("\n")) >= 0) {
        const line = stderrLine.slice(0, nl).trim();
        stderrLine = stderrLine.slice(nl + 1);
        if (!line) continue;
        const m = line.match(/^\[sim-capture\]\s+(\{.*\})\s*$/);
        if (m) {
          try {
            const meta = JSON.parse(m[1]);
            capture.lastMeta = meta;
            broadcast(META_CHANNEL, meta);
          } catch (e) {
            api.log?.warn?.("ios-sim meta parse", e, line);
          }
        } else {
          api.log?.info?.("[sim-capture]", line);
        }
      }
    });

    proc.on("error", (e) => {
      api.log?.error?.("ios-sim helper error", e);
      capture.proc = null;
      sendStatus({ kind: "error", error: String(e) });
    });
    proc.on("exit", (code, signal) => {
      api.log?.info?.("ios-sim helper exit", code, signal);
      if (capture.proc === proc) capture.proc = null;
      sendStatus({ kind: "stopped", reason: `exit ${code} ${signal || ""}`.trim() });
    });

    return { ok: true, status: "started" };
  }

  // Input helper -------------------------------------------------------
  const inputSrc = path.join(helperSourceDir, "sim-input.m");
  const inputBin = path.join(helperBuildDir, "sim-input");

  const input = (globalThis.__codexppIosSimInput = globalThis.__codexppIosSimInput || {
    proc: null,
  });

  function ensureInputBinary() {
    if (!fs.existsSync(inputSrc)) return { ok: false, error: "missing sim-input.m" };
    let needsBuild = !fs.existsSync(inputBin);
    if (!needsBuild) {
      const a = fs.statSync(inputBin).mtimeMs;
      const b = fs.statSync(inputSrc).mtimeMs;
      if (b > a) needsBuild = true;
    }
    if (!needsBuild) return { ok: true };
    api.log?.info?.("ios-sim compiling input helper");
    const r = spawnSync(
      "/usr/bin/clang",
      ["-fobjc-arc", "-O2", "-framework", "Foundation", "-framework", "CoreGraphics", inputSrc, "-o", inputBin],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      api.log?.error?.("ios-sim input compile failed", r.stderr);
      const head = firstLine(r.stderr) || firstLine(r.stdout) || "exit " + r.status;
      return { ok: false, error: "clang: " + head + " (see preload.log)" };
    }
    return { ok: true };
  }

  function ensureInputProc() {
    if (input.proc && !input.proc.killed) return { ok: true };
    const built = ensureInputBinary();
    if (!built.ok) return built;
    const proc = spawn(inputBin, [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderrBuf = "";
    proc.stderr.on("data", (b) => {
      stderrBuf += b.toString("utf8");
      let nl;
      while ((nl = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        if (line.trim()) api.log?.info?.("[sim-input]", line.trim());
      }
    });
    proc.on("error", (e) => {
      api.log?.error?.("sim-input error", e);
      input.proc = null;
    });
    proc.on("exit", (code, sig) => {
      api.log?.info?.("sim-input exit", code, sig);
      if (input.proc === proc) input.proc = null;
    });
    input.proc = proc;
    return { ok: true };
  }

  function stopInput() {
    if (input.proc) {
      try { input.proc.kill("SIGTERM"); } catch {}
      input.proc = null;
    }
  }

  ipcMain.handle(ch("ios-sim:input:event"), async (_evt, event) => {
    const r = ensureInputProc();
    if (!r.ok) return r;
    try {
      input.proc.stdin.write(JSON.stringify(event) + "\n");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  // Quit Simulator.app so booting a device doesn't pop up an attached window.
  // simctl boot itself is headless; only a running Simulator.app auto-attaches.
  async function killSimulatorApp() {
    return new Promise((resolve) => {
      const p = spawn("/usr/bin/killall", ["-q", "Simulator"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      p.on("error", () => resolve());
      // killall exits 1 when no process matches; either outcome is fine.
      p.on("exit", () => resolve());
    });
  }

  // Defense-in-depth: only the verbs the tweak actually needs are allowed
  // through this channel. Anything else (notably `spawn`, `install`, `push`)
  // would let a compromised renderer execute arbitrary code on the booted
  // device or on the host. Screenshots have a dedicated handler below.
  const SIMCTL_ALLOW = new Set(["boot", "shutdown"]);
  const UDID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

  ipcMain.handle(ch("ios-sim:simctl"), async (_evt, args) => {
    const list = Array.isArray(args) ? args.map(String) : [];
    const verb = list[0];
    if (!verb || !SIMCTL_ALLOW.has(verb)) {
      return { ok: false, error: "verb not allowed: " + verb };
    }
    if ((verb === "boot" || verb === "shutdown") && !UDID_RE.test(list[1] || "")) {
      return { ok: false, error: verb + " requires a UDID" };
    }
    if (verb === "boot") {
      await killSimulatorApp();
    }
    return new Promise((resolve) => {
      const p = spawn("xcrun", ["simctl", ...list], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.on("error", (e) => resolve({ ok: false, error: String(e) }));
      p.on("exit", (code) =>
        resolve({ ok: code === 0, code, stdout: out, stderr: err }),
      );
    });
  });

  // Dedicated screenshot handler. Renderer hands us a filename only; we
  // resolve the path against ~/Desktop here so the renderer never has to
  // know HOME (which it can't read on 0.1.x anyway) and can't request
  // writes to arbitrary filesystem locations.
  ipcMain.handle(ch("ios-sim:screenshot"), async (_evt, filename) => {
    const safe = String(filename || "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 128);
    if (!safe || !/\.(png|jpg|jpeg)$/i.test(safe)) {
      return { ok: false, error: "filename must end in .png/.jpg" };
    }
    const dest = path.join(os.homedir(), "Desktop", safe);
    const device =
      capture.lastMeta?.deviceUDID && UDID_RE.test(capture.lastMeta.deviceUDID)
        ? capture.lastMeta.deviceUDID
        : "booted";
    return new Promise((resolve) => {
      const p = spawn("xcrun", ["simctl", "io", device, "screenshot", dest], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.on("error", (e) => resolve({ ok: false, error: String(e) }));
      p.on("exit", (code) =>
        resolve({ ok: code === 0, code, path: dest, device, stdout: out, stderr: err }),
      );
    });
  });

  ipcMain.handle(ch("ios-sim:devices"), async () => {
    return new Promise((resolve) => {
      const p = spawn("xcrun", ["simctl", "list", "devices", "--json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.on("error", (e) => resolve({ ok: false, error: String(e) }));
      p.on("exit", (code) => {
        if (code !== 0) {
          resolve({ ok: false, code, stderr: err });
          return;
        }
        try {
          const data = JSON.parse(out);
          resolve({ ok: true, data });
        } catch (e) {
          resolve({ ok: false, error: "json parse: " + String(e) });
        }
      });
    });
  });

  ipcMain.handle(ch("ios-sim:usage"), async () => sampleSimulatorUsage());

  ipcMain.handle(ch("ios-sim:ax-snapshot"), async () => {
    const device =
      capture.lastMeta?.deviceUDID && UDID_RE.test(capture.lastMeta.deviceUDID)
        ? capture.lastMeta.deviceUDID
        : null;
    if (!device) return { ok: false, error: "No mirrored simulator device yet." };
    return new Promise((resolve) => {
      const p = spawn(
        "npx",
        [
          "-y",
          "xcodebuildmcp@latest",
          "ui-automation",
          "snapshot-ui",
          "--simulator-id",
          device,
          "--output",
          "json",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      p.stdout.on("data", (b) => {
        out += b.toString("utf8");
        if (out.length > 20 * 1024 * 1024) {
          try { p.kill("SIGTERM"); } catch {}
        }
      });
      p.stderr.on("data", (b) => (err += b.toString("utf8")));
      p.on("error", (e) => resolve({ ok: false, error: String(e) }));
      p.on("exit", (code) => {
        if (code !== 0) {
          resolve({ ok: false, code, stderr: firstLine(err) || firstLine(out) });
          return;
        }
        try {
          resolve({ ok: true, device, tree: parseAxSnapshotOutput(out) });
        } catch (error) {
          resolve({ ok: false, error: String(error?.message || error), stderr: firstLine(err) });
        }
      });
    });
  });

  ipcMain.handle(ch("ios-sim:annotation:open"), async (event, message) => {
    if (!message || typeof message !== "object") {
      return { ok: false, error: "missing annotation message" };
    }
    if (message.type !== "browser-sidebar-direct-comment") {
      return { ok: false, error: "unsupported annotation message type" };
    }
    if (typeof message.conversationId !== "string" || !message.conversationId.trim()) {
      return { ok: false, error: "missing conversation id" };
    }
    try {
      event.sender.send(MESSAGE_FOR_VIEW, message);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle(ch("ios-sim:capture:start"), async (event) => {
    const r = startCapture();
    if (capture.lastFrame) {
      // New panels can mount while the helper is already running, for example
      // when Codex remounts right-panel content after a chat switch. Replay the
      // latest frame so they do not sit on the boot placeholder waiting for the
      // next capture tick.
      setTimeout(() => {
        try {
          if (!event.sender.isDestroyed?.()) event.sender.send(FRAME_CHANNEL, capture.lastFrame);
        } catch {}
      }, 25);
    }
    if (capture.lastMeta) {
      // re-emit last meta so newly-attached renderer gets it
      setTimeout(() => {
        try {
          if (!event.sender.isDestroyed?.()) event.sender.send(META_CHANNEL, capture.lastMeta);
        } catch {}
      }, 50);
    }
    return r;
  });

  ipcMain.handle(ch("ios-sim:capture:stop"), async () => {
    stopCapture("client-stop");
    return { ok: true };
  });

  ipcMain.handle(ch("ios-sim:preflight"), async () => {
    // Renderer already bails on non-darwin, but be defensive.
    if (process.platform !== "darwin") {
      return {
        ok: false,
        reason: "platform",
        message: "iOS Simulator requires macOS.",
        hint: null,
        detail: "platform=" + process.platform,
      };
    }
    const xcrunFind = spawnSync("/usr/bin/xcrun", ["-find", "simctl"], { encoding: "utf8" });
    if (xcrunFind.status !== 0) {
      return {
        ok: false,
        reason: "xcrun",
        message: "Xcode developer tools are not configured on this Mac.",
        hint: "Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app",
        detail: firstLine(xcrunFind.stderr),
      };
    }
    const sel = spawnSync("/usr/bin/xcode-select", ["-p"], { encoding: "utf8" });
    const devDir = (sel.stdout || "").trim();
    if (sel.status !== 0 || !devDir) {
      return {
        ok: false,
        reason: "xcode-select",
        message: "Cannot determine the Xcode developer directory.",
        hint: "Run: sudo xcode-select -s /Applications/Xcode.app",
        detail: firstLine(sel.stderr),
      };
    }
    if (!/Xcode.*\.app/i.test(devDir)) {
      return {
        ok: false,
        reason: "clt-only",
        message: "Command-Line Tools are active, but the iOS Simulator needs the full Xcode.",
        hint: "Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app",
        detail: "DEVELOPER_DIR=" + devDir,
      };
    }
    const simKit = path.join(devDir, "Library/PrivateFrameworks/SimulatorKit.framework");
    if (!fs.existsSync(simKit)) {
      return {
        ok: false,
        reason: "simkit",
        message: "SimulatorKit framework was not found in this Xcode install.",
        hint: "Open Xcode once so it finishes installing components, then try again.",
        detail: simKit,
      };
    }
    return { ok: true, developerDir: devDir };
  });

  tweak.removeMainHandlers = () => {
    stopCapture();
    stopInput();
    for (const c of channels) {
      try {
        ipcMain.removeHandler(c);
      } catch {}
    }
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        api.log?.warn?.("ios-sim dispose failed", error);
      }
    }
  };
  api.log?.info?.("ios-simulator main handlers registered");
}

function installProtocolPatch(api, disposers) {
  const { protocol } = require("electron");
  const originalHandle = protocol.handle;
  const patchedAssets = new Set();

  protocol.handle = function iosSimulatorProtocolHandle(scheme, handler) {
    if (scheme !== "app" || typeof handler !== "function") {
      return originalHandle.apply(this, arguments);
    }

    const wrappedHandler = async (request) => {
      const response = await handler(request);
      if (!shouldPatchRendererAsset(request?.url)) return response;

      let originalText = null;
      try {
        originalText = await response.text();
        const patcher = globalThis[PATCH_RENDERER_ASSET_KEY] ?? patchRendererAsset;
        const patchedText = patcher(request.url, originalText);
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.set("content-type", "text/javascript; charset=utf-8");
        const assetName = assetPatchKind(request.url);
        if (patchedText !== originalText && !patchedAssets.has(assetName)) {
          patchedAssets.add(assetName);
          api.log?.info?.("ios-sim patched renderer asset: " + assetName);
        }
        return new Response(patchedText, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        api.log?.warn?.("ios-sim failed to patch renderer asset; serving original", {
          url: request?.url,
          error: stringifyError(error),
        });
        if (originalText != null) {
          return new Response(originalText, responseInitFrom(response));
        }
        return response;
      }
    };

    return originalHandle.call(this, scheme, wrappedHandler);
  };

  disposers.push(() => {
    protocol.handle = originalHandle;
  });
}

function shouldPatchRendererAsset(rawUrl) {
  return assetPatchKind(rawUrl) != null;
}

function assetPatchKind(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const basename = url.pathname.split("/").pop() || "";
    if (/^composer-[A-Za-z0-9_-]+\.js$/.test(basename)) return "composer";
    if (/^review-runtime-bridge-[A-Za-z0-9_-]+\.js$/.test(basename)) {
      return "review-runtime-bridge";
    }
  } catch {}
  return null;
}

function patchRendererAsset(rawUrl, source) {
  const kind = assetPatchKind(rawUrl);
  if (kind === "review-runtime-bridge") return patchReviewRuntimeBridge(source);
  if (kind !== "composer") return source;
  const target =
    "Wo(`browser-sidebar-direct-comment`,e=>{fe==null||e.conversationId!==fe||ts(e)},[fe,ts]),Wo(`pdf-direct-comment`,e=>{e.conversationId===G&&ts(e)},[G,ts]);";
  const replacement =
    "globalThis.__codexppIosSimAnnotationBridge||(globalThis.__codexppIosSimAnnotationBridge={entries:new Map,latest:null,submit(t){if(!t||typeof t!=`object`||t.comment==null)return!1;let n=t.conversationId,r=n!=null?this.entries.get(n):null;r==null&&this.latest!=null&&(r=this.entries.get(this.latest));if(r==null){for(let e of this.entries.values())(!r||e.updatedAt>r.updatedAt)&&(r=e)}return r?(r.setComments(e=>[...e,t.comment]),!0):!1},register(e,t){if(typeof t!=`function`)return;let n=e??`__latest`;this.entries.set(n,{setComments:t,updatedAt:Date.now()}),this.latest=n}}),globalThis.__codexppIosSimAnnotationBridge.listener||(globalThis.__codexppIosSimAnnotationBridge.listener=!0,window.addEventListener(`__codexppIosSimSubmitAnnotation`,e=>{let t=null,n=!1,r=null;try{let i=JSON.parse(e.detail);t=i.id,n=globalThis.__codexppIosSimAnnotationBridge.submit(i)}catch(e){r=String(e?.message||e)}window.dispatchEvent(new CustomEvent(`__codexppIosSimSubmitAnnotationResult`,{detail:JSON.stringify({id:t,ok:n,error:r})}))})),globalThis.__codexppIosSimAnnotationBridge.register(G,kr),Wo(`browser-sidebar-direct-comment`,e=>{fe==null||e.conversationId!==fe||ts(e)},[fe,ts]),Wo(`pdf-direct-comment`,e=>{e.conversationId===G&&ts(e)},[G,ts]);";
  return replaceRequired(source, target, replacement, "composer annotation bridge");
}

function patchReviewRuntimeBridge(source) {
  const helpers =
    'function __codexppIosSimIcon(e){return(0,Q.jsxs)(`svg`,{width:16,height:16,viewBox:`0 0 20 20`,fill:`none`,xmlns:`http://www.w3.org/2000/svg`,...e,children:[(0,Q.jsx)(`rect`,{x:5.75,y:2.75,width:8.5,height:14.5,rx:2,stroke:`currentColor`,strokeWidth:1.5}),(0,Q.jsx)(`path`,{d:`M8.75 5h2.5`,stroke:`currentColor`,strokeWidth:1.25,strokeLinecap:`round`}),(0,Q.jsx)(`path`,{d:`M9 15h2`,stroke:`currentColor`,strokeWidth:1.25,strokeLinecap:`round`})]})}function __codexppIosSimPanel(e){let t=$.useRef(null),n=e.isActive===!0;return $.useEffect(()=>{let e=t.current;if(e==null)return;window.dispatchEvent(new CustomEvent(`__codexppIosSimNativePanelMounted`,{detail:{active:n}}))},[]),$.useEffect(()=>{let e=t.current;e!=null&&(e.setAttribute(`data-codexpp-ios-sim-native-active`,n?`true`:`false`),window.dispatchEvent(new CustomEvent(`__codexppIosSimNativePanelActiveChanged`,{detail:{active:n}})))},[n]),(0,Q.jsx)(`div`,{ref:t,className:`h-full min-h-0`,[`data-codexpp-ios-sim-native-panel-host`]:`true`,[`data-codexpp-ios-sim-native-active`]:n?`true`:`false`})}function __codexppIosSimOpenTab(e,t=!0){return pe.openTab(e,__codexppIosSimPanel,{id:`ios-simulator`,kind:`ios-simulator`,title:`iOS Simulator`,icon:(0,Q.jsx)(__codexppIosSimIcon,{className:`icon-xs shrink-0`}),props:{},activate:t,onActivate:()=>{window.dispatchEvent(new Event(`__codexppIosSimNativeTabActivated`))},onClose:()=>{window.dispatchEvent(new Event(`__codexppIosSimNativeTabClosed`))}}),!0}';

  let out = replaceRequired(
    source,
    "function wr(e){let t=(0,Z.c)(31),",
    helpers + "function wr(e){let t=(0,Z.c)(31),",
    "native iOS simulator tab helpers",
  );

  out = replaceRequired(
    out,
    "t[0]!==i||t[1]!==a||t[2]!==f||t[3]!==d.cwd||t[4]!==s?(p=()=>{C(s,!0,{browserConversationId:i,browserHostDisplayName:a,cwd:d.cwd,isAgentWorking:f})},t[0]=i,t[1]=a,t[2]=f,t[3]=d.cwd,t[4]=s,t[5]=p):p=t[5];let m=p,h;",
    "t[0]!==i||t[1]!==a||t[2]!==f||t[3]!==d.cwd||t[4]!==s?(p=()=>{C(s,!0,{browserConversationId:i,browserHostDisplayName:a,cwd:d.cwd,isAgentWorking:f})},t[0]=i,t[1]=a,t[2]=f,t[3]=d.cwd,t[4]=s,t[5]=p):p=t[5];$.useEffect(()=>{let e=()=>{__codexppIosSimOpenTab(s,!0),l||ue(s)};globalThis.__codexppIosSimOpenNativeTab=e,window.addEventListener(`__codexppIosSimOpenNativeTab`,e);return()=>{globalThis.__codexppIosSimOpenNativeTab===e&&delete globalThis.__codexppIosSimOpenNativeTab,window.removeEventListener(`__codexppIosSimOpenNativeTab`,e)}},[s,l]);let m=p,h;",
    "native iOS simulator tab opener bridge",
  );

  return out;
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error("missing patch target: " + label);
  }
  return source.replace(from, to);
}

function reloadExistingAppWindowsIfHotEnabled(api) {
  const { app, BrowserWindow } = require("electron");
  if (!app.isReady()) return;

  const token = getReloadToken();
  if (globalThis[RELOAD_TOKEN_KEY] === token) return;

  const windows = BrowserWindow.getAllWindows().filter((window) => {
    if (window.isDestroyed()) return false;
    return window.webContents.getURL().startsWith("app://-/");
  });
  if (windows.length === 0) return;

  globalThis[RELOAD_TOKEN_KEY] = token;
  setTimeout(() => {
    for (const window of windows) {
      if (!window.isDestroyed()) {
        api.log?.info?.("reloading Codex window to apply iOS Simulator renderer patch");
        window.webContents.reloadIgnoringCache();
      }
    }
  }, 200);
}

function getReloadToken() {
  try {
    const fs = require("node:fs");
    const stat = fs.statSync(__filename);
    return `${__filename}:${stat.mtimeMs}`;
  } catch {
    return `${__filename}:unknown`;
  }
}

function responseInitFrom(response) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

function stringifyError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

function parseAxSnapshotOutput(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.children)) return parsed;
  const text = parsed?.content?.find?.((item) => item?.type === "text")?.text || "";
  if (parsed?.isError) {
    throw new Error(text || "snapshot-ui failed");
  }
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    throw new Error("Could not find JSON accessibility hierarchy in snapshot output");
  }
  return JSON.parse(match[1]);
}

// ── styles ──────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes codexpp-ios-sim-annotation-draw {
      0% {
        opacity: 0;
        clip-path: inset(0 100% 100% 0 round 7px);
        transform: scale(0.985);
      }
      55% {
        opacity: 1;
        clip-path: inset(0 0 100% 0 round 7px);
      }
      100% {
        opacity: 1;
        clip-path: inset(0 0 0 0 round 7px);
        transform: scale(1);
      }
    }
    @keyframes codexpp-ios-sim-drill-target {
      from { opacity: 0; transform: scale(0.985); }
      to { opacity: 1; transform: scale(1); }
    }
    [${TWEAK_ATTR}="menu-entry"] svg { color: inherit; }
    [${TWEAK_ATTR}="side-tab"][data-selected="true"] > div {
      background: color-mix(in oklab, var(--color-token-text-primary) 8%, transparent);
    }
    [${TWEAK_ATTR}="side-tab"][data-selected="true"] .pointer-events-none {
      background: color-mix(in oklab, var(--color-token-text-primary) 8%, transparent);
    }
    [${TWEAK_ATTR}="side-tab"] [${TWEAK_ATTR}="close-tab"] {
      display: none;
    }
    [${TWEAK_ATTR}="side-tab"]:hover [${TWEAK_ATTR}="tab-icon"] {
      visibility: hidden;
    }
    [${TWEAK_ATTR}="side-tab"]:hover [${TWEAK_ATTR}="close-tab"] {
      display: flex;
    }
    [${TWEAK_ATTR}="tabpanel"] {
      background: transparent !important;
    }
    [${TWEAK_ATTR}="toolbar-button"] {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      height: var(--token-button-composer-height, 28px);
      padding: 0 0.5rem;
      border-radius: 0.5rem;
      border: 1px solid transparent;
      color: var(--color-token-description-foreground, var(--color-token-text-secondary));
      background: transparent;
      cursor: pointer;
      font-size: 0.875rem;
      line-height: 18px;
      transition: color 120ms ease, background 120ms ease, max-width 180ms ease, padding-inline 180ms ease;
    }
    [${TWEAK_ATTR}="toolbar-button"][data-square="true"] {
      width: var(--token-button-composer-height, 28px);
      padding: 0;
      justify-content: center;
    }
    [${TWEAK_ATTR}="toolbar-button"][data-active="true"] {
      color: var(--color-token-text-primary);
      background: var(--color-token-list-hover-background, color-mix(in oklab, var(--color-token-text-primary) 10%, transparent));
    }
    [${TWEAK_ATTR}="toolbar-button"]:hover {
      background: var(--color-token-list-hover-background, color-mix(in oklab, var(--color-token-text-primary) 8%, transparent));
    }
    [${TWEAK_ATTR}="annotation-overlay"] {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: none;
      pointer-events: none;
    }
    [${TWEAK_ATTR}="annotation-overlay"][data-active="true"] {
      display: block;
      pointer-events: auto;
      cursor: ${ANNOTATION_CURSOR_CSS};
    }
    [${TWEAK_ATTR}="annotation-target"] {
      position: absolute;
      border: 0;
      background: transparent;
      pointer-events: auto;
      cursor: ${ANNOTATION_CURSOR_CSS};
    }
    [${TWEAK_ATTR}="annotation-highlight"] {
      position: absolute;
      display: none;
      pointer-events: none;
      border: 1.5px solid var(--codexpp-ios-sim-annotation-color, #38bdf8);
      border-radius: 7px;
      background: rgba(var(--codexpp-ios-sim-annotation-rgb, 56, 189, 248), 0.14);
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.24), 0 8px 24px rgba(0, 0, 0, 0.22);
      transition:
        left 140ms ease,
        top 140ms ease,
        width 140ms ease,
        height 140ms ease,
        opacity 120ms ease,
        transform 160ms ease;
      animation: codexpp-ios-sim-annotation-draw 180ms ease-out;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] {
      position: absolute;
      display: none;
      max-width: min(320px, calc(100% - 24px));
      min-width: 170px;
      padding: 7px 9px;
      border-radius: 9px;
      background: color-mix(in oklab, var(--color-token-dropdown-background, var(--color-token-main-surface-primary)) 88%, #6b7280);
      color: var(--color-token-text-primary);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
      font-size: 12px;
      line-height: 16px;
      pointer-events: auto;
      white-space: normal;
      overflow: hidden;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] [data-codexpp-annotation-title] {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] [data-codexpp-annotation-controls] {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 6px;
      margin-top: 2px;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] [data-codexpp-annotation-kind] {
      margin-top: 2px;
      color: var(--color-token-text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] [data-codexpp-annotation-count] {
      color: var(--color-token-text-tertiary);
      font-variant-numeric: tabular-nums;
      margin-right: auto;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] [data-codexpp-annotation-nav] {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 5px;
      color: var(--color-token-text-secondary);
      background: transparent;
    }
    [${TWEAK_ATTR}="annotation-tooltip"] [data-codexpp-annotation-nav]:hover {
      color: var(--color-token-text-primary);
      background: var(--color-token-list-hover-background, color-mix(in oklab, var(--color-token-text-primary) 8%, transparent));
    }
    [${TWEAK_ATTR}="annotation-comment"] {
      position: absolute;
      z-index: 4;
      display: flex;
      align-items: center;
      width: min(294px, calc(100% - 24px));
      height: 44px;
      padding: 8px 8px 8px 16px;
      border: 0;
      border-radius: 22px;
      background: var(--color-token-dropdown-background, var(--color-token-main-surface-primary));
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.18);
      outline: 1px solid var(--color-token-border-light, color-mix(in oklab, var(--color-token-text-primary) 15%, transparent));
      color: var(--color-token-text-primary);
      pointer-events: auto;
      transform-origin: top left;
      animation: codexpp-ios-sim-comment-in 130ms ease-out;
    }
    @keyframes codexpp-ios-sim-comment-in {
      from { opacity: 0; transform: translateY(-3px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    [${TWEAK_ATTR}="annotation-comment-input"] {
      min-width: 0;
      flex: 1;
      height: 28px;
      border: 0;
      outline: 0;
      background: transparent;
      color: inherit;
      font-size: 13px;
      line-height: 24px;
      font-family: inherit;
    }
    [${TWEAK_ATTR}="annotation-comment-input"]::placeholder {
      color: var(--color-token-text-tertiary, var(--color-token-text-secondary));
    }
    [${TWEAK_ATTR}="annotation-comment-submit"] {
      display: inline-flex;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      border: 1px solid transparent;
      border-radius: 999px;
      background: transparent;
      color: var(--color-token-text-tertiary, var(--color-token-text-secondary));
      opacity: 1;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }
    [${TWEAK_ATTR}="annotation-comment"][data-has-text="true"] [${TWEAK_ATTR}="annotation-comment-submit"] {
      border-color: color-mix(in oklab, var(--color-token-text-primary) 15%, transparent);
      background: var(--color-token-text-primary);
      color: var(--color-token-dropdown-background, var(--color-token-main-surface-primary));
    }
    [${TWEAK_ATTR}="annotation-comment"][data-has-text="false"] [${TWEAK_ATTR}="annotation-comment-submit"]:hover {
      background: var(--color-token-list-hover-background, color-mix(in oklab, var(--color-token-text-primary) 8%, transparent));
    }
    [${TWEAK_ATTR}="usage"] {
      display: none;
      align-items: center;
      height: var(--token-button-composer-height, 28px);
      padding: 0 0.55rem;
      border-radius: 999px;
      border: 1px solid var(--color-token-border-default, var(--color-token-border));
      color: var(--color-token-text-tertiary, var(--color-token-text-secondary));
      background: color-mix(in oklab, var(--color-token-text-primary) 4%, transparent);
      font-size: 0.75rem;
      line-height: 1;
      white-space: nowrap;
    }
    [${TWEAK_ATTR}="usage"][data-ready="true"] {
      display: inline-flex;
    }
    [${TWEAK_ATTR}="device-popover"] {
      position: fixed;
      z-index: 9999;
      width: 260px;
      max-height: min(480px, calc(100vh - 80px));
      overflow-y: auto;
      padding: 4px;
      border: 0;
      border-radius: 15px;
      background: color-mix(in oklab, var(--color-token-dropdown-background, var(--color-token-main-surface-primary)) 90%, transparent);
      color: var(--color-token-foreground, var(--color-token-text-primary));
      box-shadow:
        0 0 0 0.5px rgba(252, 252, 252, 0.153),
        0 8px 16px -4px rgba(0, 0, 0, 0.12);
      font-size: 13px;
      line-height: 19.5px;
    }
    [${TWEAK_ATTR}="device-popover-header"] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      min-height: 29.5px;
      padding: 5px 8px;
      color: color-mix(in oklab, var(--color-token-foreground, var(--color-token-text-primary)) 72%, transparent);
      font-size: 13px;
      line-height: 19.5px;
      font-weight: 400;
    }
    [${TWEAK_ATTR}="device-runtime"] {
      min-height: 24px;
      padding: 5px 8px 1px;
      color: color-mix(in oklab, var(--color-token-foreground, var(--color-token-text-primary)) 58%, transparent);
      font-size: 11px;
      line-height: 15.7143px;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    [${TWEAK_ATTR}="device-list"] {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }
    [${TWEAK_ATTR}="device-item"] {
      display: grid;
      grid-template-columns: 1rem minmax(0, 1fr) auto;
      align-items: center;
      width: 100%;
      gap: 8px;
      min-height: 29.5px;
      padding: 5px 8px;
      border: 0;
      border-radius: 12.5px;
      color: var(--color-token-foreground, var(--color-token-text-primary));
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      line-height: 19.5px;
    }
    [${TWEAK_ATTR}="device-item"]:hover {
      background: var(--color-token-list-hover-background, color-mix(in oklab, var(--color-token-text-primary) 8%, transparent));
    }
    [${TWEAK_ATTR}="device-item"][data-booted="true"] {
      background: color-mix(in oklab, var(--color-token-text-primary) 7%, transparent);
    }
    [${TWEAK_ATTR}="device-name"] {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [${TWEAK_ATTR}="device-state"] {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--color-token-text-tertiary, var(--color-token-text-secondary));
      font-size: 13px;
      line-height: 19.5px;
      white-space: nowrap;
    }
    [${TWEAK_ATTR}="device-state"][data-booted="true"] {
      color: var(--color-token-success, #34c759);
    }
    [${TWEAK_ATTR}="device-empty"] {
      padding: 5px 8px;
      color: color-mix(in oklab, var(--color-token-foreground, var(--color-token-text-primary)) 72%, transparent);
      font-size: 13px;
      line-height: 19.5px;
    }
    [${TWEAK_ATTR}="status"] {
      margin-top: 0.5rem;
      font-size: 0.75rem;
      color: var(--color-token-text-tertiary, var(--color-token-text-secondary));
    }
    @keyframes codexpp-ios-sim-progress {
      from { transform: translateX(-100%); }
      to   { transform: translateX(250%); }
    }
  `;
  document.head.appendChild(style);
}

// ── menu detection ──────────────────────────────────────────────────────

function findMenuAnchorButtons() {
  const found = new Set();

  // Native Codex menu. Prefer Browser when present, but do not depend on it:
  // Codex/Better Browser may hide Browser once a tab exists.
  const radixCandidates = Array.from(
    document.querySelectorAll(
      '[role="menuitem"], [role="menu"] button, [data-radix-popper-content-wrapper] button',
    ),
  );
  for (const node of radixCandidates) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute(TWEAK_ATTR)) continue;
    if (!isMenuCandidate(node)) continue;
    const label = extractLabel(node);
    const text = compactText(node.textContent || "");
    if (matchesMenuAnchorText(label) || matchesMenuAnchorText(text)) {
      found.add(node);
    }
  }

  // codex-spitscreen picker dialog: clone the "New chat" picker row.
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (!(dialog instanceof HTMLElement)) continue;
    const rows = dialog.querySelectorAll(
      "button.flex.w-full, [data-codexpp-spitscreen-picker-row]",
    );
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      if (row.getAttribute(TWEAK_ATTR)) continue;
      const title = compactText(
        row.querySelector("[data-codexpp-spitscreen-picker-title]")?.textContent ||
          row.querySelector("span")?.textContent ||
          "",
      );
      const text = compactText(row.textContent || "");
      if (
        PICKER_TITLE_PATTERNS.some((p) => p.test(title)) ||
        /^\+?New chat\b/i.test(text)
      ) {
        found.add(row);
        break; // only inject once per dialog
      }
    }
  }

  return Array.from(found);
}

function menuScopeFor(anchor) {
  if (!(anchor instanceof HTMLElement)) return null;
  return (
    anchor.closest('[role="menu"], [role="dialog"], [data-radix-popper-content-wrapper]') ||
    anchor.parentElement
  );
}

function findScopedSimMenuEntry(anchor) {
  const scope = menuScopeFor(anchor);
  return scope?.querySelector?.(`[${TWEAK_ATTR}="menu-entry"]`) || null;
}

function menuScopeHasSimEntry(anchor) {
  return Boolean(findScopedSimMenuEntry(anchor));
}

function placeMenuEntry(anchor, entry) {
  if (!(anchor instanceof HTMLElement) || !(entry instanceof HTMLElement)) return;
  const reference = findMenuEntryInsertionReference(anchor);
  if (reference === entry) return;
  if (reference instanceof HTMLElement && reference.parentElement) {
    if (reference.nextElementSibling === entry) return;
    reference.insertAdjacentElement("afterend", entry);
    return;
  }
  if (anchor.nextElementSibling === entry) return;
  anchor.insertAdjacentElement("afterend", entry);
}

function findMenuEntryInsertionReference(anchor) {
  if (!(anchor instanceof HTMLElement)) return null;
  if (anchor.closest('[role="dialog"]')) return anchor;

  const parent = anchor.parentElement;
  if (parent instanceof HTMLElement) {
    const siblings = Array.from(parent.children);
    const anchorSibling = siblings.find((node) => node === anchor || node.contains(anchor));
    const anchorIndex = siblings.indexOf(anchorSibling);
    if (anchorIndex >= 0) {
      const separatorAfter = siblings
        .slice(anchorIndex + 1)
        .find((node) => node instanceof HTMLElement && isMenuSeparator(node));
      if (separatorAfter instanceof HTMLElement) return separatorAfter;
    }
  }

  const scope =
    anchor.closest('[role="menu"], [data-radix-popper-content-wrapper], [data-side][data-align]') ||
    anchor.parentElement;
  const anchorRect = anchor.getBoundingClientRect();
  const separatorAfter = Array.from(
    scope?.querySelectorAll?.('[role="separator"], [data-orientation="horizontal"]') || [],
  ).find((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    return rect.top >= anchorRect.bottom - 1;
  });
  return separatorAfter instanceof HTMLElement ? separatorAfter : anchor;
}

function isMenuSeparator(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.getAttribute("role") === "separator") return true;
  if (node.getAttribute("data-orientation") === "horizontal") return true;
  const rect = node.getBoundingClientRect();
  const text = compactText(node.textContent || "");
  if (text) return false;
  if (node.matches?.('[role="menuitem"], button, a, input, textarea, select')) return false;
  if (node.querySelector?.('[role="menuitem"], button, a, input, textarea, select')) return false;
  return rect.width > 24 && rect.height <= 12;
}

function isMenuCandidate(node) {
  if (node.closest('[role="tablist"], [role="tabpanel"]')) return false;
  if (node.getAttribute("role") === "menuitem") return true;
  if (node.closest('[role="dialog"]')) return true;
  return Boolean(
    node.closest(
      '[role="menu"], [data-radix-popper-content-wrapper], [data-side][data-align]',
    ),
  );
}

function rewriteMenuEntry(button) {
  rewriteMenuLabel(button);
  rewriteMenuIcon(button);
  normalizeShortcutHint(button);
}

function rewriteMenuLabel(button) {
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node);
  }
  // Browser/open-file-style entries: replace the primary row label.
  for (const node of textNodes) {
    if (matchesMenuAnchorText(compactText(node.nodeValue || ""))) {
      node.nodeValue = (node.nodeValue || "")
        .replace(/Browser use/i, MENU_LABEL)
        .replace(/Browser/i, MENU_LABEL)
        .replace(/Open file/i, MENU_LABEL)
        .replace(/Browse files/i, MENU_LABEL)
        .replace(/New chat/i, MENU_LABEL);
      return;
    }
  }
  // Picker-dialog entries (e.g. "New chat" / "Open a blank chat in this pane"):
  // first matching title text node becomes the label, the next becomes subtitle.
  let setTitle = false;
  for (const node of textNodes) {
    const t = compactText(node.nodeValue || "");
    if (!t) continue;
    if (!setTitle && PICKER_TITLE_PATTERNS.some((p) => p.test(t.replace(/^\+/, "")))) {
      node.nodeValue = (node.nodeValue || "").replace(/(\+?)[A-Za-z][^\n]*/, "$1" + MENU_LABEL);
      setTitle = true;
      continue;
    }
    if (setTitle) {
      // First non-empty text after title is the subtitle.
      node.nodeValue = PICKER_SUBTITLE;
      break;
    }
  }
  normalizeShortcutHint(button);
}

function rewriteMenuIcon(button) {
  const ariaIcon = button.querySelector('span[aria-hidden="true"]');
  if (ariaIcon?.querySelector("svg")) {
    ariaIcon.innerHTML = PHONE_SVG;
    return;
  }
  const svg = button.querySelector("svg");
  if (svg) {
    svg.replaceWith(htmlToElement(PHONE_SVG));
    return;
  }
  button.prepend(htmlToElement(PHONE_ICON));
}

function normalizeShortcutHint(button) {
  if (button.closest('[role="dialog"]')) return;
  let firstHint = null;
  for (const node of Array.from(button.querySelectorAll("kbd, span"))) {
    const text = compactText(node.textContent || "");
    if (
      text !== MENU_LABEL &&
      (/^[⌘⇧⌥⌃^]+/.test(text) || /Cmd|Ctrl|Alt|Shift|⌘/.test(text))
    ) {
      if (!firstHint) {
        firstHint = node;
        node.setAttribute(TWEAK_ATTR, "shortcut-hint");
        node.setAttribute("aria-hidden", "true");
        node.textContent = OPEN_SHORTCUT_LABEL;
      } else {
        node.remove();
      }
    }
  }
  if (firstHint) return;
  installShortcutHint(button);
}

function installShortcutHint(button) {
  if (button.closest('[role="dialog"]')) return;
  if (button.querySelector(`[${TWEAK_ATTR}="shortcut-hint"]`)) return;
  const row =
    button.querySelector(":scope > div.flex.w-full.items-center") ||
    button.querySelector("div.flex.w-full.items-center") ||
    button;
  const hint = document.createElement("span");
  hint.setAttribute(TWEAK_ATTR, "shortcut-hint");
  hint.setAttribute("aria-hidden", "true");
  hint.className = "ml-2 shrink-0 text-xs text-token-description-foreground";
  hint.textContent = OPEN_SHORTCUT_LABEL;
  row.appendChild(hint);
}

function installOpenShortcut(state) {
  if (!state?.api) return;
  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const key = String(event.key || "").toLowerCase();
    if (key === ".") {
      event.preventDefault();
      event.stopPropagation();
      toggleActiveSimAnnotationMode(state.api);
      return;
    }
    if (key !== "y") return;
    event.preventDefault();
    event.stopPropagation();
    state.api?.log?.info?.("opening iOS Simulator side panel via shortcut");
    openSimPanel(state.api);
  };
  document.addEventListener("keydown", onKeyDown, true);
  state.cleanup.push(() => document.removeEventListener("keydown", onKeyDown, true));
}

function toggleActiveSimAnnotationMode(api) {
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  if (panel instanceof HTMLElement && panel.isConnected && panel.style.display !== "none") {
    toggleAnnotationMode(panel, api);
    return;
  }
  openSimPanel(api);
  window.setTimeout(() => {
    const mountedPanel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
    if (mountedPanel instanceof HTMLElement) toggleAnnotationMode(mountedPanel, api);
  }, 350);
}

function closeTransientMenu(origin) {
  const menuRoot =
    origin.closest('[role="menu"]') ||
    origin.closest("[data-radix-popper-content-wrapper]") ||
    origin.closest("[data-state]");
  if (menuRoot instanceof HTMLElement) {
    menuRoot.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  }
}

// ── side panel ──────────────────────────────────────────────────────────

function openSimPanel(api) {
  setPanelOpen(true);
  if (requestNativeSimTabOpen()) {
    mountSimPanelSoon(api, 30);
    return;
  }
  ensureSidePanelVisible();
  // NOTE: requestAnimationFrame is paused when the window is unfocused, which
  // prevented mounting when the user tabbed away. setTimeout fires regardless.
  mountSimPanelSoon(api, 30);
}

function mountSimPanelSoon(api, attemptsLeft) {
  setTimeout(() => {
    let mounted = false;
    try {
      mounted = mountSimPanel(api);
    } catch (err) {
      api?.log?.error?.("ios-sim mountSimPanel threw", String(err?.stack || err));
    }
    if (mounted) return;
    if (attemptsLeft > 1) {
      ensureSidePanelVisible();
      mountSimPanelSoon(api, attemptsLeft - 1);
      return;
    }
    api?.log?.warn?.("ios-sim could not find side panel host");
  }, attemptsLeft === 30 ? 16 : 100);
}

function mountSimPanel(api) {
  if (mountNativeSimPanel(api)) return true;
  const state = currentRendererState();
  if (state?.nativeOpenPendingUntil && Date.now() < state.nativeOpenPendingUntil) {
    return false;
  }

  const tablist = findRightTablist();
  if (!(tablist instanceof HTMLElement)) return false;
  const panelHost = tablist.closest(".flex.h-full.min-h-0.flex-col");
  if (!(panelHost instanceof HTMLElement)) return false;
  installNativeTabDeactivation(tablist, panelHost);
  installTablistDrag(tablist);

  let tab = document.querySelector(`[${TWEAK_ATTR}="side-tab"]`);
  let panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);

  if (!tab) {
    tab = createSideTab(tablist);
    tablist.appendChild(tab);
  }
  if (!panel) {
    panel = createPanel(api);
    panelHost.appendChild(panel);
  }

  activateSimPanel(panelHost, tab, panel);
  return true;
}

function requestNativeSimTabOpen() {
  const opener = globalThis[NATIVE_OPEN_FUNCTION_KEY];
  if (typeof opener !== "function") return false;
  try {
    const state = currentRendererState();
    if (state) state.nativeOpenPendingUntil = Date.now() + 2_000;
    opener();
    return true;
  } catch (error) {
    console.warn("ios-sim native tab open failed", error);
    return false;
  }
}

function installNativeTabBridge(state) {
  const mount = () => {
    setPanelOpen(true);
    mountSimPanelSoon(state.api, 30);
  };
  const activeChanged = (event) => {
    if (event instanceof CustomEvent && event.detail?.active === false) {
      deactivateNativeSimPanel();
      return;
    }
    mount();
  };
  const closed = () => {
    deactivateNativeSimPanel({ removePanel: true });
  };

  window.addEventListener(NATIVE_PANEL_MOUNTED_EVENT, mount);
  window.addEventListener(NATIVE_TAB_ACTIVATED_EVENT, mount);
  window.addEventListener(NATIVE_PANEL_ACTIVE_EVENT, activeChanged);
  window.addEventListener(NATIVE_TAB_CLOSED_EVENT, closed);
  state.cleanup.push(() => {
    window.removeEventListener(NATIVE_PANEL_MOUNTED_EVENT, mount);
    window.removeEventListener(NATIVE_TAB_ACTIVATED_EVENT, mount);
    window.removeEventListener(NATIVE_PANEL_ACTIVE_EVENT, activeChanged);
    window.removeEventListener(NATIVE_TAB_CLOSED_EVENT, closed);
  });
}

function mountNativeSimPanel(api) {
  const host = findNativeSimPanelHost();
  if (!(host instanceof HTMLElement)) return false;
  const state = currentRendererState();
  if (state) state.nativeOpenPendingUntil = 0;

  document.querySelector(`[${TWEAK_ATTR}="side-tab"]`)?.remove();

  let panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  if (!(panel instanceof HTMLElement)) {
    panel = createPanel(api);
  }
  panel.setAttribute(`${TWEAK_ATTR}-native`, "true");
  if (panel.parentElement !== host) {
    host.appendChild(panel);
  }

  activateNativeSimPanel(panel);
  return true;
}

function findNativeSimPanelHost() {
  const activeHost = document.querySelector(
    `[${NATIVE_PANEL_HOST_ATTR}][${NATIVE_PANEL_ACTIVE_ATTR}="true"]`,
  );
  if (activeHost instanceof HTMLElement) return activeHost;
  const host = document.querySelector(`[${NATIVE_PANEL_HOST_ATTR}]`);
  return host instanceof HTMLElement ? host : null;
}

function deactivateNativeSimPanel(options = {}) {
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  const panelHost = panel instanceof HTMLElement ? findPanelHostForSimPanel(panel) : null;
  setPanelOpen(false, options);
  clearSimulatorDebugOverlays();
  if (panel instanceof HTMLElement) {
    panel.style.display = "none";
    try {
      panel.__codexppIosSimDetachCapture?.();
    } catch {}
    if (options.removePanel) {
      panel.__codexppIosSimStopUsage?.();
      panel.remove();
    }
  }
  if (panelHost instanceof HTMLElement) restoreNativePanelSurfaces(panelHost, panel);
}

function createSideTab(tablist) {
  const nativeTab = findNativeTabTemplate(tablist);
  if (nativeTab) {
    const cloned = nativeTab.cloneNode(true);
    hydrateClonedSideTab(cloned);
    wireSideTab(cloned);
    return cloned;
  }

  return createFallbackSideTab();
}

function findNativeTabTemplate(tablist) {
  if (!(tablist instanceof HTMLElement)) return null;
  const tabs = Array.from(
    tablist.querySelectorAll('[data-app-shell-tab-controller="right"][data-tab-id]'),
  );
  return tabs.find((node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.getAttribute(TWEAK_ATTR) === "side-tab") return false;
    const id = node.getAttribute("data-tab-id") || "";
    return id !== "ios-simulator";
  }) || null;
}

function hydrateClonedSideTab(controller) {
  controller.setAttribute(TWEAK_ATTR, "side-tab");
  controller.setAttribute("data-app-shell-tab-controller", "right");
  controller.setAttribute("data-tab-id", "ios-simulator");
  controller.removeAttribute("data-selected");
  controller.removeAttribute("aria-selected");
  delete controller.dataset.codexppDragging;
  controller.style.opacity = "";
  controller.draggable = true;

  for (const node of controller.querySelectorAll("[id], [aria-controls]")) {
    node.removeAttribute("id");
    node.removeAttribute("aria-controls");
  }
  for (const node of controller.querySelectorAll("[data-tab-id]")) {
    node.setAttribute("data-tab-id", "ios-simulator");
  }
  for (const node of controller.querySelectorAll("[data-state]")) {
    node.removeAttribute("data-state");
  }
  for (const bg of controller.querySelectorAll(".bg-\\[var\\(--app-shell-tab-background\\)\\]")) {
    bg.classList.remove("bg-[var(--app-shell-tab-background)]");
  }

  removeClonedCloseControls(controller);

  let tabButton = controller.querySelector('button[role="tab"]');
  if (!(tabButton instanceof HTMLButtonElement)) {
    tabButton = controller.querySelector("[role='tab']");
  }
  if (!(tabButton instanceof HTMLElement)) {
    tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.setAttribute("role", "tab");
    tabButton.className =
      "no-drag relative flex flex-1 items-center gap-2 z-10 text-sm min-w-0 overflow-hidden text-token-text-secondary";
    controller.appendChild(tabButton);
  }

  if (tabButton instanceof HTMLButtonElement) tabButton.type = "button";
  tabButton.setAttribute("role", "tab");
  tabButton.setAttribute("aria-selected", "false");
  tabButton.setAttribute("aria-label", PANEL_LABEL);
  tabButton.classList.remove("text-token-text-primary");
  tabButton.classList.add("text-token-text-secondary");

  rewriteSideTabIcon(tabButton);
  rewriteSideTabLabel(tabButton);
  installCloseControl(tabButton);

  let sep = controller.querySelector('[data-app-shell-tab-separator]');
  if (!(sep instanceof HTMLElement)) {
    sep = document.createElement("div");
    sep.setAttribute("aria-hidden", "true");
    sep.className =
      "h-3 w-px shrink-0 end-0 absolute bg-token-border transition-opacity duration-200 opacity-0";
    controller.appendChild(sep);
  }
  sep.setAttribute("data-app-shell-tab-separator", "ios-simulator");
}

function removeClonedCloseControls(controller) {
  for (const node of Array.from(
    controller.querySelectorAll('button[aria-label], [role="button"][aria-label], [data-app-shell-tab-close]'),
  )) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute("role") === "tab") continue;
    if (/close/i.test(node.getAttribute("aria-label") || "") || node.hasAttribute("data-app-shell-tab-close")) {
      node.remove();
    }
  }
}

function rewriteSideTabIcon(tabButton) {
  const iconSlot =
    tabButton.querySelector('span[aria-hidden="true"]') ||
    tabButton.querySelector(".icon-xs") ||
    tabButton.querySelector("svg")?.parentElement;
  if (iconSlot instanceof HTMLElement) {
    if (/^(svg|img)$/i.test(iconSlot.tagName)) {
      const span = htmlToElement(PHONE_ICON);
      span.setAttribute(TWEAK_ATTR, "tab-icon");
      span.className = "icon-xs flex shrink-0 items-center justify-center";
      iconSlot.replaceWith(span);
      return;
    }
    iconSlot.setAttribute("aria-hidden", "true");
    iconSlot.setAttribute(TWEAK_ATTR, "tab-icon");
    iconSlot.className =
      "icon-xs flex shrink-0 items-center justify-center";
    iconSlot.innerHTML = PHONE_SVG;
    return;
  }
  const icon = htmlToElement(PHONE_ICON);
  icon.setAttribute(TWEAK_ATTR, "tab-icon");
  tabButton.prepend(icon);
}

function rewriteSideTabLabel(tabButton) {
  const walker = document.createTreeWalker(tabButton, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (compactText(node.nodeValue || "")) textNodes.push(node);
  }
  if (textNodes.length > 0) {
    textNodes[0].nodeValue = MENU_LABEL;
    for (const node of textNodes.slice(1)) node.nodeValue = "";
    return;
  }
  const labelSpan = document.createElement("span");
  labelSpan.className = "inline-block min-w-0 whitespace-nowrap";
  labelSpan.textContent = MENU_LABEL;
  tabButton.appendChild(labelSpan);
}

function installCloseControl(tabButton) {
  let close = tabButton.querySelector(`[${TWEAK_ATTR}="close-tab"]`);
  if (!(close instanceof HTMLElement)) {
    close = document.createElement("div");
    close.setAttribute(TWEAK_ATTR, "close-tab");
    close.className =
      "no-drag shrink-0 cursor-interaction items-center justify-center group-hover/tab:flex after:content-[''] after:absolute after:-inset-2 hidden absolute start-1 z-30 size-5 top-1/2 -translate-y-1/2 text-token-text-tertiary hover:text-token-text-primary";
    tabButton.appendChild(close);
  }
  close.setAttribute("role", "button");
  close.setAttribute("aria-label", `Close ${MENU_LABEL} tab`);
  close.innerHTML = SVGS.close;
  close.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSimTab();
  });
}

function wireSideTab(controller) {
  const tabButton = controller.querySelector('[role="tab"]') || controller;
  tabButton.addEventListener("click", () => {
    const panelHost = controller.closest(".flex.h-full.min-h-0.flex-col");
    const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
    if (panelHost instanceof HTMLElement && panel instanceof HTMLElement) {
      activateSimPanel(panelHost, controller, panel);
    }
  });

  controller.addEventListener("dragstart", (e) => {
    if (!e.dataTransfer) return;
    if ((e.target instanceof Element) && e.target.closest(`[${TWEAK_ATTR}="close-tab"]`)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/x-codexpp-ios-sim", "1"); } catch {}
    controller.dataset.codexppDragging = "1";
    controller.style.opacity = "0.4";
  });
  controller.addEventListener("dragend", () => {
    delete controller.dataset.codexppDragging;
    controller.style.opacity = "";
  });
}

function createFallbackSideTab() {
  const controller = document.createElement("div");
  controller.setAttribute(TWEAK_ATTR, "side-tab");
  controller.setAttribute("data-app-shell-tab-controller", "right");
  controller.setAttribute("data-tab-id", "ios-simulator");
  controller.className =
    "my-auto flex shrink-0 relative max-w-40 pe-1 items-center contain-content gap-0.5";

  const shell = document.createElement("div");
  shell.setAttribute("data-tab-id", "ios-simulator");
  shell.setAttribute("aria-roledescription", "sortable");
  shell.className =
    "group/tab relative flex h-7 max-w-39 shrink-0 items-center overflow-hidden rounded-lg bg-token-main-surface-primary px-2 py-1";
  shell.setAttribute("role", "button");
  shell.tabIndex = 0;
  shell.style.setProperty(
    "--app-shell-tab-background",
    "color-mix(in srgb, var(--color-token-foreground) 5%, var(--color-token-main-surface-primary))",
  );

  const bg = document.createElement("div");
  bg.className =
    "pointer-events-none absolute inset-0 z-0 rounded-md group-hover/tab:bg-[var(--app-shell-tab-background)]";

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "tab");
  button.className =
    "no-drag relative flex flex-1 items-center gap-2 z-10 text-sm min-w-0 overflow-hidden text-token-text-secondary";

  const iconSpan = document.createElement("span");
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.setAttribute(TWEAK_ATTR, "tab-icon");
  // Hide the phone icon on tab hover so the close-X takes its place cleanly.
  iconSpan.className =
    "icon-xs flex shrink-0 items-center justify-center";
  iconSpan.innerHTML = PHONE_SVG;

  // Close button — overlays the icon's slot on hover. The SVG itself is a
  // donut with an X cut out via fill-rule=evenodd, so it needs no background.
  const close = document.createElement("div");
  close.setAttribute("role", "button");
  close.setAttribute("aria-label", `Close ${MENU_LABEL} tab`);
  close.setAttribute(TWEAK_ATTR, "close-tab");
  close.className =
    "no-drag shrink-0 cursor-interaction items-center justify-center group-hover/tab:flex after:content-[''] after:absolute after:-inset-2 hidden absolute start-1 z-30 size-5 top-1/2 -translate-y-1/2 text-token-text-tertiary hover:text-token-text-primary";
  close.innerHTML = SVGS.close;
  close.addEventListener("mousedown", (e) => {
    // Stop the parent button (and any drag start) from reacting.
    e.preventDefault();
    e.stopPropagation();
  });
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSimTab();
  });

  const labelSpan = document.createElement("span");
  labelSpan.className = "inline-block min-w-0 whitespace-nowrap";
  labelSpan.textContent = MENU_LABEL;

  button.append(iconSpan, close, labelSpan);
  button.addEventListener("click", () => {
    const panelHost = controller.closest(".flex.h-full.min-h-0.flex-col");
    const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
    if (panelHost instanceof HTMLElement && panel instanceof HTMLElement) {
      activateSimPanel(panelHost, controller, panel);
    }
  });

  shell.append(bg, button);
  controller.appendChild(shell);

  // Trailing separator (visual parity with native tabs).
  const sep = document.createElement("div");
  sep.setAttribute("aria-hidden", "true");
  sep.setAttribute("data-app-shell-tab-separator", "ios-simulator");
  sep.className =
    "h-3 w-px shrink-0 end-0 absolute bg-token-border transition-opacity duration-200 opacity-0";
  controller.appendChild(sep);

  // HTML5 drag-and-drop reordering inside the tablist (wired after append).
  controller.draggable = true;
  controller.addEventListener("dragstart", (e) => {
    if (!e.dataTransfer) return;
    if ((e.target instanceof Element) && e.target.closest(`[${TWEAK_ATTR}="close-tab"]`)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/x-codexpp-ios-sim", "1"); } catch {}
    controller.dataset.codexppDragging = "1";
    controller.style.opacity = "0.4";
  });
  controller.addEventListener("dragend", () => {
    delete controller.dataset.codexppDragging;
    controller.style.opacity = "";
  });

  return controller;
}

function closeSimTab() {
  setPanelOpen(false);
  const panelHost = findRightTablist()?.closest(".flex.h-full.min-h-0.flex-col");
  if (panelHost instanceof HTMLElement) deactivateSimPanel(panelHost);
  document.querySelector(`[${TWEAK_ATTR}="side-tab"]`)?.remove();
  document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`)?.remove();
  // Activate the first remaining native tab so the panel area isn't blank.
  const firstNative = panelHost?.querySelector?.(
    '[role="tablist"] [data-app-shell-tab-controller] [role="tab"]',
  );
  if (firstNative instanceof HTMLElement) {
    firstNative.click();
  }
}

function installTabDrag(controller) {
  // Now-no-op (drag handlers attached at controller-creation time);
  // tablist-level handlers wired separately in installTablistDrag.
}

function installTablistDrag(tablist) {
  if (!(tablist instanceof HTMLElement) || tablist.__codexppIosSimDragWired) return;
  tablist.__codexppIosSimDragWired = true;
  tablist.addEventListener("dragover", (e) => {
    const dragging = tablist.querySelector(
      `[${TWEAK_ATTR}="side-tab"][data-codexpp-dragging="1"]`,
    );
    if (!dragging) return;
    e.preventDefault();
    const target = (e.target instanceof Element) ? e.target.closest(
      '[data-app-shell-tab-controller], [' + TWEAK_ATTR + '="side-tab"]'
    ) : null;
    if (!(target instanceof HTMLElement) || target === dragging) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    if (before) target.parentElement.insertBefore(dragging, target);
    else target.parentElement.insertBefore(dragging, target.nextSibling);
  });
  tablist.addEventListener("drop", (e) => e.preventDefault());
}

function installNativeTabDeactivation(tablist, panelHost) {
  if (tablist.__codexppIosSimWired === TABLIST_WIRE_VERSION) return;
  tablist.__codexppIosSimWired = TABLIST_WIRE_VERSION;

  const handleNativeTab = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const controller = target?.closest?.('[data-app-shell-tab-controller="right"][data-tab-id]');
    const tab = target?.closest?.('[role="tab"]') || controller?.querySelector?.('[role="tab"]');
    if (!(controller instanceof HTMLElement) && !(tab instanceof HTMLElement)) return;
    if (target?.closest?.(`[${TWEAK_ATTR}="side-tab"]`)) return;
    deactivateSimPanel(panelHost, {
      activateNativeTab: controller instanceof HTMLElement ? controller : tab,
    });
  };

  tablist.addEventListener("click", handleNativeTab, true);
  tablist.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    handleNativeTab(event);
  }, true);
}

function createPanel(api) {
  const panel = document.createElement("div");
  panel.setAttribute(TWEAK_ATTR, "tabpanel");
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-label", PANEL_LABEL);
  panel.tabIndex = -1;
  panel.className = "relative flex min-h-0 flex-1 flex-col overflow-hidden";
  panel.__codexppIosSimApi = api;

  // Toolbar
  const toolbarHost = document.createElement("div");
  toolbarHost.className =
    "relative z-10 h-toolbar-pane min-w-0 shrink-0 border-b border-token-border";
  const toolbar = document.createElement("div");
  toolbar.className =
    "flex h-full min-w-0 items-center gap-1 px-2 text-token-description-foreground";
  toolbarHost.appendChild(toolbar);
  panel.appendChild(toolbarHost);

  toolbar.appendChild(
    makeToolbarButton({
      label: "Home",
      icon: SVGS.home,
      onClick: () => onHardwareButton(panel, api, "home"),
    }),
  );
  toolbar.appendChild(
    makeToolbarButton({
      label: "Screenshot",
      icon: SVGS.camera,
      onClick: () => onScreenshot(panel, api),
    }),
  );
  const annotationButton = makeToolbarButton({
    label: "Annotate",
    icon: SVGS.annotate,
    onClick: () => toggleAnnotationMode(panel, api),
  });
  toolbar.appendChild(annotationButton);
  panel.__codexppIosSimAnnotationButton = annotationButton;

  const spacer = document.createElement("div");
  spacer.className = "flex-1";
  toolbar.appendChild(spacer);

  const usage = makeUsagePill();
  toolbar.appendChild(usage);
  panel.__codexppIosSimUsage = usage;
  startUsagePolling(panel, api);

  const devicePickerButton = makeDevicePickerButton(panel, api);
  toolbar.appendChild(devicePickerButton);
  panel.__codexppIosSimDevicePickerButton = devicePickerButton;

  // Content area
  const content = document.createElement("div");
  content.className =
    "relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden";
  content.style.background = "transparent";

  const stage = document.createElement("div");
  stage.className = "relative flex h-full w-full items-center justify-center";
  stage.style.padding = "24px 12px";

  const mirror = document.createElement("img");
  mirror.setAttribute(TWEAK_ATTR, "mirror");
  mirror.alt = "iOS Simulator";
  mirror.draggable = false;
  mirror.style.maxWidth = "100%";
  mirror.style.maxHeight = "100%";
  mirror.style.objectFit = "contain";
  mirror.style.display = "none";
  mirror.style.userSelect = "none";
  mirror.style.touchAction = "none";
  mirror.style.borderRadius = "18px";
  mirror.style.boxShadow = "0 10px 40px rgba(0,0,0,0.35)";
  stage.appendChild(mirror);

  const annotationOverlay = document.createElement("div");
  annotationOverlay.setAttribute(TWEAK_ATTR, "annotation-overlay");
  const annotationHighlight = document.createElement("div");
  annotationHighlight.setAttribute(TWEAK_ATTR, "annotation-highlight");
  const annotationTooltip = document.createElement("div");
  annotationTooltip.setAttribute(TWEAK_ATTR, "annotation-tooltip");
  annotationTooltip.addEventListener("pointerleave", (event) => {
    const state = panel.__codexppIosSimAnnotationHoverState;
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (state?.target?.contains?.(next)) return;
    hideAnnotationHover(panel);
  });
  annotationOverlay.appendChild(annotationHighlight);
  annotationOverlay.appendChild(annotationTooltip);
  annotationOverlay.addEventListener("pointerdown", (event) => {
    if (!panel.__codexppIosSimAnnotationCommentOpen) return;
    const comment = panel.__codexppIosSimAnnotationComment;
    if (comment?.contains?.(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    panel.__codexppIosSimSuppressAnnotationClickUntil = performance.now() + 300;
    clearAnnotationComment(panel);
    hideAnnotationHover(panel);
  }, true);
  annotationOverlay.addEventListener("click", (event) => {
    const suppressUntil = panel.__codexppIosSimSuppressAnnotationClickUntil || 0;
    if (performance.now() > suppressUntil) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }, true);
  stage.appendChild(annotationOverlay);
  panel.__codexppIosSimAnnotationOverlay = annotationOverlay;
  panel.__codexppIosSimAnnotationHighlight = annotationHighlight;
  panel.__codexppIosSimAnnotationTooltip = annotationTooltip;

  // ── pointer forwarding (Phase 3) ────────────────────────────────────
  let pointerDown = false;
  let activePointerId = null;
  function imgRatio(evt) {
    const rect = mirror.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    let x = (evt.clientX - rect.left) / rect.width;
    let y = (evt.clientY - rect.top) / rect.height;
    if (x < 0) x = 0; else if (x > 1) x = 1;
    if (y < 0) y = 0; else if (y > 1) y = 1;
    return { x, y };
  }
  function send(event) {
    try { api.ipc.invoke("ios-sim:input:event", event).catch(() => {}); } catch {}
  }
  installKeyboardForwarding(panel, api);
  mirror.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    panel.focus({ preventScroll: true });
    const r = imgRatio(e); if (!r) return;
    pointerDown = true;
    activePointerId = e.pointerId;
    try { mirror.setPointerCapture(e.pointerId); } catch {}
    send({ type: "touch", phase: "down", x: r.x, y: r.y });
    e.preventDefault();
  });
  mirror.addEventListener("pointermove", (e) => {
    if (!pointerDown || e.pointerId !== activePointerId) return;
    const r = imgRatio(e); if (!r) return;
    send({ type: "touch", phase: "move", x: r.x, y: r.y });
  });
  function endPointer(e) {
    if (!pointerDown || e.pointerId !== activePointerId) return;
    const r = imgRatio(e) || { x: 0.5, y: 0.5 };
    pointerDown = false;
    activePointerId = null;
    try { mirror.releasePointerCapture(e.pointerId); } catch {}
    send({ type: "touch", phase: "up", x: r.x, y: r.y });
  }
  mirror.addEventListener("pointerup", endPointer);
  mirror.addEventListener("pointercancel", endPointer);
  mirror.addEventListener("contextmenu", (e) => e.preventDefault());

  const placeholder = document.createElement("div");
  placeholder.className =
    "absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-token-text-secondary pointer-events-none";
  placeholder.innerHTML =
    `<div style="opacity:0.5">${SVGS.phoneLarge}</div>` +
    `<div class="text-base text-token-text-primary">${PANEL_LABEL}</div>` +
    `<div class="text-sm max-w-[320px]" ${TWEAK_ATTR}="placeholder-message">Booting the simulator headlessly. Mirroring will begin as soon as the device starts up.</div>` +
    `<div ${TWEAK_ATTR}="progress" class="text-token-text-tertiary" style="width:200px;height:2px;border-radius:2px;background:color-mix(in oklab,currentColor 15%,transparent);overflow:hidden;margin-top:4px;position:relative"><div style="position:absolute;inset:0;width:40%;border-radius:2px;background:currentColor;opacity:0.7;animation:codexpp-ios-sim-progress 1.6s linear infinite;will-change:transform"></div></div>`;
  stage.appendChild(placeholder);

  content.appendChild(stage);
  panel.__codexppIosSimPlaceholder = placeholder;
  panel.__codexppIosSimMirror = mirror;
  panel.__codexppIosSimStage = stage;
  panel.appendChild(content);

  // Wire capture lifecycle ----------------------------------------------
  let lastUrl = null;
  const onFrame = (payload) => {
    if (!payload) return;
    const u8 = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const url = URL.createObjectURL(new Blob([u8], { type: "image/jpeg" }));
    const prev = lastUrl;
    lastUrl = url;
    mirror.onload = () => {
      if (prev) URL.revokeObjectURL(prev);
    };
    mirror.src = url;
    if (mirror.style.display === "none") {
      mirror.style.display = "";
      placeholder.style.display = "none";
    }
    if (panel.__codexppIosSimAnnotationActive && panel.__codexppIosSimAxTree) {
      renderAnnotationTargets(panel);
    }
  };
  const onMeta = (meta) => {
    panel.__codexppIosSimMeta = meta;
    api.log?.info?.("ios-sim stream meta", meta);
    if (panel.__codexppIosSimAnnotationActive && panel.__codexppIosSimAxTree) {
      renderAnnotationTargets(panel);
    }
  };
  const onStatus = (status) => {
    if (!status) return;
    if (status.kind === "compiling") setStatus(panel, "Compiling capture helper…");
    else if (status.kind === "starting") setStatus(panel, "Starting capture…");
    else if (status.kind === "stopped") {
      mirror.style.display = "none";
      placeholder.style.display = "";
      if (status.reason && status.reason !== "client-stop") {
        setStatus(panel, "Capture stopped: " + status.reason);
      }
    } else if (status.kind === "error") {
      mirror.style.display = "none";
      placeholder.style.display = "";
      setStatus(panel, "Capture error: " + (status.error || "unknown"));
    }
  };

  panel.__codexppIosSimAttachCapture = () => {
    if (panel.__codexppIosSimCaptureAttached) return;
    panel.__codexppIosSimCaptureAttached = true;
    panel.__codexppIosSimCaptureOff = [
      api.ipc.on("ios-sim:capture:frame", onFrame),
      api.ipc.on("ios-sim:capture:meta", onMeta),
      api.ipc.on("ios-sim:capture:status", onStatus),
    ];
    api.ipc.invoke("ios-sim:capture:start").catch((e) =>
      setStatus(panel, "Capture start failed: " + e),
    );
  };
  // Also stash on globalThis as fallback in case DOM expandos get stripped
  globalThis.__codexppIosSimPanelHooks = globalThis.__codexppIosSimPanelHooks || new WeakMap();
  globalThis.__codexppIosSimPanelHooks.set(panel, {
    attach: panel.__codexppIosSimAttachCapture,
    api,
  });
  globalThis.__codexppIosSimLastCreate = Date.now();
  panel.__codexppIosSimDetachCapture = () => {
    if (!panel.__codexppIosSimCaptureAttached) return;
    panel.__codexppIosSimCaptureAttached = false;
    for (const off of panel.__codexppIosSimCaptureOff || []) {
      try {
        if (typeof off === "function") off();
      } catch {}
    }
    panel.__codexppIosSimCaptureOff = null;
    api.ipc.invoke("ios-sim:capture:stop").catch(() => {});
    if (lastUrl) {
      URL.revokeObjectURL(lastUrl);
      lastUrl = null;
    }
    mirror.removeAttribute("src");
    mirror.style.display = "none";
    placeholder.style.display = "";
  };

  return panel;
}

function makeToolbarButton({ label, icon, text, onClick }) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute(TWEAK_ATTR, "toolbar-button");
  b.setAttribute("aria-label", label);
  b.setAttribute("title", label);
  if (!text) b.setAttribute("data-square", "true");
  if (icon) {
    const i = document.createElement("span");
    i.className = "flex shrink-0 items-center justify-center";
    i.innerHTML = icon;
    b.appendChild(i);
  }
  if (text) {
    const t = document.createElement("span");
    t.textContent = text;
    b.appendChild(t);
  }
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      onClick?.();
    } catch {}
  });
  return b;
}

const HID_KEY_BY_CODE = {
  KeyA: 4, KeyB: 5, KeyC: 6, KeyD: 7, KeyE: 8, KeyF: 9, KeyG: 10, KeyH: 11,
  KeyI: 12, KeyJ: 13, KeyK: 14, KeyL: 15, KeyM: 16, KeyN: 17, KeyO: 18,
  KeyP: 19, KeyQ: 20, KeyR: 21, KeyS: 22, KeyT: 23, KeyU: 24, KeyV: 25,
  KeyW: 26, KeyX: 27, KeyY: 28, KeyZ: 29,
  Digit1: 30, Digit2: 31, Digit3: 32, Digit4: 33, Digit5: 34,
  Digit6: 35, Digit7: 36, Digit8: 37, Digit9: 38, Digit0: 39,
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,
  Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53,
  Comma: 54, Period: 55, Slash: 56,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
};

const HID_LEFT_SHIFT = 225;

function installKeyboardForwarding(panel, api) {
  if (panel.__codexppIosSimKeyboardForwarding) return;
  panel.__codexppIosSimKeyboardForwarding = true;
  const handleKeyDown = (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (isEditableKeyboardTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (forwardKeyboardCode(panel, api, event.code, event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  panel.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
}

function isEditableKeyboardTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest?.(`[${TWEAK_ATTR}="annotation-comment"]`)) return true;
  if (target.closest?.('[contenteditable="true"]')) return true;
  const tag = target.tagName?.toLowerCase?.();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function forwardKeyboardCode(panel, api, code, shiftKey) {
  if (!isSimPanelAcceptingKeyboard(panel)) return false;
  const keyCode = HID_KEY_BY_CODE[code];
  if (!keyCode) return false;
  const useShift = Boolean(shiftKey && keyCode !== HID_LEFT_SHIFT);
  const send = (payload) => {
    try { api.ipc.invoke("ios-sim:input:event", payload).catch(() => {}); } catch {}
  };
  if (useShift) send({ type: "key", keyCode: HID_LEFT_SHIFT, phase: "down" });
  send({ type: "key", keyCode, phase: "down" });
  send({ type: "key", keyCode, phase: "up" });
  if (useShift) send({ type: "key", keyCode: HID_LEFT_SHIFT, phase: "up" });
  return true;
}

function isSimPanelAcceptingKeyboard(panel) {
  if (!(panel instanceof HTMLElement)) return false;
  if (!document.contains(panel)) return false;
  const style = window.getComputedStyle(panel);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return true;
}

function makeUsagePill() {
  const node = document.createElement("div");
  node.setAttribute(TWEAK_ATTR, "usage");
  node.setAttribute("aria-label", "Simulator CPU and memory usage");
  node.dataset.ready = "false";
  node.textContent = "";
  return node;
}

function startUsagePolling(panel, api) {
  if (panel.__codexppIosSimUsageTimer) return;
  const tick = () => {
    if (!panel.isConnected) {
      panel.__codexppIosSimStopUsage?.();
      return;
    }
    if (panel.style.display === "none" || panel.hidden) return;
    updateUsagePill(panel, api).catch((err) =>
      api.log?.warn?.("ios-sim usage update failed", String(err)),
    );
  };
  panel.__codexppIosSimUsageTimer = window.setInterval(tick, 2_000);
  panel.__codexppIosSimStopUsage = () => {
    if (panel.__codexppIosSimUsageTimer) {
      window.clearInterval(panel.__codexppIosSimUsageTimer);
    }
    panel.__codexppIosSimUsageTimer = null;
    panel.__codexppIosSimStopUsage = null;
  };
  tick();
}

async function updateUsagePill(panel, api) {
  const node = panel.__codexppIosSimUsage;
  if (!node) return;
  const res = await api.ipc.invoke("ios-sim:usage");
  if (!res?.ok) {
    node.dataset.ready = "false";
    node.textContent = "";
    node.title = res?.error || res?.stderr || "Usage unavailable";
    return;
  }
  const cpu = Number(res.cpu) || 0;
  const cpuText = cpu >= 10 ? cpu.toFixed(0) : cpu.toFixed(1);
  node.dataset.ready = "true";
  node.textContent = `CPU ${cpuText}%  RAM ${formatBytes(res.rssBytes || 0)}`;
  node.title = `${res.processCount || 0} simulator process${res.processCount === 1 ? "" : "es"}`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${Math.round(n / (1024 * 1024))} MB`;
}

function hideNativePanelSurfaces(panelHost, panel) {
  for (const nativePanel of findNativePanelSurfaces(panelHost, panel)) {
    hideNativeSurface(nativePanel);
  }
}

function restoreNativePanelSurfaces(panelHost, panel) {
  const nativePanels = new Set([
    ...panelHost.querySelectorAll(
      `[${NATIVE_PANEL_HIDDEN_ATTR}="true"], :scope > [role="tabpanel"]`,
    ),
    ...document.querySelectorAll(`[${NATIVE_PANEL_HIDDEN_ATTR}="true"]`),
  ]);
  for (const nativePanel of nativePanels) {
    if (nativePanel === panel) continue;
    restoreNativeSurface(nativePanel);
  }
}

function findNativePanelSurfaces(panelHost, panel) {
  const tablist = findRightTablist();
  const surfaces = new Set();
  const selectors = [
    ':scope > [role="tabpanel"]',
    ".relative.min-h-0.flex-1",
  ].join(",");

  for (const node of panelHost.querySelectorAll(selectors)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node === panel || node.contains(panel) || panel.contains(node)) continue;
    if (node.closest?.(`[${TWEAK_ATTR}]`)) continue;
    if (tablist && (node === tablist || node.contains(tablist) || tablist.contains(node))) continue;
    if (node.closest?.('[role="tablist"]')) continue;
    if (!isVisibleNativeContentSurface(panelHost, node)) continue;
    surfaces.add(node);
  }

  for (const node of findBrowserWebviewSurfaces(panel)) {
    surfaces.add(node);
  }

  return Array.from(surfaces);
}

function hideNativeSurface(node) {
  if (!(node instanceof HTMLElement)) return;
  if (!node.hasAttribute(PREV_DISPLAY_ATTR)) {
    node.setAttribute(PREV_DISPLAY_ATTR, node.style.display || "");
  }
  node.setAttribute(NATIVE_PANEL_HIDDEN_ATTR, "true");
  node.style.display = "none";
}

function restoreNativeSurface(node) {
  if (!(node instanceof HTMLElement)) return;
  const previous = node.getAttribute(PREV_DISPLAY_ATTR);
  if (previous !== null) {
    node.style.display = previous;
    node.removeAttribute(PREV_DISPLAY_ATTR);
  }
  node.removeAttribute(NATIVE_PANEL_HIDDEN_ATTR);
}

function findBrowserWebviewSurfaces(panel) {
  if (!(panel instanceof HTMLElement)) return [];
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.width <= 0 || panelRect.height <= 0) return [];

  const surfaces = new Set();
  for (const webview of collectBrowserWebviews()) {
    if (!(webview instanceof HTMLElement)) continue;
    if (webview.closest?.(`[${TWEAK_ATTR}]`)) continue;
    if (!isVisibleBrowserWebview(webview)) continue;
    const webviewRect = webview.getBoundingClientRect();
    if (!rectsOverlap(panelRect, webviewRect)) continue;
    surfaces.add(webview);

    const wrapper = webview.parentElement;
    if (
      wrapper instanceof HTMLElement &&
      wrapper !== document.body &&
      wrapper !== document.documentElement &&
      !wrapper.closest?.(`[${TWEAK_ATTR}]`) &&
      rectsOverlap(panelRect, wrapper.getBoundingClientRect())
    ) {
      surfaces.add(wrapper);
    }
  }
  return Array.from(surfaces);
}

function collectBrowserWebviews() {
  const webviews = [];
  const seen = new Set();
  const visit = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    try {
      for (const webview of root.querySelectorAll?.("webview") ?? []) {
        if (!seen.has(webview)) {
          seen.add(webview);
          webviews.push(webview);
        }
      }
      for (const element of root.querySelectorAll?.("*") ?? []) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    } catch {}
  };
  visit(document);
  return webviews;
}

function isVisibleBrowserWebview(webview) {
  const rect = webview.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1 || rect.x < -1000 || rect.y < -1000) return false;
  const style = getComputedStyle(webview);
  return style.display !== "none" && style.visibility !== "hidden";
}

function rectsOverlap(a, b) {
  if (!a || !b) return false;
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

function isVisibleNativeContentSurface(panelHost, node) {
  const rect = node.getBoundingClientRect();
  const hostRect = panelHost.getBoundingClientRect();
  if (rect.width < Math.max(120, hostRect.width * 0.45)) return false;
  if (rect.height < 80) return false;
  if (rect.bottom <= hostRect.top + 36) return false;
  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

function findPanelHostForSimPanel(panel) {
  if (!(panel instanceof HTMLElement)) return null;
  const nativeHost = panel.closest(`[${NATIVE_PANEL_HOST_ATTR}]`);
  const nativePanelHost = nativeHost?.closest?.(".flex.h-full.min-h-0.flex-col");
  if (nativePanelHost instanceof HTMLElement) return nativePanelHost;

  const injectedTab = document.querySelector(`[${TWEAK_ATTR}="side-tab"]`);
  const injectedPanelHost = injectedTab?.closest?.(".flex.h-full.min-h-0.flex-col");
  return injectedPanelHost instanceof HTMLElement ? injectedPanelHost : null;
}

function activateSimPanel(panelHost, tab, panel) {
  setPanelOpen(true);
  syncNativeTabSelection(panelHost, null);
  hideNativePanelSurfaces(panelHost, panel);

  const tabButton = tab.querySelector('[role="tab"]');
  tab.dataset.selected = "true";
  tabButton?.setAttribute("aria-selected", "true");
  tabButton?.classList.remove("text-token-text-secondary");
  tabButton?.classList.add("text-token-text-primary");
  showSimPanel(panel);
}

function activateNativeSimPanel(panel) {
  setPanelOpen(true);
  panel.setAttribute(`${TWEAK_ATTR}-native`, "true");
  showSimPanel(panel);
  const panelHost = findPanelHostForSimPanel(panel);
  if (panelHost instanceof HTMLElement) hideNativePanelSurfaces(panelHost, panel);
}

function showSimPanel(panel) {
  panel.style.display = "";
  try {
    panel.focus({ preventScroll: true });
  } catch {}
  startSimPanelPreflight(panel);
}

function startSimPanelPreflight(panel) {
  // Auto-boot a default device if nothing is booted, then refresh label.
  // We gate everything behind a preflight check so users on Macs without a
  // working Xcode toolchain see a single explanatory message instead of the
  // generic "Booting…" placeholder followed by a cryptic spawn error.
  const api = panel.__codexppIosSimApi;
  if (!api) return;

  if (panel.__codexppIosSimPreflightRunning) return;
  if (panel.__codexppIosSimPreflightOk) {
    try {
      panel.__codexppIosSimAttachCapture?.();
    } catch (e) {
      console.warn("ios-sim attach capture", e);
    }
    return refreshDeviceLabel(panel, api);
  }

  const showPreflightFailure = (pf) => {
    const placeholder = panel.__codexppIosSimPlaceholder;
    const msg = placeholder?.querySelector(`[${TWEAK_ATTR}="placeholder-message"]`);
    const progress = placeholder?.querySelector(`[${TWEAK_ATTR}="progress"]`);
    if (msg) {
      const hint = pf?.hint ? `\n\n${pf.hint}` : "";
      msg.textContent = (pf?.message || "iOS Simulator unavailable.") + hint;
      msg.style.whiteSpace = "pre-line";
    }
    progress?.remove();
    api.log?.warn?.("ios-sim preflight failed", pf);
  };

  panel.__codexppIosSimPreflightRunning = true;
  api.ipc
    .invoke("ios-sim:preflight")
    .then((pf) => {
      if (!pf?.ok) {
        showPreflightFailure(pf);
        return;
      }
      panel.__codexppIosSimPreflightOk = true;
      try {
        panel.__codexppIosSimAttachCapture?.();
      } catch (e) {
        console.warn("ios-sim attach capture", e);
      }
      if (!readAutoBootEnabled(api)) {
        return refreshDeviceLabel(panel, api);
      }
      return ensureBootedDevice(panel, api).then(() => refreshDeviceLabel(panel, api));
    })
    .catch((e) => {
      showPreflightFailure({
        message: "iOS Simulator preflight failed.",
        hint: String(e?.message || e || ""),
      });
    })
    .finally(() => {
      panel.__codexppIosSimPreflightRunning = false;
    });
}

function deactivateSimPanel(panelHost, options = {}) {
  setPanelOpen(false, options);
  clearSimulatorDebugOverlays();
  const tabWrap = document.querySelector(`[${TWEAK_ATTR}="side-tab"]`);
  const tab = tabWrap?.querySelector('[role="tab"]');
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  tabWrap?.removeAttribute("data-selected");
  tab?.setAttribute("aria-selected", "false");
  tab?.classList.remove("text-token-text-primary");
  tab?.classList.add("text-token-text-secondary");
  if (panel instanceof HTMLElement) {
    panel.style.display = "none";
    try {
      panel.__codexppIosSimDetachCapture?.();
    } catch {}
  }

  restoreNativePanelSurfaces(panelHost, panel);

  if (options.activateNativeTab instanceof HTMLElement) {
    syncNativeTabSelection(panelHost, options.activateNativeTab);
  }
}

function clearSimulatorDebugOverlays() {
  document.getElementById("__codexpp_simulator_overlay")?.remove();
  document.getElementById("__codexpp_ui_dump_overlay")?.remove();
}

function syncNativeTabSelection(panelHost, selectedController) {
  for (const controller of panelHost.querySelectorAll(
    '[data-app-shell-tab-controller="right"][data-tab-id]',
  )) {
    if (!(controller instanceof HTMLElement)) continue;
    if (controller.getAttribute(TWEAK_ATTR) === "side-tab") continue;
    const selected = controller === selectedController || controller.contains(selectedController);
    if (selected) controller.dataset.selected = "true";
    else controller.removeAttribute("data-selected");
    const tab = controller.querySelector('[role="tab"]');
    if (tab instanceof HTMLElement) {
      tab.setAttribute("aria-selected", selected ? "true" : "false");
      tab.classList.toggle("text-token-text-primary", selected);
      tab.classList.toggle("text-token-text-secondary", !selected);
    }
  }
}

function removeSimPanel(options = {}) {
  setPanelOpen(false, options);
  const panel = document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`);
  if (panel instanceof HTMLElement && panel.closest(`[${NATIVE_PANEL_HOST_ATTR}]`)) {
    deactivateNativeSimPanel({ ...options, removePanel: true });
  } else {
    const panelHost = findRightTablist()?.closest(".flex.h-full.min-h-0.flex-col");
    if (panelHost instanceof HTMLElement) deactivateSimPanel(panelHost, options);
  }
  document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`)?.__codexppIosSimStopUsage?.();
  document.querySelector(`[${TWEAK_ATTR}="side-tab"]`)?.remove();
  document.querySelector(`[${TWEAK_ATTR}="tabpanel"]`)?.remove();
}

function ensureSidePanelVisible() {
  if (findRightTablist()) return;
  const toggle =
    document.querySelector('button[aria-label="Toggle side panel"][aria-pressed="false"]') ||
    document.querySelector('button[aria-label="Open side panel"]') ||
    findLikelySidePanelOpenButton();
  if (toggle instanceof HTMLElement) toggle.click();
}

function findLikelySidePanelOpenButton() {
  const buttons = Array.from(document.querySelectorAll("button[aria-label]"));
  const rightEdgeToggle = Array.from(document.querySelectorAll("button")).find((button) => {
    if (!(button instanceof HTMLElement)) return false;
    if (button.getAttribute("aria-label") || button.title || compactText(button.textContent || "")) return false;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.top > 80) return false;
    if (rect.left < window.innerWidth - 90) return false;
    return Boolean(button.querySelector("svg.rotate-180, svg"));
  });
  if (rightEdgeToggle instanceof HTMLElement) return rightEdgeToggle;

  return buttons.find((button) => {
    if (!(button instanceof HTMLElement)) return false;
    const label = button.getAttribute("aria-label") || "";
    if (!/open side panel|show side panel|expand panel/i.test(label)) return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) || null;
}

function findRightTablist() {
  const rightPanel = document.querySelector('[data-app-shell-focus-area="right-panel"]');
  const rightPanelTablist = rightPanel?.querySelector?.('[role="tablist"]');
  if (rightPanelTablist instanceof HTMLElement) return rightPanelTablist;

  const rightTab = document.querySelector('[data-app-shell-tab-controller="right"][data-tab-id]');
  const owningTablist = rightTab?.closest?.('[role="tablist"]');
  if (owningTablist instanceof HTMLElement) return owningTablist;

  const addButton =
    document.querySelector('button[aria-label="Open side panel tab"]') ||
    document.querySelector('button[title="Open side panel tab"]');
  const toolbar = addButton?.closest(".flex.h-toolbar-pane, .h-toolbar, .box-content");
  return toolbar?.querySelector('[role="tablist"]') || null;
}

// ── toolbar handlers ────────────────────────────────────────────────────

async function onHardwareButton(panel, api, button) {
  const map = { home: "home", lock: "lock", side: "side", siri: "siri" };
  const name = map[button] || "home";
  const res = await api.ipc.invoke("ios-sim:input:event", {
    type: "button-tap",
    name,
  });
  if (!res?.ok) setStatus(panel, `${button} failed: ${res?.error || "?"}`);
  else api.log?.info?.("ios-sim button", name);
}

async function onRotate() { /* removed in this build */ }

async function onScreenshot(panel, api) {
  setStatus(panel, "Saving screenshot to ~/Desktop…");
  const fname = `simulator-${Date.now()}.png`;
  const res = await api.ipc
    .invoke("ios-sim:screenshot", fname)
    .catch((e) => ({ ok: false, error: String(e?.message || e) }));
  if (res?.ok) setStatus(panel, "Saved to Desktop: " + fname);
  else
    setStatus(
      panel,
      "Screenshot failed: " + (res?.stderr || res?.error || "unknown"),
    );
}

async function onPickDevice(panel, api) {
  await openDevicePicker(panel, api);
}

async function toggleAnnotationMode(panel, api) {
  if (panel.__codexppIosSimAnnotationActive) {
    setAnnotationMode(panel, false);
    setStatus(panel, "");
    return;
  }
  setAnnotationMode(panel, true);
  setStatus(panel, "Loading simulator UI references…");
  const res = await api.ipc
    .invoke("ios-sim:ax-snapshot")
    .catch((e) => ({ ok: false, error: String(e?.message || e) }));
  if (!panel.__codexppIosSimAnnotationActive) return;
  if (!res?.ok) {
    setAnnotationMode(panel, false);
    setStatus(panel, "Annotation failed: " + (res?.stderr || res?.error || "unknown"));
    return;
  }
  panel.__codexppIosSimAxTree = res.tree;
  panel.__codexppIosSimAnnotationDevice = res.device || panel.__codexppIosSimMeta?.deviceUDID || null;
  renderAnnotationTargets(panel);
  setStatus(panel, "Annotation mode: hover a UI element, then click to comment.");
}

function setAnnotationMode(panel, active) {
  panel.__codexppIosSimAnnotationActive = Boolean(active);
  if (active) clearSimulatorDebugOverlays();
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  const button = panel.__codexppIosSimAnnotationButton;
  if (overlay) overlay.dataset.active = active ? "true" : "false";
  if (button) {
    button.dataset.active = active ? "true" : "false";
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  setAnnotationKeyboardHandling(panel, active);
  if (!active) {
    clearAnnotationTargets(panel);
    clearAnnotationComment(panel);
    hideAnnotationHover(panel);
  }
}

function setAnnotationKeyboardHandling(panel, active) {
  if (active) {
    if (panel.__codexppIosSimAnnotationKeydown) return;
    panel.__codexppIosSimAnnotationKeydown = (event) => {
      if (!panel.__codexppIosSimAnnotationActive) return;
      if (panel.__codexppIosSimAnnotationCommentOpen) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const handled = cycleAnnotationSelection(panel, event.key === "ArrowRight" ? 1 : -1);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    document.addEventListener("keydown", panel.__codexppIosSimAnnotationKeydown, true);
    return;
  }

  if (panel.__codexppIosSimAnnotationKeydown) {
    document.removeEventListener("keydown", panel.__codexppIosSimAnnotationKeydown, true);
    panel.__codexppIosSimAnnotationKeydown = null;
  }
}

function renderAnnotationTargets(panel) {
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  const mirror = panel.__codexppIosSimMirror;
  const stage = panel.__codexppIosSimStage;
  if (!overlay || !mirror || !stage) return;
  const previousHover = panel.__codexppIosSimAnnotationHoverState;
  const previousHoverKey = previousHover?.sourceItem
    ? annotationItemStableKey(previousHover.sourceItem)
    : null;
  const previousHoverIndex = previousHover?.index || 0;
  clearAnnotationTargets(panel);

  const mirrorRect = mirror.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  if (mirrorRect.width <= 0 || mirrorRect.height <= 0) return;

  const meta = panel.__codexppIosSimMeta || {};
  const rootFrame = getAxRootFrame(panel.__codexppIosSimAxTree);
  const pointWidth = Number(meta.pointWidth || rootFrame?.width || 390);
  const pointHeight = Number(meta.pointHeight || rootFrame?.height || 844);
  const items = flattenAnnotationAxItems(panel.__codexppIosSimAxTree, {
    pointWidth,
    pointHeight,
  });
  const renderItems = [...items].sort(compareAnnotationRenderOrder);
  let replacementHoverTarget = null;
  let replacementHoverItem = null;

  for (const item of renderItems.slice(0, 260)) {
    const target = document.createElement("button");
    target.type = "button";
    target.setAttribute(TWEAK_ATTR, "annotation-target");
    target.setAttribute("aria-label", annotationLabel(item));
    const left = mirrorRect.left - stageRect.left + (item.frame.x / pointWidth) * mirrorRect.width;
    const top = mirrorRect.top - stageRect.top + (item.frame.y / pointHeight) * mirrorRect.height;
    const width = Math.max(8, (item.frame.width / pointWidth) * mirrorRect.width);
    const height = Math.max(8, (item.frame.height / pointHeight) * mirrorRect.height);
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.width = `${width}px`;
    target.style.height = `${height}px`;
    target.style.zIndex = String(annotationTargetZIndex(item));
    target.__codexppIosSimAnnotationItem = item;
    target.addEventListener("pointerenter", (event) => showAnnotationHover(panel, target, item, event));
    target.addEventListener("pointerleave", (event) => {
      const tooltip = panel.__codexppIosSimAnnotationTooltip;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (tooltip?.contains?.(next)) return;
      hideAnnotationHover(panel);
    });
    target.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectAnnotationTarget(panel, target, item, event);
    });
    overlay.appendChild(target);
    if (previousHoverKey && annotationItemStableKey(item) === previousHoverKey) {
      replacementHoverTarget = target;
      replacementHoverItem = item;
    }
  }

  if (previousHoverKey && replacementHoverTarget && replacementHoverItem) {
    const hoverItems = getAnnotationSelectionItems(panel, replacementHoverItem);
    panel.__codexppIosSimAnnotationHoverState = {
      target: replacementHoverTarget,
      sourceItem: replacementHoverItem,
      items: hoverItems,
      index: Math.min(previousHoverIndex, Math.max(0, hoverItems.length - 1)),
    };
    applyAnnotationSelection(panel);
  }
}

function annotationItemStableKey(item) {
  const frame = normalizeAxFrame(item?.frame || item?.AXFrame) || {};
  return [
    item?.AXUniqueId || "",
    annotationText(item),
    annotationRole(item),
    Math.round((frame.x || 0) * 2) / 2,
    Math.round((frame.y || 0) * 2) / 2,
    Math.round((frame.width || 0) * 2) / 2,
    Math.round((frame.height || 0) * 2) / 2,
  ].join(":");
}

function clearAnnotationTargets(panel) {
  panel.__codexppIosSimAnnotationOverlay
    ?.querySelectorAll(`[${TWEAK_ATTR}="annotation-target"]`)
    .forEach((node) => node.remove());
}

function showAnnotationHover(panel, target, item, event) {
  if (
    panel.__codexppIosSimAnnotationCommentOpen &&
    panel.__codexppIosSimAnnotationSelectedTarget &&
    panel.__codexppIosSimAnnotationSelectedTarget !== target
  ) {
    return;
  }
  const highlight = panel.__codexppIosSimAnnotationHighlight;
  const tooltip = panel.__codexppIosSimAnnotationTooltip;
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  if (!highlight || !tooltip || !overlay) return;
  const items = getAnnotationSelectionItems(panel, item);
  const previous = panel.__codexppIosSimAnnotationHoverState;
  const sameTarget = previous?.target === target && previous?.sourceItem === item;
  const index = sameTarget ? Math.min(previous.index || 0, items.length - 1) : 0;
  panel.__codexppIosSimAnnotationHoverState = { target, sourceItem: item, items, index };
  applyAnnotationSelection(panel);
}

function applyAnnotationSelection(panel) {
  const state = panel.__codexppIosSimAnnotationHoverState;
  if (!state?.target?.isConnected) return false;
  const target = state.target;
  const item = state.items[state.index] || state.sourceItem;
  const highlight = panel.__codexppIosSimAnnotationHighlight;
  const tooltip = panel.__codexppIosSimAnnotationTooltip;
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  if (!highlight || !tooltip || !overlay || !item) return false;
  const rect = getCorrectedAnnotationSelectionRect(panel, state, item, target);
  const overlayRect = overlay.getBoundingClientRect();
  if (!rect) return false;
  const left = rect.left;
  const top = rect.top;
  const color = ANNOTATION_COLORS[state.index % ANNOTATION_COLORS.length];
  highlight.style.setProperty("--codexpp-ios-sim-annotation-color", color.border);
  highlight.style.setProperty("--codexpp-ios-sim-annotation-rgb", color.rgb);
  const wasVisible = highlight.style.display === "block";
  highlight.style.display = "block";
  highlight.style.left = `${left}px`;
  highlight.style.top = `${top}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  if (!wasVisible) {
    highlight.style.animation = "none";
    void highlight.offsetWidth;
    highlight.style.animation = "";
  }
  renderAnnotationTooltip(panel, item);
  tooltip.style.display = "block";
  const tooltipHeight = tooltip.getBoundingClientRect().height || 64;
  const tooltipTop = top > tooltipHeight + 8 ? top - tooltipHeight - 8 : top + rect.height + 8;
  tooltip.style.left = `${Math.max(8, Math.min(left, overlayRect.width - 328))}px`;
  tooltip.style.top = `${Math.max(8, tooltipTop)}px`;
  return true;
}

function getCorrectedAnnotationSelectionRect(panel, state, item, target) {
  const rect = getAnnotationItemOverlayRect(panel, item) || getElementOverlayRect(panel, target);
  if (!rect || !item?.__codexppDrilldown) return rect;

  const projectedParent = getAnnotationItemOverlayRect(panel, state.sourceItem);
  const liveParent = getElementOverlayRect(panel, target);
  if (!projectedParent || !liveParent) return rect;

  return {
    ...rect,
    left: rect.left + (liveParent.left - projectedParent.left),
    top: rect.top + (liveParent.top - projectedParent.top),
  };
}

function getAnnotationSelectionItems(panel, item) {
  if (item?.__codexppDrilldown || item?.__codexppSyntheticText) return [item];
  if (!canDrilldownAnnotationItem(item)) return [item];
  const dims = getAnnotationDims(panel);
  const children = inferDrilldownAnnotationItems(panel, item, dims);
  return children.length > 0 ? [item, ...children] : [item];
}

function renderAnnotationTooltip(panel, item) {
  const tooltip = panel.__codexppIosSimAnnotationTooltip;
  const state = panel.__codexppIosSimAnnotationHoverState;
  if (!tooltip || !state) return;
  tooltip.replaceChildren();

  const title = document.createElement("div");
  title.dataset.codexppAnnotationTitle = "true";
  title.textContent = annotationText(item) || item.AXUniqueId || "Unnamed";
  tooltip.appendChild(title);

  const controls = document.createElement("div");
  controls.dataset.codexppAnnotationControls = "true";
  const count = document.createElement("span");
  count.dataset.codexppAnnotationCount = "true";
  count.textContent = `${state.index + 1}/${state.items.length}`;
  controls.appendChild(count);
  if (state.items.length > 1) {
    controls.appendChild(makeAnnotationNavButton(panel, -1, "Previous annotation target", "‹"));
    controls.appendChild(makeAnnotationNavButton(panel, 1, "Next annotation target", "›"));
  }
  tooltip.appendChild(controls);

  const kind = document.createElement("div");
  kind.dataset.codexppAnnotationKind = "true";
  kind.textContent = annotationRole(item);
  tooltip.appendChild(kind);
}

function makeAnnotationNavButton(panel, delta, label, text) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.codexppAnnotationNav = "true";
  button.setAttribute("aria-label", label);
  button.textContent = text;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    cycleAnnotationSelection(panel, delta);
  });
  return button;
}

function cycleAnnotationSelection(panel, delta) {
  const state = panel.__codexppIosSimAnnotationHoverState;
  if (!state || state.items.length <= 1) return false;
  state.index = (state.index + delta + state.items.length) % state.items.length;
  return applyAnnotationSelection(panel);
}

function getCurrentAnnotationItem(panel, target, fallbackItem) {
  const state = panel.__codexppIosSimAnnotationHoverState;
  if (state?.target === target && state.items[state.index]) return state.items[state.index];
  return fallbackItem;
}

function getAnnotationDims(panel) {
  const meta = panel.__codexppIosSimMeta || {};
  const rootFrame = getAxRootFrame(panel.__codexppIosSimAxTree);
  return {
    pointWidth: Number(meta.pointWidth || rootFrame?.width || 390),
    pointHeight: Number(meta.pointHeight || rootFrame?.height || 844),
  };
}

function getAnnotationItemOverlayRect(panel, item) {
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  const mirror = panel.__codexppIosSimMirror;
  const frame = normalizeAxFrame(item?.frame);
  if (!overlay || !mirror || !frame) return null;
  const mirrorRect = mirror.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  if (mirrorRect.width <= 0 || mirrorRect.height <= 0) return null;
  const dims = getAnnotationDims(panel);
  return {
    left: mirrorRect.left - overlayRect.left + (frame.x / dims.pointWidth) * mirrorRect.width,
    top: mirrorRect.top - overlayRect.top + (frame.y / dims.pointHeight) * mirrorRect.height,
    width: Math.max(8, (frame.width / dims.pointWidth) * mirrorRect.width),
    height: Math.max(8, (frame.height / dims.pointHeight) * mirrorRect.height),
  };
}

function getElementOverlayRect(panel, element) {
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  if (!overlay || !(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  return {
    left: rect.left - overlayRect.left,
    top: rect.top - overlayRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function hideAnnotationHover(panel) {
  if (panel.__codexppIosSimAnnotationCommentOpen) return;
  panel.__codexppIosSimAnnotationHoverState = null;
  const highlight = panel.__codexppIosSimAnnotationHighlight;
  const tooltip = panel.__codexppIosSimAnnotationTooltip;
  if (highlight) highlight.style.display = "none";
  if (tooltip) {
    tooltip.style.display = "none";
    tooltip.replaceChildren();
  }
}

function selectAnnotationTarget(panel, target, item, event) {
  showAnnotationHover(panel, target, item, event);
  showAnnotationComment(panel, target, getCurrentAnnotationItem(panel, target, item));
}

function showAnnotationComment(panel, target, item) {
  const overlay = panel.__codexppIosSimAnnotationOverlay;
  if (!overlay) return;
  clearAnnotationComment(panel);
  panel.__codexppIosSimAnnotationSelectedTarget = target;
  panel.__codexppIosSimAnnotationCommentOpen = true;

  const form = document.createElement("form");
  form.setAttribute(TWEAK_ATTR, "annotation-comment");
  form.dataset.hasText = "false";
  const input = document.createElement("input");
  input.setAttribute(TWEAK_ATTR, "annotation-comment-input");
  input.type = "text";
  input.placeholder = "Add a comment…";
  input.autocomplete = "off";
  input.spellcheck = true;
  const submit = document.createElement("button");
  submit.setAttribute(TWEAK_ATTR, "annotation-comment-submit");
  submit.type = "submit";
  submit.setAttribute("aria-label", "Dictate");
  submit.innerHTML = SVGS.mic;
  form.appendChild(input);
  form.appendChild(submit);

  const overlayRect = overlay.getBoundingClientRect();
  const state = panel.__codexppIosSimAnnotationHoverState;
  const targetRect =
    state?.target === target
      ? getCorrectedAnnotationSelectionRect(panel, state, item, target)
      : getAnnotationItemOverlayRect(panel, item) || getElementOverlayRect(panel, target);
  if (!targetRect) return;
  const left = Math.max(8, Math.min(targetRect.left, overlayRect.width - 306));
  const belowTop = targetRect.top + targetRect.height + 8;
  const aboveTop = targetRect.top - 52;
  const top = belowTop + 44 < overlayRect.height ? belowTop : Math.max(8, aboveTop);
  form.style.left = `${left}px`;
  form.style.top = `${top}px`;

  input.addEventListener("input", () => {
    const hasText = input.value.trim().length > 0;
    form.dataset.hasText = hasText ? "true" : "false";
    submit.setAttribute("aria-label", hasText ? "Comment" : "Dictate");
    submit.innerHTML = hasText ? SVGS.annotationCheck : SVGS.mic;
  });
  const submitComment = async () => {
    const comment = input.value.trim();
    if (!comment) {
      input.focus();
      return;
    }
    if (submit.disabled) return;
    submit.disabled = true;
    const ok = await openNativeAnnotationComment(panel, item, comment);
    submit.disabled = false;
    if (ok) {
      setAnnotationMode(panel, false);
      setStatus(panel, "");
      return;
    }
    input.focus();
    setStatus(panel, "Annotation failed: active chat could not be found.");
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    submitComment();
  });
  form.addEventListener(
    "keydown",
    (event) => {
      event.stopPropagation();
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        submitComment();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearAnnotationComment(panel);
        hideAnnotationHover(panel);
      }
    },
    true,
  );

  overlay.appendChild(form);
  panel.__codexppIosSimAnnotationComment = form;
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
}

function clearAnnotationComment(panel) {
  panel.__codexppIosSimAnnotationComment?.remove?.();
  panel.__codexppIosSimAnnotationComment = null;
  panel.__codexppIosSimAnnotationCommentOpen = false;
  panel.__codexppIosSimAnnotationSelectedTarget = null;
}

async function openNativeAnnotationComment(panel, item, comment) {
  const conversationId = findActiveConversationId(panel);
  const simulatorId = getAnnotationSimulatorId(panel);
  const body = comment.trim();
  const id = `ios-sim-annotation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const payload = {
    id,
    conversationId,
    body,
    comment: createIosSimulatorCommentAttachment(panel, item, body, simulatorId, id),
  };
  const res = await submitSavedAnnotationToComposer(payload);
  if (res?.ok) return true;
  setStatus(panel, "Annotation failed: " + (res?.error || "composer annotation bridge unavailable"));
  return false;
}

function submitSavedAnnotationToComposer(payload) {
  return new Promise((resolve) => {
    const id = payload.id;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      window.removeEventListener("__codexppIosSimSubmitAnnotationResult", onResult);
      resolve(result);
    };
    const onResult = (event) => {
      try {
        const detail = JSON.parse(event.detail || "{}");
        if (detail.id !== id) return;
        finish(detail);
      } catch (error) {
        finish({ ok: false, error: String(error?.message || error) });
      }
    };
    window.addEventListener("__codexppIosSimSubmitAnnotationResult", onResult);
    window.dispatchEvent(
      new CustomEvent("__codexppIosSimSubmitAnnotation", {
        detail: JSON.stringify(payload),
      }),
    );
    window.setTimeout(() => finish({ ok: false, error: "timed out" }), 500);
  });
}

function writeAnnotationToComposer(panel, body) {
  const composer = findComposerTextbox(panel);
  if (!composer) return false;
  writeTextToComposer(composer, body);
  return true;
}

function createIosSimulatorAnnotationTarget(item, simulatorId) {
  const frame = normalizeAxFrame(item.frame) || { x: 0, y: 0, width: 0, height: 0 };
  return {
    type: "ios-simulator",
    simulatorId,
    label: annotationLabel(item),
    role: annotationRole(item),
    frame,
    accessibilityIdentifier: item.AXUniqueId || null,
  };
}

function createIosSimulatorAnnotationAnchor(item, simulatorId) {
  const frame = normalizeAxFrame(item.frame) || { x: 0, y: 0, width: 0, height: 0 };
  return {
    kind: "ios-simulator-element",
    simulatorId,
    label: annotationLabel(item),
    frame,
  };
}

function createIosSimulatorCommentAttachment(panel, item, body, simulatorId, commentId) {
  const frame = normalizeAxFrame(item.frame) || { x: 0, y: 0, width: 0, height: 0 };
  const label = annotationLabel(item);
  const pathId = simulatorId || "booted";
  const viewportSize = getAnnotationViewportSize(panel);
  const markerViewportPoint = {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
  return {
    id: commentId,
    type: "comment",
    origin: "browser",
    body,
    position: {
      side: "right",
      path: `browser:ios-simulator:${pathId}`,
      line: 1,
    },
    content: [{ content_type: "text", text: body }],
    localBrowserContext: {
      pageUrl: `ios-simulator://${pathId}`,
      framePath: ["iOS Simulator"],
      frameUrl: null,
      targetRole: annotationRole(item),
      targetSelector: item.AXUniqueId || null,
      targetPath: label,
      targetText: annotationText(item),
      targetName: annotationText(item) || label,
      targetDescription: `${label} in simulator ${pathId}`,
      nearbyText: annotationReference(item, simulatorId),
    },
    localBrowserCommentMetadata: {
      kind: "element",
      markerViewportPoint,
      viewportSize,
    },
    markerViewportPoint,
    localBrowserAttachedImages: [],
    attachedImages: [],
  };
}

function getAnnotationSimulatorId(panel) {
  return (
    panel.__codexppIosSimAnnotationDevice ||
    panel.__codexppIosSimMeta?.deviceUDID ||
    panel.__codexppIosSimMeta?.udid ||
    null
  );
}

function findActiveConversationId(panel) {
  const fromUrl = extractConversationIdFromUrl(window.location.href);
  if (fromUrl) return fromUrl;
  const composer = findComposerTextbox(panel);
  const composerShell = composer?.closest?.(
    'form, [data-testid*="composer" i], [class*="composer" i], main',
  );
  const roots = [
    composerShell,
    composer,
    document.querySelector('main [data-testid*="composer" i]'),
    document.querySelector('main [class*="composer" i]'),
  ].filter((root) => {
    if (!root) return false;
    if (root.closest?.('[data-app-shell-focus-area="right-panel"]')) return false;
    if (root.closest?.("nav, aside")) return false;
    return true;
  });
  for (const root of roots) {
    const id = findConversationIdInNode(root);
    if (id) return id;
  }
  return null;
}

function extractConversationIdFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of ["conversationId", "threadId"]) {
      const value = cleanConversationId(url.searchParams.get(key));
      if (value) return value;
    }
    const initialRoute = url.searchParams.get("initialRoute");
    if (initialRoute) {
      const nested = extractConversationIdFromUrl(new URL(initialRoute, url.origin).href);
      if (nested) return nested;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const value = cleanConversationId(decodeURIComponent(parts[i]));
      if (value) return value;
    }
  } catch {}
  return null;
}

function findConversationIdInNode(node) {
  const seen = new Set();
  const stack = [];
  for (let current = node; current; current = current.parentElement) {
    stack.push(...reactPayloadsForNode(current));
  }
  for (const payload of stack) {
    const id = findConversationIdInValue(payload, seen, 0);
    if (id) return id;
  }
  return null;
}

function reactPayloadsForNode(node) {
  if (!node || typeof node !== "object") return [];
  const payloads = [];
  for (const key of Object.keys(node)) {
    if (
      key.startsWith("__reactProps$") ||
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$")
    ) {
      payloads.push(node[key]);
    }
  }
  return payloads;
}

function findConversationIdInValue(value, seen, depth) {
  if (depth > 8 || value == null) return null;
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const directKeys = ["conversationId", "threadId", "localConversationId"];
  for (const key of directKeys) {
    const id = cleanConversationId(value[key]);
    if (id) return id;
  }
  const nestedKeys = ["memoizedProps", "pendingProps", "return", "child", "sibling", "stateNode", "props"];
  for (const key of nestedKeys) {
    const id = findConversationIdInValue(value[key], seen, depth + 1);
    if (id) return id;
  }
  if (depth >= 4) return null;
  for (const key of Object.keys(value).slice(0, 80)) {
    if (typeof value[key] === "function") continue;
    const id = findConversationIdInValue(value[key], seen, depth + 1);
    if (id) return id;
  }
  return null;
}

function cleanConversationId(value) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (id.length < 8 || id.length > 240) return null;
  if (/^(settings|login|thread-overlay|new|new-chat|new-conversation|undefined|null)$/i.test(id)) return null;
  if (/^(browser|ios-simulator|codexpp)$/i.test(id)) return null;
  if (/^(index|index\.html|local|app|host)$/i.test(id)) return null;
  if (/\.(html|js|css|map)$/i.test(id)) return null;
  return id;
}

function getAnnotationViewportSize(panel) {
  const meta = panel?.__codexppIosSimMeta || {};
  const width = Number(meta.pointWidth || meta.width || 390);
  const height = Number(meta.pointHeight || meta.height || 844);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 390,
    height: Number.isFinite(height) && height > 0 ? height : 844,
  };
}

function findComposerTextbox(panel) {
  const candidates = Array.from(
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'),
  ).filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.closest?.(`[${TWEAK_ATTR}]`)) return false;
    if (node.closest?.('[data-app-shell-focus-area="right-panel"]')) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const label = [
      node.getAttribute("aria-label"),
      node.getAttribute("placeholder"),
      node.getAttribute("data-placeholder"),
      node.textContent,
    ].filter(Boolean).join(" ");
    if (/url|address|search/i.test(label) && !/ask|message|prompt|codex|chat/i.test(label)) return false;
    return true;
  });
  candidates.sort((a, b) => composerScore(b, panel) - composerScore(a, panel));
  return candidates[0] || null;
}

function composerScore(node, panel) {
  const text = [
    node.getAttribute("aria-label"),
    node.getAttribute("placeholder"),
    node.getAttribute("data-placeholder"),
    node.getAttribute("name"),
  ].filter(Boolean).join(" ");
  let score = 0;
  if (/ask|message|prompt|codex|chat/i.test(text)) score += 100;
  if (node.matches("textarea")) score += 25;
  if (node.getAttribute("contenteditable") === "true") score += 20;
  const rect = node.getBoundingClientRect();
  if (rect.top > window.innerHeight * 0.55) score += 15;
  if (panel && rect.right < panel.getBoundingClientRect().left) score += 8;
  return score;
}

function writeTextToComposer(node, text) {
  node.focus({ preventScroll: true });
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")?.set;
    if (setter) setter.call(node, text);
    else node.value = text;
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const selection = window.getSelection?.();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges?.();
  selection?.addRange?.(range);
  if (!document.execCommand?.("insertText", false, text)) {
    node.textContent = text;
  }
  node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function flattenAnnotationAxItems(tree, dims) {
  const roots = Array.isArray(tree) ? tree : tree ? [tree] : [];
  const items = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const frame = normalizeAxFrame(node.frame || node.AXFrame);
    if (frame && shouldAnnotateAxNode(node, frame, dims)) {
      items.push({ ...node, frame });
      const labelTarget = syntheticTextTargetForNode(node, frame, dims);
      if (labelTarget) items.push(labelTarget);
    }
    for (const child of node.children || []) visit(child);
  };
  for (const root of roots) visit(root);
  items.sort(compareAnnotationPriority);
  return dedupeAnnotationItems(items);
}

function compareAnnotationPriority(a, b) {
  const roleDelta = annotationKindPriority(b) - annotationKindPriority(a);
  if (roleDelta) return roleDelta;
  return annotationArea(a) - annotationArea(b);
}

function compareAnnotationRenderOrder(a, b) {
  const areaDelta = annotationArea(b) - annotationArea(a);
  if (Math.abs(areaDelta) > 0.5) return areaDelta;
  return annotationKindPriority(a) - annotationKindPriority(b);
}

function annotationArea(item) {
  return Math.max(0, item?.frame?.width || 0) * Math.max(0, item?.frame?.height || 0);
}

function annotationKindPriority(item) {
  if (item?.__codexppSyntheticText) return 4;
  const role = annotationRole(item);
  if (/StaticText|Text|Label/i.test(role)) return 3;
  if (/TextField|Search/i.test(role)) return 2;
  if (/Button|Switch|Slider|Picker|Link/i.test(role)) return 1;
  return 0;
}

function annotationTargetZIndex(item) {
  return 20 + annotationKindPriority(item) * 10 + Math.max(0, 20 - Math.round(Math.sqrt(annotationArea(item))));
}

function dedupeAnnotationItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = [
      Math.round(item.frame.x),
      Math.round(item.frame.y),
      Math.round(item.frame.width),
      Math.round(item.frame.height),
      item.AXUniqueId || item.AXLabel || item.AXValue || item.role_description || item.type || "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function shouldAnnotateAxNode(node, frame, dims) {
  if (frame.width < 4 || frame.height < 4) return false;
  if (frame.x < -2 || frame.y < -2) return false;
  if (frame.x > dims.pointWidth || frame.y > dims.pointHeight) return false;
  const area = frame.width * frame.height;
  if (area > dims.pointWidth * dims.pointHeight * 0.82) return false;
  const role = String(node.type || node.role_description || node.role || "");
  if (/Application/i.test(role)) return false;
  const hasName = Boolean(node.AXUniqueId || node.AXLabel || node.AXValue || node.title);
  if (/Button|TextField|Switch|Cell|StaticText|Text|Label|Image|Link|Slider|Picker|Search/i.test(role)) return true;
  return hasName && area < dims.pointWidth * dims.pointHeight * 0.35;
}

function syntheticTextTargetForNode(node, frame, dims) {
  const label = annotationText(node);
  if (!label || label.length > 160) return null;
  const role = String(node.type || node.role_description || node.role || "");
  if (/StaticText|Text|Label|TextField|Search|Slider/i.test(role)) return null;
  if (hasTextLikeChild(node)) return null;

  const textFrame = estimateTextFrame(frame, label, dims);
  if (!textFrame) return null;
  return {
    ...node,
    type: "Text",
    role_description: "Text",
    AXLabel: label,
    AXUniqueId: node.AXUniqueId ? `${node.AXUniqueId}:label` : `${label}:label`,
    frame: textFrame,
    __codexppSyntheticText: true,
  };
}

function canDrilldownAnnotationItem(item) {
  if (!item?.frame) return false;
  if (item.__codexppSyntheticText || item.__codexppDrilldown) return false;
  const role = annotationRole(item);
  const area = annotationArea(item);
  const label = annotationText(item);
  if (!label || area < 2800) return false;
  if (!/StaticText|Text|Group|Button|Cell/i.test(role)) return false;
  return true;
}

function inferDrilldownAnnotationItems(panel, item, dims) {
  const frame = normalizeAxFrame(item.frame);
  if (!frame) return [];
  const realChildren = collectDrilldownChildItems(item, frame, dims);
  if (realChildren.length > 1) return realChildren;

  const labelParts = splitCombinedAccessibilityLabel(annotationText(item));
  if (shouldUseCompactVisualStackFallback(frame, labelParts)) {
    const visualItems = inferMirrorVisualStackItems(panel, item, frame, labelParts, dims);
    if (visualItems.length > 0) return visualItems;
    return inferCompactVisualStackItems(item, frame, labelParts, dims);
  }

  const children = [];
  const textParts = labelParts.length > 0 ? labelParts : [annotationText(item)];
  const wantsIcon = frame.height >= 96 && frame.width >= 96;
  const iconSize = wantsIcon
    ? Math.max(32, Math.min(72, frame.height * 0.22, frame.width * 0.28))
    : 0;
  const rowHeights = textParts.slice(0, 4).map((_, index) => (index === 0 ? 30 : 22));
  const iconGap = iconSize ? 14 : 0;
  const rowGap = textParts.length > 1 ? 8 : 0;
  const totalHeight =
    iconSize +
    iconGap +
    rowHeights.reduce((sum, height) => sum + height, 0) +
    rowGap * Math.max(0, Math.min(textParts.length, 4) - 1);
  let cursorY =
    frame.height >= 180
      ? frame.y + Math.max(8, (frame.height - totalHeight) / 2)
      : frame.y + Math.max(8, frame.height * 0.1);

  if (wantsIcon) {
    children.push(makeDrilldownAnnotationItem(item, {
      kind: "image",
      role: "Image",
      label: labelParts[0] ? `${labelParts[0]} image` : "Image",
      frame: clampFrame({
        x: frame.x + (frame.width - iconSize) / 2,
        y: cursorY,
        width: iconSize,
        height: iconSize,
      }, dims),
    }));
    cursorY += iconSize + iconGap;
  }

  textParts.slice(0, 4).forEach((part, index) => {
    const isPrimary = index === 0;
    const rowHeight = rowHeights[index] || 22;
    const width = Math.max(28, Math.min(frame.width - 12, part.length * (isPrimary ? 11.5 : 8.2) + 16));
    children.push(makeDrilldownAnnotationItem(item, {
      kind: isPrimary ? "title" : "text",
      role: "Text",
      label: part,
      frame: clampFrame({
        x: frame.x + Math.max(6, (frame.width - width) / 2),
        y: cursorY,
        width,
        height: rowHeight,
      }, dims),
    }));
    cursorY += rowHeight + rowGap;
  });

  return dedupeAnnotationItems(children);
}

function inferMirrorVisualStackItems(panel, item, frame, labelParts, dims) {
  const mirror = panel?.__codexppIosSimMirror;
  if (!(mirror instanceof HTMLImageElement)) return [];
  if (!mirror.complete || !mirror.naturalWidth || !mirror.naturalHeight) return [];

  let data;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = mirror.naturalWidth;
    canvas.height = mirror.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(mirror, 0, 0, canvas.width, canvas.height);
    const crop = frameToImageCrop(frame, dims, canvas.width, canvas.height);
    if (!crop) return [];
    data = {
      crop,
      image: ctx.getImageData(crop.x, crop.y, crop.width, crop.height),
    };
  } catch {
    return [];
  }

  const bands = foregroundBandsForImageData(data.image);
  if (bands.length < 2) return [];

  const items = [];
  const usefulBands = bands
    .filter((band) => band.width >= 8 && band.height >= 6 && band.pixels >= 18)
    .slice(0, Math.min(1 + labelParts.length, 5));
  if (usefulBands.length < 2) return [];

  const first = usefulBands[0];
  const firstLooksLikeIcon =
    first.height >= 24 &&
    first.width >= 24 &&
    first.height > usefulBands[Math.min(1, usefulBands.length - 1)].height * 1.35;
  const textBands = firstLooksLikeIcon ? usefulBands.slice(1) : usefulBands;

  if (firstLooksLikeIcon) {
    items.push(makeDrilldownAnnotationItem(item, {
      kind: "image",
      role: "Image",
      label: labelParts[0] ? `${labelParts[0]} image` : "Image",
      frame: imageBandToFrame(first, data.crop, dims, mirror.naturalWidth, mirror.naturalHeight, {
        minWidth: 32,
        minHeight: 32,
        padX: 5,
        padY: 5,
      }),
    }));
  }

  labelParts.slice(0, textBands.length).forEach((part, index) => {
    const band = textBands[index];
    if (!band) return;
    items.push(makeDrilldownAnnotationItem(item, {
      kind: index === 0 ? "title" : "text",
      role: "Text",
      label: part,
      frame: imageBandToFrame(band, data.crop, dims, mirror.naturalWidth, mirror.naturalHeight, {
        minWidth: index === 0 ? 44 : 36,
        minHeight: index === 0 ? 20 : 16,
        padX: index === 0 ? 7 : 5,
        padY: index === 0 ? 4 : 3,
      }),
    }));
  });

  return dedupeAnnotationItems(items);
}

function frameToImageCrop(frame, dims, imageWidth, imageHeight) {
  const x = Math.max(0, Math.floor((frame.x / dims.pointWidth) * imageWidth));
  const y = Math.max(0, Math.floor((frame.y / dims.pointHeight) * imageHeight));
  const right = Math.min(imageWidth, Math.ceil(((frame.x + frame.width) / dims.pointWidth) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil(((frame.y + frame.height) / dims.pointHeight) * imageHeight));
  const width = right - x;
  const height = bottom - y;
  if (width < 12 || height < 12) return null;
  return { x, y, width, height };
}

function foregroundBandsForImageData(imageData) {
  const { width, height, data } = imageData;
  const bg = sampleImageBackground(data, width, height);
  const rows = Array.from({ length: height }, () => ({
    count: 0,
    minX: width,
    maxX: -1,
  }));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (!isForegroundPixel(data, i, bg)) continue;
      const row = rows[y];
      row.count += 1;
      if (x < row.minX) row.minX = x;
      if (x > row.maxX) row.maxX = x;
    }
  }

  const activeThreshold = Math.max(2, Math.floor(width * 0.006));
  const maxGap = Math.max(5, Math.round(height * 0.026));
  const bands = [];
  let current = null;
  let gap = 0;

  rows.forEach((row, y) => {
    const active = row.count >= activeThreshold;
    if (active) {
      if (!current) {
        current = { minY: y, maxY: y, minX: row.minX, maxX: row.maxX, pixels: row.count };
      } else {
        current.maxY = y;
        current.minX = Math.min(current.minX, row.minX);
        current.maxX = Math.max(current.maxX, row.maxX);
        current.pixels += row.count;
      }
      gap = 0;
      return;
    }
    if (!current) return;
    gap += 1;
    if (gap <= maxGap) return;
    current.maxY -= gap;
    finishForegroundBand(current, bands);
    current = null;
    gap = 0;
  });
  if (current) {
    current.maxY -= gap;
    finishForegroundBand(current, bands);
  }

  return mergeNearbyForegroundBands(bands, width, height);
}

function sampleImageBackground(data, width, height) {
  const points = [
    [Math.floor(width * 0.08), Math.floor(height * 0.08)],
    [Math.floor(width * 0.92), Math.floor(height * 0.08)],
    [Math.floor(width * 0.08), Math.floor(height * 0.92)],
    [Math.floor(width * 0.92), Math.floor(height * 0.92)],
    [Math.floor(width * 0.5), Math.floor(height * 0.5)],
  ];
  const colors = points.map(([x, y]) => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  });
  colors.sort((a, b) => luminance(b) - luminance(a));
  return colors[0] || [255, 255, 255];
}

function luminance(color) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function isForegroundPixel(data, index, bg) {
  const alpha = data[index + 3];
  if (alpha < 180) return false;
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  const distance = Math.sqrt(dr * dr + dg * dg + db * db);
  if (distance < 34) return false;
  const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const bgLum = luminance(bg);
  return lum < bgLum - 16 || Math.max(r, g, b) - Math.min(r, g, b) > 28;
}

function finishForegroundBand(band, bands) {
  const width = band.maxX - band.minX + 1;
  const height = band.maxY - band.minY + 1;
  if (width <= 0 || height <= 0) return;
  bands.push({ ...band, width, height });
}

function mergeNearbyForegroundBands(bands, cropWidth, cropHeight) {
  const out = [];
  const joinGap = Math.max(7, Math.round(cropHeight * 0.035));
  for (const band of bands) {
    const prev = out[out.length - 1];
    if (
      prev &&
      band.minY - prev.maxY <= joinGap &&
      (Math.max(prev.width, band.width) >= cropWidth * 0.12 || Math.abs(centerOfBand(prev) - centerOfBand(band)) <= cropWidth * 0.26)
    ) {
      prev.maxY = Math.max(prev.maxY, band.maxY);
      prev.minX = Math.min(prev.minX, band.minX);
      prev.maxX = Math.max(prev.maxX, band.maxX);
      prev.pixels += band.pixels;
      prev.width = prev.maxX - prev.minX + 1;
      prev.height = prev.maxY - prev.minY + 1;
      continue;
    }
    out.push({ ...band });
  }
  return out.filter((band) => band.maxY > cropHeight * 0.04 && band.minY < cropHeight * 0.96);
}

function centerOfBand(band) {
  return band.minX + band.width / 2;
}

function imageBandToFrame(band, crop, dims, imageWidth, imageHeight, options = {}) {
  const padX = options.padX || 0;
  const padY = options.padY || 0;
  const minWidth = options.minWidth || 8;
  const minHeight = options.minHeight || 8;
  const x = crop.x + band.minX - padX;
  const y = crop.y + band.minY - padY;
  const width = Math.max(minWidth, band.width + padX * 2);
  const height = Math.max(minHeight, band.height + padY * 2);
  return clampFrame({
    x: (x / imageWidth) * dims.pointWidth,
    y: (y / imageHeight) * dims.pointHeight,
    width: (width / imageWidth) * dims.pointWidth,
    height: (height / imageHeight) * dims.pointHeight,
  }, dims);
}

function shouldUseCompactVisualStackFallback(frame, labelParts) {
  return (
    frame.width >= 120 &&
    frame.height >= 120 &&
    frame.height <= 260 &&
    labelParts.length >= 2 &&
    labelParts.length <= 3
  );
}

function inferCompactVisualStackItems(item, frame, labelParts, dims) {
  const children = [];
  const iconSize = Math.max(52, Math.min(68, frame.width * 0.34, frame.height * 0.42));
  const centerX = frame.x + frame.width / 2;

  children.push(makeDrilldownAnnotationItem(item, {
    kind: "image",
    role: "Image",
    label: labelParts[0] ? `${labelParts[0]} image` : "Image",
    frame: clampFrame({
      x: centerX - iconSize / 2 + frame.width * 0.018,
      y: frame.y + frame.height * 0.105,
      width: iconSize,
      height: iconSize,
    }, dims),
  }));

  labelParts.slice(0, 3).forEach((part, index) => {
    const isPrimary = index === 0;
    const rowHeight = isPrimary ? 36 : 21;
    const yRatio = isPrimary ? 0.56 : 0.82 + Math.max(0, index - 1) * 0.13;
    const width = Math.max(
      32,
      Math.min(
        dims.pointWidth - 12,
        isPrimary ? part.length * 13.4 + 30 : part.length * 7.8 + 18,
      ),
    );
    children.push(makeDrilldownAnnotationItem(item, {
      kind: isPrimary ? "title" : "text",
      role: "Text",
      label: part,
      frame: clampFrame({
        x: centerX - width / 2,
        y: frame.y + frame.height * yRatio,
        width,
        height: rowHeight,
      }, dims),
    }));
  });

  return dedupeAnnotationItems(children);
}

function collectDrilldownChildItems(item, parentFrame, dims) {
  const children = Array.isArray(item?.children) ? item.children : [];
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const frame = normalizeAxFrame(node.frame || node.AXFrame);
    const role = String(node.type || node.role_description || node.role || "");
    const label = annotationText(node);
    if (frame && isFrameInside(frame, parentFrame) && !sameFrame(frame, parentFrame)) {
      const hasUsableRole = /StaticText|Text|Label|Image|Button|Switch|Slider|Picker|Link/i.test(role);
      if (hasUsableRole && (label || /Image/i.test(role))) {
        out.push({
          ...node,
          AXLabel: label || `${annotationText(item) || "Element"} image`,
          frame: clampFrame(frame, dims),
          __codexppDrilldown: true,
          __codexppDrilldownKind: /Image/i.test(role) ? "image" : "child",
        });
      }
    }
    for (const child of node.children || []) visit(child);
  };
  for (const child of children) visit(child);
  return dedupeAnnotationItems(out)
    .filter((child) => annotationArea(child) >= 16)
    .sort(compareAnnotationVisualOrder)
    .slice(0, 8);
}

function compareAnnotationVisualOrder(a, b) {
  const topDelta = (a?.frame?.y || 0) - (b?.frame?.y || 0);
  if (Math.abs(topDelta) > 2) return topDelta;
  return (a?.frame?.x || 0) - (b?.frame?.x || 0);
}

function isFrameInside(frame, parentFrame) {
  return (
    frame.x >= parentFrame.x - 2 &&
    frame.y >= parentFrame.y - 2 &&
    frame.x + frame.width <= parentFrame.x + parentFrame.width + 2 &&
    frame.y + frame.height <= parentFrame.y + parentFrame.height + 2
  );
}

function sameFrame(a, b) {
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

function splitCombinedAccessibilityLabel(label) {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const helloWorld = text.match(/^(Hello,\s*world!),\s*(.+)$/i);
  if (helloWorld) return [helloWorld[1], helloWorld[2]].filter(Boolean);
  const parts = text.split(/,\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 2) return parts;
  return [parts.slice(0, -1).join(", "), parts[parts.length - 1]].filter(Boolean);
}

function makeDrilldownAnnotationItem(parent, options) {
  return {
    ...parent,
    type: options.role,
    role_description: options.role.toLowerCase(),
    AXLabel: options.label,
    AXValue: null,
    title: options.label,
    AXUniqueId: `${parent.AXUniqueId || annotationText(parent) || "element"}:${options.kind}`,
    frame: options.frame,
    __codexppDrilldown: true,
    __codexppDrilldownKind: options.kind,
  };
}

function hasTextLikeChild(node) {
  const children = Array.isArray(node?.children) ? node.children : [];
  return children.some((child) => {
    const role = String(child?.type || child?.role_description || child?.role || "");
    return /StaticText|Text|Label/i.test(role) && annotationText(child);
  });
}

function estimateTextFrame(frame, label, dims) {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const width = Math.max(12, Math.min(frame.width, trimmed.length * 7.2 + 10));
  const lineHeight = 18;

  if (frame.height >= 54 && frame.width <= 190) {
    const height = Math.min(24, Math.max(lineHeight, frame.height * 0.24));
    return clampFrame(
      {
        x: frame.x + Math.max(0, (frame.width - width) / 2),
        y: frame.y + frame.height - height,
        width,
        height,
      },
      dims,
    );
  }

  if (frame.height >= 24 && frame.height <= 88 && frame.width >= 90) {
    const height = Math.min(26, Math.max(lineHeight, frame.height * 0.45));
    return clampFrame(
      {
        x: frame.x + Math.min(16, Math.max(4, frame.width * 0.06)),
        y: frame.y + Math.max(0, (frame.height - height) / 2),
        width: Math.min(frame.width - 8, width),
        height,
      },
      dims,
    );
  }

  return null;
}

function clampFrame(frame, dims) {
  const x = Math.max(0, Math.min(frame.x, dims.pointWidth - 4));
  const y = Math.max(0, Math.min(frame.y, dims.pointHeight - 4));
  const width = Math.max(4, Math.min(frame.width, dims.pointWidth - x));
  const height = Math.max(4, Math.min(frame.height, dims.pointHeight - y));
  return { x, y, width, height };
}

function normalizeAxFrame(raw) {
  if (!raw) return null;
  if (typeof raw === "object") {
    const x = Number(raw.x ?? raw.left);
    const y = Number(raw.y ?? raw.top);
    const width = Number(raw.width ?? (Number(raw.right) - x));
    const height = Number(raw.height ?? (Number(raw.bottom) - y));
    if ([x, y, width, height].every(Number.isFinite)) return { x, y, width, height };
  }
  if (typeof raw === "string") {
    const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (nums.length >= 4) return { x: nums[0], y: nums[1], width: nums[2], height: nums[3] };
  }
  return null;
}

function getAxRootFrame(tree) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  return normalizeAxFrame(root?.frame || root?.AXFrame);
}

function annotationLabel(item) {
  const role = annotationRole(item);
  const name = annotationText(item) || item.AXUniqueId || "Unnamed";
  const id = item.AXUniqueId && item.AXUniqueId !== name ? ` · ${item.AXUniqueId}` : "";
  return `${name} (${role})${id}`;
}

function annotationRole(item) {
  return item.type || item.role_description || item.role || "Element";
}

function annotationText(item) {
  return String(item.AXLabel || item.title || item.AXValue || "").trim();
}

function annotationReference(item, simulatorId = null) {
  const frame = item.frame;
  const lines = [
    "iOS Simulator UI reference:",
    `- ${annotationLabel(item)}`,
    `- Simulator: ${simulatorId || "booted"}`,
    `- Frame: x=${Math.round(frame.x)}, y=${Math.round(frame.y)}, w=${Math.round(frame.width)}, h=${Math.round(frame.height)}`,
  ];
  return lines.join("\n");
}

// Build a popover dropdown listing every device, grouped by runtime.
async function openDevicePicker(panel, api) {
  api.log?.info?.("ios-sim openDevicePicker entry");
  // Toggle off if already open.
  const existing = document.querySelector(`[${TWEAK_ATTR}="device-popover"]`);
  if (existing) {
    api.log?.info?.("ios-sim openDevicePicker toggle-off");
    existing.remove();
    return;
  }
  const button = panel.__codexppIosSimDevicePickerButton;
  if (!button) {
    api.log?.warn?.("ios-sim openDevicePicker no button reference");
    return;
  }

  const res = await api.ipc.invoke("ios-sim:devices");
  api.log?.info?.("ios-sim openDevicePicker devices result", {
    ok: res?.ok,
    runtimeCount: Object.keys(res?.data?.devices || {}).length,
  });
  if (!res?.ok) {
    setStatus(panel, "simctl unavailable: " + (res?.error || res?.stderr || ""));
    return;
  }
  const runtimes = Object.keys(res.data?.devices || {})
    .filter((rt) => /iOS-/.test(rt))
    .sort()
    .reverse();

  const pop = document.createElement("div");
  pop.setAttribute(TWEAK_ATTR, "device-popover");
  pop.setAttribute("role", "menu");
  pop.tabIndex = -1;
  const br = button.getBoundingClientRect();
  pop.style.top = br.bottom + 4 + "px";
  pop.style.right = (window.innerWidth - br.right) + "px";

  const bootedCount = runtimes.reduce((count, rt) => {
    return count + (res.data.devices[rt] || []).filter((d) => d.state === "Booted").length;
  }, 0);
  const header = document.createElement("div");
  header.setAttribute(TWEAK_ATTR, "device-popover-header");
  const title = document.createElement("span");
  title.textContent = "iOS Simulators";
  const summary = document.createElement("span");
  summary.className = "text-xs text-token-text-tertiary";
  summary.textContent = bootedCount ? `${bootedCount} booted` : "None booted";
  header.append(title, summary);
  pop.appendChild(header);

  let anyShown = false;
  for (const rt of runtimes) {
    const list = (res.data.devices[rt] || []).filter((d) => d.isAvailable);
    if (!list.length) continue;
    anyShown = true;
    const runtimeHeader = document.createElement("div");
    runtimeHeader.setAttribute(TWEAK_ATTR, "device-runtime");
    runtimeHeader.textContent = formatRuntimeName(rt);
    pop.appendChild(runtimeHeader);

    const group = document.createElement("div");
    group.setAttribute(TWEAK_ATTR, "device-list");
    pop.appendChild(group);

    for (const d of list) {
      const booted = d.state === "Booted";
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.setAttribute(TWEAK_ATTR, "device-item");
      item.dataset.booted = booted ? "true" : "false";

      const check = document.createElement("span");
      check.className = "flex items-center justify-center";
      check.innerHTML = booted ? SVGS.check : "";

      const name = document.createElement("span");
      name.setAttribute(TWEAK_ATTR, "device-name");
      name.textContent = d.name;

      const state = document.createElement("span");
      state.setAttribute(TWEAK_ATTR, "device-state");
      state.dataset.booted = booted ? "true" : "false";
      state.textContent = booted ? "Booted" : d.state || "";

      item.append(check, name, state);
      item.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        api.log?.info?.("ios-sim picker item click", {
          udid: d.udid, name: d.name, state: d.state,
        });
        pop.remove();
        try {
          await selectDevice(panel, api, d);
        } catch (err) {
          api.log?.error?.("ios-sim selectDevice threw", String(err));
        }
      });
      group.appendChild(item);
    }
  }

  if (!anyShown) {
    const empty = document.createElement("div");
    empty.setAttribute(TWEAK_ATTR, "device-empty");
    empty.textContent = "No iOS simulators available.";
    pop.appendChild(empty);
  }

  document.body.appendChild(pop);
  api.log?.info?.("ios-sim openDevicePicker popover appended", {
    rect: pop.getBoundingClientRect().toJSON?.() || {
      x: pop.getBoundingClientRect().x,
      y: pop.getBoundingClientRect().y,
      w: pop.getBoundingClientRect().width,
      h: pop.getBoundingClientRect().height,
    },
    childCount: pop.children.length,
  });
  // Dismiss on outside click.
  const dismiss = (ev) => {
    if (pop.contains(ev.target) || button.contains(ev.target)) return;
    pop.remove();
    document.removeEventListener("mousedown", dismiss, true);
  };
  setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
}

function formatRuntimeName(runtime) {
  const raw = String(runtime || "")
    .replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, "");
  const ios = raw.match(/^iOS-(\d+)-(\d+)$/);
  if (ios) return `iOS ${ios[1]}.${ios[2]}`;
  return raw.replace(/-/g, " ");
}

async function selectDevice(panel, api, device) {
  api.log?.info?.("ios-sim selectDevice entry", {
    udid: device.udid, name: device.name, state: device.state,
  });
  // Re-check live state right now — the popover snapshot may be stale.
  const bootedNow = await currentBootedUDIDs(api);
  const isAlreadyBooted = bootedNow.includes(device.udid);
  api.log?.info?.("ios-sim selectDevice booted state", {
    bootedNow, isAlreadyBooted,
  });
  if (!isAlreadyBooted) {
    setStatus(panel, `Booting ${device.name}…`);
    // Shut down any other booted device first so capture targets the new one.
    for (const udid of bootedNow) {
      if (udid !== device.udid) {
        api.log?.info?.("ios-sim selectDevice shutdown", udid);
        const sr = await api.ipc.invoke("ios-sim:simctl", ["shutdown", udid]);
        api.log?.info?.("ios-sim selectDevice shutdown result", {
          udid, ok: sr?.ok, code: sr?.code,
          stderr: (sr?.stderr || "").slice(0, 400),
          stdout: (sr?.stdout || "").slice(0, 200),
        });
      }
    }
    api.log?.info?.("ios-sim selectDevice boot invoke", device.udid);
    const r = await api.ipc.invoke("ios-sim:simctl", ["boot", device.udid]);
    const stderr = (r?.stderr || "").trim();
    const benign = /code=405|current state: Booted/.test(stderr);
    api.log?.info?.("ios-sim selectDevice boot result", {
      ok: r?.ok, code: r?.code, benign,
      stderr: stderr.slice(0, 400),
      stdout: (r?.stdout || "").slice(0, 200),
    });
    if (!r?.ok && !benign) {
      setStatus(panel, `Boot failed: ${stderr || "unknown"}`);
      return;
    }
  }
  // Restart capture so it latches the (possibly new) booted device.
  api.log?.info?.("ios-sim selectDevice capture stop");
  const cs = await api.ipc.invoke("ios-sim:capture:stop");
  api.log?.info?.("ios-sim selectDevice capture stop result", { ok: cs?.ok });
  await new Promise((r) => setTimeout(r, 250));
  api.log?.info?.("ios-sim selectDevice capture start");
  const cst = await api.ipc.invoke("ios-sim:capture:start");
  api.log?.info?.("ios-sim selectDevice capture start result", { ok: cst?.ok });
  setStatus(panel, `Active: ${device.name}`);
  // Reflect the picked device in the picker label immediately.
  const button = panel.__codexppIosSimDevicePickerButton;
  const label = button?.querySelector(`[${TWEAK_ATTR}="device-picker-label"]`);
  if (label) label.textContent = device.name;
  api.log?.info?.("ios-sim selectDevice done", device.name);
}

async function currentBootedUDIDs(api) {
  const res = await api.ipc.invoke("ios-sim:devices");
  if (!res?.ok) return [];
  const out = [];
  for (const list of Object.values(res.data?.devices || {})) {
    for (const d of list || []) if (d.state === "Booted") out.push(d.udid);
  }
  return out;
}

// Boot a sensible default if nothing is booted. Called on panel open.
async function ensureBootedDevice(panel, api) {
  api.log?.info?.("ios-sim ensureBootedDevice entry");
  const res = await api.ipc.invoke("ios-sim:devices");
  if (!res?.ok) {
    api.log?.warn?.("ios-sim ensureBootedDevice devices failed", {
      error: res?.error, stderr: (res?.stderr || "").slice(0, 200),
    });
    return;
  }
  const allRuntimes = Object.keys(res.data?.devices || {}).filter((rt) =>
    /iOS-/.test(rt),
  );
  for (const rt of allRuntimes) {
    for (const d of res.data.devices[rt] || []) {
      if (d.state === "Booted" && d.isAvailable) {
        api.log?.info?.("ios-sim ensureBootedDevice already booted", {
          udid: d.udid, name: d.name, runtime: rt,
        });
        return;
      }
    }
  }
  // Pick newest iOS runtime, prefer iPhone 16/15/14 family.
  const iosRuntimes = allRuntimes.sort().reverse();
  let pick = null;
  outer: for (const rt of iosRuntimes) {
    const devs = (res.data.devices[rt] || []).filter((d) => d.isAvailable);
    for (const pat of [/iPhone 16/, /iPhone 15/, /iPhone 14/, /iPhone/]) {
      const m = devs.find((d) => pat.test(d.name));
      if (m) { pick = { ...m, runtime: rt }; break outer; }
    }
  }
  if (!pick) {
    api.log?.warn?.("ios-sim ensureBootedDevice no pick", { runtimes: iosRuntimes });
    return;
  }
  api.log?.info?.("ios-sim ensureBootedDevice picked", {
    udid: pick.udid, name: pick.name, runtime: pick.runtime,
  });
  setStatus(panel, `Booting ${pick.name}…`);
  const r = await api.ipc.invoke("ios-sim:simctl", ["boot", pick.udid]);
  const stderr = (r?.stderr || "").trim();
  const benign = /code=405|current state: Booted/.test(stderr);
  api.log?.info?.("ios-sim ensureBootedDevice boot result", {
    ok: r?.ok, code: r?.code, benign,
    stderr: stderr.slice(0, 400),
    stdout: (r?.stdout || "").slice(0, 200),
  });
  if (!r?.ok && !benign) {
    setStatus(panel, `Boot failed: ${stderr || "unknown"}`);
    return;
  }
  // Start capture immediately — the helper polls for the booted device state,
  // so we get frames as soon as IOSurface is ready (Apple-logo phase included).
  const cs = await api.ipc.invoke("ios-sim:capture:stop").catch((e) => ({ ok: false, error: String(e) }));
  api.log?.info?.("ios-sim ensureBootedDevice capture stop", { ok: cs?.ok });
  const cst = await api.ipc.invoke("ios-sim:capture:start").catch((e) => ({ ok: false, error: String(e) }));
  api.log?.info?.("ios-sim ensureBootedDevice capture start", { ok: cst?.ok });
  setStatus(panel, `Active: ${pick.name}`);
}

function makeDevicePickerButton(panel, api) {
  const b = document.createElement("button");
  b.type = "button";
  // Inherit toolbar-button CSS for size/padding/cursor/hover.
  b.setAttribute(TWEAK_ATTR, "toolbar-button");
  b.dataset.codexppIosSimRole = "device-picker";
  b.setAttribute("aria-label", "Choose device");
  b.setAttribute("title", "Choose device");
  const label = document.createElement("span");
  label.setAttribute(TWEAK_ATTR, "device-picker-label");
  label.textContent = "Device";
  label.style.maxWidth = "150px";
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";
  const chev = document.createElement("span");
  chev.className = "flex shrink-0 items-center justify-center";
  chev.innerHTML = SVGS.chevron;
  b.append(label, chev);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    api.log?.info?.("ios-sim picker clicked");
    openDevicePicker(panel, api).catch((err) =>
      api.log?.error?.("ios-sim openDevicePicker threw", String(err)),
    );
  });
  return b;
}

// Refresh device picker label from currently-booted device.
async function refreshDeviceLabel(panel, api) {
  const button = panel.__codexppIosSimDevicePickerButton;
  if (!button) return;
  const label = button.querySelector(`[${TWEAK_ATTR}="device-picker-label"]`);
  if (!label) return;
  const res = await api.ipc.invoke("ios-sim:devices");
  if (!res?.ok) return;
  for (const list of Object.values(res.data?.devices || {})) {
    for (const d of list || []) if (d.state === "Booted") {
      api.log?.info?.("ios-sim refreshDeviceLabel set", d.name);
      label.textContent = d.name;
      return;
    }
  }
  api.log?.info?.("ios-sim refreshDeviceLabel none booted");
  label.textContent = "Device";
}

function setStatus(panel, msg) {
  const placeholder = panel?.__codexppIosSimPlaceholder;
  if (!placeholder) return;
  let status = placeholder.querySelector(`[${TWEAK_ATTR}="status"]`);
  if (!status) {
    status = document.createElement("div");
    status.setAttribute(TWEAK_ATTR, "status");
    placeholder.appendChild(status);
  }
  status.textContent = msg;
}

// ── helpers ─────────────────────────────────────────────────────────────

function extractLabel(node) {
  return node.getAttribute("aria-label")?.trim() || compactText(node.textContent || "");
}

function matchesBrowserText(value) {
  return BROWSER_PATTERNS.some((pattern) => pattern.test(value));
}

function matchesMenuAnchorText(value) {
  return MENU_ANCHOR_PATTERNS.some((pattern) => pattern.test(value));
}

function compactText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function htmlToElement(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
