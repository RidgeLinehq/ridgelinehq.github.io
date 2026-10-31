"""Voice helpers for the studio (free path, no keys).
  python3 vo.py speak <out.mp3> "<text>" [--voice en-US-AndrewMultilingualNeural] [--rate +4%]
  python3 vo.py silences <file.mp3> [--db -38] [--min 0.2]      (prints start,end pairs)
  python3 vo.py concat <out.mp3> <lead_silence_s> <a.mp3> <gap_s> <b.mp3> [<gap_s> <c.mp3> ...]
  python3 vo.py dur <file>
speak uses edge-tts (Microsoft neural voices, free). Inside the cloud container the TLS proxy needs
SSL_CERT_FILE=/root/.ccr/ca-bundle.crt and --proxy $HTTPS_PROXY; both are passed automatically when present.
"""
import os, re, subprocess, sys, json

def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).decode().strip())

def speak(out, text, voice="en-US-AndrewMultilingualNeural", rate="+4%"):
    env = dict(os.environ)
    if os.path.exists("/root/.ccr/ca-bundle.crt"):
        env.setdefault("SSL_CERT_FILE", "/root/.ccr/ca-bundle.crt")
    cmd = ["edge-tts", "--voice", voice, "--rate=" + rate, "--text", text, "--write-media", out]
    if env.get("HTTPS_PROXY"):
        cmd[1:1] = ["--proxy", env["HTTPS_PROXY"]]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    for attempt in range(3):
        r = subprocess.run(cmd, env=env, capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 1000:
            return dur(out)
    sys.stderr.write(r.stderr[-800:])
    raise SystemExit("edge-tts failed for " + out)

def silences(path, db=-38, mn=0.2):
    r = subprocess.run(["ffmpeg", "-i", path, "-af", f"silencedetect=noise={db}dB:d={mn}", "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    total = dur(path)
    if len(ends) < len(starts): ends.append(total)
    return list(zip(starts, ends)), total

def concat(out, lead, parts):
    """parts = [(file, gap_after_seconds), ...]; lead = silence before the first part."""
    inputs, filt, n = [], "", 0
    for i, (f, gap) in enumerate(parts):
        inputs += ["-i", f]
        pad = f"apad=pad_dur={gap}" if gap > 0 else "anull"
        pre = f"adelay={int(lead*1000)}|{int(lead*1000)}," if (i == 0 and lead > 0) else ""
        filt += f"[{i}:a]aresample=44100,aformat=channel_layouts=mono,{pre}{pad}[p{i}];"
        n += 1
    filt += "".join(f"[p{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + inputs + ["-filter_complex", filt, "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", out], check=True)
    return dur(out)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "speak":
        voice = a[a.index("--voice") + 1] if "--voice" in a else "en-US-AndrewMultilingualNeural"
        rate = a[a.index("--rate") + 1] if "--rate" in a else "+4%"
        print(speak(a[1], a[2], voice, rate))
    elif a[0] == "silences":
        db = float(a[a.index("--db") + 1]) if "--db" in a else -38
        mn = float(a[a.index("--min") + 1]) if "--min" in a else 0.2
        s, total = silences(a[1], db, mn)
        print(json.dumps({"dur": total, "silences": [[round(x, 3), round(y, 3)] for x, y in s]}))
    elif a[0] == "concat":
        out, lead = a[1], float(a[2]); rest = a[3:]
        parts = []
        i = 0
        while i < len(rest):
            f = rest[i]; gap = float(rest[i + 1]) if i + 1 < len(rest) else 0.0
            parts.append((f, gap)); i += 2
        print(concat(out, lead, parts))
    elif a[0] == "dur":
        print(dur(a[1]))
