#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const CDP_LIST_URL = process.env.CDP_LIST_URL || "http://127.0.0.1:9222/json/list";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    i += 1;
  } else {
    args.set(key, "true");
  }
}

const limit = Number(args.get("limit") || 160);
const clickAria = args.get("click-aria") || "";
const clear = args.has("clear");
const simulator = args.has("simulator") || args.get("mode") === "simulator";
const axFile = args.get("ax-file") || "";
const axAll = args.has("ax-all");
const axLimit = Number(args.get("ax-limit") || 120);
const snapshot = args.has("snapshot");
const simulatorId = args.get("simulator-id") || "";
const watch = args.has("watch") || args.has("live");
const intervalMs = Number(args.get("interval-ms") || args.get("interval") || 750);

const cdp = await openCodexCdp();
try {
  if (clickAria) {
    await cdp.evaluate(
      `(async () => {
        const target = Array.from(document.querySelectorAll('[aria-label]'))
          .find((node) => (node.getAttribute('aria-label') || '').includes(${JSON.stringify(clickAria)}));
        if (!target) return { ok: false, error: 'No aria match' };
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { ok: true, label: target.getAttribute('aria-label') };
      })()`,
      { awaitPromise: true },
    );
  }

  if (watch && clear) {
    throw new Error("--watch and --clear do not make sense together");
  }

  if (watch) {
    cdp.close();
    while (true) {
      let loopCdp = null;
      try {
        loopCdp = await openCodexCdp();
        const result = await renderOverlay(loopCdp);
        console.log(JSON.stringify(summarizeResult(result)));
      } catch (error) {
        console.log(JSON.stringify({
          t: new Date().toISOString(),
          ok: false,
          mode: simulator ? "simulator" : "ui",
          first: [],
          error: error?.message || String(error),
        }));
      } finally {
        loopCdp?.close();
      }
      await sleep(intervalMs);
    }
  } else {
    const result = await renderOverlay(cdp);
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  if (!watch) cdp.close();
}

async function openCodexCdp() {
  const pages = await fetchJson(CDP_LIST_URL);
  const page =
    pages.find((entry) => entry.url?.startsWith("app://-/index.html")) ||
    pages.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);

  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Could not find a debuggable Codex page on port 9222");
  }
  return connectCdp(page.webSocketDebuggerUrl);
}

async function renderOverlay(cdp) {
  const axTree = simulator ? await resolveAxTree() : null;
  return cdp.evaluate(
    simulator
      ? buildSimulatorOverlayExpression({ clear, axTree, axAll, axLimit })
      : buildOverlayExpression({ limit, clear }),
    {
      awaitPromise: false,
      returnByValue: true,
    },
  );
}

async function resolveAxTree() {
  if (axFile) return parseAxPayload(await readFile(axFile, "utf8"));
  if (snapshot) return getAxSnapshot(simulatorId);
  return null;
}

function summarizeResult(result) {
  return {
    t: new Date().toISOString(),
    ok: result?.ok,
    mode: result?.mode,
    axCount: result?.axCount,
    first:
      result?.axItems?.slice?.(0, 5).map((item) => ({
        label: item.label,
        id: item.id,
        y: Math.round((item.frame?.y || 0) * 10) / 10,
      })) || [],
    error: result?.error,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(100, ms)));
}

function buildSimulatorOverlayExpression({ clear, axTree, axAll, axLimit }) {
  return `(() => {
    const OVERLAY_ID = '__codexpp_simulator_overlay';
    clearCodexppOverlays();
    if (${JSON.stringify(clear)}) return { cleared: true, mode: 'simulator' };

    const mirror =
      Array.from(document.querySelectorAll('[data-codexpp-ios-sim="mirror"], img[alt="iOS Simulator"]'))
        .find((img) => {
          if (!(img instanceof HTMLImageElement)) return false;
          const style = getComputedStyle(img);
          const rect = img.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || 1) > 0.01 &&
            rect.width > 0 &&
            rect.height > 0;
        });
    if (!(mirror instanceof HTMLImageElement)) {
      return { ok: false, mode: 'simulator', error: 'No visible simulator mirror image found' };
    }

    const panel = mirror.closest('[data-codexpp-ios-sim="tabpanel"]');
    const meta = panel?.__codexppIosSimMeta || null;
    const rect = mirror.getBoundingClientRect();
    const natural = {
      width: mirror.naturalWidth || meta?.pixelWidth || 0,
      height: mirror.naturalHeight || meta?.pixelHeight || 0
    };
    const pointSize = {
      width: meta?.pointWidth || (meta?.scale ? natural.width / meta.scale : 390),
      height: meta?.pointHeight || (meta?.scale ? natural.height / meta.scale : 844)
    };

    const axTree = ${JSON.stringify(axTree)};
    const axAll = ${JSON.stringify(axAll)};
    const axLimit = ${Number(axLimit)};

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      'position:fixed',
      'left:' + rect.left + 'px',
      'top:' + rect.top + 'px',
      'width:' + rect.width + 'px',
      'height:' + rect.height + 'px',
      'z-index:2147483647',
      'pointer-events:none',
      'box-sizing:border-box',
      'border:1px solid #38bdf8',
      'border-radius:' + getComputedStyle(mirror).borderRadius,
      'overflow:hidden',
      'font:11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace',
      'color:white',
      'text-shadow:0 1px 2px rgba(0,0,0,.7)'
    ].join(';');

    const add = (kind, style, text = '') => {
      const node = document.createElement('div');
      node.dataset.kind = kind;
      node.style.cssText = style;
      if (text) node.textContent = text;
      overlay.appendChild(node);
      return node;
    };

    const px = (x) => (x / pointSize.width) * rect.width;
    const py = (y) => (y / pointSize.height) * rect.height;

    add('grid-bg', [
      'position:absolute',
      'inset:0',
      'background-image:linear-gradient(rgba(56,189,248,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,.22) 1px, transparent 1px)',
      'background-size:' + (rect.width / 4) + 'px ' + (rect.height / 8) + 'px',
      'background-position:0 0'
    ].join(';'));

    const guides = [
      { label: 'top safe-ish', x: 0, y: 59, w: pointSize.width, h: 1, color: '#f59e0b' },
      { label: 'bottom safe-ish', x: 0, y: pointSize.height - 34, w: pointSize.width, h: 1, color: '#f59e0b' },
      { label: 'center x', x: pointSize.width / 2, y: 0, w: 1, h: pointSize.height, color: '#a78bfa' },
      { label: 'center y', x: 0, y: pointSize.height / 2, w: pointSize.width, h: 1, color: '#a78bfa' }
    ];
    for (const guide of guides) {
      add('guide', [
        'position:absolute',
        'left:' + px(guide.x) + 'px',
        'top:' + py(guide.y) + 'px',
        'width:' + Math.max(1, px(guide.w)) + 'px',
        'height:' + Math.max(1, py(guide.h)) + 'px',
        'background:' + guide.color,
        'opacity:.9'
      ].join(';'));
    }

    const targets = [
      { label: 'Home', x: pointSize.width / 2 - 48, y: pointSize.height - 34, w: 96, h: 22, color: '#34d399' },
      { label: 'Center', x: pointSize.width / 2 - 22, y: pointSize.height / 2 - 22, w: 44, h: 44, color: '#a78bfa' }
    ];
    for (const target of targets) {
      const box = add('target', [
        'position:absolute',
        'left:' + px(target.x) + 'px',
        'top:' + py(target.y) + 'px',
        'width:' + px(target.w) + 'px',
        'height:' + py(target.h) + 'px',
        'border:1px solid ' + target.color,
        'background:color-mix(in srgb, ' + target.color + ' 13%, transparent)',
        'box-sizing:border-box',
        'border-radius:5px'
      ].join(';'));
      const label = document.createElement('div');
      label.textContent = target.label;
      label.style.cssText = [
        'position:absolute',
        'left:4px',
        'top:3px',
        'padding:1px 4px',
        'border-radius:4px',
        'background:' + target.color,
        'color:#020617',
        'text-shadow:none'
      ].join(';');
      box.appendChild(label);
    }

    const axItems = flattenAxTree(axTree)
      .filter((item) => item.frame && item.frame.width > 1 && item.frame.height > 1)
      .filter((item) => axAll || isTouchCandidate(item))
      .slice(0, axLimit);

    axItems.forEach((item, index) => {
      const frame = item.frame;
      const color = colorForAxItem(item);
      const labelText = axLabelForItem(item, index + 1);
      const box = add('ax-target', [
        'position:absolute',
        'left:' + px(frame.x) + 'px',
        'top:' + py(frame.y) + 'px',
        'width:' + px(frame.width) + 'px',
        'height:' + py(frame.height) + 'px',
        'border:1.5px solid ' + color,
        'background:color-mix(in srgb, ' + color + ' 16%, transparent)',
        'box-sizing:border-box',
        'border-radius:4px'
      ].join(';'));
      box.title = [
        item.type || item.role || 'AXElement',
        item.AXLabel ? 'label=' + item.AXLabel : '',
        item.AXUniqueId ? 'id=' + item.AXUniqueId : '',
        item.AXValue ? 'value=' + item.AXValue : '',
        item.role_description ? 'role_description=' + item.role_description : '',
        item.enabled === false ? 'disabled' : ''
      ].filter(Boolean).join('\\n');

      const label = document.createElement('div');
      label.textContent = labelText.length > 90 ? labelText.slice(0, 87) + '...' : labelText;
      label.style.cssText = [
        'position:absolute',
        'left:3px',
        'top:3px',
        'max-width:calc(100% - 6px)',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
        'padding:1px 4px',
        'border-radius:4px',
        'background:' + color,
        'color:#020617',
        'text-shadow:none'
      ].join(';');
      box.appendChild(label);
    });

    const points = [
      [0, 0],
      [pointSize.width / 2, 0],
      [pointSize.width, 0],
      [0, pointSize.height / 2],
      [pointSize.width / 2, pointSize.height / 2],
      [pointSize.width, pointSize.height / 2],
      [0, pointSize.height],
      [pointSize.width / 2, pointSize.height],
      [pointSize.width, pointSize.height]
    ];
    for (const [x, y] of points) {
      const clampedX = Math.min(Math.max(px(x), 0), rect.width - 1);
      const clampedY = Math.min(Math.max(py(y), 0), rect.height - 1);
      add('point', [
        'position:absolute',
        'left:' + clampedX + 'px',
        'top:' + clampedY + 'px',
        'width:5px',
        'height:5px',
        'margin-left:-2.5px',
        'margin-top:-2.5px',
        'border-radius:999px',
        'background:#38bdf8',
        'box-shadow:0 0 0 1px rgba(2,6,23,.8)'
      ].join(';'));
    }

    const badge = add('badge', [
      'position:absolute',
      'left:8px',
      'bottom:8px',
      'padding:4px 6px',
      'border-radius:6px',
      'background:rgba(2,6,23,.72)',
      'border:1px solid rgba(255,255,255,.18)',
      'backdrop-filter:blur(8px)'
    ].join(';'));
    badge.textContent =
      Math.round(pointSize.width) + 'x' + Math.round(pointSize.height) + 'pt' +
      ' / ' + Math.round(natural.width) + 'x' + Math.round(natural.height) + 'px' +
      ' / view ' + Math.round(rect.width) + 'x' + Math.round(rect.height) +
      (axItems.length ? ' / AX ' + axItems.length : '');

    document.body.appendChild(overlay);
    return {
      ok: true,
      mode: 'simulator',
      mirrorRect: {
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      },
      pointSize,
      natural,
      meta,
      axCount: axItems.length,
      axItems: axItems.map((item, index) => ({
        index: index + 1,
        role: item.role,
        type: item.type,
        label: item.AXLabel || item.title || null,
        value: item.AXValue || null,
        id: item.AXUniqueId || null,
        frame: item.frame
      }))
    };

    function flattenAxTree(root) {
      const out = [];
      const stack = Array.isArray(root) ? [...root] : root ? [root] : [];
      while (stack.length) {
        const node = stack.shift();
        if (!node || typeof node !== 'object') continue;
        out.push(node);
        if (Array.isArray(node.children)) stack.unshift(...node.children);
      }
      return out;
    }

    function isTouchCandidate(item) {
      if (item.enabled === false) return false;
      const role = String(item.role || item.role_description || item.type || '');
      const frame = item.frame || {};
      if (/Application/i.test(role)) return false;
      if (/Group/i.test(role) && /^Toolbar$/i.test(String(item.AXUniqueId || item.AXLabel || ""))) {
        return false;
      }
      if (
        frame.width >= pointSize.width * 0.95 &&
        frame.height >= pointSize.height * 0.85 &&
        !/Button|TextField|SearchField|Switch|Link|Cell|Control|Menu|Slider|Stepper|Tab|Image|Row/i.test(role)
      ) {
        return false;
      }
      const hasIdentifier = Boolean(item.AXUniqueId);
      const actionable =
        /Button|TextField|SearchField|Switch|Link|Cell|Control|Menu|Slider|Stepper|Tab|Image|Row/i.test(role);
      return hasIdentifier || actionable;
    }

    function colorForAxItem(item) {
      const role = String(item.role || item.type || item.role_description || '');
      if (/Button/i.test(role)) return '#34d399';
      if (/TextField|SearchField/i.test(role)) return '#38bdf8';
      if (/Cell|StaticText/i.test(role) && item.AXUniqueId) return '#f59e0b';
      if (/Image/i.test(role)) return '#fb7185';
      return '#a78bfa';
    }

    function axLabelForItem(item, index) {
      const name = item.AXLabel || item.title || item.AXValue || item.role_description || item.type || item.role || 'element';
      const id = item.AXUniqueId ? ' · ' + item.AXUniqueId : '';
      const role = item.type || item.role_description || item.role || 'AX';
      return index + ' ' + String(name) + id + ' · ' + role;
    }

    function clearCodexppOverlays() {
      document.getElementById('__codexpp_simulator_overlay')?.remove();
      document.getElementById('__codexpp_ui_dump_overlay')?.remove();
    }
  })()`;
}

function buildOverlayExpression({ limit, clear }) {
  return `(() => {
    const OVERLAY_ID = '__codexpp_ui_dump_overlay';
    document.getElementById('__codexpp_ui_dump_overlay')?.remove();
    document.getElementById('__codexpp_simulator_overlay')?.remove();
    if (${JSON.stringify(clear)}) return { cleared: true, items: [] };

    const selectors = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role]',
      '[aria-label]',
      '[data-radix-popper-content-wrapper]',
      '[data-side][data-align]',
      '[data-app-shell-tab-controller]',
      '[data-codexpp-ios-sim]'
    ].join(',');

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    const raw = Array.from(document.querySelectorAll(selectors))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => !node.closest('#' + OVERLAY_ID))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const label =
          node.getAttribute('aria-label') ||
          node.getAttribute('title') ||
          node.getAttribute('role') ||
          (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90) ||
          node.tagName.toLowerCase();
        return {
          node,
          rect,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < viewport.width &&
            rect.top < viewport.height &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity || 1) > 0.01,
          data: {
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute('role'),
            aria: node.getAttribute('aria-label'),
            tweak: node.getAttribute('data-codexpp-ios-sim'),
            text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
            label,
            className: String(node.className || ''),
            rect: {
              x: Math.round(rect.x * 10) / 10,
              y: Math.round(rect.y * 10) / 10,
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10
            },
            style: {
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
              fontWeight: style.fontWeight,
              color: style.color,
              backgroundColor: style.backgroundColor,
              border: style.border,
              borderRadius: style.borderRadius,
              padding: style.padding,
              boxShadow: style.boxShadow
            }
          }
        };
      })
      .filter((entry) => entry.visible)
      .sort((a, b) => (a.rect.top - b.rect.top) || (a.rect.left - b.rect.left));

    const deduped = [];
    const seen = new Set();
    for (const entry of raw) {
      const key = [
        Math.round(entry.rect.x),
        Math.round(entry.rect.y),
        Math.round(entry.rect.width),
        Math.round(entry.rect.height),
        entry.data.label
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
      if (deduped.length >= ${Number(limit)}) break;
    }

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'pointer-events:none',
      'font:11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace'
    ].join(';');

    const colors = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#fb7185'];
    deduped.forEach((entry, index) => {
      const color = colors[index % colors.length];
      const box = document.createElement('div');
      box.style.cssText = [
        'position:fixed',
        'left:' + entry.rect.left + 'px',
        'top:' + entry.rect.top + 'px',
        'width:' + entry.rect.width + 'px',
        'height:' + entry.rect.height + 'px',
        'border:1px solid ' + color,
        'background:color-mix(in srgb, ' + color + ' 10%, transparent)',
        'box-sizing:border-box',
        'border-radius:3px'
      ].join(';');

      const tag = document.createElement('div');
      const label = String(index + 1) + ' ' + entry.data.label;
      tag.textContent = label.length > 42 ? label.slice(0, 39) + '...' : label;
      tag.style.cssText = [
        'position:absolute',
        'left:0',
        'top:-16px',
        'max-width:260px',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
        'padding:1px 4px',
        'border-radius:3px',
        'color:#020617',
        'background:' + color,
        'box-shadow:0 1px 3px rgba(0,0,0,.25)'
      ].join(';');
      box.appendChild(tag);
      overlay.appendChild(box);
      entry.data.index = index + 1;
    });

    document.body.appendChild(overlay);
    return {
      viewport,
      count: deduped.length,
      items: deduped.map((entry) => entry.data)
    };
  })()`;
}

function getAxSnapshot(simulatorId) {
  const resolvedSimulatorId = simulatorId || findBootedSimulatorId();
  if (!resolvedSimulatorId) {
    throw new Error("No booted simulator found. Pass --simulator-id <UUID>.");
  }
  const output = execFileSync(
    "npx",
    [
      "-y",
      "xcodebuildmcp@latest",
      "ui-automation",
      "snapshot-ui",
      "--simulator-id",
      resolvedSimulatorId,
      "--output",
      "json",
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  return parseAxPayload(output);
}

function findBootedSimulatorId() {
  const output = execFileSync("xcrun", ["simctl", "list", "devices", "--json"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const devices = JSON.parse(output).devices || {};
  for (const list of Object.values(devices)) {
    for (const device of list || []) {
      if (device.state === "Booted" && device.udid) return device.udid;
    }
  }
  return "";
}

function parseAxPayload(raw) {
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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function connectCdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  return {
    evaluate(expression, options = {}) {
      return new Promise((resolve, reject) => {
        const callId = ++id;
        pending.set(callId, { resolve, reject });
        ws.send(JSON.stringify({
          id: callId,
          method: "Runtime.evaluate",
          params: {
            expression,
            awaitPromise: Boolean(options.awaitPromise),
            returnByValue: options.returnByValue !== false,
          },
        }));
      }).then((message) => {
        if (message.result?.exceptionDetails) {
          throw new Error(message.result.exceptionDetails.text || "Runtime.evaluate failed");
        }
        return message.result?.result?.value;
      });
    },
    close() {
      ws.close();
    },
  };
}
