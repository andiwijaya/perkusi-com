"""Render the code-native brand's social sharing card (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
image = Image.new('RGB', (1200, 630), '#121513')
draw = ImageDraw.Draw(image)
font_path = 'C:/Windows/Fonts/bahnschrift.ttf'
font = lambda size: ImageFont.truetype(font_path, size)
draw.text((68, 45), 'perkusi.com', font=font(34), fill='#e9eae1')
draw.text((68, 150), 'Make rhythm.', font=font(83), fill='#e9eae1')
draw.text((68, 247), 'Build loops.', font=font(83), fill='#e9eae1')
draw.text((68, 344), 'Play.', font=font(83), fill='#c3f36b')
draw.text((68, 530), 'A NEW SPACE FOR RHYTHM.  BUILT FOR MUSICIANS.', font=font(21), fill='#a4aba2')
for radius in (215, 166, 115):
    draw.ellipse((915-radius, 295-radius, 915+radius, 295+radius), outline='#48583a', width=2)
for row in range(4):
    for col in range(4):
        x, y = 815 + col * 52, 195 + row * 52
        color = '#c3f36b' if row * 4 + col in (1, 4, 10, 15) else '#303e27'
        draw.rounded_rectangle((x, y, x+43, y+43), radius=6, fill=color, outline='#5b7046', width=1)
draw.ellipse((736, 155, 750, 169), fill='#c3f36b')
image.save(root / 'public' / 'social-card.png', optimize=True)
