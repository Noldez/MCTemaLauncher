<div align="center">

<img src=".github/logo.png" width="120" alt="MC Tema">

# MC Tema Launcher

Official desktop launcher for the [MC Tema](https://mctema.lt) Minecraft server - `play.mctema.lt`

[![CI](https://img.shields.io/github/actions/workflow/status/Noldez/MCTemaLauncher/ci.yml?branch=main&label=CI)](https://github.com/Noldez/MCTemaLauncher/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/Noldez/MCTemaLauncher/codeql.yml?branch=main&label=CodeQL)](https://github.com/Noldez/MCTemaLauncher/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/Noldez/MCTemaLauncher?label=release)](https://github.com/Noldez/MCTemaLauncher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Noldez/MCTemaLauncher/total?label=downloads&color=2ea44f)](https://github.com/Noldez/MCTemaLauncher/releases)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Noldez/MCTemaLauncher/badge)](https://scorecard.dev/viewer/?uri=github.com/Noldez/MCTemaLauncher)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13924/badge)](https://www.bestpractices.dev/projects/13924)
[![License](https://img.shields.io/github/license/Noldez/MCTemaLauncher)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-0078d4)](https://mctema.lt)

**[Download for players -> mctema.lt](https://mctema.lt)**

<img src=".github/screenshot.png" width="820" alt="MC Tema Launcher">

</div>

## Features

- **One-click play** - installs Minecraft 1.21.11 + Fabric with a bundled Java 21 runtime and joins the server automatically
- **MC Tema account login** - credentials verified over certificate-pinned TLS, stored encrypted with the OS keystore (Windows DPAPI / Linux libsecret)
- **Friends & chat** - live presence, direct messages with image support, launcher-native notifications
- **Screenshot gallery** - browse local shots, submit the best ones to the community gallery on mctema.lt
- **Skin locker** - local skin collection with live 3D preview
- **Optional mods** - Sodium, Lithium, Iris and more, installed from Modrinth with checksum verification on every launch
- **Automatic updates** - silent download, one-click install

## Verify your download

The official installer from [mctema.lt](https://mctema.lt):

```
SHA-256  f4008fa041599eec0f66ce30dbef184cc669358aacd0814f02378172467c1aac
```

- [VirusTotal scan](https://www.virustotal.com/gui/file/f4008fa041599eec0f66ce30dbef184cc669358aacd0814f02378172467c1aac) - 0/62 vendors flag it
- [GitHub releases](https://github.com/Noldez/MCTemaLauncher/releases) are built from this source by a public workflow; each exe ships with `SHA256SUMS.txt` and a signed provenance attestation you can check with `gh attestation verify <exe> --repo Noldez/MCTemaLauncher`

The installer is not yet code-signed ([#5](https://github.com/Noldez/MCTemaLauncher/issues/5)), so Windows SmartScreen may warn on first run - the checksum and scan above are how you verify authenticity until then.

## Linux

**Debian, Ubuntu, Kali, Mint** - install the `.deb` from [releases](https://github.com/Noldez/MCTemaLauncher/releases/latest). This is the recommended route: it needs no FUSE and adds a normal menu entry.

```bash
sudo apt install ./MCTemaLauncher-*.deb
mctema-launcher
```

**Everything else** - the `.AppImage`:

```bash
chmod +x MCTemaLauncher-*.AppImage
./MCTemaLauncher-*.AppImage
```

Distros that dropped FUSE 2 (Kali, newer Arch/Ubuntu) need the AppImage to unpack itself instead of mounting. Note the double dash:

```bash
./MCTemaLauncher-*.AppImage --appimage-extract-and-run
```

Credential storage needs a secret service (gnome-keyring or kwallet). The `.deb` pulls in `libsecret`; on a minimal desktop without a keyring daemon the launcher will say so rather than store your password unprotected.

## Why open source

So players can verify what the launcher does. It talks only to `mctema.lt`, official Mojang/Fabric/Modrinth endpoints and `mc-heads.net` - nothing else. Client mods are hash-verified before every launch. Releases are built from this source with published SHA-256 checksums.

Found something off? See [SECURITY.md](SECURITY.md).

## Development

```
npm install
npm run download-jre   # fetch Temurin JRE 21 into assets/jre
npm start
```

Build the Windows installer with `npm run dist` (NSIS, output in `build/`). Game files live in `%APPDATA%\.mctema`.

Contributions welcome - see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Code is licensed under [GPL-3.0](LICENSE). MC Tema branding, logos and artwork are **not** covered by the code license and may not be reused.

Icons by [game-icons.net](https://game-icons.net) (CC BY 3.0) and Font Awesome Free.
