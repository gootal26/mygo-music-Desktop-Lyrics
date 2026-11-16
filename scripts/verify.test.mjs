import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("desktop_lyrics.ps1 contains strictly 7-bit ASCII characters and avoids csc.exe / DropShadowEffect", () => {
  const psPath = path.join(root, "desktop_lyrics.ps1");
  const content = fs.readFileSync(psPath, "utf8");
  const nonAscii = [...content].findIndex((ch) => ch.charCodeAt(0) > 0x7f);
  assert.equal(nonAscii, -1, `Found non-ASCII character at index ${nonAscii}`);
  assert.equal(content.includes('Add-Type @"'), false, "Must not invoke csc.exe via Add-Type C# block");
  assert.equal(content.includes("<DropShadowEffect"), false, "Must not use <DropShadowEffect> shader on layered window");
  assert.ok(content.includes("DefinePInvokeMethod"), "Should bind Win32 APIs via Reflection.Emit");
});

test("plugin.json and locales/zh-CN.json are valid and completely localized", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const zhCN = JSON.parse(fs.readFileSync(path.join(root, "locales", "zh-CN.json"), "utf8"));
  const indexSrc = fs.readFileSync(path.join(root, "index.js"), "utf8");

  assert.equal(manifest.id, "windows-desktop-lyrics");
  assert.ok(manifest.permissions.network.includes("music.163.com"));
  assert.ok(manifest.permissions.network.includes("lrclib.net"));
  assert.ok(manifest.permissions.process.includes("powershell"));

  for (const s of manifest.settings) {
    assert.ok(zhCN[s.label], `Missing zh-CN translation for setting label: ${s.label}`);
    if (s.help) {
      assert.ok(zhCN[s.help], `Missing zh-CN translation for setting help: ${s.help}`);
    }
    if (Array.isArray(s.options)) {
      const seen = new Set();
      for (const opt of s.options) {
        assert.ok(!seen.has(opt.value), `Duplicate option value ${opt.value} in ${s.key}`);
        seen.add(opt.value);
        assert.ok(zhCN[opt.label], `Missing zh-CN translation for option: ${opt.label}`);
      }
    }
  }

  const tCalls = [...indexSrc.matchAll(/\bt\((["'])((?:\\.|(?!\1).)*)\1\)/g)];
  assert.ok(tCalls.length > 0, "Expected t(...) localization calls in index.js");
  for (const m of tCalls) {
    const rawKey = m[2].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'");
    assert.ok(zhCN[rawKey], `Missing zh-CN translation for index.js key: ${rawKey}`);
  }
});

test("index.js IPC escaping, NetEase priority, LRCLIB fallback, and settings lifecycle", async () => {
  const written = [];
  let closed = false;
  let killed = false;
  const storageMap = new Map();
  const settingMap = new Map([
    ["enabled", "false"],
    ["onlineLyrics", "true"],
    ["lyricsSource", "auto"],
    ["simplifyChinese", "true"],
  ]);

  globalThis.host = {
    platform: "windows",
    dir: "C:\\Users\\test\\plugins\\desktop-lyrics",
    dataDir: "C:\\Users\\test\\data\\plugins\\desktop-lyrics",
    language: () => "zh-CN",
    t: (k) => k,
    setting: (k) => settingMap.get(k) ?? "",
    storage: {
      get: (k) => storageMap.get(k),
      set: (k, v) => storageMap.set(k, v),
      remove: (k) => storageMap.delete(k),
    },
    spawn: () => ({
      write: (chunk) => written.push(chunk),
      readLine: () => new Promise(() => {}),
      wait: () => Promise.resolve(0),
      closeStdin: () => {
        closed = true;
      },
      kill: () => {
        killed = true;
      },
    }),
  };

  globalThis.fetch = async (url) => {
    if (url.includes("music.163.com/api/search/get/web")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            songs: [
              { id: 111, name: "日落大道", artists: [{ name: "Other" }], album: { name: "Cover" }, duration: 180000 },
              { id: 222, name: "日落大道", artists: [{ name: "梁博" }], album: { name: "迷藏" }, duration: 275000 },
            ],
          },
        }),
      };
    }
    if (url.includes("music.163.com/api/song/lyric?id=222")) {
      return {
        ok: true,
        json: async () => ({
          lrc: { lyric: "[01:55.00]你看那金黄多耀眼" },
          tlyric: { lyric: "" },
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  const mod = await import(`../index.js?v=${Date.now()}`);

  let readQueueResolve = null;
  const readLineImpl = () =>
    new Promise((resolve) => {
      readQueueResolve = resolve;
    });

  let capturedArgs = null;
  globalThis.host.spawn = (_exe, args) => {
    capturedArgs = args;
    return {
      write: (chunk) => written.push(chunk),
      readLine: readLineImpl,
      wait: () => Promise.resolve(0),
      closeStdin: () => {
        closed = true;
        if (readQueueResolve) {
          const r = readQueueResolve;
          readQueueResolve = null;
          r(null);
        }
      },
      kill: () => {
        killed = true;
      },
    };
  };

  // Start via setSetting({ key: "enabled", value: "true" })
  mod.setSetting({ key: "enabled", value: "true" });
  assert.ok(Array.isArray(capturedArgs));
  assert.equal(capturedArgs.includes("-File"), false, "Must not hold -File lock inside host.dir");
  assert.ok(capturedArgs.includes("-Command"));
  const cmdStr = capturedArgs[capturedArgs.indexOf("-Command") + 1];
  assert.ok(cmdStr.includes("Set-Location -LiteralPath $env:TEMP"));
  assert.ok(cmdStr.includes("[scriptblock]::Create"));
  assert.equal(written.length, 1);
  // Config message must be strictly ASCII (\uXXXX escaped)
  assert.equal(/[^\x00-\x7f]/.test(written[0]), false, "Overlay stdin payload must be pure ASCII");
  const cfg = JSON.parse(written[0]);
  assert.equal(cfg.type, "config");
  assert.equal(cfg.simplifyChinese, true);
  assert.equal(cfg.backdropStyle, "subtle");
  assert.equal(cfg.uiLock, "锁定");

  // Simulate needLyrics request from PowerShell SMTC worker for "日落大道 - 梁博"
  assert.ok(readQueueResolve, "pumpOverlay should await proc.readLine()");
  const sendNeed = readQueueResolve;
  readQueueResolve = null;
  sendNeed(
    JSON.stringify({
      type: "needLyrics",
      id: "1|日落大道\0梁博\0迷藏",
      title: "日落大道",
      artist: "梁博",
      album: "迷藏",
      durationMs: 275000,
    }),
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(written.length, 2);
  assert.equal(/[^\x00-\x7f]/.test(written[1]), false, "Lyrics IPC response must be pure ASCII");
  const lyrReply = JSON.parse(written[1]);
  assert.equal(lyrReply.type, "lyrics");
  assert.equal(lyrReply.lrc, "[01:55.00]你看那金黄多耀眼");

  // Switching enabled to false must stop overlay immediately even if mock setting still returns "true"
  settingMap.set("enabled", "true");
  mod.setSetting({ key: "enabled", value: "false" });
  assert.equal(closed, true);
  assert.equal(killed, true);
  assert.equal(JSON.parse(written[2]).type, "stop");

  // Re-start via browse({ page: "start" }) and test home/reset-pos
  const startPage = mod.browse({ page: "start" });
  assert.equal(startPage.subtitle, "Status: Running");
  const homePage = mod.home();
  assert.equal(homePage.subtitle, "Status: Running");

  // Clean up spawned mock proc
  mod.browse({ page: "stop" });
});
