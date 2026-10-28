#!/usr/bin/env python3
import os
import math
from PIL import Image, ImageDraw

def create_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = size * 0.08
    w = size - 2 * margin
    h = size - 2 * margin

    # Draw rounded shield background
    # Background circle/rounded rect with dark sapphire gradient
    r = size * 0.22
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=r,
        fill=(15, 23, 42, 255), # slate-900
        outline=(59, 130, 246, 255), # blue-500
        width=max(1, int(size * 0.025))
    )

    # Draw shield polygon in center
    cx = size / 2.0
    cy = size / 2.0

    # Shield vertices
    top_y = cy - size * 0.25
    mid_y = cy + size * 0.05
    bot_y = cy + size * 0.32
    left_x = cx - size * 0.25
    right_x = cx + size * 0.25

    shield_pts = [
        (cx, top_y),
        (right_x, top_y + size * 0.08),
        (right_x, mid_y),
        (cx, bot_y),
        (left_x, mid_y),
        (left_x, top_y + size * 0.08),
    ]

    draw.polygon(shield_pts, fill=(30, 58, 138, 255), outline=(96, 165, 250, 255))

    # Inner check / lock mark
    check_pts = [
        (cx - size * 0.10, cy + size * 0.02),
        (cx - size * 0.02, cy + size * 0.10),
        (cx + size * 0.12, cy - size * 0.06),
    ]
    draw.line(check_pts, fill=(16, 185, 129, 255), width=max(2, int(size * 0.05)), joint='curve')

    return img

def main():
    out_dir = os.path.abspath('packaging/icons')
    os.makedirs(out_dir, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    for s in sizes:
        icon = create_icon(s)
        icon.save(os.path.join(out_dir, f'{s}x{s}.png'))
        if s == 512:
            icon.save(os.path.join(out_dir, 'icon.png'))
            icon.save(os.path.join(out_dir, 'linuxsec.png'))

    print(f"Generated icons in {out_dir}: {sizes}")

if __name__ == '__main__':
    main()
