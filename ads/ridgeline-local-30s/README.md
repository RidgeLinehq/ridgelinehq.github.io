# Ridgeline Local — 30-second paid social ad

`ridgeline-local-ad-30s.mp4` is the finished ad (1080×1920, 30 fps, 30 s, H.264/AAC, ~−14 LUFS). `poster.jpg` is a still for the ad preview.

`script.md` has the voiceover, captions, scene timing and honesty notes.

## How it was built (and how to re-render)

Everything is generated from code in `source/`:

* `composition.html` + `timing.js` — the whole ad as a time-driven web page: `window.seek(t)` draws the frame for time *t* (Ken Burns photo moves, phone mock-ups, word-synced captions, price pop, end card). Open it in a browser and call `seek(12.5)` in the console to inspect any moment.
* `render.js` — Playwright screenshots 900 frames (`node render.js composition.html frames 30 30 3`), `mux.sh` encodes them with the audio into the MP4.
* `voice/` — the voiceover lines as WAV plus `vo_lines.json` (script) and `vo_timing.json` (per-word timings from forced alignment). `make_vo.py` regenerates them with the Kokoro-82M ONNX voice (model files are not committed; see the script header).
* `music/make_music.py` — generates the original music bed and all SFX procedurally (deterministic). `mix.py` builds the final mix: voice chain, music ducked −7.5 dB under speech, SFX, −14 LUFS / −1 dBTP master.
* `assets/` — the six photos used as footage (JPEG copies of the originals).

To change a line of copy: edit `voice/vo_lines.json`, run `make_vo.py`, regenerate `timing.js`, re-run `render.js`, `mix.py`, `mux.sh`.
