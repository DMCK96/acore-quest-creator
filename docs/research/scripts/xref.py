import csv,gzip,sqlite3,collections,json,re,os,glob
csv.field_size_limit(10**9)
db=sqlite3.connect('coa.sqlite')
ct={int(r[0]) for r in db.execute('select entry from creature_template')}
gt={int(r[0]) for r in db.execute('select entry from gameobject_template')}
cspawn={int(r[0]) for r in db.execute('select id from creature')}
b=json.loads(os.popen('cd coa && git show HEAD:data/coa-world/baseline.json').read())
cov=set(b['coveredMigrations']); addc=set(); addg=set()
for f in glob.glob('coa/data/sql/updates/pending_db_world/*.sql'):
    if f[4:] in cov: continue
    s=open(f,errors='replace').read()
    for m in re.finditer(r'INSERT[^;]*?INTO\s+`?(creature_template|gameobject_template)`?[^;]*?VALUES\s*(.*?);',s,re.S|re.I):
        ids={int(x) for x in re.findall(r'\(\s*(\d+)\s*,',m.group(2))}
        (addc if m.group(1).lower()=='creature_template' else addg).update(ids)
print('pending updates add creature_template',len(addc-ct),'gameobject_template',len(addg-gt))
ct|=addc; gt|=addg
cc={int(r['entry']):r for r in csv.DictReader(gzip.open('wdb/creaturecache.tsv.gz','rt'),delimiter='\t')}
exc={int(r['id']):r for r in csv.DictReader(gzip.open('t/tables/creature.csv.gz','rt'))}
exg={int(r['id']):r for r in csv.DictReader(gzip.open('t/tables/gameobject.csv.gz','rt'))}
asc_c=set(cc)|set(exc)
print('creatures: coa',len(ct),'ascension',len(asc_c),'missing',len(asc_c-ct),' of which id>=100000:',sum(1 for i in asc_c-ct if i>=100000))
print('objects: coa',len(gt),'ascension(exiles)',len(exg),'missing',len(set(exg)-gt))
exspawn=collections.Counter(int(r['entry']) for r in csv.DictReader(gzip.open('t/tables/creature_spawn.csv.gz','rt')))
mc=asc_c-ct; print('missing creatures with Exiles spawns:',sum(1 for i in mc if i in exspawn),'spawn rows',sum(exspawn[i] for i in mc))
wdb={int(r['entry']):r for r in csv.DictReader(gzip.open('wdb/questcache.tsv.gz','rt'),delimiter='\t')}
keep=json.load(open('playable.json'))
refc=set();refg=set();refi=set()
for i in keep:
    w=wdb[i]
    for n in range(1,5):
        v=int(w[f'RequiredNpcOrGo{n}'] or 0)
        if v>0: refc.add(v)
        elif v<0: refg.add(-v)
    for k in [f'RequiredItemId{n}' for n in range(1,7)]+[f'RequiredSourceItemId{n}' for n in range(1,5)]+[f'RewardItem{n}' for n in range(1,5)]+[f'RewardChoiceItemId{n}' for n in range(1,7)]+['SrcItemId']:
        v=int(w.get(k) or 0)
        if v>0: refi.add(v)
print('playable quests reference',len(refc),'NPCs:',len(refc-ct),'missing in CoA,',len((refc-ct)-asc_c),'unknown anywhere; present but unspawned:',len((refc&ct)-cspawn))
print('  ',len(refg),'objects:',len(refg-gt),'missing in CoA')
json.dump(sorted(refi),open('refitems.json','w')); print('  ',len(refi),'items referenced')
