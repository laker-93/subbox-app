<img src="assets/icons/icon.png" alt="logo" title="subbox" align="right" height="60px" width="60px" />

# Subbox

  <p align="center">
    <a href="https://github.com/laker-93/subbox-app/blob/development/LICENSE">
      <img src="https://img.shields.io/github/license/laker-93/subbox-app?style=flat-square&color=brightgreen"
      alt="License">
    </a>
      <a href="https://github.com/laker-93/subbox-app/releases">
      <img src="https://img.shields.io/github/v/release/laker-93/subbox-app?style=flat-square&color=blue"
      alt="Release">
    </a>
    <a href="https://github.com/laker-93/subbox-app/releases">
      <img src="https://img.shields.io/github/downloads/laker-93/subbox-app/total?style=flat-square&color=orange"
      alt="Downloads">
    </a>
  </p>

---

## Attribution

Subbox is a fork of [Feishin](https://github.com/jeffvli/feishin), a modern self-hosted
music player by [jeffvli](https://github.com/jeffvli) (itself a rewrite of
[Sonixd](https://github.com/jeffvli/sonixd)). Feishin is licensed under the
GNU General Public License v3.0, and Subbox remains licensed under the GPL-3.0 —
see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Subbox has been modified from the original since 2024. It adds DJ-workflow features
(Rekordbox/Serato library and playlist sync via the pymix API, wishlist and sharing
surfaces) and is not affiliated with or endorsed by the Feishin project. Please report
issues with Subbox to [this repository](https://github.com/laker-93/subbox-app/issues),
**not** to the Feishin maintainers.

## Features

- [x] MPV player backend
- [x] Web player backend
- [x] Modern UI
- [x] Scrobble playback to your server
- [x] Smart playlist editor (Navidrome)
- [x] Synchronized and unsynchronized lyrics support
- [ ] [Request a feature](https://github.com/laker-93/subbox-app/issues)

## Screenshots

<a href="./media/preview_full_screen_player.png"><img src="./media/preview_full_screen_player.png" width="49.5%"/></a> <a href="./media/preview_album_artist_detail.png"><img src="./media/preview_album_artist_detail.png" width="49.5%"/></a> <a href="./media/preview_album_detail.png"><img src="./media/preview_album_detail.png" width="49.5%"/></a> <a href="./media/preview_smart_playlist.png"><img src="./media/preview_smart_playlist.png" width="49.5%"/></a>

## Getting Started

### Desktop (recommended)

Download the [latest desktop client](https://github.com/laker-93/subbox-app/releases). The desktop client is the recommended way to use Subbox. It supports both the MPV and web player backends, as well as includes built-in fetching for lyrics.

#### macOS Notes

If you're using a device running macOS 12 (Monterey) or higher, [check here](https://github.com/jeffvli/feishin/issues/104#issuecomment-1553914730) for instructions on how to remove the app from quarantine.

For media keys to work, you will be prompted to allow Subbox to be a Trusted Accessibility Client. After allowing, you will need to restart Subbox for the privacy settings to take effect.

#### Linux Notes

We provide a small install script to download the latest `.AppImage`, make it executable, and also download the icons required by Desktop Environments. Finally, it generates a `.desktop` file to add Subbox to your Application Launcher.

Simply run the installer like this:

```sh
dir=/your/application/directory
curl 'https://raw.githubusercontent.com/laker-93/subbox-app/refs/heads/development/install-subbox-appimage' | sh -s -- "$dir"
```

The script also has an option to add launch arguments to run Subbox in native Wayland mode. Note that this is experimental in Electron and therefore not officially supported. If you want to use it, run this instead:

```sh
dir=/your/application/directory
curl 'https://raw.githubusercontent.com/laker-93/subbox-app/refs/heads/development/install-subbox-appimage' | sh -s -- "$dir" wayland-native
```

It also provides a simple uninstall routine, removing the downloaded files:

```sh
dir=/your/application/directory
curl 'https://raw.githubusercontent.com/laker-93/subbox-app/refs/heads/development/install-subbox-appimage' | sh -s -- "$dir" remove
```

The entry should show up in your Application Launcher immediately. If it does not, simply log out, wait 10 seconds, and log back in. Your Desktop Environment may alternatively provide a way to reload entries.

### Web and Docker

Subbox is available as a Docker image, published to Docker Hub as
[`laker93/player`](https://hub.docker.com/r/laker93/player). You can run the container
using the following commands:

```bash
# Run the latest version
docker run --name subbox -p 9180:9180 laker93/player:latest

# Build the image locally
docker build -t subbox .
docker run --name subbox -p 9180:9180 subbox
```

#### Docker Compose

To install via Docker Compose, use the following snippet. This also works on Portainer.

```yaml
services:
    subbox:
        container_name: subbox
        image: 'laker93/player:latest'
        restart: unless-stopped
        environment:
            - SERVER_NAME=jellyfin # pre-defined server name
            - SERVER_LOCK=true # When true AND name/type/url are set, only username/password can be toggled
            - SERVER_TYPE=jellyfin # the allowed types are: jellyfin, navidrome, subsonic. These values are case insensitive
            - SERVER_URL= # http://address:port or https://address:port
            - REMOTE_URL= # http://address or https://address
            - LEGACY_AUTHENTICATION=false # When SERVER_LOCK is true, sets the legacy (plaintext) authentication flag for Subsonic/OpenSubsonic servers
            - ANALYTICS_DISABLED=true # Set to true to disable Umami analytics tracking
        ports:
            - 9180:9180
            # Alternatively, to restrict to only localhost, - 127.0.0.1:9180:8190
```

### Configuration

1. Upon startup you will be greeted with a prompt to select the path to your MPV binary. If you do not have MPV installed, you can download it [here](https://mpv.io/installation/) or install it using any package manager supported by your OS. After inputting the path, restart the app.

2. After restarting the app, you will be prompted to select a server. Click the `Open menu` button and select `Manage servers`. Click the `Add server` button in the popup and fill out all applicable details. You will need to enter the full URL to your server, including the protocol and port if applicable (e.g. `https://navidrome.my-server.com` or `http://192.168.0.1:4533`).

- **Navidrome** - For the best experience, select "Save password" when creating the server and configure the `SessionTimeout` setting in your Navidrome config to a larger value (e.g. 72h).
    - **Linux users** - The default password store uses `libsecret`. `kwallet4/5/6` are also supported, but must be explicitly set in Settings > Window > Passwords/secret store.

3. _Optional_ - If you want to host Subbox on a subpath (not `/`), then pass in the following environment variable: `PUBLIC_PATH=PATH`. For example, to host on `/subbox`, pass in `PUBLIC_PATH=/subbox`.

4. _Optional_ - To hard code the server url, pass the following environment variables: `SERVER_NAME`, `SERVER_TYPE` (one of `jellyfin` or `navidrome` or `subsonic`), `SERVER_URL`. To prevent users from changing these settings, pass `SERVER_LOCK=true`. This can only be set if all three of the previous values are set. When `SERVER_LOCK=true`, you can also set `LEGACY_AUTHENTICATION=true` or `LEGACY_AUTHENTICATION=false` to configure the legacy authentication flag for the server (only applicable for Subsonic/OpenSubsonic servers).

5. _Optional_ - If your server uses a separate public-facing URL than what integrating applications use internally to communicate with your server, such as a separate Navidrome `ShareURL`, set `REMOTE_URL` to said public-facing URL.
 
6. _Optional_ - To disable Umami analytics tracking in the Docker/web version, set the environment variable `ANALYTICS_DISABLED=true`. When enabled, the analytics script will not be loaded and all tracking will be disabled.

7. _Optional_ - App settings (theme, language, sidebar options, etc.) can be overridden with environment variables on first run. The variables use the `FS_` prefix (e.g. `FS_GENERAL_THEME=defaultDark`, `FS_GENERAL_LANGUAGE=de`). See [the settings environment variable documentation](docs/ENV_SETTINGS.md) for the full list.

## FAQ

### MPV is either not working or is rapidly switching between pause/play states

First thing to do is check that your MPV binary path is correct. Navigate to the settings page and re-set the path and restart the app. If your issue still isn't resolved, try reinstalling MPV. Known working versions include `v0.35.x` and `v0.36.x`. `v0.34.x` is a known broken version.

### What music servers does Subbox support?

Subbox supports any music server that implements a [Navidrome](https://www.navidrome.org/), [Jellyfin](https://jellyfin.org/), or [OpenSubsonic compatible](https://opensubsonic.netlify.app/) API.

- [Navidrome](https://github.com/navidrome/navidrome)
- [Jellyfin](https://github.com/jellyfin/jellyfin)
- [OpenSubsonic](https://opensubsonic.netlify.app/) compatible servers, such as...
    - [Airsonic-Advanced](https://github.com/airsonic-advanced/airsonic-advanced)
    - [Ampache](https://ampache.org)
    - [Astiga](https://asti.ga/)
    - [Funkwhale](https://www.funkwhale.audio/)
    - [Gonic](https://github.com/sentriz/gonic)
    - [LMS](https://github.com/epoupon/lms)
    - [Nextcloud Music](https://apps.nextcloud.com/apps/music)
    - [Supysonic](https://github.com/spl0k/supysonic)
    - [Qm-Music](https://github.com/chenqimiao/qm-music)
    - More (?)

### I have the issue "The SUID sandbox helper binary was found, but is not configured correctly" on Linux

This happens when you have user (unprivileged) namespaces disabled (`sysctl kernel.unprivileged_userns_clone` returns 0). You can fix this by either enabling unprivileged namespaces, or by making the `chrome-sandbox` Setuid.

```bash
chmod 4755 chrome-sandbox
sudo chown root:root chrome-sandbox
```

Ubuntu 24.04 specifically introduced breaking changes that affect how namespaces work. Please see https://discourse.ubuntu.com/t/ubuntu-24-04-lts-noble-numbat-release-notes/39890#:~:text=security%20improvements%20 for possible fixes.

## Development

Built and tested using Node `v23.11.0`.

This project is built off of [electron-vite](https://github.com/alex8088/electron-vite)

- `pnpm run dev` - Start the development server
- `pnpm run dev:watch` - Start the development server in watch mode (for main / preload HMR)
- `pnpm run start` - Starts the app in production preview mode
- `pnpm run build` - Builds the app for desktop
- `pnpm run build:electron` - Build the electron app (main, preload, and renderer)
- `pnpm run build:remote` - Build the remote app (remote)
- `pnpm run build:web` - Build the standalone web app (renderer)
- `pnpm run package` - Package the project
- `pnpm run package:dev` - Package the project for development locally
- `pnpm run package:linux` - Package the project for Linux locally
- `pnpm run package:mac` - Package the project for Mac locally
- `pnpm run package:win` - Package the project for Windows locally
- `pnpm run publish:linux` - Publish the project for Linux
- `pnpm run publish:linux:beta` - Publish the project for Linux (beta channel)
- `pnpm run publish:linux-arm64` - Publish the project for Linux ARM64
- `pnpm run publish:linux-arm64:beta` - Publish the project for Linux ARM64 (beta channel)
- `pnpm run publish:mac` - Publish the project for Mac
- `pnpm run publish:mac:beta` - Publish the project for Mac (beta channel)
- `pnpm run publish:win` - Publish the project for Windows
- `pnpm run publish:win:beta` - Publish the project for Windows (beta channel)
- `pnpm run typecheck` - Type check the project
- `pnpm run typecheck:node` - Type check the project with tsconfig.node.json
- `pnpm run typecheck:web` - Type check the project with tsconfig.web.json
- `pnpm run lint` - Lint the project
- `pnpm run lint:fix` - Lint the project and fix linting errors
- `pnpm run i18next` - Generate i18n files

## Translation

This project uses [Weblate](https://hosted.weblate.org/projects/subbox/) for translations. If you would like to contribute, please visit the link and submit a translation.

## License

Subbox — Copyright (C) 2024-2026 Luke Purnell
Based on Feishin — Copyright (C) 2022-2024 jeffvli and the Feishin contributors.

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the [GNU General Public License](LICENSE) for more details.

The Subbox backend service (`pymix`) is a separate program that communicates with this
client over an HTTP API. It is not covered by this license — see its own repository.

"Subbox" and the Subbox logo are trademarks of Luke Purnell. The GPL grants you rights
to the code, not to the name or branding; forks must be distributed under a different
name and logo.
