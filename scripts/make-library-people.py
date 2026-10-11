"""開発用：図書館の「人の気配」を作る（src/assets/sounds/library-people.ogg）

- 近くの席のひそひそ話（音声合成した文を、声帯を使わないささやき声に変える）
- 遠くのカウンターの小さな話し声
- たまに、遠くの小さな咳払い
を、まばらに置いて広い部屋の響きを付ける。間はほぼ無音（図書館の空調などは別の音で鳴らす）。

声：HTS Voice "Mei"（Nagoya Institute of Technology, CC BY 3.0）
使い方: python scripts/make-library-people.py src/assets/sounds/library-people.ogg
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from scipy import linalg, signal

# 喫茶店の話し声を作る道具をそのまま使う
_spec = importlib.util.spec_from_file_location("cafe", Path(__file__).with_name("make-cafe-voices.py"))
cafe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cafe)

SR = cafe.SR
LENGTH_SEC = 180
RNG = np.random.default_rng(20261012)
cafe.RNG = RNG

WHISPERS = [
    "これ、借りてもいい？",
    "あ、うん、いいよ。",
    "その本、どこにあった？",
    "三階の奥の棚だよ。",
    "あとでコピーしたいんだけど。",
    "閉館って何時だっけ。",
    "八時までだったと思う。",
    "ちょっと席外すね。",
    "うん、荷物見とくよ。",
    "このページ、わかる？",
    "あとで教えるね。",
    "あ、ごめん、それ私の。",
    "もう少しで終わりそう。",
    "そろそろ休憩しようか。",
]
COUNTER = [
    "返却はこちらでお願いします。",
    "貸出期間は二週間です。",
    "カードをお預かりします。",
    "はい、ありがとうございます。",
    "予約の本が届いています。",
]
COUGHS = ["こほっ", "けほっ", "ごほん"]


def lpc(frame: np.ndarray, order: int) -> tuple[np.ndarray, float]:
    r = np.correlate(frame, frame, "full")[len(frame) - 1 : len(frame) + order]
    if r[0] <= 1e-9:
        return np.r_[1.0, np.zeros(order)], 0.0
    r[0] *= 1.0001
    a = linalg.solve_toeplitz(r[:order], -r[1 : order + 1])
    err = r[0] + np.dot(a, r[1 : order + 1])
    return np.r_[1.0, a], max(err, 0.0)


def whisper(x: np.ndarray) -> np.ndarray:
    """声の高さ（声帯の振動）を取り除いて、息だけのささやき声にする"""
    y = signal.resample_poly(x, 1, 3)  # 16 kHz で分析
    y = signal.lfilter([1, -0.95], 1, y)
    n, hop, order = 400, 160, 18
    win = np.hanning(n)
    out = np.zeros(len(y) + n)
    norm = np.zeros(len(y) + n)
    for i in range(0, len(y) - n, hop):
        seg = y[i : i + n] * win
        a, err = lpc(seg, order)
        if err <= 0:
            continue
        g = np.sqrt(err / n)
        out[i : i + n] += signal.lfilter([g], a, RNG.standard_normal(n)) * win
        norm[i : i + n] += win**2
    out = out[: len(y)] / np.maximum(norm[: len(y)], 1e-3)
    out = signal.lfilter([1], [1, -0.95], out)
    return signal.resample_poly(out, 3, 1)


def norm_peak(x: np.ndarray, to: float) -> np.ndarray:
    p = np.abs(x).max()
    return x * (to / p) if p > 0 else x


def main(out: Path) -> None:
    total = LENGTH_SEC * SR
    mix = np.zeros((2, total))

    def put(y: np.ndarray, t: float, dist: float, pan: float, level: float) -> None:
        s = int(t * SR)
        if s >= total:
            return
        st = cafe.place(norm_peak(y, level), dist, pan)
        e = min(total, s + st.shape[1])
        mix[:, s:e] += st[:, : e - s]

    # ひそひそ話：2 人が 1〜3 往復
    t = RNG.uniform(3, 10)
    while t < LENGTH_SEC - 8:
        a, b = cafe.speaker(), cafe.speaker()
        pan = RNG.uniform(-0.85, 0.85)
        dist = RNG.uniform(0.35, 0.75)
        tt = t
        for k in range(int(RNG.integers(1, 4)) * 2 - int(RNG.integers(0, 2))):
            y = whisper(cafe.say(str(RNG.choice(WHISPERS)), a if k % 2 == 0 else b))
            put(y, tt, dist, pan + RNG.uniform(-0.1, 0.1), RNG.uniform(0.35, 0.6))
            tt += len(y) / SR + RNG.uniform(0.3, 1.2)
        t = tt + RNG.uniform(18, 45)

    # 遠くのカウンター
    t = RNG.uniform(20, 40)
    while t < LENGTH_SEC - 6:
        spk = cafe.speaker()
        y = cafe.say(str(RNG.choice(COUNTER)), spk)
        put(y, t, 0.12, RNG.uniform(-0.3, 0.3), 0.18)
        t += len(y) / SR + RNG.uniform(35, 70)

    # 遠くの小さな咳払い
    t = RNG.uniform(10, 30)
    while t < LENGTH_SEC - 3:
        y = whisper(cafe.say(str(RNG.choice(COUGHS)), cafe.speaker()))
        sos = signal.butter(2, [200, 2500], btype="band", fs=SR, output="sos")
        put(signal.sosfilt(sos, y), t, RNG.uniform(0.2, 0.45), RNG.uniform(-0.9, 0.9), 0.3)
        t += RNG.uniform(30, 60)

    # 広い部屋の響き
    def hall_ir(seconds: float = 2.2) -> np.ndarray:
        n = int(seconds * SR)
        tt = np.arange(n) / SR
        ir = RNG.standard_normal((2, n)) * np.exp(-tt / 0.38)
        ir = signal.sosfilt(signal.butter(2, 3000, fs=SR, output="sos"), ir, axis=1)
        ir[:, : int(0.012 * SR)] = 0
        return ir / np.sqrt((ir**2).sum(axis=1, keepdims=True))

    ir = hall_ir()
    wet = np.stack([signal.fftconvolve(mix[c], ir[c])[:total] for c in range(2)])
    mix = mix * 0.6 + wet * 0.7
    mix -= mix.mean(axis=1, keepdims=True)
    mix = norm_peak(mix, 0.6)
    print(f"rms={np.sqrt((mix ** 2).mean()):.4f} peak={np.abs(mix).max():.2f}")
    with tempfile.TemporaryDirectory() as d:
        wav_path = Path(d) / "people.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype("<i2").tobytes())
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav_path), "-c:a", "libopus", "-b:a", "64k", str(out)],
            check=True,
        )
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "src/assets/sounds/library-people.ogg"))
