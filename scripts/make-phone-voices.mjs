// スマホ用の声かけ音声を VOICEVOX で作る（GitHub Actions の phone-voices ワークフローから実行）
// VOICEVOX エンジンが http://127.0.0.1:50021 で動いている前提。
// 出力：docs/phone-voices/<声の名前>/<番号>.wav（ffmpeg で mp3 にするのはワークフロー側）
//
// 使うときは各声の利用規約に従い、公開する場合は「VOICEVOX:キャラクター名」のクレジットを書く。

import fs from 'node:fs';
import path from 'node:path';

const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const OUT = process.argv[2] || 'docs/phone-voices';

/** スマホで気が散るアプリを開いたときの声かけ（短く、言い方を少しずつ変える） */
export const LINES = [
  '今は集中の時間だよ。スマホを置いて、勉強に戻ろう。',
  'あと少し、がんばろう。スマホは休憩のときにね。',
  'そのアプリは、休憩になってから。',
  'よし、スマホを置こう。集中に戻ろう。',
];

/** 聞き比べる声（キャラクター名・スタイル名・フォルダ名） */
const VOICES = [
  ['冥鳴ひまり', 'ノーマル', 'himari'],
  ['No.7', 'アナウンス', 'no7-announce'],
  ['No.7', '読み聞かせ', 'no7-story'],
  ['春日部つむぎ', 'ノーマル', 'tsumugi'],
  ['四国めたん', 'ノーマル', 'metan'],
  ['WhiteCUL', 'ノーマル', 'whitecul'],
  ['青山龍星', 'ノーマル', 'ryusei'],
  ['雀松朱司', 'ノーマル', 'suzumatsu'],
];

async function main() {
  const speakers = await (await fetch(`${ENGINE}/speakers`)).json();
  const credits = [];
  for (const [name, style, dir] of VOICES) {
    const sp = speakers.find((s) => s.name === name);
    const st = sp?.styles.find((x) => x.name === style);
    if (!st) {
      console.log(`見つからない声：${name}（${style}）`);
      continue;
    }
    fs.mkdirSync(path.join(OUT, dir), { recursive: true });
    for (const [i, text] of LINES.entries()) {
      const q = await (await fetch(`${ENGINE}/audio_query?speaker=${st.id}&text=${encodeURIComponent(text)}`, { method: 'POST' })).json();
      q.speedScale = 1.05;
      q.intonationScale = 1.15;
      q.prePhonemeLength = 0.15;
      q.postPhonemeLength = 0.25;
      const wav = Buffer.from(await (await fetch(`${ENGINE}/synthesis?speaker=${st.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) })).arrayBuffer());
      fs.writeFileSync(path.join(OUT, dir, `${i + 1}.wav`), wav);
    }
    credits.push(`| ${dir} | VOICEVOX:${name}（${style}） |`);
    console.log(`作りました：${name}（${style}）`);
  }
  fs.writeFileSync(
    path.join(OUT, 'README.md'),
    `# スマホ用の声かけ音声

MacroDroid の「読み上げ」の代わりに再生する音声です。VOICEVOX（無料の音声合成ソフト）で作りました。
各フォルダの \`sample.mp3\` で聞き比べて、気に入った声の \`1.mp3\`〜\`${LINES.length}.mp3\` をスマホに入れてください。

## セリフ

${LINES.map((l, i) => `${i + 1}. ${l}`).join('\n')}

## 声とクレジット

| フォルダ | 声 |
|---|---|
${credits.join('\n')}

各キャラクターの利用規約に従って使ってください。自分のスマホで使うだけならクレジットの表示はいりませんが、
公開する場合は「VOICEVOX:キャラクター名」を書いてください。
`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
