// Electron のミニウィンドウ用の入口。状態はメイン画面からメインプロセス経由で届く
import { MiniView } from './ui/mini-view.js';

const desk = window.desktop;
const view = new MiniView(document.getElementById('mini'), (cmd) => desk?.command(cmd));
if (desk) {
  desk.onState((s) => view.update(s?.mini));
  desk.getState().then((s) => view.update(s?.mini));
}
