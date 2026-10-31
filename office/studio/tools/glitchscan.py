"""Find single-frame paint glitches (an unpainted tile, a flash) in a rendered frame folder or an MP4.
  python3 glitchscan.py <frames dir with fNNNNN.jpg | video.mp4> [--fps 30] [--cuts 4.3,6.5,...]
A glitch is a frame whose difference to BOTH neighbours is large while the neighbours are close to each other
(a spike), away from the listed cut times. Prints the suspect frames with their times; exit code 1 if any.
"""
import glob, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

src = sys.argv[1]
fps = float(sys.argv[sys.argv.index("--fps") + 1]) if "--fps" in sys.argv else 30.0
cuts = [float(x) for x in sys.argv[sys.argv.index("--cuts") + 1].split(",")] if "--cuts" in sys.argv else []
if src.lower().endswith(".mp4"):
    d = tempfile.mkdtemp(); subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", "scale=135:240", os.path.join(d, "f%05d.png")], check=True)
    files = sorted(glob.glob(os.path.join(d, "f*.png")))
    load = lambda f: np.asarray(Image.open(f).convert("L"), dtype=np.float32)
else:
    files = sorted(glob.glob(os.path.join(src, "f*.jpg")))
    load = lambda f: np.asarray(Image.open(f).convert("L").resize((135, 240)), dtype=np.float32)
frames = [load(f) for f in files]
diffs = [float(np.abs(frames[i] - frames[i - 1]).mean()) for i in range(1, len(frames))]
sus = []
for i in range(1, len(frames) - 1):
    a, b = diffs[i - 1], diffs[i]            # prev->this, this->next
    both = float(np.abs(frames[i + 1] - frames[i - 1]).mean())  # prev->next
    t = i / fps
    near_cut = any(abs(t - c) < 0.6 for c in cuts)
    if a > 6 and b > 6 and both < min(a, b) * 0.5 and not near_cut:
        sus.append((i, round(t, 2), round(a, 1), round(b, 1), round(both, 1)))
print(f"{len(frames)} frames, median step diff {np.median(diffs):.2f}, max {max(diffs):.1f}")
for s in sus: print("SUSPECT frame", s[0], "t=", s[1], "diff prev", s[2], "next", s[3], "prev->next", s[4])
print("glitches:", len(sus))
sys.exit(1 if sus else 0)
