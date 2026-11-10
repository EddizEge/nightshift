"""NIGHTSHIFT tanıtım videosu kurgusu: ham çekimden (record.mjs) bölümleri kesip birleştirir.

Kullanım: python video/edit.py <take_adı> <kurgu.json> <çıktı.mp4>
  take_adı   : video/raw/<take> (.mp4 + .wav + .json)
  kurgu.json : {"segments": [[mark, from_sec, to_sec], ...], "xfade": 0.18, "fade_in": 0.6, "fade_out": 0.9}
               mark = record.mjs işaret adı (ör. "PLAY", "EVENT_A") ya da "ABS" (mutlak saniye)
Video: bölümler arası kısa çapraz geçiş (xfade), ses: acrossfade; ses ham çekimle kare-senkron (audioOffsetSec).
Çıktı: H.264 High, yuv420p, 1920x1080, 60 fps, AAC 48 kHz stereo, +faststart.
"""
import json
import subprocess
import sys
from pathlib import Path

take, cfg_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
raw = Path("video/raw") / take
meta = json.loads(Path(f"{raw}.json").read_text(encoding="utf8"))["meta"]
cfg = json.loads(Path(cfg_path).read_text(encoding="utf8"))
FPS = meta["fps"]
marks = {}
for m in meta["marks"]:
    name = m["mark"].split(" ")[0]
    marks.setdefault(name, m["i"] / FPS)

xf = float(cfg.get("xfade", 0.18))
segs = []
for name, a, b in cfg["segments"]:
    base = 0.0 if name == "ABS" else marks[name]
    # kare sınırına yuvarla
    s = round((base + a) * FPS) / FPS
    e = round((base + b) * FPS) / FPS
    segs.append((s, e))

total_frames = meta["frames"]
for s, e in segs:
    assert 0 <= s < e <= total_frames / FPS + 1e-6, (s, e)

audio_off = meta.get("audioOffsetSec") or 0.0
has_audio = Path(f"{raw}.wav").exists()

# Ses: oyun sesi ancak PLAY'de başlar -> önüne sessizlik ekleyip video zaman çizelgesine hizala
inputs = ["-i", f"{raw}.mp4"]
if has_audio:
    inputs += ["-i", f"{raw}.wav"]

fc = []
for k, (s, e) in enumerate(segs):
    fc.append(f"[0:v]trim=start={s:.6f}:end={e:.6f},setpts=PTS-STARTPTS,fps={FPS}[v{k}]")
    if has_audio:
        fc.append(
            f"[1:a]aresample=48000,adelay={int(round(audio_off * 1000))}|{int(round(audio_off * 1000))},"
            f"apad,atrim=start={s:.6f}:end={e:.6f},asetpts=PTS-STARTPTS[a{k}]"
        )

# zincirleme xfade / acrossfade
vcur, acur = "v0", "a0"
acc = segs[0][1] - segs[0][0]
for k in range(1, len(segs)):
    dur_k = segs[k][1] - segs[k][0]
    off = acc - xf
    fc.append(f"[{vcur}][v{k}]xfade=transition=fade:duration={xf}:offset={off:.6f}[vx{k}]")
    vcur = f"vx{k}"
    if has_audio:
        fc.append(f"[{acur}][a{k}]acrossfade=d={xf}:c1=tri:c2=tri[ax{k}]")
        acur = f"ax{k}"
    acc = acc + dur_k - xf

fade_in = float(cfg.get("fade_in", 0.6))
fade_out = float(cfg.get("fade_out", 0.9))
fc.append(f"[{vcur}]fade=t=in:st=0:d={fade_in},fade=t=out:st={acc - fade_out:.6f}:d={fade_out},format=yuv420p[vout]")
if has_audio:
    fc.append(
        f"[{acur}]afade=t=in:st=0:d={fade_in},afade=t=out:st={acc - fade_out:.6f}:d={fade_out},"
        f"loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[aout]"
    )

cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]"]
if has_audio:
    cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
cmd += [
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-maxrate", "24M", "-bufsize", "48M",
    "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-r", str(FPS),
    "-g", str(FPS), "-movflags", "+faststart", "-t", f"{acc:.6f}", out,
]
print(f"bölümler: {[(round(s, 3), round(e, 3)) for s, e in segs]}")
print(f"süre: {acc:.2f} sn, ses: {has_audio} (ofset {audio_off:.3f} sn)")
subprocess.run(cmd, check=True)
print("yazıldı:", out)
