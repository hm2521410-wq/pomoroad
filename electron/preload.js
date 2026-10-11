'use strict';
// 画面（レンダラー）に渡す Windows 連携の窓口。必要な操作だけを公開する。
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  sendState: (s) => ipcRenderer.send('state', s),
  getState: () => ipcRenderer.invoke('getState'),
  onState: (cb) => on('state', cb),
  command: (c) => ipcRenderer.send('cmd', c),
  onCommand: (cb) => on('cmd', cb),
  mini: {
    toggle: (on) => ipcRenderer.send('mini:toggle', on),
    collapse: () => ipcRenderer.send('mini:collapse'),
    setOptions: (o) => ipcRenderer.send('mini:options', o),
    flash: (on) => ipcRenderer.send('mini:flash', !!on),
  },
  // 見守り：前に出ている画面のアプリ名と題名（画面の中身は見ない）
  foreground: {
    sample: () => ipcRenderer.invoke('fg:sample'),
    status: () => ipcRenderer.invoke('fg:status'),
    stop: () => ipcRenderer.send('fg:stop'),
  },
  setTray: (o) => ipcRenderer.send('tray', o),
  notify: (o) => ipcRenderer.send('notify', o),
  attention: (o) => ipcRenderer.send('attention', o),
  setFullScreen: (on) => ipcRenderer.invoke('fullscreen', on),
  onFullScreen: (cb) => on('fullscreen', cb),
  setTitleBar: (o) => ipcRenderer.send('titlebar', o),
  setShortcuts: (map) => ipcRenderer.invoke('shortcuts', map),
  setSystem: (o) => ipcRenderer.send('system', o),
  getIdleTime: () => ipcRenderer.invoke('idleTime'),
  onPower: (cb) => on('power', cb),
  showMain: () => ipcRenderer.send('showMain'),
  quit: () => ipcRenderer.send('quit'),
  version: () => ipcRenderer.invoke('version'),
});
