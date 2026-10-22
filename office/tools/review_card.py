"""Build a client's review request card: a 1200x1800 PNG with a QR code to their Google review link.
Usage: python3 office/tools/review_card.py <job.json> <out dir>   (runs in the GitHub Action; needs Pillow + qrcode)"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
import qrcode
job = json.load(open(sys.argv[1])); out = sys.argv[2]
biz = str(job.get("business", "")).strip()[:60]; link = str(job.get("reviewLink", "")).strip(); slug = job["slug"]
assert link.startswith("https://"), "review link must be https"
W, H = 1200, 1800
im = Image.new("RGB", (W, H), "#fffdf8"); d = ImageDraw.Draw(im)
font = lambda size, bold=True: ImageFont.truetype("office/studio/media/fonts/InterTight.ttf", size)
try:
    serif = ImageFont.truetype("office/studio/media/fonts/InstrumentSerif-Italic.ttf", 64)
except Exception:
    serif = font(60)
# header band
d.rectangle([0, 0, W, 300], fill="#142f27")
d.polygon([(70, 200), (120, 120), (150, 160), (175, 125), (230, 200)], fill="#fffdf8")
d.text((270, 118), "How did we do?", font=font(84), fill="#fffdf8")
d.text((270, 215), "A quick Google review helps our small business more than you know.", font=font(30), fill="#d2b375")
# business name
f = font(72)
while d.textlength(biz, font=f) > W - 160 and f.size > 36: f = font(f.size - 4)
d.text((W // 2, 420), biz, font=f, fill="#15271f", anchor="mm")
d.text((W // 2, 500), "Scan to leave a review (30 seconds)", font=serif, fill="#7f6233", anchor="mm")
# QR
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=18, border=2)
qr.add_data(link); qr.make(fit=True)
q = qr.make_image(fill_color="#142f27", back_color="#fffdf8").convert("RGB")
q = q.resize((760, 760), Image.NEAREST)
d.rounded_rectangle([W // 2 - 420, 560, W // 2 + 420, 1400], radius=48, outline="#e3ded0", width=6, fill="#fffdf8")
im.paste(q, (W // 2 - 380, 600))
d.text((W // 2, 1460), "Open your camera, point it at the code, tap the link.", font=font(36), fill="#5a6a60", anchor="mm")
d.text((W // 2, 1530), "Thank you for trusting us with your home or business.", font=font(36), fill="#5a6a60", anchor="mm")
d.rectangle([0, 1700, W, H], fill="#f5f1e6")
d.text((W // 2, 1750), "Honest reviews only. Never pay or pressure anyone for a review.", font=font(26), fill="#9a7a45", anchor="mm")
os.makedirs(out, exist_ok=True)
path = os.path.join(out, f"{slug}.png"); im.save(path, optimize=True); print("wrote", path)
