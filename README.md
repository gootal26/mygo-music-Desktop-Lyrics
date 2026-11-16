# Windows Desktop Lyrics (MyGo Music Plugin)

A floating, always-on-top desktop lyrics plugin for the Windows version of **MyGo Music**.

Repository: [gootal26/mygo-music-Desktop-Lyrics](https://github.com/gootal26/mygo-music-Desktop-Lyrics)

## Features

- Native transparent WPF lyrics bar on Windows 10 / 11
- Syncs track metadata, play/pause state, and timeline via Windows SMTC (`GlobalSystemMediaTransportControls`)
- Automatically reads local `.lrc` files beside tracks indexed by MyGo Music (`local/index.json`) or in extra folders
- Optional online synced lyrics lookup via [LRCLIB](https://lrclib.net)
- Click-through lock mode (`WS_EX_TRANSPARENT`), drag-to-reposition when unlocked, font size / highlight color / position settings, and Simplified Chinese localization

## Install

### Option 1: Install in MyGo Music

1. Open Windows **MyGo Music** -> **Settings > Plugins > + > Install from GitHub**.
2. Enter:
   ```text
   gootal26/mygo-music-Desktop-Lyrics
   ```
3. In **Settings > Plugins > Desktop Lyrics**, click **Allow Programs** so the plugin can start `powershell`.
4. Turn on **Enable Desktop Lyrics** (or open **Desktop Lyrics** from the sidebar and click **Enable / Restart Desktop Lyrics**).

### Option 2: One-Click Install Link

- Deep link: [`mygo-music://install-plugin?repo=gootal26/mygo-music-Desktop-Lyrics`](mygo-music://install-plugin?repo=gootal26/mygo-music-Desktop-Lyrics)
- Windows CMD:
  ```bat
  start "" "mygo-music://install-plugin?repo=gootal26/mygo-music-Desktop-Lyrics"
  ```
- HTML install button:
  ```html
  <a href="mygo-music://install-plugin?repo=gootal26/mygo-music-Desktop-Lyrics">Install Desktop Lyrics in MyGo Music</a>
  ```

> **Note:** GitHub strips custom URL schemes (`mygo-music://`) in rendered README Markdown. Add the topic `mygo-music-plugin` to `gootal26/mygo-music-Desktop-Lyrics` on GitHub so it appears on [mygo-music.egoist.dev/plugins](https://mygo-music.egoist.dev/plugins) with a clickable **Install** button.

## Updating

Push new commits to the default branch of `gootal26/mygo-music-Desktop-Lyrics` (or publish a new GitHub Release tag). MyGo Music checks for updates daily and in **Settings > Plugins**.
