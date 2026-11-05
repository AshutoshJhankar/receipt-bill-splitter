"""Generate the fictional sample receipt used by the demo's "Try a sample bill" button.

    python samples/make_receipt.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "sample-receipt.jpg"

ITEMS = [("Paneer Tikka", 1, 320), ("Butter Naan", 4, 60), ("Dal Makhani", 1, 280),
         ("Veg Biryani", 2, 300), ("Fresh Lime Soda", 3, 90), ("Gulab Jamun", 2, 120)]

W, LH = 620, 34
f, fb, fs = ImageFont.truetype(FONT, 22), ImageFont.truetype(BOLD, 26), ImageFont.truetype(FONT, 18)
img = Image.new("RGB", (W, 1060), (250, 248, 242))
d = ImageDraw.Draw(img)
y = 30


def center(text, font, dy=LH):
    global y
    w = d.textlength(text, font=font)
    d.text(((W - w) / 2, y), text, font=font, fill=(30, 30, 30))
    y += dy


def row(left, right, font=f):
    global y
    d.text((40, y), left, font=font, fill=(30, 30, 30))
    w = d.textlength(right, font=font)
    d.text((W - 40 - w, y), right, font=font, fill=(30, 30, 30))
    y += LH


def rule():
    global y
    d.text((40, y), "-" * 46, font=f, fill=(90, 90, 90))
    y += LH


center("THE COPPER LANTERN", fb, 40)
center("Family Restaurant", fs, 28)
center("14, Sample Road, Bengaluru", fs, 28)
center("GSTIN: 29AAAAA0000A1Z5 (demo)", fs, 36)
row("Bill No: 4821", "Date: 05/11/2026", fs)
row("Table: 7", "Guests: 3", fs)
rule()
row("Item            Qty   Rate", "Amount")
rule()
subtotal = 0
for name, q, rate in ITEMS:
    amt = q * rate
    subtotal += amt
    row(f"{name:<16}{q:>3}{rate:>7.2f}", f"{amt:.2f}")
rule()
row("Sub Total", f"{subtotal:.2f}")
row("CGST @ 2.5%", f"{subtotal * 0.025:.2f}")
row("SGST @ 2.5%", f"{subtotal * 0.025:.2f}")
row("Service Charge @ 5%", f"{subtotal * 0.05:.2f}")
rule()
total = subtotal * 1.10
row("GRAND TOTAL", f"Rs. {total:.2f}", fb)
y += 12
center("Thank you! Visit again", fs, 28)
center("(Fictional bill for demo purposes)", fs, 28)

img = img.crop((0, 0, W, y + 30)).rotate(-1.2, expand=True, fillcolor=(235, 232, 225)).filter(ImageFilter.GaussianBlur(0.4))
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, quality=88)
print("wrote", OUT, img.size)
