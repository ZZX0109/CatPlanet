"""Arrange unedited Blender renders; labels are outside the model images."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]/'artifacts/cat-reference-study/final'
font_path='/System/Library/Fonts/Hiragino Sans GB.ttc'
font=ImageFont.truetype(font_path,42)
small=ImageFont.truetype(font_path,25)
labels=[
    ('solid','01  纯色胖猫','圆颊 · 短腿 · 琥珀眼'),
    ('ragdoll','02  双色布偶','倒 V 白脸 · 蓝眼 · 分区长毛'),
    ('siamese','03  海豹重点色暹罗','楔形脸 · 细短毛 · 蓝眼'),
]
for view,filename in [('three','comparison.png'),('face','faces.png')]:
    board=Image.new('RGB',(3000,1100),'#f6f2ec')
    draw=ImageDraw.Draw(board)
    for i,(key,title,subtitle) in enumerate(labels):
        picture=Image.open(root/(key+'-'+view+'.png')).convert('RGB')
        if picture.size!=(1000,1000):raise ValueError('Expected unscaled 1000px render')
        board.paste(picture,(i*1000,100))
        draw.text((i*1000+36,10),title,font=font,fill='#453d37')
        draw.text((i*1000+38,65),subtitle,font=small,fill='#75685e')
    board.save(root/filename)
    print(root/filename)
