import json
from pathlib import Path
from PIL import Image,ImageOps,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[1]
rows=json.loads((ROOT/'references/candidates.json').read_text())
out=ROOT/'references/contact-sheets';out.mkdir(exist_ok=True)
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
for start in range(0,len(rows),16):
    canvas=Image.new('RGB',(1800,1600),'#eeeae3')
    draw=ImageDraw.Draw(canvas)
    for offset,row in enumerate(rows[start:start+16]):
        x=(offset%4)*450;y=(offset//4)*400
        with Image.open(ROOT/row['local_path']) as image:
            image=ImageOps.contain(image.convert('RGB'),(440,354))
            canvas.paste(image,(x+(450-image.width)//2,y+(354-image.height)//2))
        title=row['title'].replace('File:','')
        draw.text((x+10,y+358),f"#{row['candidate_id']:03d}  {title[:40]}",fill='#222',font=font)
    canvas.save(out/f'candidates-{start//16+1:02d}.jpg',quality=92)
print('CONTACT_SHEETS',len(list(out.glob('*.jpg'))))
with (ROOT/'references/candidate-index.tsv').open('w') as fp:
    for row in rows: fp.write(f"{row['candidate_id']:03d}\t{row['title']}\t{row['source_url']}\n")
