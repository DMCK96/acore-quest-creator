import json,sqlite3,collections,math,csv,gzip
csv.field_size_limit(10**9)
db=sqlite3.connect('coa.sqlite')
st={int(k):v for k,v in json.load(open('supertrack.json')).items()}
keep=set(json.load(open('playable.json')))
wdb={int(r['entry']):r for r in csv.DictReader(gzip.open('wdb/questcache.tsv.gz','rt'),delimiter='\t')}
g={int(k):[tuple(x) for x in v] for k,v in json.load(open('ender_guess.json')).items()}
ct={int(r[0]) for r in db.execute('select entry from creature_template')}
gt={int(r[0]) for r in db.execute('select entry from gameobject_template')}
spawn=[]
for e,m,x,y,z in db.execute('select id,map,position_x,position_y,position_z from creature'): spawn.append(('c',int(e),int(m),float(x),float(y)))
for e,m,x,y,z in db.execute('select id,map,position_x,position_y,position_z from gameobject'): spawn.append(('g',int(e),int(m),float(x),float(y)))
grid=collections.defaultdict(list)
for s in spawn: grid[(s[2],int(s[3]//20),int(s[4]//20))].append(s)
def coa_at(m,x,y,r=5):
    out=set()
    for dx in(-1,0,1):
        for dy in(-1,0,1):
            for s in grid[(m,int(x//20)+dx,int(y//20)+dy)]:
                if math.dist((x,y),(s[3],s[4]))<=r: out.add((s[0],s[1]))
    return out
cust=[q for q in st if q>=30000]
print('supertrack custom-range quests',len(cust),'| of the 8,431 playable custom',len(keep&set(st)),'| custom-range not in our playable set',len(set(cust)-keep))
turn={q:[p for p in st[q] if p['slot']==4] for q in keep&set(st)}
obj={q:[p for p in st[q] if p['slot']<4] for q in keep&set(st)}
print(' with turn-in point',sum(1 for v in turn.values() if v),' with objective points',sum(1 for v in obj.values() if v))
# identify enders: CoA spawn at the turn-in point
c=collections.Counter(); placed=collections.defaultdict(list)
for q,ps in turn.items():
    if not ps: continue
    at=set().union(*(coa_at(p['map'],p['x'],p['y']) for p in ps))
    guess=set(g.get(q,[]))
    if guess & at: c['guess confirmed by a CoA spawn at the point']+=1
    elif at and guess: c['CoA spawn at point disagrees with guess']+=1
    elif at: c['ender found from CoA spawn (no text guess)']+=1
    elif guess:
        c['guess, point gives its missing spawn']+=1
        for k in guess: placed[k].append((q,ps[0]['map'],ps[0]['x'],ps[0]['y'],ps[0]['z']))
    else: c['point only: no ender known']+=1
for k,v in c.most_common(): print('  ',k,v)
miss_npc={k for ks in g.values() for k in ks if k[0]=='c' and k[1] not in ct}
print('missing giver/ender NPCs:',len(miss_npc),'now with a turn-in location',len(miss_npc & set(placed)))
b=[p for k,v in placed.items() if k in (('g',402000),('g',412000)) for p in v]
locs={(m,round(x),round(y)) for _,m,x,y,z in b}; print('Hero\'s Call Board turn-in points:',len(b),'distinct',len(locs), sorted(locs)[:12])
# objective targets
refc=collections.defaultdict(set)
for q in keep:
    for n in range(1,5):
        v=int(wdb[q][f'RequiredNpcOrGo{n}'] or 0)
        if v>0 and v not in ct: refc[v].add((q,n-1))
hit=sum(1 for v,qs in refc.items() if any(p['slot']==i for q,i in qs if q in st for p in st[q]))
print('missing objective-target NPCs',len(refc),'with an objective area from SuperTrack',hit)
json.dump({f'{k[0]}{k[1]}':v for k,v in placed.items()},open('placed.json','w'))
names={}
for e,n in db.execute('select entry,name from creature_template'): names[('c',int(e))]=n
for e,n in db.execute('select entry,name from gameobject_template'): names[('g',int(e))]=n
dis=collections.Counter(); ex=[]
for q,ps in turn.items():
    if not ps: continue
    at=set().union(*(coa_at(p['map'],p['x'],p['y']) for p in ps)); guess=set(g.get(q,[]))
    if at and guess and not guess&at:
        gin=any((k[1] in ct) if k[0]=='c' else (k[1] in gt) for k in guess)
        dis['guess is in CoA (real conflict)' if gin else 'guess missing from CoA (stands beside a stock spawn)']+=1
        if gin and len(ex)<6: ex.append((q,wdb[q]['Title'][:35],wdb[q]['CompletedText'][:40],[names.get(k) for k in guess][:2],[names.get(k) for k in at][:3]))
print(dis); [print('  ',e) for e in ex]
exq=json.load(open('missing.json'))
other=set(cust)-keep
cat=collections.Counter()
for q in other:
    w=wdb.get(q)
    cat['not in quest caches at all' if not w else ('in cache, no text' )]+=1
print('custom-range SuperTrack quests outside playable set:',dict(cat))
import random; random.seed(2); print([ (q,wdb[q]['Title']) for q in random.sample([q for q in other if q in wdb],8)])
inCoA=lambda k:(k[1] in ct) if k[0]=='c' else (k[1] in gt)
placed2=collections.defaultdict(list); qn=0
for q,ps in turn.items():
    guess={k for k in g.get(q,[]) if not inCoA(k)}
    if ps and guess:
        qn+=1
        for k in guess: placed2[k].append((ps[0]['map'],ps[0]['x'],ps[0]['y'],ps[0]['z']))
mn={k for k in miss_npc}
print('FINAL: quests whose missing ender gets a spawn point',qn,'| missing giver/ender NPCs placed',len(mn&set(placed2)),'of',len(mn))
exsp=collections.defaultdict(list)
for r in csv.DictReader(gzip.open('t/tables/creature_spawn.csv.gz','rt')): exsp[int(r['entry'])].append(r)
catc={int(r['id']) for r in csv.DictReader(open('cache/cachedata/catalogue/creatures.tsv'),delimiter='\t',quoting=csv.QUOTE_NONE)}
left=[k for k in mn if k not in placed2 and not exsp[k[1]] and k[1] not in catc]
print('missing giver/ender NPCs with no location from any source',len(left))
json.dump({f'{k[0]}{k[1]}':v for k,v in placed2.items()},open('placed.json','w'))
