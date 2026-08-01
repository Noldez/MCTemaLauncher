# MC Tema Launcher

Official desktop launcher for the [MC Tema](https://mctema.lt) Minecraft server (`play.mctema.lt`).

Download for players: **[mctema.lt](https://mctema.lt)**

## Features

- One-click play: installs Minecraft 1.21.11 + Fabric with a bundled Java runtime, joins the server automatically
- MC Tema account login (credentials stored encrypted with Windows DPAPI, verified over certificate-pinned TLS)
- Friends list with live presence, direct messages with image support
- Screenshot gallery with community submissions to mctema.lt
- Skin locker with 3D preview
- Optional performance mods (Sodium, Lithium, Iris and more) installed from Modrinth with checksum verification
- Automatic updates

## Why open source

So players can verify what the launcher does: it talks only to `mctema.lt`, official Mojang/Fabric/Modrinth endpoints and `mc-heads.net`, and nothing else. Release installers are built from this source - checksums are published alongside each release.

## Development

```
npm install
npm run download-jre   # fetch Temurin JRE 21 into assets/jre
npm start
```

Build the Windows installer with `npm run dist` (output in `build/`). Game files live in `%APPDATA%\.mctema`.

## License

Code is licensed under [GPL-3.0](LICENSE). MC Tema branding, logos and artwork are not covered by the code license and may not be reused.

Icons by [game-icons.net](https://game-icons.net) (CC BY 3.0) and Font Awesome Free.
