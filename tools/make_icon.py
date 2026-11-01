"""Draws the TradeOps icon set (blue rounded square + white ring-and-dot mark).

Run:  .venv\\Scripts\\python tools\\make_icon.py
Writes: assets/icon.ico, assets/icon-256.png, assets/installer-banner.bmp, assets/installer-small.bmp,
        frontend/public/favicon.ico, frontend/public/favicon.png
Reads:  assets/nuqta-credit.png (the nuqta credit on the installer banner, rendered from tools/nuqta_credit.html)
Change the colours/shape here and rerun to restyle the app icon everywhere.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
PUBLIC = ROOT / "frontend" / "public"

TOP_LEFT = (59, 130, 246)      # blue-500  (matches the app's primary colour)
BOTTOM_RIGHT = (29, 78, 216)   # blue-700
WHITE = (255, 255, 255, 255)


def gradient(size: int) -> Image.Image:
    """Diagonal blue gradient."""
    base = Image.new("RGB", (size, size))
    px = base.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP_LEFT, BOTTOM_RIGHT))
    return base


def mark_layer(size: int, scale: float = 1.0) -> Image.Image:
    """White mark: an open ring around a solid dot (same shape as components/LogoMark.tsx), on a transparent layer."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    k = size / 24 * 1.1 * scale
    r, width = 8.2 * k, 2.2 * k
    ro = r + width / 2  # PIL draws the arc stroke inward from this outer radius
    box = [c - ro, c - ro, c + ro, c + ro]
    start, end = -60, -60 + 360 * 42 / (2 * math.pi * 8.2)
    d.arc(box, start, end, fill=WHITE, width=round(width))
    for ang in (start, end):  # round caps
        x, y = c + r * math.cos(math.radians(ang)), c + r * math.sin(math.radians(ang))
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=WHITE)
    dot = 3.4 * k
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill=WHITE)
    return layer


def icon(size: int = 1024) -> Image.Image:
    """Rounded square with the mark, supersampled for clean edges."""
    bg = gradient(size).convert("RGBA")
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=round(size * 0.22), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    out.alpha_composite(mark_layer(size))
    return out


def banner(width: int, height: int) -> Image.Image:
    """Installer side banner: blue gradient with a large faint mark and the icon."""
    side = max(width, height)
    img = gradient(side).crop((0, 0, width, height)).convert("RGBA")
    ghost = mark_layer(side, 1.0)
    ghost.putalpha(ghost.getchannel("A").point(lambda v: v // 6))
    img.alpha_composite(ghost, (-(side - width) // 2, -(side - height) // 2 + height // 5))
    logo = icon(512).resize((96, 96), Image.LANCZOS)
    img.alpha_composite(logo, ((width - 96) // 2, round(height * 0.18)))
    # "A product of nuqta" credit (the studio's current mark); its source is tools/nuqta_credit.html
    credit_file = ASSETS / "nuqta-credit.png"
    if credit_file.exists():
        credit = Image.open(credit_file).convert("RGBA")
        credit = credit.resize((credit.width * 140 // 560, credit.height * 140 // 560), Image.LANCZOS)
        img.alpha_composite(credit, ((width - credit.width) // 2, height - credit.height - 24))
    return img.convert("RGB")


def main():
    ASSETS.mkdir(exist_ok=True)
    big = icon(1024)
    sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]
    big.save(ASSETS / "icon.ico", sizes=sizes)
    big.resize((256, 256), Image.LANCZOS).save(ASSETS / "icon-256.png")
    big.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    big.resize((64, 64), Image.LANCZOS).save(PUBLIC / "favicon.png")
    banner(164, 314).save(ASSETS / "installer-banner.bmp")
    icon(256).resize((55, 55), Image.LANCZOS).convert("RGB").save(ASSETS / "installer-small.bmp")
    print("icon set written to", ASSETS, "and", PUBLIC)


if __name__ == "__main__":
    main()
