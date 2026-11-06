# Crops and compresses the project page's screenshots: docs/images/raw/*.png
# (from scripts/docs-screenshots.mjs, scripts/docs-growth.mjs and adb screencaps)
# into docs/images/*.jpg.
#   python3 scripts/docs-images.py
from pathlib import Path
from PIL import Image

images = Path(__file__).resolve().parent.parent / 'docs' / 'images'
raw = images / 'raw'

# Desktop shots are 2880x1800; a few are cropped to their content.
CROPS = {'home': (500, 40, 2380, 1500), 'grow': (640, 330, 2240, 1460)}


def around_the_light(im):
    """A Light Material Lab scene, cropped to where the light is (plus a margin), at 4:3."""
    bg = im.getpixel((4, 4))
    lit = Image.eval(im.convert('L'), lambda v: 255 if v > sum(bg) / 3 + 40 else 0)
    left, top, right, bottom = lit.getbbox()
    pad = 0.08 * max(right - left, bottom - top)
    left, top, right, bottom = left - pad, top - pad, right + pad, bottom + pad
    # Widen or heighten around the middle to 4:3, then keep it inside the picture.
    w, h = right - left, bottom - top
    if w / h < 4 / 3: w = h * 4 / 3
    else: h = w * 3 / 4
    w, h = min(w, im.width), min(h, im.height)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    x = min(max(0, cx - w / 2), im.width - w)
    y = min(max(0, cy - h / 2), im.height - h)
    return im.crop((round(x), round(y), round(x + w), round(y + h)))

for png in sorted(raw.glob('*.png')):
    name = png.stem                         # e.g. home-light, phone-launch-dark
    im = Image.open(png).convert('RGB')
    if name.startswith('phone-'):
        im = im.crop((0, 155, im.width, im.height - 150))   # status and navigation bars
        width = 700
    else:
        crop = CROPS.get(name.rsplit('-', 1)[0])
        if crop: im = im.crop(crop)
        if name.startswith('scene-'): im = around_the_light(im)
        width = 1800
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(images / f'{name}.jpg', 'JPEG', quality=82, optimize=True, progressive=True)
    print(name, im.size)
