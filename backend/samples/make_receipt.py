"""Generate the fictional sample receipt used by the demo's "Try a sample bill" button.

A mixed bill on purpose: veg and non-veg dishes, a soft drink and beer, GST on food and VAT on liquor,
so the demo shows automatic assignment and per-tax splitting. tests/test_backend.py has the matching
model reply (SAMPLE_REPLY), and tests/split_cases.json the expected shares.

    python samples/make_receipt.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "sample-receipt.jpg"

ITEMS = [("Paneer Tikka", 1, 320, "food"), ("Chicken 65", 1, 340, "food"), ("Butter Chicken", 1, 420, "food"),
         ("Dal Makhani", 1, 280, "food"), ("Butter Naan", 4, 60, "food"), ("Jeera Rice", 1, 220, "food"),
         ("Fresh Lime Soda", 2, 90, "food"), ("Kingfisher Premium", 3, 250, "liquor")]

W, LH = 660, 34
f, fb, fs = ImageFont.truetype(FONT, 22), ImageFont.truetype(BOLD, 26), ImageFont.truetype(FONT, 18)
img = Image.new("RGB", (W, 1200), (250, 248, 242))
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
    d.text((40, y), "-" * 44, font=f, fill=(90, 90, 90))
    y += LH


center("THE COPPER LANTERN", fb, 40)
center("Bar & Kitchen", fs, 28)
center("14, Sample Road, Bengaluru", fs, 28)
center("GSTIN: 29AAAAA0000A1Z5 (demo)", fs, 36)
row("Bill No: 4821", "Date: 05/11/2026", fs)
row("Table: 7", "Guests: 4", fs)
rule()
row("Item                Qty    Rate", "Amount")
rule()
food = liquor = 0
for name, q, rate, kind in ITEMS:
    amt = q * rate
    if kind == "liquor":
        liquor += amt
    else:
        food += amt
    row(f"{name:<19}{q:>3}{rate:>8.2f}", f"{amt:.2f}")
rule()
subtotal = food + liquor
charges = [("CGST @ 2.5%", food * 0.025), ("SGST @ 2.5%", food * 0.025),
           ("VAT (Liquor) @ 10%", liquor * 0.10), ("Service Charge @ 5%", subtotal * 0.05)]
gross = subtotal + sum(a for _, a in charges)
total = round(gross)
row("Sub Total", f"{subtotal:.2f}")
for label, amount in charges:
    row(label, f"{amount:.2f}")
row("Round Off", f"{total - gross:.2f}")
rule()
row("GRAND TOTAL", f"Rs. {total:.2f}", fb)
y += 12
center("Thank you! Visit again", fs, 28)
center("(Fictional bill for demo purposes)", fs, 28)

img = img.crop((0, 0, W, y + 30)).rotate(-1.2, expand=True, fillcolor=(235, 232, 225)).filter(ImageFilter.GaussianBlur(0.4))
OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, quality=88)
print("wrote", OUT, img.size)
