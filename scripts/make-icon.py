"""Generate build/icon.png (1024x1024) — electron-builder converts it to .icns."""
from PIL import Image, ImageDraw
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([80, 80, S - 80, S - 80], radius=200, fill=(22, 23, 29, 255))
for i, c in enumerate([(25, 211, 197), (58, 111, 247), (176, 92, 242)]):
    y = 640 + i * 70
    d.rounded_rectangle([200, y, 200 + 620 - i * 160, y + 46], radius=23, fill=c + (255,))
d.polygon([(400, 230), (400, 560), (680, 395)], fill=(25, 211, 197, 255))
img.save("build/icon.png")
