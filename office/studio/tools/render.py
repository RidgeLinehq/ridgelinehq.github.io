"""Render a Ridgeline commercial: stage.html + captions -> frames -> MP4 with voice, music and sound effects.
Usage: python3 render.py <ad folder> <out.mp4> [--fps 30] [--only t1,t2,...  (just save stills)]
                         [--ad <file.json>] [--variants voice,full] [--mux-only]
The ad folder holds stage.html and ad.json (or the file named by --ad):
  {"dur": seconds, "vo": "path to voice mp3", "music": "path to wav" or null, "captions": [[t0, t1, "text with *highlight*"], ...],
   "sfx": [[t, "whoosh|tap|thud|pop|riser|impact|tick|ding"], ...], "capTop": 1430, "musicVol": 0.55, "voGain": 1.6,
   "preset": "medium", "crf": 19, "loudI": -14, "loudTP": -1.5}
--variants voice,full  renders the frames once and muxes twice: <out>-voice.mp4 (voice + sfx, no music bed, for
                       posting with a platform sound) and <out>-full.mp4 (voice + sfx + music ducked under speech).
--mux-only             skips the frame render (and the video encode when <out>.work/video.mp4 exists) and reuses <out>.work.
Chromium: uses Playwright's own browser, or CHROMIUM_PATH / /opt/pw-browsers/chromium when that is not installed.
"""
import json, os, sys, subprocess, threading, shutil, functools, http.server, socketserver, wave
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=os.path.dirname(os.path.abspath(__file__))).decode().strip()
ad_dir, out = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default
fps = int(opt("--fps", 30))
only = [float(x) for x in opt("--only").split(",")] if "--only" in args else None
variants = opt("--variants").split(",") if "--variants" in args else None
mux_only = "--mux-only" in args
cfg = json.load(open(opt("--ad") or os.path.join(ad_dir, "ad.json")))
base = out[:-4] if out.lower().endswith(".mp4") else out
work = base + ".work"
if not mux_only:
    shutil.rmtree(work, ignore_errors=True); os.makedirs(work)

def chunks(captions):
    res = []
    for t0, t1, text in captions:
        parts = [p.strip() for p in text.split("|")]
        total = sum(len(p) for p in parts) or 1
        t = t0
        for p in parts:
            d = (t1 - t0) * len(p) / total
            words = [{"w": w.strip("*"), "hl": w.startswith("*")} for w in p.split()]
            res.append({"t0": round(t, 3), "t1": round(t + d, 3), "words": words, "top": cfg.get("capTop", 1430)})
            t += d
        res[-1]["t1"] = round(t1 + 0.25, 3)  # hold the last chunk through the breath
    return res

data = {"dur": cfg["dur"], "captions": chunks(cfg["captions"]), "tl": cfg.get("tl", {}), "bgs": cfg.get("bgs", []),
        "hook": cfg.get("hook", ""), "text": cfg.get("text", {})}

# no deferred rasterization: a scaled iframe tile that is not painted yet shows up as a hole in one frame
FLAGS = ["--disable-gpu-vsync", "--force-color-profile=srgb", "--disable-checker-imaging", "--disable-partial-raster", "--disable-lcd-text"]
def launch(p):
    try:
        return p.chromium.launch(args=FLAGS)
    except Exception as e:
        exe = os.environ.get("CHROMIUM_PATH") or "/opt/pw-browsers/chromium"
        if not os.path.exists(exe): raise
        return p.chromium.launch(executable_path=exe, args=FLAGS)

if not mux_only:
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Q, directory=ROOT))
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    stage_url = f"http://127.0.0.1:{port}/" + os.path.relpath(os.path.join(ad_dir, "stage.html"), ROOT)

    times = only if only else [i / fps for i in range(int(cfg["dur"] * fps))]
    with sync_playwright() as p:
        b = launch(p)
        pg = b.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        pg.add_init_script("window.AD_DATA=" + json.dumps(data))
        pg.goto(stage_url); pg.evaluate("window.ready"); pg.wait_for_timeout(800)
        for i, t in enumerate(times):
            pg.evaluate(f"window.render({t})")
            pg.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")  # let the compositor commit the frame
            name = f"still-{t:05.2f}.png" if only else f"f{i:05d}.jpg"
            if only: pg.screenshot(path=os.path.join(work, name))
            else: pg.screenshot(path=os.path.join(work, name), type="jpeg", quality=93)
            if not only and i % 150 == 0: print("frame", i, "/", len(times), flush=True)
        b.close()
    srv.shutdown()
    if only:
        print("stills in", work); sys.exit(0)

# ---- sound effects (generated, royalty free)
SR = 44100
n = int(cfg["dur"] * SR) + SR
fx = np.zeros(n); rng = np.random.default_rng(3)
def put(sig, t, g):
    i = int(t * SR); j = min(n, i + len(sig)); fx[i:j] += sig[: j - i] * g
def whoosh():
    L = int(0.45 * SR); x = rng.standard_normal(L)
    # band-pass sweep by cumulative smoothing
    out = np.zeros(L); a = 0.0
    for k in range(L):
        c = 0.02 + 0.25 * (k / L); a += c * (x[k] - a); out[k] = a
    e = np.sin(np.pi * np.arange(L) / L) ** 2
    return out * e * 2.2
def tap():
    t = np.arange(int(0.05 * SR)) / SR
    return (np.sin(2 * np.pi * 1800 * t) * 0.5 + rng.standard_normal(len(t)) * 0.3) * np.exp(-t * 120)
def thud():
    t = np.arange(int(0.5 * SR)) / SR
    f = 45 + 120 * np.exp(-t * 25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * 1.2
def pop():
    t = np.arange(int(0.08 * SR)) / SR
    f = 900 + 900 * np.exp(-t * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 50) * 0.35
def riser(L=1.3):
    N = int(L * SR); x = rng.standard_normal(N); out = np.zeros(N); a = 0.0
    for k in range(N):
        c = 0.004 + 0.12 * (k / N) ** 2; a += c * (x[k] - a); out[k] = a
    t = np.arange(N) / SR
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (t / L) ** 2) / SR) * 0.25
    env = (t / L) ** 1.6
    return (out * 3 + tone) * env
def impact():
    t = np.arange(int(1.2 * SR)) / SR
    f = 38 + 160 * np.exp(-t * 18)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4) * 1.4
    burst = rng.standard_normal(len(t)) * np.exp(-t * 28) * 0.5
    return sub + burst
def tick():  # one keyboard key
    t = np.arange(int(0.03 * SR)) / SR
    return (rng.standard_normal(len(t)) * 0.6 + np.sin(2 * np.pi * 2600 * t) * 0.3) * np.exp(-t * 260)
def ding():  # soft two-note confirmation
    t = np.arange(int(0.55 * SR)) / SR
    a = np.sin(2 * np.pi * 1046.5 * t) * np.exp(-t * 9)
    b = np.sin(2 * np.pi * 1318.5 * np.maximum(0, t - 0.09)) * np.exp(-np.maximum(0, t - 0.09) * 8) * (t > 0.09)
    return (a + b) * 0.35
FX = {"whoosh": whoosh, "tap": tap, "thud": thud, "pop": pop, "riser": riser, "impact": impact, "tick": tick, "ding": ding}
gains = {"whoosh": 0.35, "tap": 0.5, "thud": 0.55, "pop": 0.4, "riser": 0.4, "impact": 0.45, "tick": 0.35, "ding": 0.5}
for t, kind in cfg.get("sfx", []):
    put(FX[kind](), t, gains[kind])
fx = np.clip(fx, -1, 1)
with wave.open(os.path.join(work, "fx.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((fx * 32767).astype("<i2").tobytes())

# ---- video once (the variants share every frame), then one audio mix per variant muxed with -c:v copy
video = os.path.join(work, "video.mp4")
if not (mux_only and os.path.exists(video)):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-framerate", str(fps), "-i", os.path.join(work, "f%05d.jpg"),
                    "-vf", cfg.get("grade", "eq=contrast=1.05:saturation=1.08,noise=alls=3:allf=t"),
                    "-c:v", "libx264", "-preset", cfg.get("preset", "medium"), "-crf", str(cfg.get("crf", 19)), "-pix_fmt", "yuv420p", "-profile:v", "high",
                    "-t", str(cfg["dur"]), video], check=True)
    print("video encoded", flush=True)

def mux(dest, with_music):
    """voice (front, EQ + compression) + optional music ducked under the voice + sfx -> two-pass loudnorm -> AAC, video copied."""
    vo, music = cfg["vo"], cfg.get("music") if with_music else None
    vg = cfg.get("voGain", 1.6)
    I = cfg.get("loudI", -14) if music else cfg.get("loudI_voice", cfg.get("loudI", -14))
    TP = cfg.get("loudTP", -1.5)
    chain = ("[1:a]aresample=44100,highpass=f=70,equalizer=f=140:t=q:w=1:g=2.5,equalizer=f=3200:t=q:w=1.2:g=3,equalizer=f=9000:t=q:w=1:g=1.5,"
             "acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=" + str(vg) + ",apad=whole_dur=" + str(cfg["dur"] + 0.5) + ",asplit=2[vo][sc];")  # padded so the sidechain (and the music under it) lasts the whole cut
    inputs = ["-i", vo]
    if music:
        chain += ("[2:a]aresample=44100,volume=" + str(cfg.get("musicVol", 0.55)) + "[mu];"
                  "[mu][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[duck];"
                  "[3:a]aresample=44100,volume=0.9[fx];[vo][duck][fx]amix=inputs=3:normalize=0")
        inputs += ["-i", music, "-i", os.path.join(work, "fx.wav")]
    else:
        chain += "[sc]anullsink;[2:a]aresample=44100,volume=0.9[fx];[vo][fx]amix=inputs=2:normalize=0"
        inputs += ["-i", os.path.join(work, "fx.wav")]
    chain += ",alimiter=limit=0.95:level=0,atrim=0:" + str(cfg["dur"])  # level=0: a ceiling, not an auto-normaliser
    # pass 1: measure integrated loudness; pass 2: one linear gain to the target, then a true ceiling.
    # (loudnorm's own linear mode silently falls back to dynamic mode when the gain would push the peak over TP,
    #  and dynamic mode delays and truncates the tail; a plain gain + limiter is deterministic.)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", video] + inputs + ["-filter_complex", chain + ",loudnorm=I=" + str(I) + ":TP=" + str(TP) + ":print_format=json[a]", "-map", "[a]", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1])
    gain = round(I - float(m["input_i"]), 2)
    ceiling = round(10 ** ((TP - 1.5) / 20), 3)  # 1.5 dB under the true-peak target: the AAC encoder overshoots limited transients
    full = chain + ",volume=" + str(gain) + "dB,aresample=48000,alimiter=limit=" + str(ceiling) + ":level=0:attack=4:release=80,afade=t=out:st=" + str(cfg["dur"] - 1.3) + ":d=1.3[a]"  # resample BEFORE the ceiling: the encoder must not resample after it
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", video] + inputs + [
           "-filter_complex", full, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", str(cfg["dur"]), "-movflags", "+faststart", dest]
    subprocess.run(cmd, check=True)
    print("wrote", dest, "(measured", m["input_i"], "LUFS, gain", gain, "dB, ceiling", TP, "dBFS)", flush=True)

if variants:
    for v in variants:
        mux(f"{base}-{v}.mp4", v == "full")
else:
    mux(base + ".mp4", bool(cfg.get("music")))
if "--keep-work" not in args:
    shutil.rmtree(work)
