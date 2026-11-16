import http from "node:http";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const REPO = "gootal26/mygo-music-Desktop-Lyrics";
const DEEP_LINK = `mygo-music://install-plugin?repo=${REPO}`;
const CMD_LINE = `start "" "${DEEP_LINK}"`;

const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MyGo Desktop Lyrics · Windows 桌面歌词插件</title>
  <meta name="description" content="MyGo Music Windows 桌面歌词插件 (${REPO})：原生透明悬浮窗口、SMTC 精准同步、网易云/LRCLIB 歌词匹配与简繁转换。" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      color-scheme: light dark;
      --bg: light-dark(#f8f9fb, #0c0d11);
      --surface: light-dark(#ffffff, #14161c);
      --surface-muted: light-dark(#f1f3f6, #1a1d25);
      --border: light-dark(#e3e6ec, #262934);
      --text: light-dark(#111318, #f3f4f7);
      --muted: light-dark(#565b68, #9ca2b0);
      --accent: #ef4d3e;
      --accent-hover: #dc3f30;
      --stage-bg: #12141a;
      --stage-border: #252936;
      --font-sans: "Plus Jakarta Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
      --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100dvh;
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; }
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
      border-radius: 6px;
    }

    /* Top Bar Contract: 3 zones separated cleanly on 1 line */
    .topbar {
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }
    .topbar-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 32px;
    }
    .brand {
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.02em;
      text-decoration: none;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 28px;
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    .nav a {
      text-decoration: none;
      white-space: nowrap;
      flex-shrink: 0;
      transition: color 160ms var(--ease-out);
    }
    .nav a:hover {
      color: var(--text);
      text-decoration: underline;
      text-underline-offset: 6px;
    }
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 20px;
      border-radius: 8px;
      background: var(--accent);
      color: #ffffff;
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background-color 160ms var(--ease-out), transform 160ms var(--ease-out);
    }
    .btn-primary:hover {
      background: var(--accent-hover);
    }
    .btn-primary:active {
      transform: translateY(1px);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* Hero 2-column split */
    .hero {
      padding: 56px 0 64px;
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.15fr);
      gap: 48px;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }
    .meta-line {
      margin: 0 0 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }
    .hero h1 {
      margin: 0 0 18px;
      font-size: clamp(2.15rem, 3.6vw, 3.15rem);
      line-height: 1.14;
      letter-spacing: -0.03em;
      text-wrap: balance;
    }
    .lead {
      margin: 0 0 28px;
      color: var(--muted);
      font-size: 16px;
      max-width: 54ch;
    }
    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .btn-lg {
      padding: 11px 20px;
      font-size: 14px;
    }
    .btn-secondary {
      padding: 10px 14px;
      border-radius: 8px;
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
      font-family: inherit;
      font-weight: 500;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background-color 160ms var(--ease-out), border-color 160ms var(--ease-out);
    }
    .btn-secondary:hover {
      background: var(--surface-muted);
    }
    .status-note {
      margin: 0;
      min-height: 22px;
      font-size: 13px;
      color: var(--accent);
      font-weight: 500;
    }

    /* Interactive Windows Desktop Lyrics Simulator */
    .stage {
      background: var(--stage-bg);
      border: 1px solid var(--stage-border);
      border-radius: 16px;
      padding: 20px;
      color: #f3f4f7;
    }
    .stage-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 20px;
    }
    .stage-track {
      font-size: 13px;
      color: #a9b0c0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .stage-track strong {
      color: #ffffff;
      font-weight: 600;
    }
    .segmented {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 8px;
    }
    .seg-btn {
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: #b4bac8;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 150ms var(--ease-out), color 150ms var(--ease-out);
    }
    .seg-btn[aria-pressed="true"] {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
    }
    .desktop-canvas {
      position: relative;
      min-height: 230px;
      border-radius: 12px;
      background:
        radial-gradient(120% 100% at 15% 15%, rgba(239, 77, 62, 0.18), transparent 55%),
        radial-gradient(100% 100% at 85% 85%, rgba(77, 159, 255, 0.14), transparent 55%),
        linear-gradient(180deg, #1b1e28 0%, #11131a 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 28px 20px;
      overflow: hidden;
    }
    .overlay-bar {
      width: 100%;
      max-width: 540px;
      border-radius: 18px;
      padding: 18px 24px 16px;
      text-align: center;
      transition: background-color 180ms var(--ease-out), border-color 180ms var(--ease-out);
      position: relative;
    }
    .overlay-bar[data-backdrop="subtle"] {
      background: rgba(18, 19, 24, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(12px);
    }
    .overlay-bar[data-backdrop="transparent"] {
      background: transparent;
      border: 1px solid transparent;
    }
    .overlay-bar[data-locked="false"]:hover {
      background: rgba(20, 21, 27, 0.86);
      border-color: rgba(255, 255, 255, 0.24);
    }
    .overlay-hud {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-bottom: 8px;
      min-height: 24px;
      transition: opacity 150ms var(--ease-out);
    }
    .overlay-bar[data-locked="true"] .overlay-hud {
      opacity: 0;
      pointer-events: none;
    }
    .hud-chip {
      padding: 3px 9px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.14);
      border: none;
      color: #f3f4f7;
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }
    .hud-chip:hover { background: rgba(255, 255, 255, 0.26); }
    .lyric-main {
      margin: 0;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.01em;
      text-shadow: 0 1px 4px rgba(0, 0, 0, 0.65);
      transition: color 180ms var(--ease-out), font-size 180ms var(--ease-out);
    }
    .lyric-sub {
      margin: 6px 0 0;
      color: rgba(243, 244, 246, 0.88);
      font-weight: 400;
      line-height: 1.4;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    }
    .overlay-bar[data-size="small"] .lyric-main { font-size: 20px; }
    .overlay-bar[data-size="small"] .lyric-sub { font-size: 13px; }
    .overlay-bar[data-size="medium"] .lyric-main { font-size: 25px; }
    .overlay-bar[data-size="medium"] .lyric-sub { font-size: 14px; }
    .overlay-bar[data-size="large"] .lyric-main { font-size: 30px; }
    .overlay-bar[data-size="large"] .lyric-sub { font-size: 16px; }

    .overlay-bar[data-accent="coral"] .lyric-main { color: #ff7466; }
    .overlay-bar[data-accent="sky"] .lyric-main { color: #66d1ff; }
    .overlay-bar[data-accent="gold"] .lyric-main { color: #ffd56a; }
    .overlay-bar[data-accent="mint"] .lyric-main { color: #5ae8c8; }

    .stage-controls {
      margin-top: 16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .control-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .control-label {
      font-size: 12px;
      color: #9ba3b4;
      margin-right: 4px;
    }

    /* Section Grid */
    .section {
      padding: 64px 0;
      border-bottom: 1px solid var(--border);
    }
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 36px;
    }
    .section-head h2 {
      margin: 0;
      font-size: clamp(1.5rem, 2.4vw, 2rem);
      letter-spacing: -0.02em;
    }
    .section-sub {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }
    .cap-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 40px;
    }
    .cap-item {
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }
    .cap-item h3 {
      margin: 0 0 8px;
      font-size: 17px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .cap-item p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }

    /* Install & Release section */
    .install-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 40px;
      align-items: start;
    }
    .install-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
    }
    .install-panel h3 {
      margin: 0 0 12px;
      font-size: 17px;
    }
    .install-steps {
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      font-size: 14px;
    }
    .install-steps li + li { margin-top: 8px; }
    .cmd-box {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 10px;
      background: var(--surface-muted);
      font-family: var(--font-mono);
      font-size: 13px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    details {
      border-top: 1px solid var(--border);
      padding: 16px 0;
    }
    details:last-of-type { border-bottom: 1px solid var(--border); }
    summary {
      cursor: pointer;
      font-weight: 600;
      font-size: 15px;
    }
    details ul {
      margin: 10px 0 0;
      padding-left: 20px;
      color: var(--muted);
      font-size: 14px;
    }
    details li + li { margin-top: 6px; }
    code {
      font-family: var(--font-mono);
      font-size: 0.9em;
    }

    .footer {
      padding: 28px 0 40px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      font-size: 13px;
      color: var(--muted);
    }
    .footer-links {
      display: flex;
      gap: 20px;
    }
    .footer a { text-decoration: none; }
    .footer a:hover { color: var(--text); text-decoration: underline; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }
    @media (max-width: 960px) {
      .hero, .install-grid, .cap-grid {
        grid-template-columns: 1fr;
      }
      .hero { padding: 36px 0 44px; gap: 32px; }
      .nav { display: none; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="#top">MyGo Desktop Lyrics</a>
      <nav class="nav" aria-label="页面导航">
        <a href="#preview">实时预览</a>
        <a href="#capabilities">核心能力</a>
        <a href="#install">安装指南</a>
        <a href="#changelog">更新记录</a>
      </nav>
      <a class="btn-primary" href="${DEEP_LINK}">一键安装</a>
    </div>
  </header>

  <main id="top" class="container">
    <section id="preview" class="hero">
      <div>
        <p class="meta-line">Windows 10 / 11 · MyGo Music 插件 · v1.1.0</p>
        <h1>桌面歌词，终于清晰且同步。</h1>
        <p class="lead">
          为 Windows 版 MyGo Music 打造的原生 WPF 悬浮歌词条。采用 SMTC 时间轴锚定防止进度漂移，自动读取本地 <code>.lrc</code> 与网易云 / LRCLIB 同步曲库，并在管道层面彻底解决中文乱码与繁简混杂问题。
        </p>
        <div class="hero-actions">
          <a class="btn-primary btn-lg" href="${DEEP_LINK}">在 MyGo Music 中一键安装</a>
          <button type="button" class="btn-secondary" id="copy-repo-btn">复制 GitHub 仓库</button>
          <button type="button" class="btn-secondary" id="copy-cmd-btn">复制 CMD 命令</button>
        </div>
        <p class="status-note" id="copy-status" role="status" aria-live="polite"></p>
      </div>

      <div class="stage" aria-label="Windows 桌面歌词样式交互预览">
        <div class="stage-toolbar">
          <span class="stage-track">正在预览：<strong>日落大道</strong> — 梁博 · 迷藏</span>
          <div class="segmented" role="group" aria-label="歌词样式快速切换">
            <button type="button" class="seg-btn" id="prev-line-btn">上一句</button>
            <button type="button" class="seg-btn" id="next-line-btn">下一句</button>
            <button type="button" class="seg-btn" id="lock-toggle-btn" aria-pressed="false">解锁态</button>
          </div>
        </div>

        <div class="desktop-canvas">
          <div class="overlay-bar" id="preview-overlay" data-accent="coral" data-backdrop="subtle" data-size="medium" data-locked="false">
            <div class="overlay-hud" aria-hidden="false">
              <button type="button" class="hud-chip" id="hud-early-btn">-0.5s</button>
              <button type="button" class="hud-chip" id="hud-late-btn">+0.5s</button>
              <button type="button" class="hud-chip" id="hud-lock-btn">锁定</button>
            </div>
            <p class="lyric-main" id="preview-main-line">你看那金黄多耀眼</p>
            <p class="lyric-sub" id="preview-sub-line">我们奔跑着在这条路的中间</p>
          </div>
        </div>

        <div class="stage-controls">
          <div class="control-group" role="group" aria-label="高亮配色">
            <span class="control-label">配色</span>
            <button type="button" class="seg-btn" data-set-accent="coral" aria-pressed="true">珊瑚红</button>
            <button type="button" class="seg-btn" data-set-accent="sky" aria-pressed="false">天空蓝</button>
            <button type="button" class="seg-btn" data-set-accent="gold" aria-pressed="false">琥珀金</button>
            <button type="button" class="seg-btn" data-set-accent="mint" aria-pressed="false">薄荷绿</button>
          </div>

          <div class="control-group" role="group" aria-label="底框样式">
            <span class="control-label">底框</span>
            <button type="button" class="seg-btn" data-set-backdrop="subtle" aria-pressed="true">微透</button>
            <button type="button" class="seg-btn" data-set-backdrop="transparent" aria-pressed="false">纯文字</button>
          </div>

          <div class="control-group" role="group" aria-label="歌词字号">
            <span class="control-label">字号</span>
            <button type="button" class="seg-btn" data-set-size="small" aria-pressed="false">小</button>
            <button type="button" class="seg-btn" data-set-size="medium" aria-pressed="true">中</button>
            <button type="button" class="seg-btn" data-set-size="large" aria-pressed="false">大</button>
          </div>
        </div>
      </div>
    </section>

    <section id="capabilities" class="section">
      <div class="section-head">
        <h2>核心能力</h2>
        <p class="section-sub">针对 Windows 桌面实机反馈重构的同步、编码与渲染管线</p>
      </div>
      <div class="cap-grid">
        <article class="cap-item">
          <h3>01. SMTC 时间轴防漂移同步</h3>
          <p>仅在切歌、播放状态变化、<code>LastUpdatedTime</code> 变动或 Seek 超过 20ms 时重设锚点，避免轮询周期不断归零导致的歌词滞后。</p>
        </article>
        <article class="cap-item">
          <h3>02. 网易云优先 + LRCLIB 时长评分</h3>
          <p>优先检索同目录本地 <code>.lrc</code>，在线默认优先网易云曲库并合并翻译歌词，按标题、歌手、专辑与歌曲时长综合打分，防止错配版本。</p>
        </article>
        <article class="cap-item">
          <h3>03. Win32 繁简转换与零乱码管道</h3>
          <p>PowerShell 脚本全量使用 7-bit ASCII 编写，标准流强制 UTF-8 配合 <code>\\uXXXX</code> escape 传输，并通过 <code>LCMapStringW</code> 自动转简体。</p>
        </article>
        <article class="cap-item">
          <h3>04. 微透玻璃底框与悬停微调</h3>
          <p>支持 <code>微透磨砂底框</code> 与 <code>无底框纯文字</code> 双模式，ClearType 锐利排版，未锁定时悬停可直接拖拽位置或按 <code>±0.5s</code> 校准。</p>
        </article>
      </div>
    </section>

    <section id="install" class="section">
      <div class="section-head">
        <h2>安装与升级指南</h2>
        <p class="section-sub">仓库地址：<code>${REPO}</code></p>
      </div>
      <div class="install-grid">
        <div class="install-panel">
          <h3>在 Windows 版 MyGo Music 中安装或更新</h3>
          <ol class="install-steps">
            <li>打开 MyGo Music，进入 <strong>设置 &gt; 插件 &gt; + &gt; Install from GitHub</strong>。</li>
            <li>输入仓库名 <code>${REPO}</code>（已安装用户直接点击检查更新即可升级到 v1.1.0）。</li>
            <li>在插件卡片中点击 <strong>允许程序 (Allow Programs)</strong>，放行启动 <code>powershell</code>。</li>
            <li>在设置中开启 <strong>开启桌面歌词</strong>，并按需允许 <code>music.163.com</code> 与 <code>lrclib.net</code>。</li>
          </ol>
          <div class="cmd-box">${CMD_LINE}</div>
        </div>

        <div id="changelog">
          <details open>
            <summary>v1.1.0 视觉与内核更新说明</summary>
            <ul>
              <li>桌面悬浮条新增 <code>ClearType</code> Display 文本渲染与圆角悬停工具栏模板，消除旧版方形蓝框按钮。</li>
              <li>新增「歌词背景样式」设置（微透磨砂底框 / 无底框纯文字），保证浅色网页背景下依旧清晰可读。</li>
              <li>修复 SMTC 时间轴锚点覆盖导致的歌词不同步、繁简混杂以及 Windows PowerShell 管道乱码。</li>
            </ul>
          </details>
          <details>
            <summary>为什么在 CMD 里直接粘贴 mygo-music:// 会提示“不是内部或外部命令”？</summary>
            <ul>
              <li><code>mygo-music://</code> 是自定义 URL 协议而不是可执行文件。请在浏览器的安装按钮上点击打开，或在 CMD 中运行上方完整的 <code>start "" "mygo-music://..."</code> 命令，也可按 <code>Win + R</code> 粘贴链接回车唤醒。</li>
            </ul>
          </details>
          <details>
            <summary>安装 / 重装提示 “rename ... replaced: The process cannot access the file because it is being used by another process”？</summary>
            <ul>
              <li>这是因为旧版正在运行的 <code>powershell.exe</code> 桌面歌词进程占用着旧插件目录，导致 Windows 无法替换文件。</li>
              <li><strong>一次性解决：</strong>先关闭「开启桌面歌词」并退出 MyGo Music（或任务管理器结束 <code>powershell.exe</code>），再重新点击安装/更新即可。</li>
              <li>新版已改为切换工作目录到 <code>%TEMP%</code> 并从内存执行脚本，不再锁定插件目录，后续更新无需关闭歌词。</li>
            </ul>
          </details>
        </div>
      </div>
    </section>
  </main>

  <footer class="container footer">
    <span>MyGo Desktop Lyrics · ${REPO}</span>
    <div class="footer-links">
      <a href="#preview">实时预览</a>
      <a href="#capabilities">核心能力</a>
      <a href="#install">安装指南</a>
    </div>
  </footer>

  <script>
    const statusEl = document.getElementById("copy-status");
    async function copyText(text, label) {
      try {
        await navigator.clipboard.writeText(text);
        statusEl.textContent = label + "：" + text;
      } catch {
        statusEl.textContent = "请手动复制：" + text;
      }
    }
    document.getElementById("copy-repo-btn").addEventListener("click", () => {
      copyText("${REPO}", "已复制仓库");
    });
    document.getElementById("copy-cmd-btn").addEventListener("click", () => {
      copyText(${JSON.stringify(CMD_LINE)}, "已复制 CMD 命令");
    });

    const lines = [
      { main: "每当黄昏阳光把所有都渲染", sub: "你看那金黄多耀眼" },
      { main: "你看那金黄多耀眼", sub: "我们奔跑着在这条路的中间" },
      { main: "我们奔跑着在这条路的中间", sub: "我们哭泣着在这条路的两端" },
      { main: "一直走 一直走 直到我看到夜的黑暗", sub: "日落大道 — 梁博" }
    ];
    let lineIdx = 1;
    let nudgeMs = 0;

    const overlayEl = document.getElementById("preview-overlay");
    const mainLineEl = document.getElementById("preview-main-line");
    const subLineEl = document.getElementById("preview-sub-line");
    const lockToggleBtn = document.getElementById("lock-toggle-btn");

    function renderLines() {
      const cur = lines[lineIdx];
      mainLineEl.textContent = cur.main;
      subLineEl.textContent = cur.sub;
    }

    document.getElementById("prev-line-btn").addEventListener("click", () => {
      lineIdx = (lineIdx - 1 + lines.length) % lines.length;
      renderLines();
    });
    document.getElementById("next-line-btn").addEventListener("click", () => {
      lineIdx = (lineIdx + 1) % lines.length;
      renderLines();
    });

    function setLocked(locked) {
      overlayEl.dataset.locked = String(locked);
      lockToggleBtn.setAttribute("aria-pressed", String(locked));
      lockToggleBtn.textContent = locked ? "已锁定穿透" : "解锁态";
    }

    lockToggleBtn.addEventListener("click", () => {
      setLocked(overlayEl.dataset.locked !== "true");
    });
    document.getElementById("hud-lock-btn").addEventListener("click", () => {
      setLocked(true);
    });
    document.getElementById("hud-early-btn").addEventListener("click", () => {
      nudgeMs += 500;
      statusEl.textContent = "预览偏移：-" + (nudgeMs / 1000).toFixed(1) + "s（提前）";
    });
    document.getElementById("hud-late-btn").addEventListener("click", () => {
      nudgeMs -= 500;
      const sign = nudgeMs <= 0 ? "+" : "-";
      statusEl.textContent = "预览偏移：" + sign + (Math.abs(nudgeMs) / 1000).toFixed(1) + "s";
    });

    function bindGroup(attr, datasetKey) {
      const btns = document.querySelectorAll("[data-" + attr + "]");
      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-" + attr);
          overlayEl.dataset[datasetKey] = val;
          btns.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        });
      });
    }
    bindGroup("set-accent", "accent");
    bindGroup("set-backdrop", "backdrop");
    bindGroup("set-size", "size");
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, repo: REPO }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Plugin page listening on http://0.0.0.0:${PORT}`);
});
