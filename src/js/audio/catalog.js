// 環境音の一覧・カテゴリ・シーン（組み合わせのプリセット）

export const CATEGORIES = [
  { id: 'noise', label: 'ノイズ' },
  { id: 'rain', label: '雨' },
  { id: 'water', label: '水辺' },
  { id: 'nature', label: '自然' },
  { id: 'place', label: '場所' },
  { id: 'work', label: '作業音' },
  { id: 'tone', label: 'トーン' },
  { id: 'custom', label: 'マイサウンド' },
];

// bed: 一定の音のループ（beds.js）, stream: ゆっくり移り変わる流れ（streams.js）,
// asset: 収録済みの音（assets/ 以下）, events: ときどき鳴る単発音（oneshots.js）, live: その場で発音
// events の visitors：鳥が「やって来て、同じ場所でしばらく鳴いて、去る」
// events の steady：仕掛けの音（ししおどし）なので、頻度を移り変わらせない
// gain: dB（素材ごとの聞こえ方の差をそろえる）, reverb: 響きの種類と量
export const SOUNDS = [
  { id: 'white', cat: 'noise', name: 'ホワイトノイズ', icon: '🌫️', bed: 'white', gain: -9, desc: '全部の高さが同じ強さのザーッという音' },
  { id: 'pink', cat: 'noise', name: 'ピンクノイズ', icon: '🌸', bed: 'pink', gain: -5, desc: '高い音を少し抑えた、耳にやさしいノイズ' },
  { id: 'brown', cat: 'noise', name: 'ブラウンノイズ', icon: '🟤', bed: 'brown', gain: -2, desc: '低く落ち着いた「ゴー」という音。集中用に人気' },
  { id: 'deepbrown', cat: 'noise', name: 'ディープブラウン', icon: '🌑', bed: 'deepbrown', gain: 0, desc: 'さらに低くこもらせたブラウンノイズ' },
  { id: 'green', cat: 'noise', name: 'グリーンノイズ', icon: '🌿', bed: 'green', gain: -3, desc: '中くらいの高さに寄せた自然な響きのノイズ' },
  { id: 'fan', cat: 'noise', name: '扇風機', icon: '🪭', bed: 'fan', gain: -4 },
  { id: 'airplane', cat: 'noise', name: '飛行機の機内', icon: '✈️', bed: 'airplane', gain: -2 },

  { id: 'rain-light', cat: 'rain', name: '小雨', icon: '🌦️', stream: 'rain-light', gain: 2, desc: '雨の強さや音の近さが、数分かけてゆっくり変わります' },
  { id: 'rain-heavy', cat: 'rain', name: '本降りの雨', icon: '🌧️', stream: 'rain-heavy', gain: -3, desc: 'ときどき強まったり、少し弱まったりします' },
  { id: 'rain-window', cat: 'rain', name: '窓に当たる雨', icon: '🪟', stream: 'rain-window', gain: 0, desc: '風に乗って、雨が窓に当たる強さが変わります' },
  { id: 'rain-roof', cat: 'rain', name: '屋根の雨', icon: '🏠', stream: 'rain-roof', gain: -1 },
  { id: 'thunder', cat: 'rain', name: '遠雷', icon: '⛈️', stream: 'rain-distant', gain: 0, events: [{ name: 'thunder', every: [20, 60], gain: -2, period: 240 }], reverb: { type: 'outdoor', wet: 0.5 } },

  { id: 'stream', cat: 'water', name: '川のせせらぎ', icon: '🏞️', stream: 'stream', gain: -1 },
  { id: 'river', cat: 'water', name: '渓流', icon: '🌊', stream: 'river', gain: -3 },
  { id: 'waterfall', cat: 'water', name: '滝', icon: '💧', stream: 'waterfall', gain: -4 },
  { id: 'waves', cat: 'water', name: '波の音', icon: '🐚', stream: 'waves', gain: -1, desc: '海の荒れ具合がゆっくり変わります' },
  { id: 'shishi', cat: 'water', name: 'ししおどし', icon: '🎋', stream: 'trickle', gain: 0, events: [{ name: 'shishi', every: [14, 30], gain: -6, steady: true }], reverb: { type: 'garden', wet: 0.45 } },

  { id: 'wind', cat: 'nature', name: '風', icon: '🌬️', stream: 'wind', gain: -3 },
  { id: 'leaves', cat: 'nature', name: '木々のざわめき', icon: '🌳', stream: 'leaves', gain: -1 },
  { id: 'forest', cat: 'nature', name: '森の小鳥', icon: '🐦', stream: 'forest', gain: 0, events: [{ name: 'bird', gain: -10, visitors: { count: [1, 4], stay: [40, 160], repeat: [2.5, 9], gap: [3, 30] } }], reverb: { type: 'forest', wet: 0.35 } },
  {
    id: 'mountain', cat: 'nature', name: '山の朝', icon: '⛰️', stream: 'mountain', gain: 0,
    events: [
      { name: 'uguisu', gain: -9, visitors: { count: [0, 2], stay: [60, 240], repeat: [7, 18], gap: [15, 90] } },
      { name: 'cuckoo', gain: -12, visitors: { count: [0, 1], stay: [60, 200], repeat: [25, 60], gap: [60, 240] } },
      { name: 'bird', gain: -16, visitors: { count: [0, 3], stay: [30, 120], repeat: [3, 10], gap: [10, 40] } },
    ],
    reverb: { type: 'valley', wet: 0.45 },
    desc: 'ウグイスとカッコウ、山の風と遠くの沢',
  },
  { id: 'crickets', cat: 'nature', name: '秋の虫', icon: '🦗', stream: 'crickets', gain: -3, reverb: { type: 'forest', wet: 0.25 }, desc: 'スズムシとコオロギ' },
  { id: 'frogs', cat: 'nature', name: '田んぼのカエル', icon: '🐸', stream: 'frogs', gain: -3, reverb: { type: 'forest', wet: 0.2 } },
  { id: 'higurashi', cat: 'nature', name: 'ヒグラシ', icon: '🌇', stream: 'breeze', gain: 0, events: [{ name: 'higurashi', every: [10, 30], gain: -10 }], reverb: { type: 'forest', wet: 0.45 } },
  { id: 'fire', cat: 'nature', name: '焚き火', icon: '🔥', stream: 'fire', gain: -1 },
  { id: 'furin', cat: 'nature', name: '風鈴', icon: '🎐', stream: 'breeze', gain: -4, events: [{ name: 'furin', every: [3, 12], gain: -10, period: 90 }], reverb: { type: 'garden', wet: 0.3 } },

  {
    id: 'cafe', cat: 'place', name: '喫茶店', icon: '☕', asset: 'sounds/cafe-voices.ogg', stream: 'cafe-clatter', gain: -3,
    desc: 'まわりの席の話し声（聞き取れない程度）と食器の音。にぎやかさが少しずつ変わります',
    events: [
      { name: 'steam', every: [70, 160], gain: -10 },
      { name: 'doorbell', every: [90, 220], gain: -14 },
    ],
    reverb: { type: 'room', wet: 0.15 },
  },
  {
    id: 'library', cat: 'place', name: '図書館', icon: '📚', bed: 'libraryBed', gain: -6,
    events: [
      { name: 'page', every: [6, 20], gain: -8 },
      { name: 'pencil', every: [8, 25], gain: -10 },
      { name: 'footsteps', every: [25, 70], gain: -6 },
      { name: 'book', every: [40, 100], gain: -10 },
      { name: 'typing', every: [30, 80], gain: -8 },
    ],
    reverb: { type: 'hall', wet: 0.4 },
  },
  { id: 'train', cat: 'place', name: '電車', icon: '🚃', bed: 'train', gain: -3, desc: 'ガタンゴトン…と走る車内' },

  { id: 'clock', cat: 'work', name: '時計の音', icon: '🕰️', bed: 'clock', gain: -8, reverb: { type: 'room', wet: 0.2 } },
  { id: 'keyboard', cat: 'work', name: 'タイピング', icon: '⌨️', stream: 'keyboard', gain: -6, reverb: { type: 'room', wet: 0.15 } },
  { id: 'pencil', cat: 'work', name: '鉛筆で書く音', icon: '✏️', stream: 'pencil', gain: -5, reverb: { type: 'room', wet: 0.15 } },
  { id: 'vinyl', cat: 'work', name: 'レコードのノイズ', icon: '📀', bed: 'vinyl', gain: 2 },

  { id: 'ambient', cat: 'tone', name: 'アンビエント', icon: '🎹', bed: 'ambient', gain: -4, reverb: { type: 'hall', wet: 0.5 }, desc: 'ゆっくり移り変わる柔らかい和音' },
  { id: 'binaural-alpha', cat: 'tone', name: 'バイノーラル α波', icon: '🎧', live: { kind: 'binaural', carrier: 200, beat: 10 }, gain: -6, desc: '左右で 10Hz ずらした音。ヘッドホンで' },
  { id: 'binaural-beta', cat: 'tone', name: 'バイノーラル β波', icon: '🎧', live: { kind: 'binaural', carrier: 220, beat: 18 }, gain: -6, desc: '左右で 18Hz ずらした音。ヘッドホンで' },
  { id: 'binaural-gamma', cat: 'tone', name: 'バイノーラル γ波', icon: '🎧', live: { kind: 'binaural', carrier: 240, beat: 40 }, gain: -6, desc: '左右で 40Hz ずらした音。ヘッドホンで' },
];

export const SOUND_MAP = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));

// シーン：ワンタップで組み合わせを呼び出す
export const SCENES = [
  { id: 'rainy-cafe', name: '雨の喫茶店', icon: '☕', mix: { cafe: 0.55, 'rain-window': 0.5 } },
  { id: 'library', name: '静かな図書館', icon: '📚', mix: { library: 0.7, clock: 0.25 } },
  { id: 'mountain', name: '山の朝', icon: '⛰️', mix: { mountain: 0.6, stream: 0.3, leaves: 0.25 } },
  { id: 'seaside', name: '海辺', icon: '🐚', mix: { waves: 0.75, wind: 0.2 } },
  { id: 'forest-bath', name: '森林浴', icon: '🌲', mix: { forest: 0.55, leaves: 0.35, stream: 0.3 } },
  { id: 'summer-night', name: '夏の夜', icon: '🎐', mix: { frogs: 0.5, crickets: 0.3, furin: 0.35 } },
  { id: 'autumn-night', name: '秋の夜長', icon: '🍂', mix: { crickets: 0.6, wind: 0.15, clock: 0.2 } },
  { id: 'storm', name: '嵐の夜', icon: '⛈️', mix: { 'rain-heavy': 0.7, thunder: 0.7, wind: 0.4 } },
  { id: 'cabin', name: '冬の山小屋', icon: '🔥', mix: { fire: 0.7, wind: 0.35, clock: 0.15 } },
  { id: 'garden', name: '日本庭園', icon: '🎋', mix: { shishi: 0.6, stream: 0.3, forest: 0.25 } },
  { id: 'night-train', name: '夜行列車', icon: '🚃', mix: { train: 0.65, 'rain-window': 0.3 } },
  { id: 'study-room', name: '自習室', icon: '✏️', mix: { pencil: 0.45, fan: 0.25, clock: 0.2 } },
  { id: 'lofi', name: 'Lo-fi 勉強部屋', icon: '📀', mix: { ambient: 0.4, vinyl: 0.55, 'rain-window': 0.3 } },
  { id: 'deep-focus', name: '深い集中', icon: '🟤', mix: { brown: 0.6 } },
];
