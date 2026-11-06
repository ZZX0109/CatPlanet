"""Lay out the unmodified Blender renders as labeled comparison boards."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).resolve().parents[1]/'artifacts/three-cat-models/final'
fontpath='/System/Library/Fonts/Hiragino Sans GB.ttc'
font=ImageFont.truetype(fontpath,46)
small=ImageFont.truetype(fontpath,26)
labels=[('solid','01  蓝灰纯色 · 圆胖体型','胸腹加宽 · 圆脸 · 琥珀眼'),('ragdoll','02  布偶 · 双色长毛','白色倒 V 脸 · 蓝眼 · 蓬松尾毛'),('siamese','03  暹罗 · 海豹重点色','修长体型 · 短毛 · 蓝眼')]
for view,filename in [('three','comparison.png'),('face','faces.png')]:
 board=Image.new('RGB',(3000,1100),'#f6f2ec')
 draw=ImageDraw.Draw(board)
 for i,(key,label,subtitle) in enumerate(labels):
  picture=Image.open(root/(key+'-'+view+'.png')).convert('RGB')
  board.paste(picture,(i*1000,100))
  draw.text((i*1000+40,8),label,font=font,fill='#453d37')
  draw.text((i*1000+42,65),subtitle,font=small,fill='#75685e')
 board.save(root/filename)
 print(root/filename)
