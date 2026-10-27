import json, re, numpy as np, soundfile as sf
from scipy.signal import resample_poly
from kokoro_onnx import Kokoro
from pocketsphinx import Decoder
K = "/tmp/claude-0/-home-user/b169b62a-d682-52c1-a224-39e4ecd64bbf/scratchpad/kokoro/"
k = Kokoro(K+"kokoro-fp32.onnx", K+"voices-v1.0.bin")
VOICE = "am_fenrir"
cfg = json.load(open("vo_lines.json"))
EXTRA_DICT = {"chatgpt": "CH AE T JH IY P IY T IY", "a.i.": "EY AY"}
def norm_words(tts):
    s = tts.lower().replace("a.i.", "a i").replace("-", " ")
    s = re.sub(r"[^a-z' ]+", " ", s)
    return s.split()
def trim(x, sr, thr=0.004, pad=0.02):
    env = np.abs(x); idx = np.where(env > thr)[0]
    a = max(0, idx[0]-int(pad*sr)); b = min(len(x), idx[-1]+int(pad*sr))
    return x[a:b], a/sr
def align(x24, sr, words):
    y = resample_poly(x24, 2, 3); pcm = (np.clip(y,-1,1)*32767).astype(np.int16).tobytes()
    d = Decoder(samprate=16000)
    for w in words:
        if d.lookup_word(w) is None:
            if w in EXTRA_DICT: d.add_word(w, EXTRA_DICT[w], True)
            else: raise SystemExit(f"missing dict word: {w}")
    d.set_align_text(" ".join(words)); d.start_utt(); d.process_raw(pcm, full_utt=True); d.end_utt()
    segs = [(re.sub(r"\(\d+\)$","",s.word), s.start_frame/100, (s.end_frame+1)/100) for s in d.seg() if s.word not in ("<s>","</s>","<sil>","[SPEECH]")]
    segs = [s for s in segs if s[0] in words]
    # refine: shrink each word end to last voiced frame (10ms) within its span
    fr = int(0.01*16000); out=[]
    for w,s,e in segs:
        a,b = int(s*16000), int(e*16000); seg = y[a:b]
        if len(seg) > fr*3:
            e_fr = np.array([np.sqrt(np.mean(seg[i:i+fr]**2)) for i in range(0, len(seg)-fr, fr)])
            voiced = np.where(e_fr > max(0.01, 0.08*e_fr.max()))[0]
            if len(voiced): 
                e2 = s + (voiced[-1]+1)*0.01; s2 = s + voiced[0]*0.01
                s, e = s2, max(e2, s2+0.06)
        out.append((w,s,e))
    return out
results = []; report=[]
for L in cfg["lines"]:
    window = L["end_by"] - L["start"]
    speed = L.get("speed", 1.0)
    for attempt in range(4):
        x, sr = k.create(L["tts"], voice=VOICE, speed=speed, lang="en-us")
        x, off = trim(x, sr)
        dur = len(x)/sr
        if dur <= window: break
        speed = min(1.2, round(speed * dur/window * 1.03, 3))
    words = norm_words(L["tts"])
    segs = align(x, sr, words)
    if len(segs) != len(words): raise SystemExit(f"{L['id']}: aligned {len(segs)} of {len(words)} words: {segs}")
    # map tts words to caption tokens: group alignment words by the whitespace tokens of the TTS text
    cap_tokens = L["caption"].split(); tts_tokens = L["tts"].split()
    groups=[]; i=0
    for tok in tts_tokens:
        n = len(norm_words(tok)); groups.append(list(range(i, i+n))); i += n
    assert i == len(words), (L["id"], i, len(words))
    mapping = L.get("map")
    if mapping is None:
        if len(cap_tokens) != len(tts_tokens): raise SystemExit(f"{L['id']}: caption tokens {len(cap_tokens)} vs tts tokens {len(tts_tokens)}; add 'map'")
        mapping = [[j] for j in range(len(tts_tokens))]
    tokens = []
    for tok, tidx in zip(cap_tokens, mapping):
        widx = [w for j in tidx for w in groups[j]]
        s = segs[widx[0]][1]; e = segs[widx[-1]][2]
        tokens.append({"w": tok, "s": round(L["start"]+s,3), "e": round(L["start"]+e,3)})
    y48 = resample_poly(x, 2, 1)  # 24k -> 48k
    y48 = y48 / (np.abs(y48).max()+1e-9) * 0.7
    sf.write(f"audio/vo_{L['id']}.wav", y48.astype(np.float32), 48000)
    results.append({"id": L["id"], "start": L["start"], "end": round(L["start"]+dur,3), "dur": round(dur,3), "speed": speed, "file": f"audio/vo_{L['id']}.wav", "tokens": tokens})
    report.append(f"{L['id']:4s} start {L['start']:5.2f} dur {dur:4.2f}s (window {window:4.2f}) speed {speed:<5} ends {L['start']+dur:5.2f} / by {L['end_by']:5.2f}  -> {' '.join(t['w'] for t in tokens)}")
json.dump({"voice": VOICE, "lines": results}, open("vo_timing.json","w"), indent=1)
print("\n".join(report))
