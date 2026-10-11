// パネル（ドロワー）の開き方の決まり。DOM を使わないので Node のテストからも読める。
// - 下のボタン（tool）：同じものをもう一度押したら閉じる、違うものなら開き直す
// - パネルの中のタブ（tab）：閉じずに切り替えるだけ

/** cur：{ drawer, tab } / action：{ type: 'tool', kind, tab? } か { type: 'tab', tab } */
export function nextDrawer(cur, action) {
  if (action.type === 'tab') return { drawer: cur.drawer, tab: action.tab };
  if (cur.drawer === action.kind && (!action.tab || action.tab === cur.tab)) return { drawer: null, tab: cur.tab };
  return { drawer: action.kind, tab: action.tab ?? cur.tab ?? 'timer' };
}
