# Ridgeline Studio: how commercials are made

The studio turns the real website into real commercials: screen-recorded footage of
https://ridgelinehq.github.io inside a phone, a voiceover, punchy word-by-word captions, music,
tap and whoosh sounds. No slideshows, no stock "AI" imagery, no paragraphs on screen.
Grayson's standard (Oct 22, 2026): "as close to an actual commercial as you can."

## Folder map

```
office/studio/
  CONTEXT.md          (you are here)
  tools/render.py     (stage.html + ad.json -> frames -> MP4 with voice, music, sfx; --ad <file>, --variants voice,full, --mux-only)
  tools/music.py      (fallback: original music bed from numpy when no track is available)
  tools/vo.py         (free neural voice from inside the container: speak, silences, concat; no Action round trip)
  tools/qa.py         (10 frames + contact sheet + loudness numbers for a finished MP4)
  tools/glitchscan.py (scans every rendered frame for a single-frame paint glitch)
  ad<N>/stage.html    (the scene graph of one commercial: window.render(t) draws time t)
  ad<N>/ad.json       (timing, captions, sfx, audio paths; see ad2/ad.json for the full shape)
  ad5/spec.json       (one body timeline + three hooks -> make_ads.py writes loss.json, demo.json, question.json)
  media/              (voice MP3s, music, fonts; written by the two Actions below)
  fetch/<id>.json     (ask the "studio fetch" Action to download https files into media/)
  tts/<id>.json       (ask the "studio voice" Action to speak lines with a free neural voice)
  out/                (finished MP4s, one per commercial)
```

## The two free Actions (the container cannot download from most sites)

- **Fetch**: push `fetch/<id>.json` = `{"id","files":[{"url":"https://...","path":"office/studio/media/..."}]}`.
  The Action downloads each file (https only, 50 MB max) and pushes it back in about a minute.
  Poll with `git fetch origin main && git ls-tree -r --name-only origin/main | grep <path>`.
- **Voice, from inside the container (Oct 31, 2026)**: `python3 office/studio/tools/vo.py speak <out.mp3> "<text>"` runs
  edge-tts through the proxy (it passes `--proxy $HTTPS_PROXY` and the CA bundle itself), about 10 s per line. Use the
  Action below only when the container has no network.
- **Voice (Action)**: push `tts/<id>.json` = `{"id","lines":[{"voice","text","path":"office/studio/media/....mp3","rate":"+4%"}]}`.
  Free Microsoft neural voices through edge-tts. Good male ad voices: `en-US-AndrewMultilingualNeural`
  (warm, natural), `en-US-BrianMultilingualNeural` (younger, upbeat), `en-US-GuyNeural` (classic announcer),
  `en-US-ChristopherNeural` (deep). Grayson picks the voice; record the pick in `settings/main.studio.voice`.
- vidIQ voices (ElevenLabs quality: Liam `TX3LPaxmHKxFdv7VOQHJ`, Brian `nPczCjzI2devNBz1zQrb`) cost
  ~14 credits per script and the plan has 150 a month: use them for hero spots, not daily posts.

## Making a commercial (the exact steps)

1. **Script** (30 to 35 seconds spoken, 60 to 80 words): hook in the first 3 seconds with a true, specific
   fact; the problem in the customer's words; "Ridgeline Local" named once as the answer; the free check;
   one call to action. Every claim comes from `office/specs/offer.md` or a real AI-check result in
   `office/gw/out/`. Never promise rankings or results.
2. **Voice**: tts job (free) or vidIQ. Download, then find the pauses:
   `ffmpeg -i vo.mp3 -af silencedetect=noise=-38dB:d=0.2 -f null -`. Each gap is a caption boundary.
3. **ad.json**: copy `ad2/ad.json`, set `dur` = voice length + 1.7 s, write one caption per spoken
   phrase using the silence times (`|` splits a phrase into chunks that appear one after another;
   `*word*` colors it gold), set the `tl` timeline so each scene cut lands on a pause, and the
   phone's scroll and tap times land on the words that describe them.
4. **stage.html**: reuse `ad2/stage.html` for the site-tour format. For a new format, keep the rules:
   something always moves (slow push-in, drifting backdrop, particles); cuts use zoom-through,
   whip-left or 3D flips, never plain fades; the phone shows the REAL site (iframe of /index.html)
   with a visible tap ring and real typing; captions are 3 to 6 words at a time.
5. **Preview stills first**: `python3 office/studio/tools/render.py office/studio/ad<N> /tmp/x.mp4 --only 1.5,4,8,...`
   then LOOK at the stills (make a contact sheet). Fix anything cut off, overlapping, blurry or empty.
6. **Render**: `python3 office/studio/tools/render.py office/studio/ad<N> office/studio/out/<name>.mp4`
   (1080x1920, 30 fps, about 3 to 8 minutes). Then pull 10 frames from the MP4 and look again, and check
   loudness (`ffmpeg -i out.mp4 -af volumedetect -f null -`: mean around -15 dB, max under -1 dB).
7. Commit `ad<N>/`, `out/<name>.mp4` and the media it used. Never commit `__pycache__` or work folders (`*.work/` is gitignored).

## Lessons from ad5 (the launch cuts, Oct 31, 2026)
- Render the video once and mux each audio variant with `-c:v copy` (`--variants voice,full`): half the encode time.
- Chromium needs `--disable-checker-imaging --disable-partial-raster` and a two-frame settle before each screenshot, or a
  scaled iframe tile can come out unpainted in one frame. `tools/glitchscan.py` catches it if it happens.
- Loudness: measure once, apply one linear gain, then a true ceiling 1.5 dB under the target, resampled to 48 kHz BEFORE
  the ceiling. loudnorm's linear mode silently falls back to dynamic mode (and truncates the tail) when the gain would
  push the peak over the target; the AAC encoder overshoots limited transients by about 1.5 dB.
- Keep captions at 1320 px or higher: TikTok and Reels draw their own caption block over the bottom ~300 px.
- The site's section ids change; `siteInit()` must fall back instead of looping when an id is missing.

## Quality gate (a post that fails any line is not posted)

- Real site footage is on screen for at least 8 seconds, with the free-check form visibly filled.
- The hook is a true fact from a real check, with its date.
- No frame has text cut off, caption over the phone screen, or an empty white card.
- Voice is clearly audible over the music at every word; music is ducked under speech.
- Nothing invented: no fake client, review count, ranking, or result.
- Grayson's last name, hometown and personal details appear nowhere.
