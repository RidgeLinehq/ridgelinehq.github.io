"""Final audio mix: VO lines + music bed (ducked under voice) + SFX -> out/mix.wav (48k stereo), mastered to ~-14 LUFS / -1 dBTP."""
import json, numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy.signal import butter, sosfilt, resample_poly
from pedalboard import Pedalboard, Compressor, HighpassFilter, PeakFilter, Limiter, Gain, LowShelfFilter, HighShelfFilter
SR=48000; N=SR*30
def load(path, mono=False):
    x, sr = sf.read(path, always_2d=True)
    if sr != SR: x = resample_poly(x, SR, sr, axis=0)
    if mono: x = x.mean(1, keepdims=True)
    return x.astype(np.float32)
def place(track, clip, t, gain=1.0):
    i=int(round(t*SR)); c=clip if clip.shape[1]==2 else np.repeat(clip,2,axis=1)
    n=min(len(c), N-i)
    if n>0: track[i:i+n]+=c[:n]*gain
def db(x): return 10**(x/20)
# ---- VO ----
vo=np.zeros((N,2),np.float32); tim=json.load(open("vo_timing.json"))
for L in tim["lines"]:
    x=load(L["file"], mono=True)
    place(vo, x, L["start"])
# VO chain: HPF 85, slight low-mid cut, presence lift, compressor, de-harsh shelf
vo_board=Pedalboard([HighpassFilter(cutoff_frequency_hz=85), PeakFilter(cutoff_frequency_hz=300, gain_db=-1.5, q=1.0), PeakFilter(cutoff_frequency_hz=3200, gain_db=2.0, q=0.9), HighShelfFilter(cutoff_frequency_hz=9000, gain_db=1.0), Compressor(threshold_db=-20, ratio=3.0, attack_ms=8, release_ms=120), Gain(gain_db=4.0)])
vo=vo_board(vo, SR)
# VO envelope for ducking (mono)
env=np.sqrt(np.convolve((vo.mean(1))**2, np.ones(int(.03*SR))/int(.03*SR), mode="same"))
act=(env>0.01).astype(np.float32)
# attack 40ms / release 500ms smoothing
duck=np.zeros(N,np.float32); a_att=1-np.exp(-1/(0.04*SR)); a_rel=1-np.exp(-1/(0.5*SR)); g=0.0
for i in range(N):
    tgt=act[i]; g+= (a_att if tgt>g else a_rel)*(tgt-g); duck[i]=g
# look-ahead: shift duck earlier by 60ms
la=int(.06*SR); duck=np.concatenate([duck[la:], np.zeros(la,np.float32)])
duck=np.maximum(duck, np.concatenate([np.zeros(la), duck[:-la]]))
DUCK_DB=-7.5
music_gain=db(DUCK_DB*duck)[:,None]
# ---- MUSIC ----
music=load("music/music_full.wav")[:N]
if len(music)<N: music=np.vstack([music, np.zeros((N-len(music),2),np.float32)])
music*=music_gain
# ---- SFX ----
sfx=np.zeros((N,2),np.float32); S=lambda n: load(f"music/sfx/{n}.wav")
tick=S("typing_tick"); tap=S("tap"); whoosh=S("whoosh"); pop=S("pop"); ding=S("ding"); notify=S("notify"); buzz=S("ring_buzz"); msg=S("message_in"); riser=S("riser_short")
QUERY_LEN=19
rng=np.random.default_rng(7)
for i in range(QUERY_LEN):
    place(sfx, tick, 0.10+i*(0.68/QUERY_LEN)+rng.uniform(-0.01,0.01), db(-14+rng.uniform(-2,2)))
place(sfx, tap, 0.85, db(-10)); place(sfx, msg, 1.12, db(-12)); place(sfx, tap, 2.17, db(-10))
for t,gn in [(3.0,-16),(7.0,-20),(11.0,-14),(14.0,-13),(17.0,-13),(20.0,-13),(26.5,-13)]: place(sfx, whoosh, t-0.12, db(gn))
for t in [14.72,15.52,16.12]: place(sfx, ding, t, db(-13))
place(sfx, riser, 17.1, db(-16)); place(sfx, ding, 18.0, db(-10))
for t in [18.35,18.75,19.15]: place(sfx, notify, t, db(-12)); place(sfx, buzz, t, db(-16))
T_POP=next(t['s'] for L in tim['lines'] if L['id']=='L5b' for t in L['tokens'] if t['w']=='$39.99'); place(sfx, pop, T_POP, db(-6)); print('pop at', T_POP)
place(sfx, msg, 24.45, db(-13)); place(sfx, ding, 27.45, db(-15))
# ---- SUM ----
VO_DB=0.0; MUSIC_DB=-2.0; SFX_DB=0.0
mix=vo*db(VO_DB)+music*db(MUSIC_DB)+sfx*db(SFX_DB)
# master: gentle glue, normalize to -14 LUFS, then a look-ahead peak limiter at -1 dBFS (true-peak safe via 4x oversampled check)
from scipy.ndimage import minimum_filter1d
def limiter(x, ceil_db=-1.0, look_ms=5, rel_ms=60):
    ceil=db(ceil_db); L=int(look_ms/1000*SR)
    peak=np.abs(x).max(1); g_req=np.minimum(1.0, ceil/np.maximum(peak,1e-9))
    env=minimum_filter1d(g_req, size=2*L, mode="nearest")
    env=np.convolve(env, np.ones(L)/L, mode="same"); env=np.minimum(env, 1.0)
    # upward (release) smoothing only
    out=np.empty_like(env); g=1.0; a=1-np.exp(-1/(rel_ms/1000*SR))
    for i in range(len(env)):
        if env[i]<g: g=env[i]
        else: g+=a*(env[i]-g)
        out[i]=g
    return x*out[:,None]
glue=Pedalboard([Compressor(threshold_db=-16, ratio=1.5, attack_ms=25, release_ms=250)])
mix=glue(mix, SR)
meter=pyln.Meter(SR); lufs=meter.integrated_loudness(mix)
target=-14.0; mix=mix*db(target-lufs)
mix=limiter(mix)
lufs2=meter.integrated_loudness(mix); peak=20*np.log10(np.abs(mix).max()+1e-9)
up=resample_poly(mix, 4, 1, axis=0); tpeak=20*np.log10(np.abs(up).max()+1e-9)
# fade last 0.2 s and ensure exact length
fade=np.linspace(1,0,int(.2*SR),dtype=np.float32)[:,None]; mix[-len(fade):]*=fade
sf.write("out/mix.wav", mix.astype(np.float32), SR, subtype="PCM_24")
vo_l=meter.integrated_loudness(vo[int(3*SR):int(7*SR)]); mu_l=meter.integrated_loudness(music[int(12*SR):int(20*SR)])
print(f"mix LUFS {lufs2:.2f} (pre-norm {lufs:.2f}) peak {peak:.2f} dBFS truepeak {tpeak:.2f} dBTP | VO 3-7s {vo_l:.1f} LUFS | ducked music 12-20s {mu_l:.1f} LUFS")
# per-second RMS of the final mix
m=mix.mean(1); print("per-sec dBFS:", " ".join(f"{20*np.log10(np.sqrt(np.mean(m[i*SR:(i+1)*SR]**2))+1e-9):.0f}" for i in range(30)))
