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
- **In-game client features** - MC Tema settings and shortcuts in the pause menu, a badge in the tab list next to other players on the client, and Residence claim previews
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

So players can verify what the launcher does, rather than taking our word for it. The sections below exist to make that practical: they say where to look instead of leaving you to read the whole thing.

Found something off? See [SECURITY.md](SECURITY.md).

## How it works

**Three processes.** `main.js` is the Electron main process and the only part with filesystem and network access. `renderer/` is the UI, and it runs with `nodeIntegration: false` and `contextIsolation: true`, so page code cannot reach Node at all. Everything in between crosses `preload.js`, which exposes one narrow `window.api` object of named IPC calls. If a capability is not listed there, the UI does not have it.

**Where the logic lives.** `lib/` holds the parts worth reading on their own: `pinned-http.js` (every call to our API), `credentials.js` (what touches your password), `mods.js` (integrity checks), `config.js`, `mc-status.js`. These have unit tests, and none of them need Electron to run.

**Logging in.** Your password goes to `mctema.lt/api/launcher/login` over a certificate-pinned connection and is checked against the server's AuthMe database, the same account you use in game. The server returns a session token plus a refresh token, and staying signed in afterwards uses the refresh token, so **the password is not sent again**.

**Signing you in to the game.** The launcher does *not* hand Minecraft your password. Anything loaded into that JVM can read its environment, mods you install yourself included, so the password would be the one credential a hostile mod could simply pick up. Instead the launcher asks the site for a one-shot login ticket - one nickname, one use, five minutes - and passes only that. The client mod sends it through the encrypted handshake and the server redeems it, after which it is worth nothing. If a ticket cannot be issued the game still starts and you type `/login` once.

**Why the password is still stored.** It sits encrypted in `auth.dat` so you are not asked for it every time: it signs you in and stands in when there is no usable refresh token. It never leaves the launcher.

**Playing.** Before every launch the bundled client mods are hashed and compared against known values, and the game's mods folder is rebuilt from scratch. A mismatch aborts the launch rather than joining the server with modified code. The game then runs on the bundled Temurin JRE 21 with a Fabric profile and connects straight to `play.mctema.lt`.

**Updating.** `electron-updater` checks `mctema.lt/updates/` every 15 minutes and installs on quit. This path deliberately uses ordinary TLS rather than our pins, so that a mistake in the pin list stays recoverable by shipping a fix.

**Everything it contacts.** `mctema.lt` for accounts, friends, chat and the gallery; Mojang (`launchermeta`, `launcher`, `libraries`, `resources.download`) and `meta.fabricmc.net` for game files; `api.modrinth.com` for optional mods; `mc-heads.net` for skin and avatar images.

Grepping the source for `https://` returns a few more, and it is worth saying why rather than leaving you to wonder. `discord.gg`, `youtube.com` and `twitch.tv` are links handed to your browser, never fetched by the launcher. `files.minecraftforge.net`, `search.maven.org`, `github.com` and `help.minecraft.net` live in [`lib/mclc/`](lib/mclc), the vendored copy of minecraft-launcher-core, on Forge code paths this launcher does not use; they are kept so the fork stays close to upstream.

## Security

- **Certificate pinning.** Every call to `mctema.lt` is rejected unless the certificate chain contains one of the public keys pinned in [`lib/pinned-http.js`](lib/pinned-http.js). A rogue certificate authority, a corporate proxy or hostile wifi cannot read your credentials. Backup keys for a second CA are pinned as well, so a certificate change cannot lock everyone out. The one deliberate exception is the updater, explained above.
- **Credentials.** Stored through the OS keystore, DPAPI on Windows and libsecret or kwallet on Linux. On Linux the launcher refuses to save anything when only Chromium's `basic_text` backend is available, because that "encryption" uses a hardcoded key.
- **Session tokens.** 32 random bytes. The server stores only their SHA-256, so a database leak yields nothing usable. Logging out revokes the token, and changing your password invalidates every session.
- **Refresh tokens rotate.** Each one can be exchanged exactly once. If a token that has already been used turns up again, a copy is in circulation, so every token from that login is revoked and you are asked to sign in. Theft is made visible instead of silent.
- **Nothing valuable reaches the game process.** Mods share one JVM and can all read its environment, and you can install mods of your own, so the launcher assumes anything it puts there is readable by a stranger. It puts in a single-use login ticket and a token scoped to nothing but the tab-list presence beat. Neither is worth anything once used, and the account password is not there at all.
- **Downloads are verified.** Minecraft libraries and the client jar are checked against Mojang's published hashes, and optional mods against the SHA-512 Modrinth publishes, before anything is loaded as code. A file that does not match is refused rather than used.
- **Client integrity.** Bundled mods are hash-verified on every launch, not just at install.
- **No telemetry.** The launcher reports nothing about you anywhere.
- **Verifiable builds.** Every release ships `SHA256SUMS.txt` and a signed provenance attestation from the workflow that built it:

```bash
gh attestation verify MCTemaLauncher-Setup.exe --repo Noldez/MCTemaLauncher
```

The installer is not code-signed yet ([#5](https://github.com/Noldez/MCTemaLauncher/issues/5)), which is the one gap we are aware of and do not hide.

## Troubleshooting

**Windows warns about the file.** See [Windows SmartScreen](#verify-your-download) above. The installer is not code-signed yet, so fresh builds have no reputation. Verify the checksum and the VirusTotal scan, then choose "More info" and "Run anyway".

**Linux: `dlopen(): error loading libfuse.so.2`.** Kali, newer Ubuntu and Arch no longer ship FUSE 2, which the AppImage needs in order to mount itself. Either install the `.deb` instead, which does not use FUSE at all, or run the AppImage so it unpacks itself (note the double dash):

```bash
./MCTemaLauncher-*.AppImage --appimage-extract-and-run
```

**Linux: "Nerasta saugi raktinė (gnome-keyring arba kwallet)".** No secret service is running, so there is nowhere safe to keep your password. The launcher refuses rather than falling back to Chromium's `basic_text` backend, which "encrypts" with a key anyone can look up. Install and start `gnome-keyring` or `kwallet`; the `.deb` already pulls in `libsecret`. Standard desktops have one running.

**The 3D character does not appear.** Virtual machines usually have no GPU, and their virtual display adapters are on Chromium's WebGL blocklist. Since v0.2.12 the launcher falls back to software rendering, and to a flat 2D skin if even that is unavailable. Everything else works normally either way.

**"Nepavyko pasiekti mctema.lt".** A network hiccup, common on VM NAT or right after waking from sleep. Read-only requests retry automatically; press refresh if it persists.

**"Saugumo klaida: nepatikimas sertifikatas".** The launcher pins the public keys behind `mctema.lt` and refused a certificate that did not match. This is what it looks like when something is intercepting the connection, so treat it seriously: check whether you are on a network that inspects traffic (some corporate or school wifi), and if you are not, please [report it](SECURITY.md). It can also mean our certificate authority changed and the pins need updating, which is our bug, not yours.

**Updating the Linux `.deb` asks for a password.** Installing a `.deb` requires root, so the updater elevates. The AppImage updates without any prompt.

## Development

```bash
npm install
npm run download-jre         # Temurin JRE 21 into assets/jre (Windows)
npm run download-jre-linux   # same, for Linux builds
npm start
```

Everything CI runs, which is also what a pull request needs to pass:

```bash
npm run lint         # ESLint
npm test             # node --test
npm run typecheck    # tsc --noEmit over lib/ and scripts/
npm run check-pins   # verify mctema.lt still matches a pinned certificate
```

Packaging, output in `build/`:

```bash
npm run dist         # Windows installer (NSIS)
npm run dist-linux   # Linux AppImage and .deb
```

Layout: `main.js` is the Electron main process, `preload.js` the bridge, `renderer/` the UI, and `lib/` holds the logic worth testing on its own (certificate-pinned HTTP, credentials, config, mod staging, server ping). `lib/mclc/` is a vendored fork of minecraft-launcher-core and is deliberately left close to upstream.

Game files live in `%APPDATA%\.mctema` on Windows and `~/.config/.mctema` on Linux.

Contributions welcome - see [CONTRIBUTING.md](CONTRIBUTING.md).

## Signed releases

Updates are verified against a release manifest signed with an offline Ed25519
key. The launcher fetches the manifest over its certificate-pinned client,
hashes the installer it downloaded, and installs only if a valid signature
covers that exact version and hash - so control of the update feed alone is not
enough to ship code to players. The public key lives in `lib/release-verify.js`.

Publishing a release:

```bash
npm run dist
MCTEMA_SIGNING_KEY=/path/to/release-key.pem node scripts/sign-release.js build/MCTemaLauncher-Setup-<version>.exe
# upload the installer, its .blockmap, latest.yml and manifest-<version>.json
```

The private key never belongs on the server or in this repository.

## License

Code is licensed under [GPL-3.0](LICENSE). MC Tema branding, logos and artwork are **not** covered by the code license and may not be reused.

Icons by [game-icons.net](https://game-icons.net) (CC BY 3.0) and Font Awesome Free.
