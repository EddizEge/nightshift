"""Video kare denetimi: yinelenen / donmuş / siyah kare oranı ve ani sıçramalar.

Kullanım: python check_frames.py <video.mp4> [--from SEC] [--to SEC]
ffmpeg ile 480x270 gri tonlu ham kareler okunur; ardışık kareler arası ortalama mutlak fark (0-255) ölçülür.
"""
import subprocess
import sys

import numpy as np

path = sys.argv[1]
W, H = 480, 270
cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={W}:{H}:flags=area,format=gray", "-f", "rawvideo", "-"]
raw = subprocess.run(cmd, capture_output=True, check=True).stdout
n = len(raw) // (W * H)
frames = np.frombuffer(raw[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.int16)
diffs = np.abs(frames[1:] - frames[:-1]).mean(axis=(1, 2))
means = frames.mean(axis=(1, 2))

exact = int((diffs == 0).sum())
near = int((diffs < 0.15).sum())
black = int((means < 4).sum())
med = float(np.median(diffs))
spikes = [(i + 1, round(float(d), 2)) for i, d in enumerate(diffs) if d > max(25.0, med * 8)]
print(f"kare: {n}")
print(f"birebir aynı ardışık kare: {exact} ({exact / max(1, n - 1) * 100:.2f}%)")
print(f"neredeyse aynı (<0.15/255): {near} ({near / max(1, n - 1) * 100:.2f}%)")
print(f"siyah kare (ort.<4): {black}")
print(f"ardışık fark medyanı: {med:.2f}  en küçük: {diffs.min():.3f}  en büyük: {diffs.max():.2f}")
print(f"sıçrama (kesme / flaş olabilir): {len(spikes)} -> {spikes[:30]}")
runs = []
start = None
for i, d in enumerate(diffs):
    if d < 0.15:
        start = i if start is None else start
    elif start is not None:
        if i - start >= 2:
            runs.append((start, i - start + 1))
        start = None
print(f"3+ karelik donma dizileri: {runs[:20]}")
