"""Quality-gate helpers: frames, contact sheet and loudness for a finished MP4.
  python3 qa.py <video.mp4> <out_dir> [--n 10]
Writes <out_dir>/<name>-frames/f01.jpg ... and <out_dir>/<name>-sheet.jpg, prints duration, size, fps,
mean/max volume (ffmpeg volumedetect) and integrated loudness (ebur128) as one JSON line.
"""
import json, os, re, subprocess, sys
from PIL import Image, ImageDraw

def probe(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size", "-of", "json", path]).decode()
    j = json.loads(out)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    a = next((s for s in j["streams"] if s["codec_type"] == "audio"), {})
    num, den = v["r_frame_rate"].split("/")
    return {"dur": round(float(j["format"]["duration"]), 2), "mb": round(int(j["format"]["size"]) / 1e6, 1), "w": v["width"], "h": v["height"],
            "fps": round(int(num) / int(den), 2), "vcodec": v["codec_name"], "acodec": a.get("codec_name")}

def loudness(path):
    r = subprocess.run(["ffmpeg", "-i", path, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
    mean = float(re.search(r"mean_volume: ([-\d.]+)", r).group(1)); mx = float(re.search(r"max_volume: ([-\d.]+)", r).group(1))
    e = subprocess.run(["ffmpeg", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = re.findall(r"I:\s+([-\d.]+) LUFS", e); tp = re.findall(r"Peak:\s+([-\d.]+) dBFS", e)
    return {"mean_dB": mean, "max_dB": mx, "LUFS": float(I[-1]) if I else None, "true_peak_dBFS": float(tp[-1]) if tp else None}

def frames(path, out_dir, n=10):
    name = os.path.splitext(os.path.basename(path))[0]
    fdir = os.path.join(out_dir, name + "-frames"); os.makedirs(fdir, exist_ok=True)
    d = probe(path)["dur"]
    times = [d * (i + 0.5) / n for i in range(n)]
    files = []
    for i, t in enumerate(times):
        f = os.path.join(fdir, f"f{i+1:02d}-{t:05.2f}s.jpg")
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", str(t), "-i", path, "-frames:v", "1", "-q:v", "2", f], check=True)
        files.append(f)
    cols = 5; W, H = 1080 // 3, 1920 // 3
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * W, rows * (H + 28)), (18, 18, 18)); dr = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        im = Image.open(f).resize((W, H)); x = (i % cols) * W; y = (i // cols) * (H + 28)
        sheet.paste(im, (x, y + 28)); dr.text((x + 8, y + 7), os.path.basename(f)[4:10], fill=(255, 200, 100))
    sp = os.path.join(out_dir, name + "-sheet.jpg"); sheet.save(sp, quality=88)
    return files, sp

if __name__ == "__main__":
    path, out_dir = sys.argv[1], sys.argv[2]
    n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 10
    os.makedirs(out_dir, exist_ok=True)
    info = probe(path); info.update(loudness(path))
    files, sheet = frames(path, out_dir, n)
    info["file"] = path; info["sheet"] = sheet
    print(json.dumps(info))
