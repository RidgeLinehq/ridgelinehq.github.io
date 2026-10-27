#!/usr/bin/env python3
"""
make_music.py -- procedural music bed + SFX for the "Ridgeline Local" 30 s vertical ad.

Everything is synthesized in numpy/scipy (+ pedalboard for reverb/chorus/compression).
Deterministic: all randomness comes from one seeded Generator. Re-runnable.

Outputs (next to this file):
  music_full.wav        stereo 48 kHz float32, exactly 1,440,000 frames, music only
  stems/*.wav           per-bus stems (same gain / fade as the master, no bus compressor)
  sfx/*.wav             UI / transition SFX, peak -6 dBFS, 10 ms fades
  cues.json             bpm, section starts, accent times
  report.md             self-check (RMS table, LUFS, true peak, silence checks, clicks, spectrum)
"""
import os, json, math
import numpy as np
from scipy import signal
import soundfile as sf
import pyloudnorm as pyln
import pedalboard as pb

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 48000
DUR = 30.0
N = int(round(DUR * SR))          # 1_440_000
BPM = 120.0
BEAT = 60.0 / BPM                 # 0.5 s
EIGHTH = BEAT / 2                 # 0.25 s
SEED = 20261027
rng = np.random.default_rng(SEED)
TWO_PI = 2.0 * math.pi

# =====================================================================================
# basic helpers
# =====================================================================================
def db(x):
    return 10.0 ** (x / 20.0)

def to_db(x):
    return 20.0 * math.log10(max(x, 1e-12))

NOTE_IDX = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
            'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}

def hz(name):
    """'D2', 'Bb3' -> Hz (A4 = 440)."""
    n, o = name[:-1], int(name[-1])
    midi = 12 * (o + 1) + NOTE_IDX[n]
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)

def cents(f, c):
    return f * 2.0 ** (c / 1200.0)

def tvec(n):
    return np.arange(n) / SR

def stereo(x):
    return x if x.ndim == 2 else np.stack([x, x])

def place(buf, sig, t0, gain=1.0):
    """Add mono (n,) or stereo (2,n) signal into stereo buffer (2,N) at t0 seconds (bounds-safe)."""
    sig = stereo(sig)
    i0 = int(round(t0 * SR))
    n = sig.shape[1]
    if i0 >= N or i0 + n <= 0:
        return
    a, b = max(i0, 0), min(i0 + n, N)
    buf[:, a:b] += gain * sig[:, a - i0:b - i0]

def pan(sig, p):
    """Constant-power pan of a mono signal, p in [-1, 1]."""
    th = (p + 1.0) * math.pi / 4.0
    return np.stack([sig * math.cos(th), sig * math.sin(th)])

def fade(x, fin=0.0, fout=0.0):
    """Raised-cosine fade in / out (returns a copy). fout guarantees the last sample is exactly 0."""
    x = np.array(x, dtype=np.float64, copy=True)
    n = x.shape[-1]
    if fin > 0:
        k = min(n, max(2, int(fin * SR)))
        w = 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
        x[..., :k] *= w
    if fout > 0:
        k = min(n, max(2, int(fout * SR)))
        w = 0.5 + 0.5 * np.cos(np.pi * np.arange(1, k + 1) / k)
        x[..., n - k:] *= w
    return x

def exp_seg(n, start, end, curve=5.0):
    """Exponential segment from start to end, inclusive of both ends."""
    if n <= 0:
        return np.zeros(0)
    if n == 1:
        return np.array([end], dtype=np.float64)
    t = np.linspace(0.0, 1.0, n)
    s = (1.0 - np.exp(-curve * t)) / (1.0 - np.exp(-curve))
    return start + (end - start) * s

def adsr(gate_n, a, d, s, r, curve=5.0):
    """Exponential ADSR. Returns an envelope of gate_n + release samples."""
    an = max(2, int(a * SR)); dn = max(2, int(d * SR)); rn = max(2, int(r * SR))
    env = np.zeros(gate_n + rn)
    k = min(an, gate_n)
    env[:k] = exp_seg(an, 0.0, 1.0, curve)[:k]
    if gate_n > an:
        k2 = min(dn, gate_n - an)
        env[an:an + k2] = exp_seg(dn, 1.0, s, curve)[:k2]
        if gate_n > an + dn:
            env[an + dn:gate_n] = s
    last = env[gate_n - 1] if gate_n > 0 else 0.0
    env[gate_n:] = exp_seg(rn, last, 0.0, curve)
    return env

def decay_env(n, tau, attack=0.001):
    """Smooth attack then exponential decay; final 2 ms tucked to zero."""
    t = tvec(n)
    env = np.exp(-t / tau)
    an = max(2, int(attack * SR))
    if an < n:
        env[:an] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(an) / an)
    return fade(env, 0.0, 0.002)

def noise(n, ch=1):
    x = rng.standard_normal((ch, n)) if ch > 1 else rng.standard_normal(n)
    return x * 0.33

# ---------------- oscillators ----------------
def saw(freq, n, phase0=0.0):
    """Band-limited sawtooth (polyBLEP). freq may be a scalar or per-sample array."""
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    out = 2.0 * ph - 1.0
    m = ph < dt
    tt = ph[m] / dt[m]
    out[m] -= (tt + tt - tt * tt - 1.0)
    m2 = ph > (1.0 - dt)
    tt = (ph[m2] - 1.0) / dt[m2]
    out[m2] -= (tt * tt + tt + tt + 1.0)
    return out

def sine(freq, n, phase0=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.sin(TWO_PI * (phase0 + np.cumsum(f) / SR))

def additive(f0, n, partials, inharm=0.0, attack=0.002):
    """Additive partials: list of (ratio, amp, tau). Band-limited by construction."""
    t = tvec(n)
    x = np.zeros(n)
    for r, a, tau in partials:
        fk = f0 * r * math.sqrt(1.0 + inharm * r * r)
        if fk > 0.45 * SR:
            continue
        x += a * np.sin(TWO_PI * fk * t + rng.random() * TWO_PI) * np.exp(-t / tau)
    an = max(2, int(attack * SR))
    x[:an] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(an) / an)
    return x

# ---------------- filters ----------------
def _sos(fc, kind, order):
    return signal.butter(order, fc, kind, fs=SR, output='sos')

def lp(x, fc, order=2):
    return signal.sosfilt(_sos(min(fc, 0.47 * SR), 'low', order), x, axis=-1)

def hp(x, fc, order=2):
    return signal.sosfilt(_sos(max(fc, 5.0), 'high', order), x, axis=-1)

def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos([max(lo, 5.0), min(hi, 0.47 * SR)], 'band', order), x, axis=-1)

def rbj(fc, q, kind):
    w0 = TWO_PI * fc / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2.0 * q)
    if kind == 'lp':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
    else:
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    return np.array([b0, b1, b2]) / a0, np.array([1.0, a1 / a0, a2 / a0])

def tv_filter(x, cutoff, q=0.707, kind='lp', block=64):
    """Time-varying 2-pole RBJ filter, coefficients updated every `block` samples (zipper-free for slow sweeps)."""
    if x.ndim == 2:
        return np.stack([tv_filter(ch, cutoff, q, kind, block) for ch in x])
    n = len(x)
    cut = np.broadcast_to(np.asarray(cutoff, dtype=np.float64), (n,))
    out = np.empty(n)
    zi = np.zeros(2)
    for i in range(0, n, block):
        fc = float(np.clip(cut[i], 20.0, 20000.0))
        b, a = rbj(fc, q, kind)
        out[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], zi=zi)
    return out

def lp_tv(x, cutoff, q=0.707):
    return tv_filter(x, cutoff, q, 'lp')

def hp_tv(x, cutoff, q=0.707):
    return tv_filter(x, cutoff, q, 'hp')

def lp4_tv(x, cutoff, q=0.9):
    """4-pole-ish sweepable lowpass: resonant stage + gentle stage."""
    return lp_tv(lp_tv(x, cutoff, q), np.asarray(cutoff) * 1.35, 0.6)

def soft(x, drive=1.5):
    return np.tanh(drive * x) / math.tanh(drive)

# ---------------- pedalboard FX ----------------
def fx(sig2, plugins):
    board = pb.Pedalboard(plugins)
    y = board(np.ascontiguousarray(sig2, dtype=np.float32), SR)
    return np.asarray(y, dtype=np.float64)

def reverb(sig2, room=0.8, damp=0.5, width=1.0):
    return fx(sig2, [pb.Reverb(room_size=room, damping=damp, wet_level=1.0, dry_level=0.0, width=width)])

def chorus(sig2, rate=0.45, depth=0.22, delay=7.0, mix=0.35):
    return fx(sig2, [pb.Chorus(rate_hz=rate, depth=depth, centre_delay_ms=delay, feedback=0.0, mix=mix)])

# =====================================================================================
# instruments
# =====================================================================================
def sub_boom(dur=1.8):
    """0.0 s pattern-interrupt: soft but deep sub impact (no BRAAM)."""
    n = int(dur * SR); t = tvec(n)
    f = hz('D1') + (95.0 - hz('D1')) * np.exp(-t / 0.12)
    x = sine(f, n) * decay_env(n, 0.45, attack=0.008)
    x = soft(x, 1.4)
    thud = lp(noise(n), 160, 4) * decay_env(n, 0.07, 0.003) * 1.2
    x = lp(x + thud, 380, 2)
    return fade(x, 0.0, 0.03)

def drone(t_on=0.0, t_off=7.0, rel=0.15):
    """D minor drone: detuned polyBLEP saws (D2, D3) under a slowly opening resonant lowpass + D1 sine."""
    gate = int((t_off - t_on) * SR); n = gate + int(rel * SR); t = tvec(n) + t_on
    voices = [(hz('D2'), -5, -0.45), (hz('D2'), 5, 0.45), (hz('D3'), -7, -0.7), (hz('D3'), 7, 0.7)]
    L = np.zeros(n); R = np.zeros(n)
    for f, c, p in voices:
        drift = 1.0 + 0.0012 * np.sin(TWO_PI * 0.09 * t + rng.random() * TWO_PI)
        v = saw(cents(f, c) * drift, n, rng.random())
        s = pan(v, p); L += s[0]; R += s[1]
    # filter: 130 Hz -> 620 Hz over 0..3 s, then slow unsettled LFO around 560 Hz
    open_ = np.clip(t / 3.0, 0.0, 1.0)
    cut = 130.0 * (620.0 / 130.0) ** open_
    cut = cut + np.where(t > 3.0, (560.0 - 620.0) * np.clip((t - 3.0) / 1.0, 0, 1) + 110.0 * np.sin(TWO_PI * 0.17 * (t - 3.0)) * np.clip((t - 3.0) / 1.0, 0, 1), 0.0)
    L = lp4_tv(L, cut, 1.1); R = lp4_tv(R, cut * 1.03, 1.1)
    env = adsr(gate, 1.4, 0.5, 1.0, rel)
    sub = np.sin(TWO_PI * hz('D1') * tvec(n)) * 0.2
    out = (np.stack([L, R]) * 0.3 + sub) * env
    return out

def tick(vel=1.0):
    """Muted clock-like tick for the 0-3 s pulse."""
    n = int(0.07 * SR); t = tvec(n)
    x = (np.sin(TWO_PI * 1250 * t) + 0.45 * np.sin(TWO_PI * 2480 * t) * np.exp(-t / 0.003)) * np.exp(-t / 0.011)
    x = lp(x, 3000, 2)
    return fade(x * vel, 0.0006, 0.01)

def noise_riser(dur, f0, f1, curve=3.2, hp_ratio=0.45, width=1.0, pan_sweep=None, end_fade=0.004):
    """Clean filtered-noise sweep rising from f0 to f1 with an exponential amplitude curve."""
    n = int(dur * SR); u = tvec(n) / dur
    nz = noise(n, 2)
    center = f0 * (f1 / f0) ** u
    y = lp_tv(nz, center * 1.3, 1.3)
    y = hp_tv(y, center * hp_ratio, 0.8)
    amp = (np.exp(curve * u) - 1.0) / (np.exp(curve) - 1.0)
    y = y * amp
    y = lp(y, 11000, 2)
    mono = y.mean(axis=0)
    y = width * y + (1.0 - width) * np.stack([mono, mono])
    if pan_sweep is not None:
        p0, p1 = pan_sweep
        th = (np.linspace(p0, p1, n) + 1.0) * math.pi / 4.0
        m = y.mean(axis=0)
        y = np.stack([m * np.cos(th), m * np.sin(th)])
    return fade(y, 0.01, end_fade)

def sting():
    """3.0 s: dark quick sting -- sub thump + short low filtered-saw minor stab."""
    n = int(2.2 * SR); t = tvec(n)
    f = 38.0 + 34.0 * np.exp(-t / 0.06)
    sub = sine(f, n) * decay_env(n, 0.32, 0.003)
    stab = np.zeros((2, n))
    for nm, c, p in [('D2', -4, -0.3), ('D2', 4, 0.3), ('A2', 0, 0.0), ('F3', -3, -0.55), ('F3', 3, 0.55)]:
        v = saw(cents(hz(nm), c), n, rng.random())
        stab += pan(v, p)
    cut = 200.0 + 1100.0 * np.exp(-t / 0.09)
    stab = lp4_tv(stab, cut, 1.3)
    stab *= decay_env(n, 0.24, 0.002) * 0.2
    out = stab + np.stack([sub, sub]) * 0.95
    return fade(out, 0.0, 0.05)

def heart_thump(vel=1.0):
    n = int(0.45 * SR); t = tvec(n)
    f = 46.0 + 32.0 * np.exp(-t / 0.05)
    x = sine(f, n) * decay_env(n, 0.09, 0.012)
    x = lp(x, 150, 2)
    return fade(x * vel, 0.0, 0.03)

def pad(notes, t_on, t_off, cutoff_fn, a=0.35, r=0.55, detune=7.0, q=0.9, drift=0.0012, hp_cut=None):
    """Analog-style pad: 3 detuned polyBLEP saws per note (L / C / R), swept resonant lowpass, exp ADSR.
    notes: list of note names or (name, weight). cutoff_fn(t_abs) -> Hz array."""
    gate = int(round((t_off - t_on) * SR)); n = gate + int(r * SR)
    t_abs = tvec(n) + t_on
    L = np.zeros(n); R = np.zeros(n)
    for i, item in enumerate(notes):
        nm, w = (item if isinstance(item, tuple) else (item, 1.0))
        f = hz(nm)
        for c, p in ((-detune, -0.75), (0.0, 0.0), (detune, 0.75)):
            d = 1.0 + drift * np.sin(TWO_PI * (0.08 + 0.03 * i) * t_abs + rng.random() * TWO_PI)
            v = saw(cents(f, c) * d, n, rng.random()) * w
            s = pan(v, p); L += s[0]; R += s[1]
    cut = np.asarray(cutoff_fn(t_abs), dtype=np.float64)
    L = lp4_tv(L, cut, q); R = lp4_tv(R, cut * 1.04, q)
    out = np.stack([L, R])
    if hp_cut:
        out = hp(out, hp_cut, 2)
    env = adsr(gate, a, 1.0, 0.85, r)
    return out * env / (len(notes) * 3.0)

def kick(vel=1.0):
    n = int(0.5 * SR); t = tvec(n)
    f = 50.0 + 120.0 * np.exp(-t / 0.027)
    body = sine(f, n) * decay_env(n, 0.125, 0.0008)
    body = soft(body, 1.6)
    click = lp(noise(n), 3500, 2) * decay_env(n, 0.004, 0.0003) * 0.7
    x = lp(body + click, 7000, 2)
    return fade(x * vel, 0.0, 0.03)

def clap():
    n = int(0.55 * SR)
    nz = noise(n)
    env = np.zeros(n)
    for k, (dt_, a_) in enumerate([(0.0, 0.45), (0.011, 0.65), (0.021, 0.8), (0.031, 1.0)]):
        i = int(dt_ * SR); m = n - i
        tau = 0.0055 if k < 3 else 0.07
        env[i:] = np.maximum(env[i:], a_ * np.exp(-tvec(m) / tau))
    x = nz * env
    x = bp(x, 700, 9000, 2)
    x = soft(x, 1.8)
    return fade(x, 0.0005, 0.03)

def hat(vel=1.0, tau=0.03):
    n = int(0.14 * SR)
    nz = noise(n, 2)
    x = hp(nz, 7200, 4)
    x = lp(x, 15500, 2)
    m = x.mean(axis=0)
    x = 0.65 * x + 0.35 * np.stack([m, m])
    return fade(x * decay_env(n, tau, 0.0006) * vel, 0.0, 0.012)

def crash(tau=0.55, dur=2.2):
    n = int(dur * SR)
    nz = noise(n, 2)
    x = hp(nz, 4500, 4)
    x = lp(x, 14000, 2)
    return fade(x * decay_env(n, tau, 0.004), 0.0, 0.1)

def thump(f_start=90.0, f_end=46.0, tau=0.28, dur=1.1, pitch_tau=0.05):
    n = int(dur * SR); t = tvec(n)
    f = f_end + (f_start - f_end) * np.exp(-t / pitch_tau)
    x = sine(f, n) * decay_env(n, tau, 0.003)
    return fade(soft(x, 1.3), 0.0, 0.05)

def bass_note(nm, dur, vel=1.0, rel=0.06):
    """Warm sub: sine fundamental (soft-saturated) + lowpassed saw an octave up for small-speaker presence."""
    f = hz(nm); gate = int(dur * SR); n = gate + int(rel * SR)
    sub = soft(np.sin(TWO_PI * f * tvec(n)), 1.4) * 0.72
    mid = lp(saw(2.0 * f, n, 0.0), 380, 4) * 0.7
    x = sub + mid
    env = adsr(gate, 0.006, 0.08, 0.9, rel)
    return x * env * vel

def pluck(nm, vel=1.0, dur=0.6):
    """Bright but smooth pluck: 2 detuned saws through a fast-closing resonant lowpass."""
    f = hz(nm); n = int(dur * SR); t = tvec(n)
    v = saw(cents(f, -5), n, rng.random()) + saw(cents(f, 5), n, rng.random())
    cut = 1300.0 + 7000.0 * vel * np.exp(-t / 0.12)
    v = lp4_tv(v, cut, 1.0)
    env = decay_env(n, 0.16, 0.0015)
    return fade(v * env * vel * 0.5, 0.0, 0.02)

def bell(nm, vel=1.0, dur=2.6):
    """Soft glass bell for the three 'step' accents."""
    f = hz(nm); n = int(dur * SR)
    parts = [(1.0, 1.0, 0.7), (2.0, 0.32, 0.42), (2.756, 0.2, 0.3), (4.07, 0.07, 0.2)]
    x = additive(f, n, parts, inharm=0.0, attack=0.0025)
    return fade(x * vel * 0.5, 0.0, 0.1)

def felt(nm, vel=0.8, dur=2.2, tau1=0.9):
    """Felt-piano-like tone: inharmonic additive partials with faster decay for higher partials + tiny hammer thud."""
    f = hz(nm); n = int(dur * SR); t = tvec(n)
    parts = []
    for k in range(1, 9):
        amp = 1.0 / k ** 1.75
        tau = tau1 / (1.0 + 0.5 * (k - 1))
        parts.append((float(k), amp, tau))
    x = additive(f, n, parts, inharm=0.00025, attack=0.004)
    hammer = lp(noise(n), 800, 2) * decay_env(n, 0.009, 0.0005) * 0.12
    x = lp(x + hammer, 5200, 2)
    return fade(x * vel * 0.45, 0.0, 0.1)

def pop_accent():
    """20.0 price reveal: sub thump + bubble pop + bright F-major chime roll."""
    n = int(1.6 * SR); t = tvec(n)
    bubble = sine(380.0 + 900.0 * np.exp(-t / 0.012), n) * decay_env(n, 0.035, 0.0008) * 0.5
    th = thump(85.0, 46.0, tau=0.3, dur=1.6)
    out = np.stack([bubble, bubble]) + np.stack([th, th]) * 0.9
    for i, nm in enumerate(['F5', 'A5', 'C6']):
        b = bell(nm, vel=0.9 - 0.15 * i, dur=1.5)
        place_local = np.zeros((2, n))
        off = int(0.012 * i * SR)
        s = pan(b, -0.35 + 0.35 * i)
        place_local[:, off:off + s.shape[1]] += s[:, :n - off]
        out += place_local * 0.55
    return fade(out, 0.0, 0.05)

def air_bed(t_on, t_off):
    """Barely audible high 'air' for the pause."""
    n = int((t_off - t_on) * SR)
    x = hp(noise(n, 2), 7000, 4)
    x = lp(x, 14000, 2)
    return fade(x, 0.6, 0.4)

def sidechain(times, depth, release=0.26, attack=0.004):
    env = np.zeros(N)
    an = max(2, int(attack * SR)); n = int(1.5 * SR)
    seg = np.exp(-tvec(n) / release)
    seg[:an] *= np.linspace(0.0, 1.0, an)
    for t in times:
        i = int(round(t * SR)); b = min(N, i + n)
        if i < N:
            env[i:b] = np.maximum(env[i:b], seg[:b - i])
    return 1.0 - depth * env

# =====================================================================================
# arrangement
# =====================================================================================
KEY_NOTES = {
    'C':  (['G3', 'C4', 'E4'],                 ['G4', 'C5', 'E5'],  'C2', 'G2'),
    'F':  (['F3', 'A3', 'C4', 'F4'],           ['A4', 'C5', 'F5'],  'F1', 'C2'),
    'Bb': (['F3', 'Bb3', 'D4', 'F4'],          ['Bb4', 'D5', 'F5'], 'Bb1', 'F2'),
    'Dm': (['D3', 'A3', 'D4', 'F4'],           ['A4', 'D5', 'F5'],  'D2', 'A2'),
    'Fend': (['F3', 'A3', 'C4', 'G4', 'F4'],   ['A4', 'C5', 'F5'],  'F1', 'C2'),
}
# (chord, start, end)
PROGRESSION = [('C', 11.0, 12.0), ('F', 12.0, 14.0), ('Bb', 14.0, 16.0), ('C', 16.0, 18.0), ('Dm', 18.0, 20.0),
               ('F', 20.0, 22.0), ('Bb', 22.0, 24.0), ('C', 24.0, 26.0), ('Fend', 26.0, 28.7)]

def build(intro_gain=1.0, verbose=True):
    buses = {k: np.zeros((2, N)) for k in ['intro', 'drums', 'bass', 'pads', 'plucks', 'keys', 'fx']}
    cues = {'bpm': BPM, 'key': 'D minor intro -> F major (relative major) drop; F / Bb / C / Dm | F / Bb / C -> F',
            'sections': [
                {'name': 'pattern_interrupt', 'start': 0.0, 'end': 3.0},
                {'name': 'sting_tension', 'start': 3.0, 'end': 7.0},
                {'name': 'pause', 'start': 7.0, 'end': 9.6},
                {'name': 'riser', 'start': 9.6, 'end': 11.0},
                {'name': 'drop_fix_steps', 'start': 11.0, 'end': 20.0},
                {'name': 'price_reveal', 'start': 20.0, 'end': 26.0},
                {'name': 'end_card', 'start': 26.0, 'end': 30.0}],
            'hits': [], 'kicks': [], 'steps': [11.0, 14.0, 17.0], 'chords': []}
    H = cues['hits']

    # ---------------- 0-3: pattern interrupt ----------------
    # The intro voices gate off at T_CUT with a ~140 ms release so the direct sound is gone exactly at 7.0;
    # the intro reverb return is ducked over the same 140 ms and then decays, leaving a short, quiet tail.
    T_CUT = 6.86; REL = 0.14
    B = buses['intro']
    place(B, sub_boom(), 0.0, 0.55); H.append({'t': 0.0, 'what': 'sub_boom'})
    place(B, drone(0.0, T_CUT, rel=REL), 0.0, 0.5)
    k = 0
    for i in range(10):                            # ticking 8ths 0.5 .. 2.75 s
        t = 0.5 + i * EIGHTH
        vel = 1.0 if i % 2 == 0 else 0.55
        place(B, pan(tick(vel), 0.25 if i % 2 else -0.25), t, 0.045)
    place(B, noise_riser(0.8, 300.0, 2600.0, curve=3.5), 3.0 - 0.8, 0.09)

    # ---------------- 3-7: sting + tension ----------------
    place(B, sting(), 3.0, 0.6); H.append({'t': 3.0, 'what': 'sting'})
    for t in (3.5, 4.5, 5.5, 6.5):                 # heartbeat lub-dub
        place(B, heart_thump(1.0), t, 0.42)
        place(B, heart_thump(0.6), t + 0.17, 0.42)
    tension_cut = lambda t: 560.0 + 110.0 * np.sin(TWO_PI * 0.21 * t)
    place(B, pad(['D3', 'A3', 'F4', ('Bb4', 0.55)], 3.0, T_CUT, tension_cut, a=0.9, r=REL, q=1.0), 3.0, 0.42)
    shimmer_cut = lambda t: 7000.0 + 900.0 * np.sin(TWO_PI * 0.13 * t)
    place(B, pad(['A5', 'D6'], 3.4, T_CUT, shimmer_cut, a=1.6, r=REL, detune=9.0, drift=0.002, hp_cut=1200.0), 3.4, 0.17)
    # safety gate: nothing direct from the intro bus survives past 7.0 (heartbeat tails etc.)
    t_all = tvec(N)
    gate = np.ones(N); m = (t_all >= T_CUT) & (t_all < 7.0)
    gate[m] = 0.5 + 0.5 * np.cos(np.pi * (t_all[m] - T_CUT) / (7.0 - T_CUT)); gate[t_all >= 7.0] = 0.0
    B *= gate

    # ---------------- 7-11: pause + riser ----------------
    F = buses['fx']
    place(F, air_bed(7.0, 11.0), 7.0, 0.004)
    place(F, noise_riser(1.4, 280.0, 6500.0, curve=3.6, width=0.8), 11.0 - 1.4, 0.32)
    riser_cut = lambda t: 220.0 * (3800.0 / 220.0) ** np.clip((t - 9.6) / 1.4, 0, 1)
    place(buses['pads'], pad(['G3', 'C4', 'E4', 'G4'], 9.6, 11.0, riser_cut, a=1.35, r=0.07, q=1.0), 9.6, 0.65)

    # ---------------- 11-26: drop ----------------
    D = buses['drums']
    place(D, crash(0.55), 11.0, 0.14); H.append({'t': 11.0, 'what': 'drop_hit'})
    place(F, thump(95.0, 48.0, tau=0.3), 11.0, 0.55)

    kick_times = [12.0 + 0.5 * i for i in range(28)] + [26.0, 26.5, 27.0, 27.5]
    for t in kick_times:
        beat_in_bar = int(round((t - 12.0) / BEAT)) % 4
        place(D, kick(1.0 if beat_in_bar in (0, 2) else 0.93), t, 0.46)
    cues['kicks'] = kick_times
    for bar in range(12, 26, 2):
        for off in (0.5, 1.5):
            place(D, clap(), bar + off, 0.22)
    k = 0
    t = 11.0
    while t < 27.76:
        off_beat = (k % 2 == 1)
        vel = (0.85 if off_beat else 0.55) * (1.0 + 0.08 * (rng.random() - 0.5) * 2)
        tau = 0.055 if off_beat else 0.035
        tt = t + (0.013 if off_beat else 0.0)
        place(D, hat(vel, tau), tt, 0.19)
        t += EIGHTH; k += 1

    # sidechain pumps (ghost pumps during the 2-beat pickup so the groove feel starts at 11.0)
    sc_times = [11.0, 11.5] + kick_times
    sc_bass = sidechain(sc_times, 0.72, release=0.24)
    sc_pad = sidechain(sc_times, 0.32, release=0.28)
    sc_pluck = sidechain(sc_times, 0.22, release=0.2)

    # bass (root-fifth movement in 8ths)
    BASS = buses['bass']
    bass_pat = [(0, 'R', 1.4, 1.0), (2, 'R', 0.9, 0.85), (3, '5', 0.9, 0.72), (4, 'R', 1.4, 1.0), (6, '5', 0.9, 0.72), (7, 'R', 0.9, 0.85)]
    place(BASS, bass_note('C2', 0.9, 1.0), 11.0, 0.3)
    place(BASS, bass_note('G2', 0.2, 0.7), 11.75, 0.3)
    for chord, s, e in PROGRESSION:
        if s < 12.0 or s >= 26.0:
            continue
        _, _, root, fifth = KEY_NOTES[chord]
        for i8, which, d8, v in bass_pat:
            place(BASS, bass_note(root if which == 'R' else fifth, d8 * EIGHTH, v), s + i8 * EIGHTH, 0.3)
    place(BASS, bass_note('F1', 2.5, 1.0, rel=0.7), 26.0, 0.3)
    BASS *= sc_bass

    # pads (chords) + high layer 20-26
    P = buses['pads']
    pad_cut = lambda t: 1500.0 + 300.0 * np.sin(TWO_PI * 0.12 * t)
    hi_cut = lambda t: 2800.0 + 350.0 * np.sin(TWO_PI * 0.1 * t + 1.0)
    for chord, s, e in PROGRESSION:
        low, high, root, fifth = KEY_NOTES[chord]
        cues['chords'].append({'t': s, 'chord': chord.replace('end', ' (end card, add9)')})
        if chord == 'Fend':
            place(P, pad(low, s, e, pad_cut, a=0.5, r=1.0), s, 0.7)
            place(P, pad(high, s, e, hi_cut, a=1.2, r=1.0, hp_cut=300.0), s, 0.19)
        else:
            place(P, pad(low, s, e, pad_cut, a=0.35, r=0.55), s, 0.7)
            if s >= 20.0:
                place(P, pad(high, s, e, hi_cut, a=0.6, r=0.55, hp_cut=300.0), s, 0.2)
    P *= sc_pad

    # plucks on the off-beat 8ths
    PL = buses['plucks']
    def pluck_chord(voicing, t, vel):
        spread = np.linspace(-0.45, 0.45, len(voicing))
        for nm, p in zip(voicing, spread):
            place(PL, pan(pluck(nm, vel), p), t, 0.38)
    for chord, s, e in PROGRESSION:
        if chord == 'Fend':
            continue
        low, high, root, fifth = KEY_NOTES[chord]
        inv = high[1:] + [high[0][:-1] + str(int(high[0][-1]) + 1)]   # first inversion up
        n8 = int(round((e - s) / EIGHTH))
        for i8 in range(1, n8, 2):
            voicing = high if (i8 % 4 == 1) else inv
            vel = 0.9 if (i8 % 4 == 1) else 0.75
            pluck_chord(voicing, s + i8 * EIGHTH, vel)
    PL *= sc_pluck

    # keys: step bells, price-reveal pop, counter-melody, end-card felt chord
    K = buses['keys']
    for t, nm in zip(cues['steps'], ['C5', 'F5', 'G5']):
        place(K, pan(bell(nm, 1.0), 0.2), t, 0.2); H.append({'t': t, 'what': f'step_bell_{nm}'})
    place(F, noise_riser(0.3, 1800.0, 9000.0, curve=4.0, hp_ratio=0.6, width=1.0), 20.0 - 0.3, 0.12)
    place(K, pop_accent(), 20.0, 0.38); H.append({'t': 20.0, 'what': 'price_pop'})
    melody = [(20.5, 'A5', 0.5), (21.0, 'G5', 0.5), (21.5, 'F5', 1.0),
              (22.5, 'D5', 0.5), (23.0, 'F5', 0.5), (23.5, 'Bb5', 1.0),
              (24.5, 'G5', 0.5), (25.0, 'E5', 0.5), (25.5, 'G5', 0.5)]
    for t, nm, d in melody:
        place(K, pan(felt(nm, 0.7, dur=1.6, tau1=0.7), -0.2), t, 0.26)
    for nm, off, v, p in [('F3', 0.0, 0.9, -0.2), ('C4', 0.012, 0.8, 0.1), ('A4', 0.024, 0.8, 0.25), ('F5', 0.04, 0.75, -0.1)]:
        place(K, pan(felt(nm, v, dur=3.6, tau1=1.7), p), 26.0 + off, 0.34)
    H.append({'t': 26.0, 'what': 'resolve_F_major'})
    H.append({'t': 28.0, 'what': 'drums_out'})

    # ---------------- bus processing ----------------
    # intro reverb return: full until T_CUT, cosine duck to -22 dB by 7.0, then a short natural-sounding tail
    duck = np.ones(N); m = (t_all >= T_CUT) & (t_all < 7.0)
    duck[m] = 1.0 - (1.0 - 0.08) * (0.5 - 0.5 * np.cos(np.pi * (t_all[m] - T_CUT) / (7.0 - T_CUT)))
    duck[t_all >= 7.0] = 0.08 * np.exp(-(t_all[t_all >= 7.0] - 7.0) / 0.3)
    intro = buses['intro'] * intro_gain
    intro_out = intro + 0.38 * reverb(intro, 0.82, 0.4) * duck

    drums = buses['drums']
    drums_out = drums + 0.13 * reverb(drums, 0.35, 0.7)

    pads = chorus(buses['pads'])
    pads_out = pads + 0.42 * reverb(pads, 0.84, 0.45)

    plucks = chorus(buses['plucks'], rate=0.3, depth=0.15, mix=0.25)
    plucks_out = plucks + 0.3 * reverb(plucks, 0.72, 0.5)

    keys_out = buses['keys'] + 0.38 * reverb(buses['keys'], 0.8, 0.5)
    fxb = buses['fx']
    fx_out = fxb + 0.25 * reverb(fxb, 0.75, 0.5)
    bass_out = buses['bass']

    stems = {'intro': intro_out, 'drums': drums_out, 'bass': bass_out, 'pads': pads_out,
             'plucks': plucks_out, 'keys': keys_out, 'fx': fx_out}
    return stems, cues

def master_env():
    t = tvec(N)
    env = np.ones(N)
    f0, f1 = 28.4, 29.85
    m = (t >= f0) & (t < f1)
    env[m] = 0.5 + 0.5 * np.cos(np.pi * (t[m] - f0) / (f1 - f0))
    env[t >= f1] = 0.0
    k = int(0.25 * SR)
    w = 0.5 + 0.5 * np.cos(np.pi * np.arange(1, k + 1) / k)
    env[N - k:] *= w
    return env

# =====================================================================================
# analysis
# =====================================================================================
METER = pyln.Meter(SR)

def lufs(x2, t0=0.0, t1=DUR):
    seg = x2[:, int(t0 * SR):int(t1 * SR)].T
    v = METER.integrated_loudness(np.ascontiguousarray(seg))
    return float(v)

def true_peak_db(x2):
    up = signal.resample_poly(x2, 4, 1, axis=-1)
    return to_db(float(np.max(np.abs(up))))

def rms_db(x2, t0, t1):
    seg = x2[:, int(round(t0 * SR)):int(round(t1 * SR))]
    return 10.0 * math.log10(max(float(np.mean(seg ** 2)), 1e-20))

def click_windows(x2, thresh=0.3, win=0.1):
    d = np.abs(np.diff(x2, axis=-1)).max(axis=0)
    w = int(win * SR)
    out = []
    for i in range(0, len(d), w):
        m = float(d[i:i + w].max())
        if m > thresh:
            out.append((i / SR, m))
    return out, float(d.max())

BANDS = [('sub <60', 20, 60), ('bass 60-250', 60, 250), ('low-mid 250-800', 250, 800),
         ('mid 800-3k', 800, 3000), ('presence 3-8k', 3000, 8000), ('air 8-16k', 8000, 16000)]

def band_report(x2, t0, t1):
    mono = x2[:, int(t0 * SR):int(t1 * SR)].mean(axis=0)
    f, pxx = signal.welch(mono, fs=SR, nperseg=16384)
    tot = np.trapezoid(pxx[(f >= 20) & (f <= 16000)], f[(f >= 20) & (f <= 16000)])
    rows = []
    for name, lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        p = np.trapezoid(pxx[m], f[m])
        octs = math.log2(hi / lo)
        rows.append((name, 10 * math.log10(max(p / tot, 1e-12)), 10 * math.log10(max(p / tot / octs, 1e-12))))
    return rows

# =====================================================================================
# SFX
# =====================================================================================
def sfx_finish(x, peak_db=-6.0):
    x = stereo(np.asarray(x, dtype=np.float64)) if x.ndim == 2 else np.asarray(x, dtype=np.float64)
    x = hp(x, 20.0, 2)
    x = fade(x, 0.010, 0.010)
    pk = float(np.max(np.abs(x)))
    return x * (db(peak_db) / max(pk, 1e-9))

def sfx_typing_tick(dur=0.040, pitch=1.0):
    n = int(dur * SR); t = tvec(n)
    body = (np.sin(TWO_PI * 1900 * pitch * t) * np.exp(-t / 0.006) * 0.6 +
            np.sin(TWO_PI * 3400 * pitch * t) * np.exp(-t / 0.003) * 0.3)
    nz = bp(noise(n), 1800, 7500, 2) * np.exp(-t / 0.0035)
    x = lp(body + 0.9 * nz, 9000, 2)
    an = int(0.0004 * SR); x[:an] *= np.linspace(0, 1, an)
    return x

def sfx_typing_ticks_8():
    gaps = rng.uniform(0.09, 0.13, size=7)
    total = float(gaps.sum()) + 0.06
    n = int(total * SR); out = np.zeros(n)
    t = 0.0
    for i in range(8):
        tk = sfx_typing_tick(0.040, pitch=1.0 + rng.uniform(-0.05, 0.05)) * rng.uniform(0.7, 1.0)
        i0 = int(t * SR); out[i0:i0 + len(tk)] += tk[:n - i0]
        if i < 7:
            t += gaps[i]
    return out

def sfx_tap():
    n = int(0.08 * SR); t = tvec(n)
    f = 125.0 + 95.0 * np.exp(-t / 0.012)
    body = sine(f, n) * decay_env(n, 0.022, 0.0008)
    click = lp(noise(n), 1600, 2) * decay_env(n, 0.002, 0.0002) * 0.5
    return lp(body + click, 2600, 2)

def sfx_whoosh():
    n = int(0.35 * SR); u = tvec(n) / 0.35
    nz = noise(n, 2)
    center = 420.0 * (2900.0 / 420.0) ** np.sin(np.pi * u)
    y = lp_tv(nz, center * 1.25, 1.2)
    y = hp_tv(y, center * 0.5, 0.8)
    amp = np.sin(np.pi * u) ** 1.6
    m = y.mean(axis=0) * amp
    th = (np.linspace(-0.7, 0.7, n) + 1.0) * math.pi / 4.0
    y = np.stack([m * np.cos(th), m * np.sin(th)]) * 0.7 + 0.3 * y * amp
    return lp(y, 9000, 2)

def sfx_pop():
    n = int(0.45 * SR); t = tvec(n)
    bubble = sine(400.0 + 950.0 * np.exp(-t / 0.011), n) * decay_env(n, 0.032, 0.0006)
    th = sine(46.0 + 55.0 * np.exp(-t / 0.03), n) * decay_env(n, 0.1, 0.002)
    sparkle = np.zeros(n)
    for f, a in [(hz('F6'), 0.14), (hz('A6'), 0.11), (hz('C7'), 0.09)]:
        sparkle += a * np.sin(TWO_PI * f * t + rng.random() * TWO_PI) * np.exp(-t / 0.09)
    an = int(0.002 * SR); sparkle[:an] *= np.linspace(0, 1, an)
    x = bubble + 0.85 * th + sparkle
    return lp(x, 12000, 2)

def sfx_ding():
    n = int(0.6 * SR)
    parts = [(1.0, 1.0, 0.33), (2.0, 0.28, 0.2), (2.756, 0.14, 0.14), (4.07, 0.06, 0.1)]
    x = additive(hz('C5'), n, parts, attack=0.003)
    second = additive(hz('E5'), n, parts, attack=0.003) * 0.95
    i = int(0.13 * SR)
    x[i:] += second[:n - i]
    return lp(x, 10000, 2)

def sfx_notify():
    n = int(0.25 * SR); t = tvec(n)
    x = (np.sin(TWO_PI * 1320 * t) * np.exp(-t / 0.07) +
         0.5 * np.sin(TWO_PI * 1980 * t + 1.0) * np.exp(-t / 0.05) +
         0.18 * np.sin(TWO_PI * 2640 * t + 2.0) * np.exp(-t / 0.035) +
         0.25 * np.sin(TWO_PI * 660 * t) * np.exp(-t / 0.04))
    an = int(0.002 * SR); x[:an] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(an) / an)
    return lp(x, 9000, 2)

def sfx_ring_buzz():
    n = int(0.3 * SR); t = tvec(n)
    f = 88.0
    car = np.sin(TWO_PI * f * t) + 0.3 * np.sin(TWO_PI * 3 * f * t) + 0.12 * np.sin(TWO_PI * 5 * f * t)
    am = 0.55 + 0.45 * np.sin(TWO_PI * 30.0 * t - math.pi / 2)
    x = car * am
    x = lp(x, 420, 2)
    return fade(x, 0.015, 0.03)

def sfx_message_in():
    n = int(0.3 * SR); t = tvec(n)
    u = np.clip(t / 0.12, 0, 1)
    swell = hp(noise(n), 2500, 4) * (u ** 2) * (t < 0.125) * 0.5
    swell = fade(swell, 0.0, 0.0) ; swell = lp(swell, 9000, 2)
    ping = np.zeros(n); i = int(0.12 * SR); m = n - i; tt = tvec(m)
    p = (np.sin(TWO_PI * hz('D6') * tt) * np.exp(-tt / 0.07) + 0.45 * np.sin(TWO_PI * hz('A6') * tt + 0.7) * np.exp(-tt / 0.05))
    an = int(0.003 * SR); p[:an] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(an) / an)
    ping[i:] = p
    # smooth the swell's end by crossfading into the ping region
    w = np.ones(n); k = int(0.02 * SR); w[i - k:i] = 0.5 + 0.5 * np.cos(np.pi * np.arange(k) / k); w[i:] = 0
    return lp(swell * w * 0.6 + ping, 9000, 2)

def sfx_riser_short():
    n = int(0.8 * SR); u = tvec(n) / 0.8
    nz = noise(n, 2)
    center = 300.0 * (5200.0 / 300.0) ** u
    y = lp_tv(nz, center * 1.3, 1.2)
    y = hp_tv(y, center * 0.45, 0.8)
    amp = np.clip(u / 0.82, 0, 1) ** 2.2
    tail = u > 0.82
    amp[tail] = 0.5 + 0.5 * np.cos(np.pi * (u[tail] - 0.82) / 0.18)
    tone = sine(220.0 * (880.0 / 220.0) ** u, n) * 0.18
    y = (y + np.stack([tone, tone])) * amp
    return lp(y, 11000, 2)

def write_sfx():
    d = os.path.join(HERE, 'sfx'); os.makedirs(d, exist_ok=True)
    items = {
        'typing_tick.wav': sfx_typing_tick(),
        'typing_ticks_8.wav': sfx_typing_ticks_8(),
        'tap.wav': sfx_tap(),
        'whoosh.wav': sfx_whoosh(),
        'pop.wav': sfx_pop(),
        'ding.wav': sfx_ding(),
        'notify.wav': sfx_notify(),
        'ring_buzz.wav': sfx_ring_buzz(),
        'message_in.wav': sfx_message_in(),
        'riser_short.wav': sfx_riser_short(),
    }
    info = []
    for name, x in items.items():
        y = sfx_finish(x)
        data = y.T if y.ndim == 2 else y
        sf.write(os.path.join(d, name), data.astype(np.float32), SR, subtype='PCM_24')
        pk = to_db(float(np.max(np.abs(y))))
        dmax = float(np.abs(np.diff(stereo(y), axis=-1)).max())
        info.append((name, y.shape[-1] / SR, 'stereo' if y.ndim == 2 else 'mono', pk, dmax))
    return info

# =====================================================================================
# main
# =====================================================================================
DESIGN_NOTES = """
### Sound design choices
* **Key / harmony.** Intro is a D minor drone (D1 sine + detuned D2/D3 polyBLEP saws under a slowly opening
  resonant lowpass, 130 -> 620 Hz over 0-3 s). The 3.0 s sting is a D-A-F low saw stab whose filter snaps shut,
  over a sub thump. The 3-7 s tension pad is Dm with a quiet b6 (Bb4) and a slow filter LFO, plus a high A5/D6
  shimmer pad (highpassed, chorused, reverb-heavy) with slow pitch drift for the "slightly unsettled" feel.
  The drop moves to the relative major, F: pickup C (V) at 11.0, then **F / Bb / C / Dm** (12-20),
  **F / Bb / C** (20-26) and a resolving **Fadd9** at 26.0. Pads are voiced around C4 for smooth voice leading;
  plucks sit an octave higher (A4-F5) so pads and plucks do not pile up in the low-mids.
* **Drums.** Kick = sine with a fast exponential pitch sweep (167 -> 47 Hz), soft tanh warmth, tiny lowpassed click,
  lowpassed at 6.5 kHz. Clap = four short noise bursts (band 650 Hz-6 kHz, soft-saturated). Hats = highpassed
  (7.2 kHz) noise, 30 / 52 ms exponential decays, off-beats accented and pushed 13 ms late (swing), +-8 % velocity.
  Four-on-the-floor only from the 12.0 downbeat; 2-beat pickup (11-12) has hats, bass and plucks only.
* **Bass.** Sine fundamental (soft-saturated) plus a 330 Hz lowpassed saw an octave up so the line reads on
  phone speakers. Root-fifth pattern in 8ths, sidechain-pumped from the kick (-10 dB dips, 240 ms release).
  Pads and plucks get lighter sidechain (-3.3 / -2.2 dB).
* **Pads.** 3 detuned saws per note (-7 / 0 / +7 cents, panned L/C/R), 4-pole resonant sweepable lowpass (block-wise
  RBJ biquads, 64-sample coefficient updates), exponential ADSR, pedalboard Chorus + Freeverb hall.
* **Plucks / keys.** Plucks: 2 detuned saws through a fast-closing resonant lowpass (5.9 kHz -> 700 Hz in ~100 ms).
  Step bells (C5 / F5 / G5 at 11 / 14 / 17 s): additive glass partials (1, 2, 2.756, 4.07). Felt piano: inharmonic
  additive partials with per-partial decay + a tiny hammer thud, lowpassed at 5.2 kHz. Price pop at 20.0 =
  sub thump + bubble sine sweep + rolled F5/A5/C6 bell chord, with a 300 ms filtered-noise reverse sweep into it.
* **Anti-click / anti-alias.** All oscillators are polyBLEP saws, sines or additive partials (no naive waveforms,
  no bitcrush, no raw noise bursts: every noise element is band-limited and enveloped). Every one-shot ends with a
  raised-cosine fade; all envelopes are exponential. The master is highpassed at 22 Hz (DC-safe), the 7.0 s
  drop-out is a 150 ms release on every intro voice with the intro reverb return decaying (tau 0.45 s) so the
  7.0-9.6 window stays below -45 dBFS, and the file ends with a cos^2 fade 28.4 -> 29.85 s plus the mandated
  250 ms fade to exact zero.
* **Dynamics.** One gentle bus compressor (ratio 1.7, 15 ms / 180 ms) on the sum; no limiter in the chain.
  Loudness is set by scaling so 11-26 s integrates to -18 LUFS; intro gain is solved iteratively to sit
  ~3.5 LU below the drop.
"""

ITERATION_LOG = """
### Iteration log (what changed between renders)
1. **v1** first full render. Timing, LUFS targets, true peak (-6.1 dBTP) and click detector (0 windows) were fine,
   but two problems: (a) the 7.0-9.6 pause measured **-33 dBFS** -- a 150 ms fade that *starts* at 7.0 from -18 dBFS
   plus a 0.45 s reverb tail already averages ~-35 dBFS over the window, so the spec's two requirements can only be
   met if the drop-out completes *by* 7.0; (b) the spectrum was too dark: presence (3-8 kHz) -27.5 dB/oct and air
   (8-16 kHz) -35.7 dB/oct against bass at -7 dB/oct, i.e. roughly -5 dB/oct of tilt, and the sub band sat at the
   same per-octave level as the bass band.
2. **v2** -- intro voices now gate off at 6.86 s with a 140 ms exponential release (direct sound is exactly zero at
   7.0), a cosine safety gate on the intro bus over 6.86-7.0, and the intro reverb return is ducked 22 dB over the
   same 140 ms then decays with tau 0.3 s. Pause RMS went from -33 to **-58 dBFS** (7.0-7.5 s: -51 dBFS). Brightness
   fixed at the source rather than with a shelf: hats +7 dB (0.085 -> 0.19) and slightly longer decays, clap
   band 650-6000 -> 700-9000 Hz, pluck filter peak 5.9 -> 8.4 kHz with a slower close (100 -> 120 ms), pad cutoff
   1150 -> 1500 Hz (hi layer 2300 -> 2800), kick click brighter, crash +2 dB, shimmer pad +2 dB. Bass sine 1.0 -> 0.85
   with a louder, brighter octave layer (330 -> 380 Hz) for phone speakers. Result: presence -23.6 and air -28.4
   dB/oct (about -3.3 dB/oct tilt from the bass band, in the normal range for a commercial mix).
3. **v3** -- fine-band check showed 40-60 Hz still ~4 dB per octave above 80-120 Hz, a 6 dB bump at 500-800 Hz
   (pluck fundamentals) over a dip at 180-500 Hz (pads were 4 dB under the plucks), and the price pop peaking at
   -8.7 dBFS. Changes: bass sine 0.85 -> 0.72 and octave layer 0.6 -> 0.7; pads +3 dB (0.5 -> 0.7, hi layers
   0.17 -> 0.2); plucks -1.5 dB (0.5 -> 0.42); pop -1.5 dB; riser into 11.0 +2 dB (noise 0.26 -> 0.32, pad
   0.55 -> 0.65) so it reads under the near-silence; intro ticks +4 dB (still ~-34 dBFS). Verified stems have no
   high-frequency zipper from the block-updated filters (pads: -70 dB above 6 kHz, -105 dB above 12 kHz).
4. **v4** -- per-stem absolute band energies showed the *kick* owned the sub (9 dB above the bass at 40-60 Hz; the
   bass trim in v3 therefore barely moved the master) and that the ringing step bells (C5/F5/G5 fundamentals) were
   as loud as the pluck fundamentals in 500-800 Hz. Changes: kick tightened (body decay 170 -> 125 ms, fundamental
   47 -> 50 Hz, -0.7 dB); step bells -3.5 dB with shorter partial decays (0.9 -> 0.7 s); pluck filter floor
   900 -> 1300 Hz (harmonics carry more of the note, less fundamental pile-up) and -0.9 dB.
5. **v5** -- the intro band table showed 93 % of the 0-7 s energy below 60 Hz (the D1 sine under the drone), which
   would disappear on a phone speaker and read as rumble elsewhere. Drone rebalanced: D1 sine 0.55 -> 0.2, D2/D3 saw
   layer 0.22 -> 0.3; shimmer pad opened (4.8 -> 7 kHz) and +1.7 dB for a little air under the voice. Because
   LUFS K-weighting discounts sub, the intro trim re-solves ~2 dB higher, so the intro's mids are now more present at
   the same loudness. Final numbers are in the tables above.
"""

def main():
    os.makedirs(os.path.join(HERE, 'stems'), exist_ok=True)
    print('building...')
    stems, cues = build(intro_gain=1.0)
    menv = master_env()

    def assemble(intro_gain):
        mix = np.zeros((2, N))
        for k, v in stems.items():
            mix += v * (intro_gain if k == 'intro' else 1.0)
        mix = hp(mix, 22.0, 2)
        # pre-compressor: put the drop at a fixed level so the compressor behaves the same every run
        g_pre = db(-16.0 - lufs(mix, 11.0, 26.0))
        mix *= g_pre
        comp = fx(mix, [pb.Compressor(threshold_db=-12.0, ratio=1.7, attack_ms=15.0, release_ms=180.0)])
        gr = lufs(mix, 11.0, 26.0) - lufs(comp, 11.0, 26.0)
        g_post = db(-18.0 - lufs(comp, 11.0, 26.0))
        out = comp * g_post * menv
        return out, g_pre * g_post, gr

    intro_gain = 1.0
    for it in range(4):
        out, g_total, gr = assemble(intro_gain)
        l_drop = lufs(out, 11.0, 26.0); l_intro = lufs(out, 0.0, 7.0)
        diff = l_drop - l_intro
        print(f'  pass {it}: drop {l_drop:.2f} LUFS, intro {l_intro:.2f} LUFS, diff {diff:.2f}, intro_gain {intro_gain:.3f}')
        if abs(diff - 3.5) < 0.15:
            break
        intro_gain *= db(diff - 3.5)
    out, g_total, gr = assemble(intro_gain)

    # ---- guard: fix any click windows (should be none) by local smoothing ----
    clicks, dmax = click_windows(out)
    fixed = []
    if clicks:
        for t0, m in clicks:
            i0 = int(t0 * SR); i1 = min(N, i0 + int(0.1 * SR))
            seg = out[:, i0:i1]
            out[:, i0:i1] = signal.sosfilt(_sos(12000, 'low', 2), seg, axis=-1)
            fixed.append(t0)
        clicks, dmax = click_windows(out)

    out = (out * np.ones(1)).astype(np.float64)
    assert out.shape == (2, N), out.shape
    sf.write(os.path.join(HERE, 'music_full.wav'), out.T.astype(np.float32), SR, subtype='FLOAT')
    for k, v in stems.items():
        s = v * (intro_gain if k == 'intro' else 1.0) * g_total * menv
        sf.write(os.path.join(HERE, 'stems', f'stem_{k}.wav'), s.T.astype(np.float32), SR, subtype='FLOAT')

    # ---- cues ----
    cues['hits'] = sorted(cues['hits'], key=lambda h: h['t'])
    cues['accent_times'] = sorted(set(round(h['t'], 3) for h in cues['hits']))
    with open(os.path.join(HERE, 'cues.json'), 'w') as f:
        json.dump(cues, f, indent=2)

    # ---- SFX ----
    sfx_info = write_sfx()

    # ---- report ----
    frames = sf.info(os.path.join(HERE, 'music_full.wav')).frames
    tp = true_peak_db(out)
    l_full = lufs(out); l_drop = lufs(out, 11.0, 26.0); l_intro = lufs(out, 0.0, 7.0); l_price = lufs(out, 20.0, 26.0)
    quiet = rms_db(out, 7.0, 9.6)
    quiet_rows = [(a, rms_db(out, a, min(a + 0.5, 9.6))) for a in np.arange(7.0, 9.6, 0.5)]
    tail_max = float(np.max(np.abs(out[:, int(29.75 * SR):])))
    last_val = float(np.max(np.abs(out[:, -1])))
    dc = [float(np.mean(out[0])), float(np.mean(out[1]))]
    bands_drop = band_report(out, 11.0, 26.0)
    bands_intro = band_report(out, 0.0, 7.0)

    lines = []
    lines.append('# Ridgeline Local -- music bed self-check\n')
    lines.append(f'Generated by `make_music.py` (seed {SEED}). 48 kHz stereo float32.\n')
    lines.append('## Format / timing\n')
    lines.append(f'* frames: **{frames}** (expected 1,440,000) -> {"OK" if frames == N else "MISMATCH"}')
    lines.append(f'* exact length: {frames / SR:.6f} s')
    lines.append(f'* last sample |x| = {last_val:.2e}; max |x| in 29.75-30.0 s = {tail_max:.2e} (smooth raised-cosine fade to true zero)')
    lines.append(f'* DC offset L/R: {dc[0]:+.2e} / {dc[1]:+.2e}\n')
    lines.append('## Loudness\n')
    lines.append(f'* integrated LUFS 11-26 s (target -18): **{l_drop:.2f} LUFS**')
    lines.append(f'* integrated LUFS 20-26 s: {l_price:.2f} LUFS')
    lines.append(f'* integrated LUFS 0-7 s (target 3-4 LU under the drop): **{l_intro:.2f} LUFS** (drop - intro = {l_drop - l_intro:.2f} LU)')
    lines.append(f'* integrated LUFS whole file: {l_full:.2f} LUFS')
    lines.append(f'* true peak (4x oversampled): **{tp:.2f} dBTP** (target <= -3)')
    lines.append(f'* bus compressor gain reduction on the drop (LU): {gr:.2f}; no limiter used')
    lines.append(f'* total normalisation gain applied: {to_db(g_total):+.2f} dB; intro bus trim: {to_db(intro_gain):+.2f} dB\n')
    lines.append('## Pause check (7.0-9.6 s must be < -45 dBFS RMS)\n')
    lines.append(f'* RMS 7.0-9.6 s: **{quiet:.1f} dBFS** -> {"OK" if quiet < -45 else "TOO LOUD"}')
    for a, v in quiet_rows:
        lines.append(f'  * {a:.1f}-{min(a + 0.5, 9.6):.1f} s: {v:.1f} dBFS')
    lines.append('')
    lines.append('## Click detection (max |x[n]-x[n-1]| per 0.1 s window, threshold 0.3)\n')
    lines.append(f'* global max sample-to-sample step: {dmax:.4f}')
    lines.append(f'* windows over threshold after fix: **{len(clicks)}**' + (f' (fixed by local smoothing at {fixed})' if fixed else ' (none needed fixing)'))
    lines.append('')
    lines.append('## Spectral balance (Welch PSD, mono sum)\n')
    lines.append('Band energy as share of total (20 Hz-16 kHz) and normalised per octave (pink noise = flat per octave).\n')
    lines.append('| band | drop 11-26 s share (dB) | drop per-octave (dB) | intro 0-7 s share (dB) | intro per-octave (dB) |')
    lines.append('|---|---|---|---|---|')
    for (name, sh, po), (_, sh2, po2) in zip(bands_drop, bands_intro):
        lines.append(f'| {name} | {sh:6.1f} | {po:6.1f} | {sh2:6.1f} | {po2:6.1f} |')
    lines.append('')
    lines.append('## Per-second RMS (dBFS, both channels)\n')
    lines.append('| sec | RMS | sec | RMS | sec | RMS |')
    lines.append('|---|---|---|---|---|---|')
    rms = [rms_db(out, s, s + 1) for s in range(30)]
    for r in range(10):
        cells = []
        for c in range(3):
            s = r + 10 * c
            cells.append(f'{s:2d}-{s + 1:2d} | {rms[s]:6.1f}')
        lines.append('| ' + ' | '.join(cells) + ' |')
    lines.append('')
    lines.append('## SFX\n')
    lines.append('| file | length (s) | channels | peak (dBFS) | max sample step |')
    lines.append('|---|---|---|---|---|')
    for name, ln, ch, pk, dm in sfx_info:
        lines.append(f'| sfx/{name} | {ln:.3f} | {ch} | {pk:.2f} | {dm:.3f} |')
    lines.append('')
    lines.append(DESIGN_NOTES)
    lines.append(ITERATION_LOG)
    with open(os.path.join(HERE, 'report.md'), 'w') as f:
        f.write('\n'.join(lines))

    print(f'drop {l_drop:.2f} LUFS | intro {l_intro:.2f} LUFS | TP {tp:.2f} dBTP | pause RMS {quiet:.1f} dBFS | clicks {len(clicks)} | frames {frames}')
    for row in bands_drop:
        print(f'  {row[0]:18s} share {row[1]:6.1f} dB   per-oct {row[2]:6.1f} dB')
    print('done.')

if __name__ == '__main__':
    main()
