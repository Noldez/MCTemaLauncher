# Contributing

Thanks for your interest in improving the MC Tema Launcher.

## Setup

```
npm install
npm run download-jre
npm start
```

## Guidelines

- Keep the UI in Lithuanian - it is the language of the community the launcher serves.
- The launcher must only talk to `mctema.lt`, official Mojang/Fabric/Modrinth endpoints and `mc-heads.net`. PRs adding other network calls will not be accepted.
- Match the existing code style: plain CommonJS, no frameworks, minimal comments.
- One change per pull request, with a short description of what and why.
- New functionality should come with automated tests (npm test runs in CI; see test/ for examples).
- All changes land via pull request with passing CI - direct pushes to main are blocked.

## Bugs and ideas

Open an [issue](https://github.com/Noldez/MCTemaLauncher/issues) or drop by the [Discord](https://discord.gg/mctema). For security issues see [SECURITY.md](SECURITY.md).
