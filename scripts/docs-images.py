# Crops and compresses the project page's screenshots: docs/images/raw/*.png
# (from scripts/docs-screenshots.mjs and adb screencaps) into docs/images/*.jpg.
#   python3 scripts/docs-images.py
from pathlib import Path
from PIL import Image

images = Path(__file__).resolve().parent.parent / 'docs' / 'images'
raw = images / 'raw'

# Desktop shots are 2880x1800; a few are cropped to their content.
CROPS = {'home': (500, 40, 2380, 1500), 'grow': (640, 330, 2240, 1460)}

for png in sorted(raw.glob('*.png')):
    name = png.stem                         # e.g. home-light, phone-launch-dark
    im = Image.open(png).convert('RGB')
    if name.startswith('phone-'):
        im = im.crop((0, 155, im.width, im.height - 150))   # status and navigation bars
        width = 700
    else:
        crop = CROPS.get(name.rsplit('-', 1)[0])
        if crop: im = im.crop(crop)
        width = 1800
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(images / f'{name}.jpg', 'JPEG', quality=82, optimize=True, progressive=True)
    print(name, im.size)
