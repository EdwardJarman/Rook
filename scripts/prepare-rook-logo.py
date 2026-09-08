from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "assets/images/rook-logo-master.png"
UI_LOGO = ROOT / "assets/images/rook-logo.png"
FAVICON = ROOT / "assets/images/favicon.png"

master = Image.open(MASTER).convert("RGBA")
alpha = master.getchannel("A")
bbox = alpha.point(lambda value: 255 if value > 3 else 0).getbbox()
if bbox is None:
    raise RuntimeError("The approved Rook logo contains no visible pixels.")

mark = master.crop(bbox)
# Optical-size adjustment: the approved hairline is retained in the master,
# while small UI and favicon exports need a one-pixel-or-better stroke.
thick_alpha = mark.getchannel("A").filter(ImageFilter.MaxFilter(27))
optical = Image.new("RGBA", mark.size, (5, 5, 4, 0))
optical.putalpha(thick_alpha)

canvas_size = 1024
max_mark = int(canvas_size * 0.84)
scale = min(max_mark / optical.width, max_mark / optical.height)
size = (max(1, round(optical.width * scale)), max(1, round(optical.height * scale)))
optical = optical.resize(size, Image.Resampling.LANCZOS)

canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
position = ((canvas_size - size[0]) // 2, (canvas_size - size[1]) // 2)
canvas.alpha_composite(optical, position)
canvas.save(UI_LOGO, optimize=True)

favicon = canvas.resize((64, 64), Image.Resampling.LANCZOS)
favicon.save(FAVICON, optimize=True)

print(f"master={MASTER}")
print(f"ui={UI_LOGO} {canvas_size}x{canvas_size}")
print(f"favicon={FAVICON} 64x64")
