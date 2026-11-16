const t = host.t;

let overlayProc = null;
let overlayError = "";
let pumpGeneration = 0;
const lyricsCache = new Map();

function boolSetting(key, fallback = false) {
  const v = host.setting(key);
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function intSetting(key, fallback = 0) {
  const v = Number.parseInt(host.setting(key), 10);
  return Number.isFinite(v) ? v : fallback;
}

function isEnabled() {
  const settingVal = host.setting("enabled");
  if (settingVal === "true") return true;
  if (settingVal === "false") return false;
  return host.storage.get("manualActive") === true;
}

function isLocked() {
  const override = host.storage.get("lockedOverride");
  if (typeof override === "boolean") return override;
  return boolSetting("locked", false);
}

function toAsciiJson(obj) {
  return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (ch) => {
    return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

function currentConfig() {
  const lang = host.language();
  const simplifyDefault = lang === "zh-CN";
  return {
    type: "config",
    locked: isLocked(),
    onlineLyrics: boolSetting("onlineLyrics", true),
    lyricsSource: host.setting("lyricsSource") || "auto",
    simplifyChinese: boolSetting("simplifyChinese", simplifyDefault),
    showTranslation: boolSetting("showTranslation", true),
    offsetMs: intSetting("lyricsOffset", 0),
    fontSize: host.setting("fontSize") || "medium",
    position: host.setting("position") || "bottom",
    accentColor: host.setting("accentColor") || "coral",
    backdropStyle: host.setting("backdropStyle") || "subtle",
    localDirs: host.setting("localDirs") || "",
    lang,
    uiLock: lang === "zh-CN" ? "\u9501\u5b9a" : "Lock",
    uiWait: lang === "zh-CN" ? "MyGo Music \u00b7 \u7b49\u5f85\u64ad\u653e" : "MyGo Music \u00b7 Waiting for playback",
  };
}

function sendToOverlay(payload) {
  if (!overlayProc) return false;
  try {
    overlayProc.write(toAsciiJson(payload) + "\n");
    return true;
  } catch (err) {
    console.warn("failed to write to overlay:", err);
    return false;
  }
}

function stopOverlay() {
  pumpGeneration++;
  const proc = overlayProc;
  overlayProc = null;
  if (!proc) return;
  try {
    proc.write(toAsciiJson({ type: "stop" }) + "\n");
  } catch (_) {}
  try {
    proc.closeStdin();
  } catch (_) {}
  try {
    proc.kill();
  } catch (_) {}
}

function normText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\s\-_'"`.,!?;:()\[\]{}\uff08\uff09\u3010\u3011]+/g, " ")
    .trim();
}

function scoreCandidate(candTitle, candArtists, candAlbum, candDurMs, targetTitle, targetArtist, targetAlbum, targetDurMs) {
  let score = 0;
  const nt = normText(candTitle);
  const tt = normText(targetTitle);
  if (nt && tt) {
    if (nt === tt) score += 40;
    else if (nt.includes(tt) || tt.includes(nt)) score += 18;
  }

  const ta = normText(targetArtist);
  if (ta) {
    const artistList = Array.isArray(candArtists) ? candArtists : [candArtists];
    const joined = normText(artistList.join(" "));
    if (joined === ta) score += 35;
    else if (joined.includes(ta) || ta.includes(joined)) score += 20;
  }

  const tal = normText(targetAlbum);
  const cal = normText(candAlbum);
  if (tal && cal && (cal === tal || cal.includes(tal) || tal.includes(cal))) {
    score += 12;
  }

  if (targetDurMs > 0 && candDurMs > 0) {
    const diffSec = Math.abs(candDurMs - targetDurMs) / 1000;
    if (diffSec <= 2) score += 35;
    else if (diffSec <= 5) score += 22;
    else if (diffSec <= 12) score += 8;
    else score -= Math.min(40, Math.round(diffSec));
  }
  return score;
}

async function fetchFromNetease(title, artist, album, durationMs) {
  const cleanTitle = (title || "").trim();
  const cleanArtist = (artist || "").trim();
  if (!cleanTitle) return { lrc: "", tlyric: "", plain: "" };

  try {
    const q = `${cleanTitle} ${cleanArtist}`.trim();
    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(q)}&type=1&offset=0&limit=8`;
    const res = await fetch(searchUrl, {
      headers: {
        Accept: "application/json",
        Referer: "https://music.163.com/",
      },
    });
    if (!res.ok) return { lrc: "", tlyric: "", plain: "" };
    const data = await res.json();
    const songs = data && data.result && Array.isArray(data.result.songs) ? data.result.songs : [];
    if (songs.length === 0) return { lrc: "", tlyric: "", plain: "" };

    let bestSong = songs[0];
    let bestScore = -9999;
    for (const s of songs) {
      const artists = Array.isArray(s.artists) ? s.artists.map((a) => a.name || "") : [];
      const alb = s.album ? s.album.name || "" : "";
      const sc = scoreCandidate(s.name, artists, alb, s.duration || 0, cleanTitle, cleanArtist, album, durationMs);
      if (sc > bestScore) {
        bestScore = sc;
        bestSong = s;
      }
    }

    const lyrRes = await fetch(`https://music.163.com/api/song/lyric?id=${bestSong.id}&lv=1&tv=1`, {
      headers: {
        Accept: "application/json",
        Referer: "https://music.163.com/",
      },
    });
    if (!lyrRes.ok) return { lrc: "", tlyric: "", plain: "" };
    const lyrData = await lyrRes.json();
    const lrc = (lyrData && lyrData.lrc && lyrData.lrc.lyric) || "";
    const tlyric = (lyrData && lyrData.tlyric && lyrData.tlyric.lyric) || "";
    if (/\[\d+:\d+/.test(lrc)) {
      return { lrc, tlyric, plain: "" };
    }
    return { lrc: "", tlyric: "", plain: lrc };
  } catch (err) {
    console.warn("netease lyric fetch failed:", err);
    return { lrc: "", tlyric: "", plain: "" };
  }
}

async function fetchFromLrclib(title, artist, album, durationMs) {
  const cleanTitle = (title || "").trim();
  const cleanArtist = (artist || "").trim();
  if (!cleanTitle) return { lrc: "", tlyric: "", plain: "" };

  try {
    const params = [`track_name=${encodeURIComponent(cleanTitle)}`];
    if (cleanArtist) params.push(`artist_name=${encodeURIComponent(cleanArtist)}`);
    if (album && album.trim()) params.push(`album_name=${encodeURIComponent(album.trim())}`);
    if (durationMs > 0) params.push(`duration=${Math.round(durationMs / 1000)}`);

    const res = await fetch(`https://lrclib.net/api/get?${params.join("&")}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.syncedLyrics) {
        return { lrc: data.syncedLyrics, tlyric: "", plain: data.plainLyrics || "" };
      }
    }
  } catch (err) {
    console.warn("lrclib get failed:", err);
  }

  try {
    const q = `${cleanTitle} ${cleanArtist}`.trim();
    const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const items = await res.json();
      if (Array.isArray(items) && items.length > 0) {
        let best = null;
        let bestScore = -9999;
        for (const item of items) {
          if (!item) continue;
          let sc = scoreCandidate(
            item.trackName || item.name || "",
            item.artistName || "",
            item.albumName || "",
            (item.duration || 0) * 1000,
            cleanTitle,
            cleanArtist,
            album,
            durationMs,
          );
          if (item.syncedLyrics) sc += 60;
          else if (item.plainLyrics) sc += 10;
          if (sc > bestScore) {
            bestScore = sc;
            best = item;
          }
        }
        if (best) {
          return {
            lrc: best.syncedLyrics || "",
            tlyric: "",
            plain: best.plainLyrics || "",
          };
        }
      }
    }
  } catch (err) {
    console.warn("lrclib search failed:", err);
  }
  return { lrc: "", tlyric: "", plain: "" };
}

async function fetchOnlineLyrics(title, artist, album, durationMs) {
  const cleanTitle = (title || "").trim();
  const cleanArtist = (artist || "").trim();
  if (!cleanTitle) return { lrc: "", tlyric: "", plain: "" };

  const sourceMode = host.setting("lyricsSource") || "auto";
  const cacheKey = `${sourceMode}\0${cleanTitle}\0${cleanArtist}\0${(album || "").trim()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  let result = { lrc: "", tlyric: "", plain: "" };
  if (sourceMode === "netease") {
    result = await fetchFromNetease(cleanTitle, cleanArtist, album, durationMs);
  } else if (sourceMode === "lrclib") {
    result = await fetchFromLrclib(cleanTitle, cleanArtist, album, durationMs);
  } else {
    const ne = await fetchFromNetease(cleanTitle, cleanArtist, album, durationMs);
    if (ne.lrc) {
      result = ne;
    } else {
      const lr = await fetchFromLrclib(cleanTitle, cleanArtist, album, durationMs);
      if (lr.lrc) result = lr;
      else result = ne.plain ? ne : lr;
    }
  }

  lyricsCache.set(cacheKey, result);
  return result;
}

async function handleOverlayMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "needLyrics") {
    if (!boolSetting("onlineLyrics", true)) {
      sendToOverlay({ type: "lyrics", id: msg.id, lrc: "", tlyric: "", plain: "" });
      return;
    }
    const found = await fetchOnlineLyrics(msg.title, msg.artist, msg.album, msg.durationMs || 0);
    sendToOverlay({
      type: "lyrics",
      id: msg.id,
      lrc: found.lrc,
      tlyric: found.tlyric,
      plain: found.plain,
    });
  } else if (msg.type === "lockChanged") {
    host.storage.set("lockedOverride", Boolean(msg.locked));
  } else if (msg.type === "closedByUser") {
    host.storage.set("manualActive", false);
    stopOverlay();
  }
}

async function pumpOverlay(proc, gen) {
  try {
    while (gen === pumpGeneration && overlayProc === proc) {
      const line = await proc.readLine();
      if (line === null) break;
      const trimmed = line.trim();
      if (!trimmed || trimmed[0] !== "{") continue;
      try {
        const msg = JSON.parse(trimmed);
        handleOverlayMessage(msg);
      } catch (err) {
        console.warn("invalid overlay message:", trimmed, err);
      }
    }
    const code = await proc.wait();
    if (gen === pumpGeneration && overlayProc === proc) {
      overlayProc = null;
      if (code !== 0) {
        const detail = proc.errorOutput ? proc.errorOutput().trim() : "";
        overlayError = detail || `Exited with code ${code}`;
      }
    }
  } catch (err) {
    if (gen === pumpGeneration && overlayProc === proc) {
      overlayProc = null;
      overlayError = String((err && err.message) || err);
    }
  }
}

function psQuote(s) {
  return `'${String(s || "").replace(/'/g, "''")}'`;
}

function startOverlay() {
  if (host.platform !== "windows") {
    overlayError = "Windows only";
    return false;
  }
  if (overlayProc) {
    sendToOverlay(currentConfig());
    return true;
  }
  overlayError = "";
  const scriptPath = `${host.dir}\\desktop_lyrics.ps1`;
  const bootstrapCmd = [
    "Set-Location -LiteralPath $env:TEMP",
    `$p=${psQuote(scriptPath)}`,
    "$c=[System.IO.File]::ReadAllText($p,[System.Text.Encoding]::UTF8)",
    `& ([scriptblock]::Create($c)) -DataDir ${psQuote(host.dataDir)} -Lang ${psQuote(host.language())}`,
  ].join("; ");
  try {
    const proc = host.spawn("powershell.exe", [
      "-NoProfile",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-Sta",
      "-Command",
      bootstrapCmd,
    ]);
    overlayProc = proc;
    const gen = ++pumpGeneration;
    sendToOverlay(currentConfig());
    pumpOverlay(proc, gen);
    return true;
  } catch (err) {
    overlayProc = null;
    overlayError = String((err && err.message) || err);
    return false;
  }
}

function syncState() {
  if (host.platform !== "windows") return;
  if (isEnabled()) {
    startOverlay();
  } else {
    stopOverlay();
  }
}

function statusSubtitle() {
  if (host.platform !== "windows") {
    return t("Windows Only");
  }
  if (overlayProc) {
    return t("Status: Running");
  }
  if (overlayError && overlayError.toLowerCase().includes("allowed")) {
    return t("Status: Waiting for permission");
  }
  return t("Status: Stopped");
}

function buildStatusPage(message) {
  const isWin = host.platform === "windows";
  const descLines = [
    t("This plugin creates a native Windows floating lyrics window and reads playback info via Windows SMTC."),
  ];
  if (message) {
    descLines.push(message);
  } else if (overlayError) {
    descLines.push(
      overlayError.toLowerCase().includes("allowed")
        ? t('Please open Settings > Plugins and click "Allow Programs" for Desktop Lyrics first.')
        : overlayError,
    );
  }

  return {
    title: t("Windows Desktop Lyrics"),
    subtitle: statusSubtitle(),
    description: descLines.join("\n"),
    sections: [
      {
        title: t("Quick Controls"),
        links: isWin
          ? [
              {
                title: t("Enable / Restart Desktop Lyrics"),
                subtitle: t("Start the floating desktop lyrics bar on Windows"),
                page: "start",
              },
              {
                title: t("Disable Desktop Lyrics"),
                subtitle: t("Close the floating desktop lyrics bar"),
                page: "stop",
              },
              {
                title: t("Toggle Click-Through Lock"),
                subtitle: t("Switch between draggable mode and click-through locked mode"),
                page: "toggle-lock",
              },
              {
                title: t("Reset Window Position"),
                subtitle: t("Move the lyrics bar back to its default screen position"),
                page: "reset-pos",
              },
            ]
          : [],
        empty: t("Windows Only"),
      },
      {
        title: t("How it works"),
        empty: t(
          '1. Allow this plugin to run powershell in Settings > Plugins.\n2. Toggle "Enable Desktop Lyrics" in Settings, or click "Enable / Restart Desktop Lyrics" below.\n3. Plays your local songs or plugin tracks — lyrics match local .lrc files first, then NetEase / LRCLIB if enabled.',
        ),
      },
    ],
  };
}

export function home() {
  syncState();
  return buildStatusPage("");
}

export function browse({ page }) {
  if (page === "start") {
    host.storage.set("manualActive", true);
    stopOverlay();
    const ok = startOverlay();
    return buildStatusPage(ok ? t("Desktop lyrics started.") : "");
  }
  if (page === "stop") {
    host.storage.set("manualActive", false);
    stopOverlay();
    return buildStatusPage(t("Desktop lyrics stopped."));
  }
  if (page === "toggle-lock") {
    const nextLocked = !isLocked();
    host.storage.set("lockedOverride", nextLocked);
    if (overlayProc) {
      sendToOverlay(currentConfig());
    }
    return buildStatusPage(
      nextLocked
        ? t("Lyrics window locked (click-through enabled).")
        : t("Lyrics window unlocked (you can drag to move it)."),
    );
  }
  if (page === "reset-pos") {
    if (overlayProc) {
      sendToOverlay({ type: "resetPos" });
    }
    return buildStatusPage(t("Window position reset."));
  }
  return buildStatusPage("");
}

export function setSetting({ key, value }) {
  if (key === "enabled") {
    host.storage.set("manualActive", value === "true");
    if (host.platform === "windows") {
      if (value === "true") startOverlay();
      else stopOverlay();
    }
    return;
  }
  if (key === "locked") {
    host.storage.remove("lockedOverride");
  }
  if (key === "lyricsSource") {
    lyricsCache.clear();
  }
  if (overlayProc) {
    sendToOverlay(currentConfig());
  }
}
