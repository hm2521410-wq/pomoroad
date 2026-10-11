"""開発用：喫茶店の「店内のざわざわ」を作る（src/assets/sounds/cafe-voices.ogg）

日本語の音声合成（Open JTalk / pyopenjtalk）で短い会話をたくさん作り、
声の高さ・話す速さ・距離・左右の位置を変えて重ね、部屋の響きを付ける。
1 人ひとりの言葉は聞き取れない程度にぼかす（近くの席でも低い音だけが届くようにする）。

声：HTS Voice "Mei"（Nagoya Institute of Technology, CC BY 3.0）

使い方（Python 3.10 以降。pyopenjtalk・numpy・scipy が必要）:
  python scripts/make-cafe-voices.py src/assets/sounds/cafe-voices.ogg
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import wave
from fractions import Fraction
from pathlib import Path

import numpy as np
import pyopenjtalk
from scipy import signal

SR = 48000
LENGTH_SEC = 160
RNG = np.random.default_rng(20261011)

LINES = [
    "このあいだの映画、すごくよかったよね。",
    "えー、ほんとに？ぜんぜん知らなかった。",
    "来週の土曜日って、空いてる？",
    "うん、たぶん大丈夫だと思う。",
    "ここのケーキ、けっこう人気なんだって。",
    "そうそう、それでね、駅のほうまで歩いたの。",
    "なるほどね、それはちょっと大変だったね。",
    "課題がまだ半分くらい残ってるんだよね。",
    "先週から急に寒くなったよね。",
    "コーヒーもう一杯たのもうかな。",
    "あの店、去年閉まっちゃったらしいよ。",
    "えっとね、たしか三時くらいだったと思う。",
    "それ、いいじゃん。今度いっしょに行こうよ。",
    "まあ、なんとかなるでしょ。",
    "ねえ聞いて、きのう電車でさ。",
    "ふうん、そういうこともあるんだね。",
    "で、結局どうなったの？",
    "まだ決まってないんだけど、たぶん春かな。",
    "うちの近くにも新しいパン屋ができたよ。",
    "わかるわかる、わたしもそう思った。",
    "その資料、あとで送ってもらってもいい？",
    "ありがとう、助かる。",
    "週末は実家に帰る予定なんだ。",
    "最近ずっと雨ばっかりだね。",
    "あれ、どこに置いたっけ。",
    "そろそろ出ないと間に合わないかも。",
    "ちょっと待って、いま調べてみる。",
    "ほら、この写真見て。",
    "かわいい、どこで撮ったの？",
    "去年の夏に行った海なんだけど。",
    "へえ、ぜんぜん混んでないね。",
    "平日だったからね、すごく空いてたよ。",
    "そういえば、あの話どうなった？",
    "それがさ、まだ返事が来ないんだよ。",
    "気長に待つしかないね。",
    "あ、それおいしそう。",
    "ひとくち食べる？",
    "いいの？ありがとう。",
    "最近なにかおもしろい本読んだ？",
    "ちょうど先週、推理小説を読み終わったところ。",
    "犯人が最後までわからなくてさ。",
    "今日って何時まで大丈夫？",
    "五時くらいまでなら平気。",
    "じゃあ、もう少しゆっくりしようか。",
    "ここ、落ち着くからいいよね。",
    "うん、静かで勉強もはかどりそう。",
    "来月から新しい部署に移るんだ。",
    "そうなんだ、おめでとう。",
    "いやいや、まだ不安のほうが大きいよ。",
    "大丈夫だよ、きっとうまくいくって。",
    "旅行の計画、そろそろ立てないとね。",
    "京都とかどう？秋はきれいだよ。",
    "いいね、紅葉の時期に行きたいな。",
    "宿だけ先に取っておこうか。",
    "さっきの会議、長かったね。",
    "ほんとに、途中でちょっと眠くなっちゃった。",
    "次はもう少し短くしてほしいよね。",
    "この曲、どこかで聞いたことある気がする。",
    "たしか昔のドラマの主題歌じゃない？",
    "あー、そうかも。なつかしいね。",
    "お昼なに食べた？",
    "まだ食べてないの、おなかすいた。",
    "じゃあ、なにか軽く頼もうよ。",
    "サンドイッチとかどうかな。",
    "うん、それにする。",
    "そういえば、引っ越しはもう終わったの？",
    "だいたい終わったけど、段ボールがまだ残ってる。",
    "手伝いに行こうか？",
    "ほんと？すごくうれしい。",
    "じゃあ、日曜日の午後にでも。",
    "なんか今日、店混んでるね。",
    "お昼どきだからかな。",
    "そっちの席のほうが明るくていいかも。",
    "ちょっと移動しようか。",
    "えっと、なんの話してたんだっけ。",
    "ほら、さっきの先生の話。",
    "ああ、あれね。けっこう面白かったよ。",
    "ノート見せてもらってもいい？",
    "いいよ、字が汚いけど。",
    "全然読めるよ、ありがとう。",
]

GROUPS = [
    # (人数, 距離 0〜1, 左右の位置)
    (2, 0.85, -0.45),
    (2, 0.7, 0.5),
    (3, 0.55, -0.15),
    (2, 0.5, 0.75),
    (2, 0.42, -0.75),
    (3, 0.35, 0.2),
    (2, 0.28, -0.4),
    (2, 0.24, 0.6),
    (3, 0.18, 0.0),
    (2, 0.15, -0.85),
    (2, 0.14, 0.85),
]


def speaker() -> dict:
    """声の特徴：k は声道の長さ（フォルマント）の倍率、pitch は声の高さの倍率"""
    if RNG.random() < 0.5:
        k = RNG.uniform(0.95, 1.06)
        pitch = RNG.uniform(0.9, 1.12)
    else:
        k = RNG.uniform(0.8, 0.88)
        pitch = RNG.uniform(0.52, 0.66)
    return {"k": k, "pitch": pitch, "speed": RNG.uniform(0.95, 1.18), "gain": RNG.uniform(0.75, 1.0)}


def say(text: str, spk: dict) -> np.ndarray:
    # 合成してから再生速度を k 倍にすると、声の高さとフォルマントが k 倍・長さが 1/k 倍になる。
    # それを見込んで、合成時の高さと速さを先に補正しておく。
    half_tone = 12 * np.log2(spk["pitch"] / spk["k"])
    speed = spk["speed"] / spk["k"]
    x, sr = pyopenjtalk.tts(text, speed=float(speed), half_tone=float(half_tone))
    assert sr == SR, sr
    x = x.astype(np.float64) / 32768.0
    frac = Fraction(1 / spk["k"]).limit_denominator(60)
    y = signal.resample_poly(x, frac.numerator, frac.denominator)
    # 文ごとの強弱
    y *= RNG.uniform(0.7, 1.0)
    fade = int(0.01 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


def conversation(n: int, total: int) -> list[np.ndarray]:
    people = [speaker() for _ in range(n)]
    tracks = [np.zeros(total) for _ in range(n)]
    t = RNG.uniform(0, 4)
    who = int(RNG.integers(n))
    while t * SR < total:
        if RNG.random() > 0.25:
            who = (who + 1 + int(RNG.integers(n - 1))) % n if n > 1 else 0
        k = 1 if RNG.random() < 0.65 else 2
        y = np.concatenate([say(str(RNG.choice(LINES)), people[who]) for _ in range(k)])
        s = int(t * SR)
        e = min(total, s + len(y))
        tracks[who][s:e] += y[: e - s] * people[who]["gain"]
        t += len(y) / SR
        r = RNG.random()
        if r < 0.12:
            t -= RNG.uniform(0.1, 0.4)  # 相づちで少し重なる
        elif r < 0.22:
            t += RNG.uniform(2.0, 6.0)  # 少し黙る
        else:
            t += RNG.uniform(0.15, 0.9)
    return tracks


def place(mono: np.ndarray, dist: float, pan: float) -> np.ndarray:
    """遠いほど小さく・こもらせて、左右に置く"""
    cutoff = 1300 + 2600 * dist
    sos = signal.butter(4, [140, cutoff], btype="band", fs=SR, output="sos")
    y = signal.sosfilt(sos, mono) * (0.18 + 0.82 * dist**1.2)
    th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    return np.stack([y * np.cos(th), y * np.sin(th)])


def room_ir(seconds: float = 0.9) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = RNG.standard_normal((2, n)) * np.exp(-t / 0.16)
    sos = signal.butter(2, 3500, fs=SR, output="sos")
    ir = signal.sosfilt(sos, ir, axis=1)
    ir[:, : int(0.004 * SR)] = 0
    return ir / np.sqrt((ir**2).sum(axis=1, keepdims=True))


def main(out: Path) -> None:
    total = LENGTH_SEC * SR
    mix = np.zeros((2, total))
    for n, dist, pan in GROUPS:
        for i, tr in enumerate(conversation(n, total)):
            mix += place(tr, dist, pan + RNG.uniform(-0.12, 0.12) * (i - n / 2))
    wet = np.stack([signal.fftconvolve(mix[c], room_ir()[c])[:total] for c in range(2)])
    mix = mix * 0.75 + wet * 0.5
    mix -= mix.mean(axis=1, keepdims=True)
    rms = np.sqrt((mix**2).mean())
    mix *= 0.1 / rms
    peak = np.abs(mix).max()
    if peak > 0.95:
        mix = np.tanh(mix / 0.95) * 0.95
    print(f"rms={np.sqrt((mix ** 2).mean()):.3f} peak={np.abs(mix).max():.2f} sec={total / SR:.0f}")
    with tempfile.TemporaryDirectory() as d:
        wav_path = Path(d) / "voices.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype("<i2").tobytes())
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav_path), "-c:a", "libopus", "-b:a", "80k", str(out)],
            check=True,
        )
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "src/assets/sounds/cafe-voices.ogg"))
