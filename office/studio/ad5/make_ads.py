"""Build the three launch cuts' ad.json files from one spec (spec.json next to this file).
  python3 office/studio/ad5/make_ads.py            -> writes loss.json, demo.json, question.json into office/studio/ad5/
The body (voice, captions, phone timeline) is shared and written once in the spec with times relative to the
body start; each hook has its own length H, so every body time becomes H + t. Hook-specific keys (text punches,
card timing, sfx) live under spec["hooks"][name]. Caption syntax is render.py's: "|" splits chunks, *word* is gold.
"""
import json, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(os.path.join(HERE, "spec.json")))
B = spec["body"]

def shift(v, H):
    if isinstance(v, (int, float)): return round(v + H, 3)
    if isinstance(v, list): return [shift(x, H) if isinstance(x, (int, float, list)) else x for x in v]
    return v

for name, hk in spec["hooks"].items():
    H = hk["H"]                      # when the body voice starts
    tl = {"hook": name}
    tl.update(hk["tl"])              # hook-only keys, absolute times
    for k, v in B["tl"].items():     # body keys, relative -> absolute
        tl[k] = shift(v, H)
    # chips: [[t, label, style], ...]
    tl["chips"] = [[round(c[0] + H, 3)] + c[1:] for c in B["chips"]]
    tl["cuts"] = sorted(set(hk.get("cuts", []) + [round(c + H, 3) for c in B["cuts"]]))
    caps = [[round(a, 3), round(b, 3), s] for a, b, s in hk.get("captions", [])] + [[round(a + H, 3), round(b + H, 3), s] for a, b, s in B["captions"]]
    sfx = [[round(t, 3), k] for t, k in hk.get("sfx", [])] + [[round(t + H, 3), k] for t, k in B["sfx"]]
    sfx.sort(); caps.sort()
    dur = round(H + B["dur_after_start"], 2)
    ad = {
        "dur": dur,
        "vo": hk["vo"],
        "music": spec["music"],
        "musicVol": spec.get("musicVol", 0.55),
        "voGain": spec.get("voGain", 1.6),
        "capTop": spec.get("capTop", 1400),
        "text": spec.get("text", {}),
        "tl": tl,
        "captions": caps,
        "sfx": sfx,
    }
    out = os.path.join(HERE, name + ".json")
    json.dump(ad, open(out, "w"), indent=1, ensure_ascii=False)
    print("wrote", out, "dur", dur, "captions", len(caps), "sfx", len(sfx))
