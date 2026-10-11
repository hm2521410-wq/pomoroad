// 環境音を「いま鳴らすか」「どのミックスを鳴らすか」を決める（DOM を使わないので Node のテストからも読める）
//
// link（鳴らすタイミング）
//   manual   … タイマーと連動しない（自分で再生・停止）
//   focus    … 集中中だけ鳴らす（休憩中は鳴らさない）
//   same     … 休憩中も集中と同じ音を鳴らす
//   separate … 休憩中は休憩用の音を鳴らす
//
// preview は「ホワイトノイズのパネルを開いて音を選んでいる間だけ」の試し聞き。パネルを閉じたら必ず消す。

export const LINK_MODES = ['manual', 'focus', 'same', 'separate'];

/**
 * @param {{ link:string, type:string, status:string, pauseWithTimer:boolean, manualPlaying?:boolean, override?:boolean|null, preview?:{ key:string }|null }} o
 * @returns {{ play:boolean, mixKey:'focus'|'break' }}
 */
export function soundPlan({ link, type, status, pauseWithTimer, manualPlaying = false, override = null, preview = null }) {
  const isFocus = type === 'focus';
  const running = status === 'running';
  const paused = status === 'paused';
  const active = running || (paused && !pauseWithTimer);
  let play;
  let mixKey = link === 'separate' && !isFocus ? 'break' : 'focus';
  if (link === 'manual') play = manualPlaying;
  else if (link === 'same' || link === 'separate') play = active;
  else play = isFocus && active; // focus（と、知らない値）
  if (override !== null && override !== undefined) play = override;
  if (preview) {
    play = true;
    mixKey = preview.key;
  }
  return { play, mixKey };
}
