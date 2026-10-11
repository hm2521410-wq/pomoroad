'use strict';
// Pomoroad — Electron のメインプロセス
// メイン画面・ミニ表示（常に手前）・タスクトレイ・全体のショートカット・電源イベントを扱う。

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  powerMonitor,
  protocol,
  shell,
  screen,
  Notification,
  nativeTheme,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_ID = 'com.hm.pomoroad';
const SRC = path.join(__dirname, '..', 'src');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://pomoroad`;
const START_HIDDEN = process.argv.includes('--hidden');

// 音を自動で鳴らせるように・裏に回っても時間がずれないように
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

let mainWin = null;
let miniWin = null;
let tray = null;
let quitting = false;
let lastState = null;
let sys = { closeToTray: true, mainOnTop: false, openAtLogin: false };
let miniOpts = { layout: 'bar', scale: 1, opacity: 100, onTop: true, autoOnMinimize: true, hideWhenMainFocused: false, size: [300, 64] };
let miniWanted = false;

// ── ウィンドウの位置の保存 ─────────────────────────
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function readWinState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}
let winState = {};
let saveTimer = null;
function saveWinState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(statePath(), JSON.stringify(winState));
    } catch (err) {
      console.error('window state save failed', err);
    }
  }, 400);
}
function visibleOnSomeDisplay(b) {
  if (!b) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x + 40 < a.x + a.width && b.x + b.width - 40 > a.x && b.y + 20 < a.y + a.height && b.y + 20 > a.y - 10;
  });
}

// ── 画面ファイルの配信（app://pomoroad/…） ─────────────
function registerProtocol() {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(SRC, rel));
    if (!file.startsWith(SRC)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const iconPath = () => path.join(SRC, 'assets', 'icon.png');

const webPrefs = (extra = {}) => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
  spellcheck: false,
  ...extra,
});

function lockExternalNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) e.preventDefault();
  });
}

// ── メイン画面 ─────────────────────────────────────
function createMain() {
  const b = winState.main;
  const ok = visibleOnSomeDisplay(b);
  mainWin = new BrowserWindow({
    width: ok ? b.width : 1280,
    height: ok ? b.height : 820,
    x: ok ? b.x : undefined,
    y: ok ? b.y : undefined,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: 'Pomoroad',
    icon: iconPath(),
    backgroundColor: '#0e1014',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#14161b', symbolColor: '#d7dbe3', height: 40 },
    webPreferences: webPrefs(),
  });
  if (winState.mainMax) mainWin.maximize();
  lockExternalNavigation(mainWin);
  mainWin.loadURL(`${ORIGIN}/index.html`);
  mainWin.once('ready-to-show', () => {
    if (!START_HIDDEN) mainWin.show();
  });
  const remember = () => {
    if (!mainWin || mainWin.isMinimized() || mainWin.isFullScreen()) return;
    winState.mainMax = mainWin.isMaximized();
    if (!winState.mainMax) winState.main = mainWin.getBounds();
    saveWinState();
  };
  mainWin.on('resize', remember);
  mainWin.on('move', remember);
  mainWin.on('close', (e) => {
    if (!quitting && sys.closeToTray) {
      e.preventDefault();
      mainWin.hide();
      if (miniOpts.autoOnMinimize && lastState?.running) showMini(true);
      if (!winState.trayHintShown && Notification.isSupported()) {
        // 初めてしまったときだけ、終了していないことを知らせる
        winState.trayHintShown = true;
        saveWinState();
        new Notification({ title: 'Pomoroad はタスクトレイで動いています', body: '右下のアイコンから開けます。終了するときはアイコンを右クリック →「終了」', icon: iconPath(), silent: true }).show();
      }
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
  });
  mainWin.on('minimize', () => {
    if (miniOpts.autoOnMinimize) showMini(true);
  });
  mainWin.on('focus', () => {
    if (miniOpts.hideWhenMainFocused && miniWin?.isVisible()) miniWin.hide();
  });
  mainWin.on('blur', () => {
    if (miniOpts.hideWhenMainFocused && miniWanted && miniWin && !miniWin.isVisible()) miniWin.showInactive();
  });
  mainWin.on('enter-full-screen', () => mainWin.webContents.send('fullscreen', true));
  mainWin.on('leave-full-screen', () => mainWin.webContents.send('fullscreen', false));
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') mainWin.webContents.toggleDevTools();
  });
}

function showMain() {
  if (!mainWin) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

// ── ミニ表示（常に手前） ────────────────────────────
function miniSize() {
  const [w, h] = miniOpts.size ?? [300, 64];
  const s = miniOpts.scale || 1;
  return [Math.round((w + 8) * s), Math.round((h + 8) * s)];
}

function createMini() {
  const [w, h] = miniSize();
  const b = winState.mini;
  let x;
  let y;
  if (b && visibleOnSomeDisplay({ ...b, width: w, height: h })) {
    x = b.x;
    y = b.y;
  } else {
    const a = screen.getPrimaryDisplay().workArea;
    x = a.x + a.width - w - 24;
    y = a.y + a.height - h - 24;
  }
  miniWin = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    title: 'Pomoroad ミニ',
    icon: iconPath(),
    webPreferences: webPrefs(),
  });
  applyMiniOptions();
  lockExternalNavigation(miniWin);
  miniWin.loadURL(`${ORIGIN}/mini.html`);
  miniWin.once('ready-to-show', () => {
    miniWin.webContents.setZoomFactor(miniOpts.scale || 1);
    if (miniWanted) miniWin.showInactive();
  });
  miniWin.on('moved', () => {
    winState.mini = miniWin.getBounds();
    saveWinState();
  });
  miniWin.on('closed', () => {
    miniWin = null;
    miniWanted = false;
  });
}

function applyMiniOptions() {
  if (!miniWin) return;
  miniWin.setAlwaysOnTop(true, miniOpts.onTop ? 'screen-saver' : 'floating');
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !!miniOpts.onTop });
  miniWin.setOpacity(Math.max(0.2, (miniOpts.opacity ?? 100) / 100));
  const [w, h] = miniSize();
  const cur = miniWin.getBounds();
  if (cur.width !== w || cur.height !== h) miniWin.setBounds({ x: cur.x + cur.width - w, y: cur.y + cur.height - h, width: w, height: h });
  miniWin.webContents.setZoomFactor(miniOpts.scale || 1);
}

function showMini(on) {
  miniWanted = on;
  if (on) {
    if (!miniWin) createMini();
    else if (!miniWin.isVisible()) miniWin.showInactive();
    if (lastState) miniWin.webContents.send('state', lastState);
  } else if (miniWin) {
    miniWin.hide();
  }
  updateTrayMenu();
}

// ── タスクトレイ ───────────────────────────────────
function createTray() {
  const img = nativeImage.createFromPath(path.join(SRC, 'assets', 'icon-32.png'));
  tray = new Tray(img.resize({ width: 16, height: 16 }));
  tray.setToolTip('Pomoroad');
  tray.on('click', () => {
    if (mainWin?.isVisible() && !mainWin.isMinimized() && mainWin.isFocused()) mainWin.hide();
    else showMain();
  });
  updateTrayMenu();
}

function sendCmd(type) {
  if (!mainWin) createMain();
  mainWin.webContents.send('cmd', { type });
}

function updateTrayMenu() {
  if (!tray) return;
  const running = !!lastState?.running;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: running ? '一時停止' : '開始', click: () => sendCmd('toggle') },
      { label: '次へスキップ', click: () => sendCmd('skip') },
      { label: '今すぐ休憩', click: () => sendCmd('breakNow') },
      { label: '環境音の再生 / 停止', click: () => sendCmd('sound') },
      { type: 'separator' },
      { label: 'ミニ表示', type: 'checkbox', checked: !!(miniWin && miniWanted), click: () => showMini(!(miniWin && miniWanted)) },
      { label: 'メイン画面を開く', click: showMain },
      { type: 'separator' },
      { label: '終了', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

// ── 画面とのやりとり ───────────────────────────────
function registerIpc() {
  ipcMain.on('state', (_e, s) => {
    const runningChanged = lastState?.running !== s.running;
    lastState = s;
    if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('state', s);
    if (mainWin) {
      if (s.progress < 0 || s.status === 'ready') mainWin.setProgressBar(-1);
      else mainWin.setProgressBar(Math.max(0.01, s.progress), { mode: s.status === 'paused' ? 'paused' : 'normal' });
      if (mainWin.getTitle() !== s.title) mainWin.setTitle(s.title);
    }
    if (tray) tray.setToolTip(s.tooltip);
    if (runningChanged) updateTrayMenu();
  });
  ipcMain.handle('getState', () => lastState);
  ipcMain.on('cmd', (_e, c) => {
    if (c?.type === 'openMain') showMain();
    else if (c?.type === 'closeMini') showMini(false);
    else mainWin?.webContents.send('cmd', c);
  });
  ipcMain.on('tray', (_e, { icons }) => {
    if (!tray || !icons) return;
    const img = nativeImage.createEmpty();
    img.addRepresentation({ scaleFactor: 1, dataURL: icons.x1 });
    img.addRepresentation({ scaleFactor: 2, dataURL: icons.x2 });
    tray.setImage(img);
  });
  ipcMain.on('mini:toggle', (_e, on) => showMini(typeof on === 'boolean' ? on : !(miniWin && miniWanted && miniWin.isVisible())));
  ipcMain.on('mini:collapse', () => {
    showMini(true);
    mainWin?.minimize();
  });
  ipcMain.on('mini:options', (_e, o) => {
    miniOpts = { ...miniOpts, ...o };
    applyMiniOptions();
  });
  ipcMain.on('notify', (_e, { title, body }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: iconPath(), silent: true });
    n.on('click', showMain);
    n.show();
  });
  ipcMain.on('attention', (_e, { focus, flash }) => {
    if (!mainWin) return;
    if (focus) {
      showMain();
      mainWin.setAlwaysOnTop(true);
      setTimeout(() => mainWin?.setAlwaysOnTop(!!sys.mainOnTop), 1500);
    } else if (flash && !mainWin.isFocused()) {
      mainWin.flashFrame(true);
      mainWin.once('focus', () => mainWin?.flashFrame(false));
    }
  });
  ipcMain.handle('fullscreen', (_e, on) => {
    mainWin?.setFullScreen(!!on);
    return mainWin?.isFullScreen();
  });
  ipcMain.on('titlebar', (_e, { dark }) => {
    nativeTheme.themeSource = dark ? 'dark' : 'light';
    try {
      mainWin?.setTitleBarOverlay({ color: dark ? '#14161b' : '#f3f4f7', symbolColor: dark ? '#d7dbe3' : '#3a3f4b' });
    } catch {
      /* タイトルバーの重ね表示に対応していない環境 */
    }
  });
  ipcMain.handle('shortcuts', (_e, map) => registerShortcuts(map));
  ipcMain.on('system', (_e, o) => {
    sys = { ...sys, ...o };
    mainWin?.setAlwaysOnTop(!!sys.mainOnTop);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!sys.openAtLogin, args: ['--hidden'] });
  });
  ipcMain.handle('idleTime', () => powerMonitor.getSystemIdleTime());
  ipcMain.on('showMain', showMain);
  ipcMain.on('quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.handle('version', () => app.getVersion());
}

function registerShortcuts(map) {
  globalShortcut.unregisterAll();
  const failed = [];
  const actions = {
    toggle: () => sendCmd('toggle'),
    skip: () => sendCmd('skip'),
    mini: () => showMini(!(miniWin && miniWanted && miniWin.isVisible())),
    show: () => {
      if (mainWin?.isVisible() && mainWin.isFocused()) mainWin.hide();
      else showMain();
    },
  };
  for (const [k, accel] of Object.entries(map ?? {})) {
    if (!accel || !actions[k]) continue;
    try {
      if (!globalShortcut.register(accel, actions[k])) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  }
  return { failed };
}

// ── 起動 ───────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);
  app.setAppUserModelId(APP_ID);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    winState = readWinState();
    registerProtocol();
    registerIpc();
    createMain();
    createTray();
    for (const ev of ['lock-screen', 'unlock-screen', 'suspend', 'resume']) {
      powerMonitor.on(ev, () => mainWin?.webContents.send('power', ev));
    }
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
