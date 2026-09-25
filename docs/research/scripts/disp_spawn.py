import csv,gzip,sqlite3,collections,json
csv.field_size_limit(10**9)
db=sqlite3.connect('coa.sqlite')
ct={int(r[0]) for r in db.execute('select entry from creature_template')}
coa_disp={int(r[0]) for r in db.execute('select CreatureDisplayID from creature_template_model')}|{int(r[0]) for r in db.execute('select DisplayID from creature_model_info')}
cc={int(r['entry']):r for r in csv.DictReader(gzip.open('wdb/creaturecache.tsv.gz','rt'),delimiter='\t',quoting=csv.QUOTE_NONE)}
exc={int(r['id']):r for r in csv.DictReader(gzip.open('t/tables/creature.csv.gz','rt'))}
wdb={int(r['entry']):r for r in csv.DictReader(gzip.open('wdb/questcache.tsv.gz','rt'),delimiter='\t')}
keep=json.load(open('playable.json'))
refc=set()
for i in keep:
    for n in range(1,5):
        v=int(wdb[i][f'RequiredNpcOrGo{n}'] or 0)
        if v>0: refc.add(v)
need=refc-ct
def disp(i):
    s=set()
    if i in cc: s|={int(cc[i][f'modelid{k}'] or 0) for k in range(1,5)}
    if i in exc: s|={int(x) for x in exc[i]['display_ids'].strip('{}').split(',') if x}
    s.discard(0); return s
allmiss=(set(cc)|set(exc))-ct
for label,S in [('quest-target NPCs missing from CoA',need),('all missing Ascension creatures',allmiss)]:
    d={i:disp(i) for i in S}; has=[i for i in S if d[i]]
    print(f'{label}: {len(S)}; with display ids {len(has)}; every display known to CoA server {sum(1 for i in has if d[i]<=coa_disp)}; at least one known {sum(1 for i in has if d[i]&coa_disp)}')
sp=collections.defaultdict(list)
for r in csv.DictReader(gzip.open('t/tables/creature_spawn.csv.gz','rt')): sp[int(r['entry'])].append(r)
cat={int(r['id']):r for r in csv.DictReader(open('cache/cachedata/catalogue/creatures.tsv'),delimiter='\t',quoting=csv.QUOTE_NONE)}
H=list(csv.DictReader(gzip.open('t/tables/quest_objective_hotspot.csv.gz','rt')))
hot={int(r['target_id']) for r in H}; hq={int(r['quest_id']) for r in H}
print('missing target NPCs -> exiles xyz',sum(1 for i in need if any(r['x'] for r in sp[i])),'| exiles %-only',sum(1 for i in need if sp[i] and not any(r['x'] for r in sp[i])),'| catalogue sighting',sum(1 for i in need if i in cat),'| objective hotspot',sum(1 for i in need if i in hot),'| nothing',sum(1 for i in need if not sp[i] and i not in cat and i not in hot))
print('playable custom quests with objective hotspots:',len(hq&set(keep)))
print('custom %-spawns: rows',sum(len(v) for k,v in sp.items() if not any(r['x'] for r in v)),'sample',[ (r['entry'],r['map_id'],r['area_id'],r['zone_x_pct'],r['zone_y_pct']) for v in list(sp.values()) for r in v if not r['x']][:3])
print('catalogue cols',list(next(iter(cat.values())).keys()))
