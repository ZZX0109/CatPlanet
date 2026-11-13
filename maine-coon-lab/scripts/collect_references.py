"""Collect attributed real-photo candidates from Wikimedia Commons for visual study."""
import concurrent.futures
import hashlib
import html
import json
import re
import subprocess
import urllib.parse
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'references'
RAW=REF/'candidates'
CACHE=REF/'metadata-cache'
for directory in (RAW,CACHE): directory.mkdir(parents=True,exist_ok=True)
UA='CatplanetMaineCoonStudy/1.0 (local educational visual reference)'

def curl(url,target):
    subprocess.run(['/usr/bin/curl','-L','--fail','--retry','3','--retry-all-errors','--retry-delay','1','--max-time','35','-sS','-A',UA,url,'-o',str(target)],check=True,capture_output=True)

def api(params):
    params={'action':'query','format':'json','uselang':'en',**params}
    url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(params)
    target=CACHE/(hashlib.sha256(url.encode()).hexdigest()+'.json')
    if not target.exists(): curl(url,target)
    return json.loads(target.read_text())

def clean(value): return html.unescape(re.sub('<[^>]+>','',value or '')).strip()

categories=['Category:Maine Coon cat heads','Category:Maine Coon cat portraits','Category:Side views of Maine Coon cats','Category:Studio portrait photographs of Maine Coon cats','Category:Large Maine Coon cats','Category:Male Maine Coon cats','Category:Female Maine Coon cats','Category:Maine Coon cats']
files={}
seen=set()
for category in categories:
    queue=[(category,0)]
    while queue:
        title,depth=queue.pop(0)
        if title in seen: continue
        seen.add(title)
        try:
            data=api({'list':'categorymembers','cmtitle':title,'cmlimit':500})
        except Exception as exc:
            print('CATEGORY_FAILED',title,str(exc)[:150],flush=True)
            continue
        for row in data.get('query',{}).get('categorymembers',[]):
            if row['ns']==14 and depth<1 and category!='Category:Maine Coon cats' and not re.search('mix|kitten|stamp|histor|draw|paint',row['title'],re.I):
                queue.append((row['title'],depth+1))
            if row['ns']==6 and re.search(r'\.(jpg|jpeg|png|webp)$',row['title'],re.I) and not re.search('floppa|gregory|justin|kitten|collage|diagram|drawing|stamp',row['title'],re.I):
                files.setdefault(row['pageid'],{**row,'categories':[]})['categories'].append(title)
print('COMMONS_CANDIDATES',len(files),flush=True)

records=[]
ids=list(files)
for start in range(0,len(ids),40):
    data=api({'pageids':'|'.join(map(str,ids[start:start+40])),'prop':'imageinfo','iiprop':'url|size|sha1|extmetadata','iiurlwidth':960,'iiurlheight':960})
    for page in data.get('query',{}).get('pages',{}).values():
        if not page.get('imageinfo'): continue
        info=page['imageinfo'][0]
        if min(info['width'],info['height'])<360: continue
        meta=info.get('extmetadata',{})
        record={**files[page['pageid']],'image_url':info['url'],'preview_url':info.get('thumburl',info['url']),'source_url':info['descriptionurl'],'width':info['width'],'height':info['height'],'sha1':info['sha1'],'artist':clean(meta.get('Artist',{}).get('value','')),'license':clean(meta.get('LicenseShortName',{}).get('value','')),'license_url':meta.get('LicenseUrl',{}).get('value',''),'description':clean(meta.get('ImageDescription',{}).get('value',''))}
        if re.search('kitten|mixed breed|crossbreed|norwegian|persian',record['description'],re.I): continue
        records.append(record)

# Balance photographer/title families so a burst of the same subject does not fill the set.
records.sort(key=lambda row:(row['title'].lower()))
families={}
for row in records:
    family=re.sub(r'\d+|\([^)]*\)|[_-]','',row['title'].lower())
    families.setdefault(family,[]).append(row)
balanced=[]
for turn in range(max(map(len,families.values()),default=0)):
    for rows in families.values():
        if turn<len(rows): balanced.append(rows[turn])
balanced=balanced[:105]

def download(pair):
    index,row=pair
    ext=Path(urllib.parse.urlparse(row['preview_url']).path).suffix.lower()
    if ext not in {'.jpg','.jpeg','.png','.webp'}: ext='.jpg'
    target=RAW/f'{index:03d}{ext}'
    try:
        if not target.exists(): curl(row['preview_url'],target)
        row={**row,'candidate_id':index,'local_path':str(target.relative_to(ROOT)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        return row
    except Exception as exc:
        print('DOWNLOAD_FAILED',index,row['title'],str(exc)[:150],flush=True)
        return None

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    downloaded=list(pool.map(download,enumerate(balanced,1)))
downloaded=[row for row in downloaded if row]
(REF/'candidates.json').write_text(json.dumps(downloaded,ensure_ascii=False,indent=2))
print('DOWNLOADED_REFERENCES',len(downloaded),flush=True)
