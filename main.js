const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Client } = require('./lib/mclc');
const { offlineUUID } = require('./lib/protocol');
const {
  postJson: pinnedPostJson,
  apiRequest: pinnedApi,
  upload: pinnedUpload,
} = require('./lib/pinned-http');
const configStore = require('./lib/config');
const { createCredentialStore, authErrText } = require('./lib/credentials');
const { mcStatus } = require('./lib/mc-status');
const { stageMods, resolveJava: resolveBundledJava } = require('./lib/mods');
const { createRichPresence } = require('./lib/rpc');
const { initUpdater: startUpdater } = require('./lib/updater');
const { createToastStack } = require('./lib/toasts');
const { autoUpdater } = require('electron-updater');

// Software WebGL fallback for GPU-less machines (VMs, blocklisted drivers);
// only used when hardware WebGL fails, renderer loads local UI only.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const SERVER = { host: 'play.mctema.lt', port: 25565 };
const MC_VERSION = '1.21.11';
const FABRIC_LOADER = '0.19.3';
const FABRIC_PROFILE = `fabric-loader-${FABRIC_LOADER}-${MC_VERSION}`;
const DISCORD_CLIENT_ID = '1059908403998236763';

const gameDir = path.join(app.getPath('appData'), '.mctema');
const configPath = path.join(gameDir, 'launcher.json');

function ensureDir() {
  try { fs.mkdirSync(gameDir, { recursive: true }); } catch {}
}

const loadConfig = () => configStore.loadConfig(configPath);
const saveConfig = (cfg) => configStore.saveConfig(configPath, cfg);

const authPath = path.join(gameDir, 'auth.dat');
const credentials = createCredentialStore({ safeStorage, authPath });
const keystoreUsable = () => credentials.keystoreUsable();
const loadAuth = () => credentials.load();
const saveAuth = (record) => credentials.save(record);
const clearAuth = () => credentials.clear();

ipcMain.handle('auth:state', () => {
  const a = loadAuth();
  return { loggedIn: !!a, username: a ? a.username : '' };
});

ipcMain.handle('auth:login', async (_e, payload) => {
  const username = String((payload && payload.username) || '').trim();
  const password = String((payload && payload.password) || '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return { ok: false, error: 'Slapyvardis: 3-16 simbolių (raidės, skaičiai, _).' };
  }
  if (!password) return { ok: false, error: 'Įvesk slaptažodį.' };
  if (!keystoreUsable()) {
    return {
      ok: false,
      error: process.platform === 'linux'
        ? 'Nerasta saugi raktinė (gnome-keyring arba kwallet).'
        : 'OS saugykla nepasiekiama.',
    };
  }
  const r = await pinnedPostJson('/api/launcher/login', { username, password });
  if (r.error) {
    return { ok: false, error: r.error === 'PIN' ? 'Saugumo klaida: nepatikimas sertifikatas.' : 'Nepavyko pasiekti mctema.lt.' };
  }
  if (r.status === 200 && r.json && r.json.ok) {
    const name = r.json.username || username;
    saveAuth({
      username: name,
      password,
      token: r.json.token || null,
      refreshToken: r.json.refreshToken || null,
    });
    const cfg = loadConfig();
    saveConfig({ ...cfg, username: name });
    return { ok: true, username: name };
  }
  return { ok: false, error: authErrText(r) };
});

ipcMain.handle('auth:logout', async () => {
  // Retire the token server-side too, so it cannot outlive the logout.
  const a = loadAuth();
  if (a && a.token) await pinnedApi('POST', '/api/launcher/logout', null, a.token);
  clearAuth();
  return { ok: true };
});

/**
 * Get a working session token again after the old one expired or was revoked.
 *
 * Prefers the refresh token, so the account password is not sent over the wire
 * to stay logged in. Falls back to a password login only for installs that
 * predate refresh tokens, or when the refresh token has been revoked - which is
 * what the server does deliberately if it ever sees one replayed.
 */
async function refreshLauncherToken(a) {
  if (a.refreshToken) {
    const r = await pinnedPostJson('/api/launcher/refresh', { refreshToken: a.refreshToken });
    if (r.status === 200 && r.json && r.json.ok && r.json.token) {
      saveAuth({
        username: r.json.username || a.username,
        password: a.password,
        token: r.json.token,
        refreshToken: r.json.refreshToken || null,
      });
      return loadAuth();
    }
    // A network blip should not cost the user their stored refresh token; only
    // a definitive rejection means it is worthless.
    if (r.error) return null;
    saveAuth({ username: a.username, password: a.password, token: null, refreshToken: null });
    a = loadAuth();
    if (!a) return null;
  }

  if (!a.password) return null;
  const r = await pinnedPostJson('/api/launcher/login', { username: a.username, password: a.password });
  if (r.status === 200 && r.json && r.json.ok && r.json.token) {
    saveAuth({
      username: r.json.username || a.username,
      password: a.password,
      token: r.json.token,
      refreshToken: r.json.refreshToken || null,
    });
    return loadAuth();
  }
  return null;
}

const FRIEND_ERR = {
  NO_ACCOUNT: 'Toks žaidėjas neregistruotas serveryje.',
  ALREADY_FRIENDS: 'Jau esate draugai.',
  ALREADY_SENT: 'Prašymas jau išsiųstas.',
  SELF: 'Savęs pridėti negalima.',
  TOO_MANY: 'Pasiektas limitas.',
  TOKEN: 'Prisijunk iš naujo.',
  BAD_INPUT: 'Netinkamas slapyvardis.',
  NOT_FOUND: 'Prašymas neberastas.',
  NOT_FRIENDS: 'Rašyti galima tik draugams.',
  TOO_LARGE: 'Failas per didelis (iki 8 MB).',
  BAD_FILE: 'Netinkamas failas.',
};

/**
 * A short-lived, presence-only token for the game process.
 *
 * Best effort on purpose: this buys a badge in the tab list, and nothing about
 * it is worth refusing to start Minecraft over.
 */
async function mintGameToken() {
  try {
    const r = await friendsApi('POST', '/api/launcher/game-token');
    return r && r.ok && typeof r.token === 'string' ? r.token : null;
  } catch {
    return null;
  }
}

/**
 * A one-shot stand-in for the account password, for the auto-login handshake.
 *
 * The game process runs mods we did not write and they can all read its
 * environment, so what goes in there should be worth as little as possible. A
 * ticket is spent the moment the server redeems it and could only ever have
 * logged in this one nick.
 */
async function mintLoginTicket() {
  try {
    const r = await friendsApi('POST', '/api/launcher/login-ticket');
    return r && r.ok && typeof r.ticket === 'string' ? r.ticket : null;
  } catch {
    return null;
  }
}

async function friendsApi(method, apiPath, body) {
  let a = loadAuth();
  if (!a) return { ok: false, error: 'Prisijunk iš naujo.' };
  if (!a.token) {
    a = await refreshLauncherToken(a);
    if (!a) return { ok: false, error: 'Prisijunk iš naujo.' };
  }
  let r = await pinnedApi(method, apiPath, body, a.token);
  if (r.error === 'NETWORK' && method === 'GET') {
    // transient DNS/socket blips (VM NAT, waking from sleep) - retry reads once
    await new Promise((res) => setTimeout(res, 700));
    r = await pinnedApi(method, apiPath, body, a.token);
  }
  if (r.status === 401) {
    const fresh = await refreshLauncherToken(a);
    if (!fresh) return { ok: false, error: 'Prisijunk iš naujo.' };
    r = await pinnedApi(method, apiPath, body, fresh.token);
  }
  if (r.error) return { ok: false, error: 'Nepavyko pasiekti mctema.lt.' };
  if (r.json && r.json.ok) return r.json;
  return { ok: false, error: FRIEND_ERR[r.json && r.json.error] || 'Kažkas nepavyko.' };
}

ipcMain.handle('friends:list', () => friendsApi('GET', '/api/launcher/friends'));
ipcMain.handle('friends:request', (_e, to) => friendsApi('POST', '/api/launcher/friends/request', { to: String(to || '') }));
ipcMain.handle('friends:respond', (_e, p) => friendsApi('POST', '/api/launcher/friends/respond', { id: Number(p && p.id), accept: !!(p && p.accept) }));
ipcMain.handle('friends:cancel', (_e, id) => friendsApi('POST', '/api/launcher/friends/cancel', { id: Number(id) }));
ipcMain.handle('friends:remove', (_e, nick) => friendsApi('POST', '/api/launcher/friends/remove', { nick: String(nick || '') }));

ipcMain.handle('chat:inbox', () => friendsApi('GET', '/api/launcher/messages/inbox'));
ipcMain.handle('chat:history', (_e, p) => {
  const withNick = encodeURIComponent(String((p && p.with) || ''));
  const after = Number((p && p.after) || 0);
  return friendsApi('GET', `/api/launcher/messages?with=${withNick}&after=${after}`);
});
ipcMain.handle('chat:send', (_e, p) => friendsApi('POST', '/api/launcher/messages', {
  to: String((p && p.to) || ''), body: String((p && p.body) || '').slice(0, 1000),
}));

ipcMain.handle('chat:sendImage', async (_e, p) => {
  const to = String((p && p.to) || '');
  const name = String((p && p.name) || 'nuotrauka.png').slice(0, 64);
  let buf;
  try { buf = Buffer.from(String((p && p.data) || ''), 'base64'); } catch { buf = null; }
  if (!buf || !buf.length || buf.length > 8 * 1024 * 1024) return { ok: false, error: 'Netinkamas failas.' };
  const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
  let a = loadAuth();
  if (!a) return { ok: false, error: 'Prisijunk iš naujo.' };
  if (!a.token) {
    a = await refreshLauncherToken(a);
    if (!a) return { ok: false, error: 'Prisijunk iš naujo.' };
  }
  let r = await pinnedUpload('/api/launcher/messages/image', a.token, { to }, { name, type, buf });
  if (r.status === 401) {
    const fresh = await refreshLauncherToken(a);
    if (!fresh) return { ok: false, error: 'Prisijunk iš naujo.' };
    r = await pinnedUpload('/api/launcher/messages/image', fresh.token, { to }, { name, type, buf });
  }
  if (r.error) return { ok: false, error: 'Nepavyko pasiekti mctema.lt.' };
  if (r.json && r.json.ok) return r.json;
  return { ok: false, error: FRIEND_ERR[r.json && r.json.error] || 'Nepavyko išsiųsti.' };
});

const MOD_HASHES = {
  'fabric-api.jar': 'bdff7fd7e220085cfad2ff9b1f40dde6534ae0b96cf378f97a374bc54cb9ed0f',
  'mctemaclient.jar': 'ce0d0b51ebf0253eb74ff8f04ebdb78e3282b38793e2cb3b38ab1ec264303d7d',
};

const resolveJava = () => resolveBundledJava({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appDir: __dirname,
});

function bundledModsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mods')
    : path.join(__dirname, 'mods');
}

async function ensureFabric() {
  const dir = path.join(gameDir, 'versions', FABRIC_PROFILE);
  const jsonPath = path.join(dir, `${FABRIC_PROFILE}.json`);
  if (!fs.existsSync(jsonPath)) {
    const url = `https://meta.fabricmc.net/v2/versions/loader/${MC_VERSION}/${FABRIC_LOADER}/profile/json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fabric meta ${res.status}`);
    const json = await res.text();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jsonPath, json);
  }
  return FABRIC_PROFILE;
}

function ensureMods() {
  stageMods({
    srcDir: bundledModsDir(),
    dstDir: path.join(gameDir, 'mods'),
    hashes: MOD_HASHES,
    optionalDir,
    optionalMods: loadConfig().optionalMods || [],
  });
}

const presence = createRichPresence({ clientId: DISCORD_CLIENT_ID, defaultState: SERVER.host });
const setRpc = (details, state, resetTimer) => presence.set(details, state, resetTimer);
const destroyRpc = () => presence.destroy();
const initRpc = () => presence.init();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1100,
    minHeight: 640,
    maximizable: true,
    fullscreenable: false,
    frame: false,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#0a0a0c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

function initUpdater() {
  startUpdater({
    autoUpdater,
    enabled: app.isPackaged,
    send: (data) => { if (win && !win.isDestroyed()) win.webContents.send('app:update', data); },
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('lt.mctema.launcher');
  ensureDir();
  createWindow();
  if (loadConfig().discordRpc !== false) initRpc();
  initUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:focus', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

const toasts = createToastStack({ BrowserWindow, getScreen: () => require('electron').screen, appDir: __dirname });

ipcMain.on('notify:native', (_e, p) => toasts.show(p || {}));

ipcMain.on('toast:dismiss', (e) => { toasts.dropBySender(e.sender); });

ipcMain.on('toast:open', (e, nick) => {
  toasts.dropBySender(e.sender);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (nick) win.webContents.send('relay:open', String(nick));
});
ipcMain.on('win:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.on('win:close', () => win && win.close());
ipcMain.on('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:set', (_e, patch) => {
  const cfg = loadConfig();
  const next = { ...cfg, ...(patch || {}) };
  if (next.ram != null) next.ram = Math.min(16, Math.max(2, Number(next.ram) || 4));
  if (next.username != null) next.username = String(next.username).slice(0, 16);
  saveConfig(next);
  if (patch && 'discordRpc' in patch) {
    if (patch.discordRpc) { setRpc('Launcheryje', SERVER.host, true); initRpc(); }
    else destroyRpc();
  }
  return next;
});

ipcMain.handle('config:openFolder', () => {
  ensureDir();
  shell.openPath(gameDir);
  return true;
});

ipcMain.handle('app:installUpdate', () => {
  try { autoUpdater.quitAndInstall(true, true); } catch {}
  return true;
});

ipcMain.handle('server:status', () => mcStatus(SERVER.host, SERVER.port, 4000));

const shotsDir = path.join(gameDir, 'screenshots');
const inShots = (p) => typeof p === 'string' && path.resolve(p).startsWith(shotsDir + path.sep);

ipcMain.handle('shots:list', () => {
  try {
    return fs.readdirSync(shotsDir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .map((f) => {
        const p = path.join(shotsDir, f);
        const st = fs.statSync(p);
        return { name: f, path: p, url: pathToFileURL(p).href, size: st.size, mtime: st.mtimeMs };
      });
  } catch { return []; }
});
ipcMain.handle('shots:delete', async (_e, p) => {
  if (!inShots(p)) return false;
  try { await shell.trashItem(p); return true; } catch { return false; }
});
ipcMain.handle('shots:open', (_e, p) => { if (inShots(p)) shell.openPath(p); return true; });
ipcMain.handle('shots:copy', (_e, p) => { if (inShots(p)) clipboard.writeImage(nativeImage.createFromPath(p)); return true; });
ipcMain.handle('shots:openFolder', () => { fs.mkdirSync(shotsDir, { recursive: true }); shell.openPath(shotsDir); return true; });

const skinsDir = path.join(gameDir, 'skins');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

ipcMain.handle('skins:save', (_e, payload) => {
  const m = /^data:image\/png;base64,(.+)$/.exec(String((payload && payload.dataUrl) || ''));
  if (!m) return { ok: false, error: 'Netinkamas failas - reikia PNG.' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 262144 || buf.length < 33 || !buf.slice(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, error: 'Netinkamas PNG failas.' };
  }
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 64 || (h !== 64 && h !== 32)) return { ok: false, error: 'Skinas turi būti 64x64 arba 64x32 PNG.' };
  const id = crypto.randomUUID();
  fs.mkdirSync(skinsDir, { recursive: true });
  fs.writeFileSync(path.join(skinsDir, `${id}.png`), buf);
  const cfg = loadConfig();
  const skin = { id, name: String((payload && payload.name) || 'be vardo').slice(0, 24),
    variant: payload && payload.variant === 'slim' ? 'slim' : 'wide', favorite: false, addedAt: Date.now() };
  saveConfig({ ...cfg, skins: [...(cfg.skins || []), skin], currentSkin: id });
  return { ok: true, skin };
});
ipcMain.handle('skins:list', () => {
  const cfg = loadConfig();
  return { current: cfg.currentSkin || null,
    skins: (cfg.skins || []).map((s) => ({ ...s, url: pathToFileURL(path.join(skinsDir, `${s.id}.png`)).href })) };
});
ipcMain.handle('skins:set', (_e, id) => {
  const c = loadConfig();
  if ((c.skins || []).some((s) => s.id === id)) saveConfig({ ...c, currentSkin: id });
  return true;
});
ipcMain.handle('skins:delete', (_e, id) => {
  const c = loadConfig();
  saveConfig({ ...c, skins: (c.skins || []).filter((s) => s.id !== id),
    currentSkin: c.currentSkin === id ? null : c.currentSkin });
  try { fs.rmSync(path.join(skinsDir, `${String(id).replace(/[^a-f0-9-]/g, '')}.png`)); } catch {}
  return true;
});
ipcMain.handle('skins:fav', (_e, p) => {
  const c = loadConfig();
  saveConfig({ ...c, skins: (c.skins || []).map((s) => s.id === (p && p.id) ? { ...s, favorite: !!p.favorite } : s) });
  return true;
});

let discordCache = { at: 0, data: { online: null, invite: null } };
ipcMain.handle('discord:status', async () => {
  const now = Date.now();
  if (now - discordCache.at > 60000) {
    try {
      const r = await pinnedApi('GET', '/api/discord', null, null);
      if (!r.error && r.status === 200) {
        const j = r.json || {};
        discordCache = { at: now, data: { online: j.online ?? null, invite: j.invite ?? null } };
      } else {
        discordCache = { at: now, data: { online: null, invite: null } };
      }
    } catch {
      discordCache = { at: now, data: { online: null, invite: null } };
    }
  }
  return discordCache.data;
});

const SITE_API = 'https://mctema.lt/api';

ipcMain.handle('gallery:submit', async (_e, payload) => {
  const p = payload && payload.path;
  const nick = String((payload && payload.nick) || '').trim();
  if (!inShots(p)) return { ok: false, error: 'Netinkamas failas.' };
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) return { ok: false, error: 'Netinkamas slapyvardis.' };
  try {
    const buf = fs.readFileSync(p);
    const type = /\.png$/i.test(p) ? 'image/png' : 'image/jpeg';
    const rawCategory = String((payload && payload.category) || 'bendra');
    const category = /^[a-z]{3,24}$/.test(rawCategory) ? rawCategory : 'bendra';
    const name = path.basename(p);
    // Session token so the server credits the submission to the logged-in
    // account instead of trusting the nick in the form body. Sent through the
    // pinned client: a bearer token must never travel on a connection that a
    // mis-issued certificate could read.
    const a = loadAuth();
    if (!a || !a.token) return { ok: false, error: 'Prisijunk iš naujo.' };
    const r = await pinnedUpload('/api/gallery/submit', a.token, { nick, category }, { name, type, buf });
    if (r.error) return { ok: false, error: 'Nepavyko pasiekti mctema.lt.' };
    if (r.status === 200 && r.json && r.json.ok !== false) return { ok: true };
    return { ok: false, error: (r.json && r.json.error) || 'Nepavyko pateikti.' };
  } catch {
    return { ok: false, error: 'Nepavyko pasiekti mctema.lt.' };
  }
});

ipcMain.handle('gallery:vote', async (_e, payload) => {
  const id = Number(payload && payload.id);
  const value = Number(payload && payload.value);
  const nick = String((payload && payload.nick) || '').trim();
  if (!Number.isInteger(id) || ![1, -1].includes(value) || !/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
    return { ok: false };
  }
  try {
    const r = await pinnedApi('POST', `/api/gallery/${id}/vote`, { nick, value });
    const ok = !r.error && r.status === 200;
    if (ok) featuredCache.at = 0;
    return { ok };
  } catch {
    return { ok: false };
  }
});

let featuredCache = { at: 0, data: [] };
ipcMain.handle('gallery:featured', async () => {
  const now = Date.now();
  if (now - featuredCache.at > 60000) {
    try {
      const r = await pinnedApi('GET', '/api/gallery/featured', null, null);
      if (!r.error && r.status === 200) {
        const rows = r.json;
        featuredCache = {
          at: now,
          data: (Array.isArray(rows) ? rows : []).map((x) => ({
            id: x.id, nick: x.nick, url: `${SITE_API}${x.url}`, at: x.at,
            category: x.category || 'bendra',
            up: Number(x.up) || 0, down: Number(x.down) || 0,
          })),
        };
      } else {
        featuredCache = { at: now, data: [] };
      }
    } catch {
      featuredCache = { at: now, data: [] };
    }
  }
  return featuredCache.data;
});

ipcMain.handle('mods:list', () => {
  try {
    const dir = bundledModsDir();
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jar'))
      .map((f) => ({ file: f, size: fs.statSync(path.join(dir, f)).size }));
  } catch { return []; }
});

const optionalDir = path.join(gameDir, 'optional-mods');
const OMOD_CATALOG = [
  { id: 'sodium', name: 'Sodium', author: 'JellySquid', desc: 'FPS optimizacija - greitesnis renderinimas' },
  { id: 'lithium', name: 'Lithium', author: 'JellySquid', desc: 'Serverio/tick optimizacija' },
  { id: 'entityculling', name: 'Entity Culling', author: 'tr7zw', desc: 'Nerodo nematomu esybiu - daugiau FPS' },
  { id: 'dynamic-fps', name: 'Dynamic FPS', author: 'juliand665', desc: 'Mazina apkrova kai langas neaktyvus' },
  { id: 'iris', name: 'Iris Shaders', author: 'coderbot', desc: 'Shaderiu palaikymas (OptiFine formatas)' },
];
let omodInfoCache = { at: 0, data: {} };
const SODIUM_PROJECT_ID = 'AANobbMI';

function omodPackVersion(v) {
  const file = v.files.find((f) => f.primary) || v.files[0];
  // hashes are carried through so the download can be verified against what
  // the API said it would be, rather than against itself.
  return {
    version: v.version_number, url: file.url, size: file.size,
    filename: file.filename, hashes: file.hashes || null,
  };
}

/**
 * Download an optional mod and prove it is the file Modrinth described.
 * Returns the buffer, or null if anything about it is wrong.
 *
 * These jars are handed to Fabric and run as code inside the game, so an
 * unverified download is arbitrary code execution. Modrinth publishes sha512
 * for every file; we refuse anything that does not match.
 */
async function downloadVerifiedMod(file) {
  try {
    if (!file || typeof file.url !== 'string') return null;
    // Never let an API response redirect us off Modrinth or down to cleartext.
    const u = new URL(file.url);
    if (u.protocol !== 'https:' || u.hostname !== 'cdn.modrinth.com') return null;

    const algo = file.hashes && file.hashes.sha512 ? 'sha512' : file.hashes && file.hashes.sha1 ? 'sha1' : null;
    if (!algo) return null;
    const expected = String(file.hashes[algo]).toLowerCase();

    const r = await fetch(u.href, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 64 * 1024 * 1024) return null;
    // Same shape check the local-file path applies: it must be a zip/jar.
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return null;

    const got = crypto.createHash(algo).update(buf).digest('hex');
    if (got !== expected) return null;
    return buf;
  } catch {
    return null;
  }
}

async function omodFetchInfo() {
  const now = Date.now();
  if (now - omodInfoCache.at < 3600000 && Object.keys(omodInfoCache.data).length) return omodInfoCache.data;
  const data = {};
  const picked = {};
  await Promise.all(OMOD_CATALOG.map(async (m) => {
    try {
      const q = `https://api.modrinth.com/v2/project/${m.id}/version?game_versions=%5B%221.21.11%22%5D&loaders=%5B%22fabric%22%5D`;
      const [vr, pr] = await Promise.all([
        fetch(q, { signal: AbortSignal.timeout(10000) }),
        fetch(`https://api.modrinth.com/v2/project/${m.id}`, { signal: AbortSignal.timeout(10000) }),
      ]);
      if (!vr.ok) return;
      const versions = await vr.json();
      const v = versions.find((x) => x.version_type === 'release') || versions[0];
      if (!v) return;
      picked[m.id] = v;
      const proj = pr.ok ? await pr.json() : {};
      data[m.id] = { ...omodPackVersion(v), icon: proj.icon_url || null };
    } catch {}
  }));
  try {
    const iris = picked['iris'];
    const dep = iris && (iris.dependencies || []).find((d) => d.project_id === SODIUM_PROJECT_ID && d.version_id);
    if (dep && data['sodium']) {
      const r = await fetch(`https://api.modrinth.com/v2/version/${dep.version_id}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const v = await r.json();
        data['sodium'] = { ...data['sodium'], ...omodPackVersion(v) };
      }
    }
  } catch {}
  if (Object.keys(data).length) omodInfoCache = { at: now, data };
  return omodInfoCache.data;
}

ipcMain.handle('omods:list', async () => {
  const cfg = loadConfig();
  const info = await omodFetchInfo();
  const catalog = OMOD_CATALOG.map((m) => {
    const st = (cfg.optionalMods || []).find((x) => x.id === m.id);
    const i = info[m.id] || {};
    return {
      id: m.id, name: m.name, author: m.author, desc: m.desc,
      icon: i.icon || null,
      version: st ? st.version : (i.version || null),
      size: st ? st.size : (i.size || null),
      available: !!i.url,
      installed: !!st,
      enabled: !!(st && st.enabled),
    };
  });
  const extras = (cfg.optionalMods || [])
    .filter((x) => !OMOD_CATALOG.some((c) => c.id === x.id))
    .map((st) => ({
      id: st.id, name: st.name || st.file, author: st.author || (st.source === 'local' ? 'Vietinis failas' : 'Modrinth'),
      icon: st.icon || null, version: st.version || null, size: st.size || null,
      available: true, installed: true, enabled: !!st.enabled, third: true,
    }));
  return [...catalog, ...extras];
});

ipcMain.handle('omods:search', async (_e, query) => {
  const q = String(query || '').trim().slice(0, 48);
  if (q.length < 2) return [];
  try {
    const facets = encodeURIComponent('[["versions:1.21.11"],["categories:fabric"],["project_type:mod"]]');
    const r = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(q)}&facets=${facets}&limit=8`,
      { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.hits || []).map((h) => ({
      slug: h.slug, name: h.title, author: h.author, icon: h.icon_url || null,
      downloads: h.downloads,
    }));
  } catch { return []; }
});

ipcMain.handle('omods:addModrinth', async (_e, payload) => {
  const slug = String((payload && payload.slug) || '').trim();
  if (!/^[a-z0-9\-_]{2,64}$/i.test(slug)) return { ok: false, error: 'Netinkamas modas.' };
  const cfg = loadConfig();
  if ((cfg.optionalMods || []).some((x) => x.id === slug) || OMOD_CATALOG.some((c) => c.id === slug)) {
    return { ok: false, error: 'Modas jau pridėtas.' };
  }
  try {
    const q = `https://api.modrinth.com/v2/project/${slug}/version?game_versions=%5B%221.21.11%22%5D&loaders=%5B%22fabric%22%5D`;
    const vr = await fetch(q, { signal: AbortSignal.timeout(10000) });
    if (!vr.ok) return { ok: false, error: 'Modas nepasiekiamas.' };
    const versions = await vr.json();
    const v = versions.find((x) => x.version_type === 'release') || versions[0];
    if (!v) return { ok: false, error: 'Nėra versijos 1.21.11 Fabric.' };
    const file = v.files.find((f) => f.primary) || v.files[0];
    const buf = await downloadVerifiedMod(file);
    if (!buf) return { ok: false, error: 'Atsisiuntimas nepavyko arba failas neatitinka kontrolinės sumos.' };
    fs.mkdirSync(optionalDir, { recursive: true });
    const fname = `${slug}.jar`;
    fs.writeFileSync(path.join(optionalDir, fname), buf);
    const st = {
      id: slug, source: 'modrinth', file: fname,
      name: String((payload && payload.name) || slug).slice(0, 48),
      author: String((payload && payload.author) || 'Modrinth').slice(0, 32),
      icon: (payload && payload.icon) || null,
      version: v.version_number, size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      enabled: true,
    };
    saveConfig({ ...loadConfig(), optionalMods: [...(loadConfig().optionalMods || []), st] });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Atsisiuntimas nepavyko.' };
  }
});

ipcMain.handle('omods:addLocal', (_e, payload) => {
  const rawName = String((payload && payload.name) || 'modas.jar');
  const name = rawName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  if (!name.endsWith('.jar')) return { ok: false, error: 'Tik .jar failai.' };
  let buf;
  try { buf = Buffer.from(String((payload && payload.data) || ''), 'base64'); } catch { buf = null; }
  if (!buf || !buf.length || buf.length > 64 * 1024 * 1024) return { ok: false, error: 'Netinkamas failas.' };
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { ok: false, error: 'Failas nėra .jar archyvas.' };
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const cfg = loadConfig();
  if ((cfg.optionalMods || []).some((x) => x.sha256 === sha)) return { ok: false, error: 'Toks modas jau pridėtas.' };
  fs.mkdirSync(optionalDir, { recursive: true });
  const file = `local-${sha.slice(0, 8)}-${name}`;
  fs.writeFileSync(path.join(optionalDir, file), buf);
  const st = {
    id: `local-${sha.slice(0, 8)}`, source: 'local', file,
    name: name.replace(/\.jar$/, ''), author: 'Vietinis failas',
    version: '', size: buf.length, sha256: sha, enabled: true,
  };
  saveConfig({ ...cfg, optionalMods: [...(cfg.optionalMods || []), st] });
  return { ok: true };
});

ipcMain.handle('omods:toggle', async (_e, payload) => {
  const id = String((payload && payload.id) || '');
  const enabled = !!(payload && payload.enabled);
  const m = OMOD_CATALOG.find((x) => x.id === id);
  const cfg = loadConfig();
  let st = (cfg.optionalMods || []).find((x) => x.id === id);
  if (!m) {
    if (!st) return { ok: false, error: 'Nežinomas modas.' };
    saveConfig({ ...cfg, optionalMods: (cfg.optionalMods || []).map((x) => x.id === id ? { ...x, enabled } : x) });
    return { ok: true };
  }
  if (enabled && st) {
    const info = (await omodFetchInfo())[id];
    if (info && info.version !== st.version) {
      try { fs.rmSync(path.join(optionalDir, st.file), { force: true }); } catch {}
      saveConfig({ ...cfg, optionalMods: (cfg.optionalMods || []).filter((x) => x.id !== id) });
      st = null;
    }
  }
  if (enabled && !st) {
    const info = (await omodFetchInfo())[id];
    if (!info) return { ok: false, error: 'Modas nepasiekiamas - patikrink internetą.' };
    try {
      const buf = await downloadVerifiedMod(info);
      if (!buf) return { ok: false, error: 'Atsisiuntimas nepavyko arba failas neatitinka kontrolinės sumos.' };
      fs.mkdirSync(optionalDir, { recursive: true });
      const file = `${id}.jar`;
      fs.writeFileSync(path.join(optionalDir, file), buf);
      st = {
        id, file, version: info.version, size: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        enabled: true,
      };
      saveConfig({ ...cfg, optionalMods: [...(cfg.optionalMods || []).filter((x) => x.id !== id), st] });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Atsisiuntimas nepavyko.' };
    }
  }
  if (!st) return { ok: false, error: 'Modas neįdiegtas.' };
  saveConfig({
    ...cfg,
    optionalMods: (cfg.optionalMods || []).map((x) => x.id === id ? { ...x, enabled } : x),
  });
  return { ok: true };
});

ipcMain.handle('omods:remove', (_e, id) => {
  const cfg = loadConfig();
  const st = (cfg.optionalMods || []).find((x) => x.id === String(id));
  if (st) {
    try { fs.rmSync(path.join(optionalDir, st.file), { force: true }); } catch {}
    saveConfig({ ...cfg, optionalMods: (cfg.optionalMods || []).filter((x) => x.id !== String(id)) });
  }
  return { ok: true };
});

let launching = false;
let sessionStart = null;

ipcMain.handle('game:play', async (_e, payload) => {
  const username = String((payload && payload.username) || '').trim();
  const ram = Math.min(16, Math.max(2, Number((payload && payload.ram) || loadConfig().ram || 4)));

  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    return { ok: false, error: 'Slapyvardis turi buti 3-16 simboliu: raides, skaiciai, pabraukimas.' };
  }
  if (launching) return { ok: false, error: 'Jau paleidziama.' };
  launching = true;

  const cfg = loadConfig();
  saveConfig({ ...cfg, username, ram });

  const send = (channel, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
  const log = (m) => send('mc:log', `[MC Tema] ${m}`);

  const launcher = new Client();
  launcher.on('progress', (e) => send('mc:progress', e));
  launcher.on('download-status', (e) => send('mc:download', e));
  launcher.on('debug', (m) => send('mc:log', String(m)));
  launcher.on('data', (m) => send('mc:log', String(m)));
  launcher.on('close', (code) => {
    launching = false;
    if (sessionStart) {
      const c = loadConfig();
      saveConfig({ ...c, totalPlayMs: (c.totalPlayMs || 0) + (Date.now() - sessionStart), lastPlayedAt: Date.now() });
      sessionStart = null;
    }
    send('mc:closed', code);
    setRpc('Launcheryje', SERVER.host, true);
    log(`Zaidimo procesas baigtas (kodas ${code}).`);
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });

  let fabricProfile;
  try {
    log('Ruošiamas Fabric loader...');
    fabricProfile = await ensureFabric();
    log('Tikrinamas klientas...');
    ensureMods();
    log('Klientas paruoštas.');
  } catch (err) {
    launching = false;
    log('Paruošimas nepavyko: ' + String((err && err.message) || err));
    return { ok: false, error: 'Nepavyko paruosti kliento: ' + String((err && err.message) || err) };
  }

  const opts = {
    authorization: {
      access_token: '0',
      client_token: '0',
      uuid: offlineUUID(username),
      name: username,
      user_properties: '{}',
      meta: { type: 'mojang', demo: false },
    },
    root: gameDir,
    version: { number: MC_VERSION, type: 'release', custom: fabricProfile },
    memory: { max: `${ram}G`, min: '1G' },
    javaPath: resolveJava(),
    quickPlay: { type: 'multiplayer', identifier: `${SERVER.host}:${SERVER.port}` },
  };

  const res = cfg.resolution || {};
  const rw = Math.min(7680, Math.max(640, Number(res.w) || 1280));
  const rh = Math.min(4320, Math.max(480, Number(res.h) || 720));
  opts.window = { width: rw, height: rh, fullscreen: !!res.fullscreen };
  const jvm = String(cfg.jvmArgs || '').trim();
  if (jvm) opts.customArgs = jvm.split(/\s+/).filter((a) => /^-[A-Za-z0-9:+\-=._,]+$/.test(a));

  try {
    const verDir = path.join(gameDir, 'versions', MC_VERSION);
    const verJar = path.join(verDir, `${MC_VERSION}.jar`);
    if (fs.existsSync(verJar) && fs.statSync(verJar).size < 1048576) {
      fs.rmSync(verDir, { recursive: true, force: true });
    }
  } catch {}

  try {
    log(`Paleidžiamas Minecraft ${MC_VERSION} kaip ${username} (${ram}G)...`);
    const auth = loadAuth();
    if (auth && auth.username.toLowerCase() === username.toLowerCase()) {
      // Never our own session token: the game runs third-party mods in the same
      // JVM, and any of them can read this environment. What goes in is a
      // separate token that reaches the presence beat and nothing else, so the
      // worst it buys a thief is looking like they are playing.
      const [gameToken, ticket] = await Promise.all([mintGameToken(), mintLoginTicket()]);
      // The account password does not go in here, and must not be put back.
      // Everything loaded into that JVM can read this environment, mods we did
      // not write included, and the launcher lets a player install any jar they
      // like. A ticket is spent the moment the server redeems it and could only
      // ever have logged in this one nick, so finding it there is worth nothing.
      //
      // If the ticket cannot be minted the game still starts; the player types
      // /login themselves that once. That is the right trade against leaving a
      // password where anything can read it.
      const secret = ticket ? { MCTEMA_TICKET: ticket } : {};
      if (!ticket) log('Nepavyko gauti prisijungimo bilieto - prisijunk su /login.');
      // Scoped to the game process; never placed in our own environment, where
      // every child spawned while preparing the launch would inherit it.
      opts.overrides = {
        ...(opts.overrides || {}),
        env: { ...secret, ...(gameToken ? { MCTEMA_TOKEN: gameToken } : {}) },
      };
    }
    await launcher.launch(opts);
    sessionStart = Date.now();
    send('mc:launched', true);
    setRpc('Žaidžia Minecraft', SERVER.host, true);
    log('Minecraft paleistas - jungiamasi prie ' + SERVER.host + '.');
    if (cfg.closeOnPlay && win && !win.isDestroyed()) win.hide();
    return { ok: true };
  } catch (err) {
    launching = false;
    log('Paleidimas nepavyko: ' + String((err && err.message) || err));
    return { ok: false, error: String((err && err.message) || err) };
  }
});
