"""Original royalty-free music bed for Ridgeline commercials (numpy only).
Usage: python3 music.py out.wav seconds [bpm]"""
import sys, numpy as np, wave
SR=44100
out=sys.argv[1]; dur=float(sys.argv[2]); bpm=float(sys.argv[3]) if len(sys.argv)>3 else 100
beat=60/bpm; n=int(SR*dur); L=np.zeros(n); R=np.zeros(n)
rng=np.random.default_rng(7)
def add(sig,start,pan=0.0,gain=1.0):
    i=int(start*SR); j=min(n,i+len(sig))
    if i>=n: return
    s=sig[:j-i]*gain; L[i:j]+=s*(1-pan)*0.5*2**0.5/1.0; R[i:j]+=s*(1+pan)*0.5*2**0.5/1.0
def env(length,a=0.005,d=0.3,s=0.0,r=0.0):
    t=np.arange(int(length*SR))/SR
    e=np.where(t<a,t/a,np.exp(-(t-a)/max(d,1e-3))*(1-s)+s)
    return e
def piano(f,length=2.4):
    t=np.arange(int(length*SR))/SR
    sig=sum((0.6/k**1.3)*np.sin(2*np.pi*f*k*t*(1+0.0004*k)) for k in range(1,7))
    return sig*env(length,0.004,0.9)
def pad(freqs,length):
    t=np.arange(int(length*SR))/SR
    sig=sum(np.sin(2*np.pi*f*t+0.3*np.sin(2*np.pi*0.2*t))+0.5*np.sin(2*np.pi*f*1.003*t) for f in freqs)/len(freqs)
    a=np.minimum(1,t/0.8)*np.minimum(1,(length-t)/0.8)
    return sig*a
def kick():
    t=np.arange(int(0.35*SR))/SR
    f=50+90*np.exp(-t*30); ph=2*np.pi*np.cumsum(f)/SR
    return np.sin(ph)*np.exp(-t*9)
def hat():
    t=np.arange(int(0.06*SR))/SR
    x=rng.standard_normal(len(t)); x=np.diff(np.concatenate([[0],x]))
    return x*np.exp(-t*70)*0.25
def clap():
    t=np.arange(int(0.25*SR))/SR
    x=rng.standard_normal(len(t)); return x*np.exp(-t*25)*0.35
mid=lambda m:440*2**((m-69)/12)
# I-V-vi-IV in D major, warm and hopeful
prog=[[50,57,62,66],[57,61,64,69],[59,62,66,71],[55,59,62,67]]
bar=4*beat; bars=int(np.ceil(dur/bar))
for b in range(bars):
    t0=b*bar; ch=prog[b%4]
    add(pad([mid(m) for m in ch[1:]],bar+0.5),t0,0,0.10)
    # piano arpeggio, 8th notes
    arp=[ch[0]+12,ch[1]+12,ch[2]+12,ch[3]+12,ch[2]+12,ch[1]+12,ch[2]+12,ch[3]+12]
    for k,m in enumerate(arp): add(piano(mid(m),1.6),t0+k*beat/2,(-0.3 if k%2 else 0.3),0.11)
    add(piano(mid(ch[0]-12),3.5),t0,0,0.22)   # bass note
    lvl=min(1.0,b/2)  # drums come in after 2 bars
    if b>=1:
        for k in range(4):
            add(kick(),t0+k*beat,0,0.55*lvl)
            add(hat(),t0+k*beat+beat/2,0.4,0.6*lvl)
            if b>=3 and k in (1,3): add(clap(),t0+k*beat,-0.1,0.5)
mix=np.stack([L,R],1)
# gentle fade in/out, normalise to -14 dB peak-ish
fade=int(1.0*SR); mix[:fade]*=np.linspace(0,1,fade)[:,None]; mix[-int(2*SR):]*=np.linspace(1,0,int(2*SR))[:,None]
mix=mix/np.max(np.abs(mix))*0.5
with wave.open(out,'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix*32767).astype('<i2').tobytes())
print("wrote",out,dur,"s")
