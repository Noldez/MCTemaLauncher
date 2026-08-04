# Contributing

Thanks for your interest in improving the MC Tema Launcher.

## Setup

```
npm install
npm run download-jre
npm start
```

Before opening a pull request:

```
npm run lint
npm run typecheck
npm test
```

All three run in CI and must pass before a pull request can be merged.

## Guidelines

- Keep the UI in Lithuanian - it is the language of the community the launcher serves.
- The launcher must only talk to `mctema.lt`, official Mojang/Fabric/Modrinth endpoints and `mc-heads.net`. PRs adding other network calls will not be accepted.
- Match the existing code style: plain CommonJS, no frameworks. Comments explain why a decision was made, not what a line does - the security-sensitive files are commented that way on purpose, so the reasoning survives the next edit.
- One change per pull request, with a short description of what and why.
- New functionality should come with automated tests (see `test/` for examples). Logic worth testing belongs in `lib/`, which is plain Node and needs no Electron to run.
- All changes land via pull request with passing CI - direct pushes to main are blocked.

Some areas are easy to weaken by accident. Changes there get read closely, and are
worth flagging in the pull request description:

- **Network** - anything touching `lib/pinned-http.js`. Requests to our API go through it so the certificate pins apply; a plain `fetch` to `mctema.lt` bypasses them.
- **The renderer** - server-supplied strings are rendered as text, never through `innerHTML`, and the window is deliberately unable to navigate away from the bundled page.
- **Stored state** - values from `launcher.json` are attacker-influenced in the threat model; anything used to build a filesystem path is validated first.
- **Updates** - `lib/release-verify.js` and the install gate in `lib/updater.js` are what stop a compromised update feed from shipping code to players.

## Bugs and ideas

Open an [issue](https://github.com/Noldez/MCTemaLauncher/issues) or drop by the [Discord](https://discord.gg/mctema). For security issues see [SECURITY.md](SECURITY.md).
