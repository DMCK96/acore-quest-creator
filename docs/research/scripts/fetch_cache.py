import json,urllib.request,tarfile,io,os,hashlib,sys
c=json.load(open('ascension-data/datasets/cache.json'))
packs={}
for p in sys.argv[1:]:
    f=c['files'][p]; out='cache/'+p; os.makedirs(os.path.dirname(out),exist_ok=True)
    if os.path.exists(out): continue
    chunks=[]
    for part in f['parts']:
        pk=part['pack']
        if pk not in packs:
            req=urllib.request.Request(c['packs'][pk]['url'],headers={'User-Agent':'curl/8'})
            packs[pk]=tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(req,timeout=300).read()))
        t=packs[pk]
        m=next(n for n in t.getnames() if part['sha256'] in n)
        chunks.append(t.extractfile(m).read())
    open(out,'wb').write(b''.join(chunks)); print(p,len(b''.join(chunks)))
