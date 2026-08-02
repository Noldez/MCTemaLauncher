const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage, safeStorage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const https = require('https');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Client } = require('./lib/mclc');
const { writeVarInt, readVarInt, offlineUUID } = require('./lib/protocol');
const { autoUpdater } = require('electron-updater');

// Software WebGL fallback for GPU-less machines (VMs, blocklisted drivers);
// only used when hardware WebGL fails, renderer loads local UI only.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const SERVER = { host: 'play.mctema.lt', port: 25565 };
const MC_VERSION = '1.21.11';
const FABRIC_LOADER = '0.19.3';
const FABRIC_PROFILE = `fabric-loader-${FABRIC_LOADER}-${MC_VERSION}`;
const DISCORD_CLIENT_ID = '';

const gameDir = path.join(app.getPath('appData'), '.mctema');
const configPath = path.join(gameDir, 'launcher.json');

function ensureDir() {
  try { fs.mkdirSync(gameDir, { recursive: true }); } catch {}
}

function loadConfig() {
  const defaults = { username: '', ram: 4, closeOnPlay: false, discordRpc: true,
    friends: [], totalPlayMs: 0, lastPlayedAt: null, skins: [], currentSkin: null,
    resolution: { w: 1280, h: 720, fullscreen: false }, jvmArgs: '', optionalMods: [],
    friendPrefs: {} };
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; }
  catch { return defaults; }
}

function saveConfig(cfg) {
  ensureDir();
  try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)); } catch {}
}

const WEBSITE_HOST = 'mctema.lt';
const CERT_PINS = [
  'H7AMYAvicN2+UcFPBz3kJXCDmGrTItZh4ujUBK8hoWg=', // GTS WE1
  'YSoUL4CBzo5aJ/ES9gSZTsavsgtHsiLLnTG+BKUdork=', // GTS Root R4
];
const authPath = path.join(gameDir, 'auth.dat');

function loadAuth() {
  try {
    if (!fs.existsSync(authPath) || !safeStorage.isEncryptionAvailable()) return null;
    const o = JSON.parse(safeStorage.decryptString(fs.readFileSync(authPath)));
    if (o && o.username && o.password) return o;
  } catch {}
  return null;
}

function saveAuth(username, password, token) {
  ensureDir();
  fs.writeFileSync(authPath, safeStorage.encryptString(JSON.stringify({ username, password, token: token || null })));
}

function clearAuth() {
  try { fs.rmSync(authPath, { force: true }); } catch {}
}

function pinnedPostJson(reqPath, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    let pinned = false;
    const req = https.request({
      host: WEBSITE_HOST, port: 443, method: 'POST', path: reqPath,
      servername: WEBSITE_HOST, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'MCTemaLauncher',
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (!pinned) { resolve({ error: 'PIN' }); return; }
        try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); }
        catch { resolve({ error: 'BAD_RESPONSE' }); }
      });
    });
    req.on('socket', (s) => s.on('secureConnect', () => {
      try {
        let cert = s.getPeerCertificate(true);
        const seen = new Set();
        while (cert && cert.pubkey && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          const pin = crypto.createHash('sha256').update(cert.pubkey).digest('base64');
          if (CERT_PINS.includes(pin)) { pinned = true; break; }
          if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
          cert = cert.issuerCertificate;
        }
      } catch {}
      if (!pinned) req.destroy(new Error('certificate pin mismatch'));
    }));
    req.on('error', () => resolve({ error: 'NETWORK' }));
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

function authErrText(r) {
  const code = r && r.json && r.json.error;
  switch (code) {
    case 'AUTH_DOWN': return 'Prisijungimas laikinai neveikia.';
    case 'RATE': return 'Per daug bandymų - pabandyk vėliau.';
    case 'WRONG': return 'Neteisingas slapyvardis arba slaptažodis.';
    case 'BAD_INPUT': return 'Slapyvardis: 3-16 simbolių (raidės, skaičiai, _).';
    default: return 'Kažkas nepavyko. Pabandyk dar kartą.';
  }
}

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
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'OS saugykla nepasiekiama.' };
  }
  const r = await pinnedPostJson('/api/launcher/login', { username, password });
  if (r.error) {
    return { ok: false, error: r.error === 'PIN' ? 'Saugumo klaida: nepatikimas sertifikatas.' : 'Nepavyko pasiekti mctema.lt.' };
  }
  if (r.status === 200 && r.json && r.json.ok) {
    const name = r.json.username || username;
    saveAuth(name, password, r.json.token || null);
    const cfg = loadConfig();
    saveConfig({ ...cfg, username: name });
    return { ok: true, username: name };
  }
  return { ok: false, error: authErrText(r) };
});

ipcMain.handle('auth:logout', () => { clearAuth(); return { ok: true }; });

function pinnedApi(method, reqPath, body, token) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    let pinned = false;
    const headers = { 'User-Agent': 'MCTemaLauncher' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const req = https.request({
      host: WEBSITE_HOST, port: 443, method, path: reqPath,
      servername: WEBSITE_HOST, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      agent: false, headers,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (!pinned) { resolve({ error: 'PIN' }); return; }
        try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); }
        catch { resolve({ error: 'BAD_RESPONSE' }); }
      });
    });
    req.on('socket', (s) => s.on('secureConnect', () => {
      try {
        let cert = s.getPeerCertificate(true);
        const seen = new Set();
        while (cert && cert.pubkey && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          const pin = crypto.createHash('sha256').update(cert.pubkey).digest('base64');
          if (CERT_PINS.includes(pin)) { pinned = true; break; }
          if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
          cert = cert.issuerCertificate;
        }
      } catch {}
      if (!pinned) req.destroy(new Error('certificate pin mismatch'));
    }));
    req.on('error', () => resolve({ error: 'NETWORK' }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function refreshLauncherToken(a) {
  const r = await pinnedPostJson('/api/launcher/login', { username: a.username, password: a.password });
  if (r.status === 200 && r.json && r.json.ok && r.json.token) {
    saveAuth(r.json.username || a.username, a.password, r.json.token);
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

function pinnedUpload(reqPath, token, fields, file) {
  return new Promise((resolve) => {
    const boundary = '----mctema' + crypto.randomBytes(12).toString('hex');
    const parts = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.name.replace(/"/g, '')}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.buf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const data = Buffer.concat(parts);
    let pinned = false;
    const req = https.request({
      host: WEBSITE_HOST, port: 443, method: 'POST', path: reqPath,
      servername: WEBSITE_HOST, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      agent: false,
      headers: {
        'User-Agent': 'MCTemaLauncher',
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': data.length,
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (!pinned) { resolve({ error: 'PIN' }); return; }
        try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); }
        catch { resolve({ error: 'BAD_RESPONSE' }); }
      });
    });
    req.on('socket', (s) => s.on('secureConnect', () => {
      try {
        let cert = s.getPeerCertificate(true);
        const seen = new Set();
        while (cert && cert.pubkey && !seen.has(cert.fingerprint256)) {
          seen.add(cert.fingerprint256);
          const pin = crypto.createHash('sha256').update(cert.pubkey).digest('base64');
          if (CERT_PINS.includes(pin)) { pinned = true; break; }
          if (!cert.issuerCertificate || cert.issuerCertificate === cert) break;
          cert = cert.issuerCertificate;
        }
      } catch {}
      if (!pinned) req.destroy(new Error('certificate pin mismatch'));
    }));
    req.on('error', () => resolve({ error: 'NETWORK' }));
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

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
  'mctemaclient.jar': '23ca5d294e9689eed4729490133a719a04f0d55149aaccb2720b6da217332dd4',
};

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function resolveJava() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, 'jre', 'bin', exe)
      : path.join(__dirname, 'assets', 'jre', 'bin', exe),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

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
  const src = bundledModsDir();
  const dst = path.join(gameDir, 'mods');
  for (const f of Object.keys(MOD_HASHES)) {
    const p = path.join(src, f);
    if (!fs.existsSync(p)) throw new Error(`Missing client file: ${f}`);
    if (sha256File(p) !== MOD_HASHES[f]) {
      throw new Error(`Client integrity check failed for ${f}. Reinstall the launcher.`);
    }
  }
  try { fs.rmSync(dst, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(dst, { recursive: true });
  for (const f of Object.keys(MOD_HASHES)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
  for (const st of (loadConfig().optionalMods || [])) {
    if (!st.enabled) continue;
    const p = path.join(optionalDir, st.file);
    try {
      if (fs.existsSync(p) && sha256File(p) === st.sha256) {
        fs.copyFileSync(p, path.join(dst, st.file));
      }
    } catch {}
  }
}

const { Client: RpcClient } = require('@xhayper/discord-rpc');

let rpc = null;
let rpcReady = false;
let rpcDetails = 'Leidykleje';
let rpcStateText = SERVER.host;
let rpcStart = Date.now();

function rpcActivity() {
  return {
    details: rpcDetails,
    state: rpcStateText,
    largeImageKey: 'logo',
    largeImageText: 'MC Tema',
    startTimestamp: rpcStart,
    buttons: [
      { label: 'Zaisk MC Tema', url: 'https://mctema.lt' },
      { label: 'Discord', url: 'https://discord.gg/mctema' },
    ],
    instance: false,
  };
}

function setRpc(details, state, resetTimer) {
  rpcDetails = details;
  rpcStateText = state;
  if (resetTimer) rpcStart = Date.now();
  if (rpc && rpcReady && rpc.user) rpc.user.setActivity(rpcActivity()).catch(() => {});
}

function destroyRpc() {
  if (!rpc) return;
  try { rpc.destroy(); } catch {}
  rpc = null;
  rpcReady = false;
}

function initRpc() {
  if (rpc || !DISCORD_CLIENT_ID) return;
  try {
    rpc = new RpcClient({ clientId: DISCORD_CLIENT_ID });
    rpc.on('ready', () => {
      rpcReady = true;
      if (rpc.user) rpc.user.setActivity(rpcActivity()).catch(() => {});
    });
    rpc.login().catch(() => {
      rpcReady = false;
      rpc = null;
      setTimeout(initRpc, 30000);
    });
  } catch {
    rpc = null;
  }
}

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
  if (!app.isPackaged) return;
  const send = (data) => { if (win && !win.isDestroyed()) win.webContents.send('app:update', data); };
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', () => {});
    autoUpdater.on('update-available', (i) => send({ state: 'available', version: i && i.version }));
    autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i && i.version }));
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 900000);
  } catch {}
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

const TOAST_W = 368;
const TOAST_H = 82;
const toastWins = [];
function layoutToasts() {
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea;
  toastWins.forEach((tw, i) => {
    if (tw.isDestroyed()) return;
    tw.setPosition(wa.x + wa.width - TOAST_W - 8, wa.y + wa.height - (TOAST_H + 4) * (i + 1) - 8);
  });
}
function dropToast(tw) {
  const i = toastWins.indexOf(tw);
  if (i !== -1) toastWins.splice(i, 1);
  if (!tw.isDestroyed()) tw.close();
  layoutToasts();
}
ipcMain.on('notify:native', (_e, p) => {
  const { title, body, nick } = p || {};
  if (!title) return;
  while (toastWins.length >= 3) dropToast(toastWins[0]);
  const tw = new BrowserWindow({
    width: TOAST_W,
    height: TOAST_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'toast-preload.js'), contextIsolation: true },
  });
  tw.setAlwaysOnTop(true, 'screen-saver');
  const qs = new URLSearchParams({ title: String(title), body: String(body || ''), nick: String(nick || '') });
  tw.loadFile(path.join(__dirname, 'renderer', 'toast.html'), { search: qs.toString() });
  tw.once('ready-to-show', () => {
    toastWins.push(tw);
    layoutToasts();
    tw.showInactive();
  });
  const auto = setTimeout(() => dropToast(tw), 8000);
  tw.on('closed', () => clearTimeout(auto));
});
ipcMain.on('toast:dismiss', (e) => {
  const tw = BrowserWindow.fromWebContents(e.sender);
  if (tw) dropToast(tw);
});
ipcMain.on('toast:open', (e, nick) => {
  const tw = BrowserWindow.fromWebContents(e.sender);
  if (tw) dropToast(tw);
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
    if (patch.discordRpc) { setRpc('Leidykleje', SERVER.host, true); initRpc(); }
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

function mcStatus(host, port, timeout = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch {} resolve(v); } };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeout, () => finish({ online: false, players: { online: 0, max: 0 }, sample: [] }));
    socket.on('error', () => finish({ online: false, players: { online: 0, max: 0 }, sample: [] }));

    const pkt = (id, ...parts) => {
      const data = Buffer.concat([writeVarInt(id), ...parts]);
      return Buffer.concat([writeVarInt(data.length), data]);
    };
    const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([writeVarInt(b.length), b]); };

    socket.on('connect', () => {
      const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(port);
      const handshake = pkt(0x00, writeVarInt(-1), str(host), portBuf, writeVarInt(1));
      socket.write(Buffer.concat([handshake, pkt(0x00)]));
    });

    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const len = readVarInt(buf, 0);
      if (!len || buf.length < len.size + len.value) return;
      try {
        let off = len.size;
        const id = readVarInt(buf, off); off += id.size;
        const sLen = readVarInt(buf, off); off += sLen.size;
        const json = JSON.parse(buf.slice(off, off + sLen.value).toString('utf8'));
        const sample = ((json.players && json.players.sample) || [])
          .map((p) => p && p.name)
          .filter((n) => typeof n === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(n));
        finish({
          online: true,
          players: { online: (json.players && json.players.online) || 0, max: (json.players && json.players.max) || 0 },
          sample,
        });
      } catch { finish({ online: false, players: { online: 0, max: 0 }, sample: [] }); }
    });
  });
}

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
      const r = await fetch('https://mctema.lt/api/discord', { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
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
    const form = new FormData();
    form.append('nick', nick);
    const category = String((payload && payload.category) || 'bendra');
    if (/^[a-z]{3,24}$/.test(category)) form.append('category', category);
    form.append('image', new Blob([buf], { type }), path.basename(p));
    const r = await fetch(`${SITE_API}/gallery/submit`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j.error || 'Nepavyko pateikti.' };
    return { ok: true };
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
    const r = await fetch(`${SITE_API}/gallery/${id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, value }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) featuredCache.at = 0;
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
});

let featuredCache = { at: 0, data: [] };
ipcMain.handle('gallery:featured', async () => {
  const now = Date.now();
  if (now - featuredCache.at > 60000) {
    try {
      const r = await fetch(`${SITE_API}/gallery/featured`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const rows = await r.json();
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
  return { version: v.version_number, url: file.url, size: file.size, filename: file.filename };
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
    const r = await fetch(file.url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return { ok: false, error: 'Atsisiuntimas nepavyko.' };
    const buf = Buffer.from(await r.arrayBuffer());
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
  const name = rawName.replace(/[^A-Za-z0-9._\-]/g, '_').slice(0, 64);
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
      const r = await fetch(info.url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) return { ok: false, error: 'Atsisiuntimas nepavyko.' };
      const buf = Buffer.from(await r.arrayBuffer());
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
    setRpc('Leidykleje', SERVER.host, true);
    log(`Zaidimo procesas baigtas (kodas ${code}).`);
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
  });

  let fabricProfile;
  try {
    log('Ruosiamas Fabric loader...');
    fabricProfile = await ensureFabric();
    log('Tikrinamas klientas...');
    ensureMods();
    log('Klientas paruostas.');
  } catch (err) {
    launching = false;
    log('Paruosimas nepavyko: ' + String((err && err.message) || err));
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
    log(`Paleidziamas Minecraft ${MC_VERSION} kaip ${username} (${ram}G)...`);
    const auth = loadAuth();
    if (auth && auth.username.toLowerCase() === username.toLowerCase()) {
      process.env.MCTEMA_PASS = auth.password;
    }
    await launcher.launch(opts);
    delete process.env.MCTEMA_PASS;
    sessionStart = Date.now();
    send('mc:launched', true);
    setRpc('Zaidzia Minecraft', SERVER.host, true);
    log('Minecraft paleistas - jungiamasi prie ' + SERVER.host + '.');
    if (cfg.closeOnPlay && win && !win.isDestroyed()) win.hide();
    return { ok: true };
  } catch (err) {
    delete process.env.MCTEMA_PASS;
    launching = false;
    log('Paleidimas nepavyko: ' + String((err && err.message) || err));
    return { ok: false, error: String((err && err.message) || err) };
  }
});
