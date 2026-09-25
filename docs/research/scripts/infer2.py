import csv,gzip,sqlite3,collections,json,re
csv.field_size_limit(10**9)
db=sqlite3.connect('coa.sqlite')
wdb={int(r['entry']):r for r in csv.DictReader(gzip.open('wdb/questcache.tsv.gz','rt'),delimiter='\t')}
keep=json.load(open('playable.json'))
ct={int(r[0]) for r in db.execute('select entry from creature_template')}
gt={int(r[0]) for r in db.execute('select entry from gameobject_template')}
qg=set()
names=collections.defaultdict(set)   # name -> {('c',id)|('g',id)}
for r in csv.DictReader(gzip.open('wdb/creaturecache.tsv.gz','rt'),delimiter='\t',quoting=csv.QUOTE_NONE): names[r['name'].strip().lower()].add(('c',int(r['entry'])))
for r in csv.DictReader(gzip.open('t/tables/creature.csv.gz','rt')):
    if r['name']: names[r['name'].strip().lower()].add(('c',int(r['id'])))
    if int(r['npc_flags'])&2: qg.add(('c',int(r['id'])))
for e,n in db.execute('select entry,name from creature_template'): names[n.strip().lower()].add(('c',int(e)))
for r in csv.DictReader(gzip.open('t/tables/gameobject.csv.gz','rt')):
    if r['name'] and r['type']=='2': names[r['name'].strip().lower()].add(('g',int(r['id'])))
for e,n,t in db.execute('select entry,name,type from gameobject_template'):
    if t=='2': names[n.strip().lower()].add(('g',int(e)))
# stock enders
for e,q in db.execute('select id,quest from creature_questender'): qg.add(('c',int(e)))
for e,q in db.execute('select id,quest from gameobject_questender'): qg.add(('g',int(e)))
ALIAS={'call board':{('g',402000),('g',412000)},'the call board':{('g',402000),('g',412000)}}
V=r"(?:return(?:\s+back)?|report(?:\s+back)?|go back|head back|speak|talk|seek out|find|bring (?:it|them|these|this|the \w+)(?: back)?|deliver (?:it|them|these|this)|turn (?:it|them) in)"
pat=re.compile(V+r"\s+(?:to|with)?\s*(.+?)(?:\s+(?:at|in|on|inside|near|within|atop|outside|to receive|for)\s+|[.!,;]|$)",re.I)
inCoA=lambda k:(k[1] in ct) if k[0]=='c' else (k[1] in gt)
def cands(text):
    out=[]
    for m in pat.finditer(text or ''):
        s=m.group(1).strip(" '\"").lower()
        if s in ALIAS: out.append(ALIAS[s]); continue
        w=re.sub(r'^the\s+','',s).split()
        for k in range(len(w),0,-1):
            n=' '.join(w[:k])
            if n in ALIAS: out.append(ALIAS[n]); break
            if n in names: out.append(names[n]); break
    return out
def pick(ids):
    for f in (lambda k:inCoA(k) and k in qg, lambda k:k in qg, inCoA, lambda k:True):
        s={k for k in ids if f(k)}
        if s: return s
def infer(w):
    c=cands(w['CompletedText']) or cands(w['Objectives']) or cands(w['EndText']) or cands(w['Details'][-300:])
    return pick(c[-1]) if c else None
# validation on stock quests CoA knows
truth=collections.defaultdict(set)
for e,q in db.execute('select id,quest from creature_questender'): truth[int(q)].add(('c',int(e)))
for e,q in db.execute('select id,quest from gameobject_questender'): truth[int(q)].add(('g',int(e)))
tot=hit=amb=miss=none=0
for q,t in truth.items():
    w=wdb.get(q)
    if not w: continue
    tot+=1; p=infer(w)
    if not p: none+=1
    elif p&t and len(p)==1: hit+=1
    elif p&t: amb+=1
    else: miss+=1
print(f'VALIDATION on {tot} stock quests: exact {hit} ({hit*100//tot}%), right but ambiguous {amb}, wrong {miss} ({miss*100//tot}%), no guess {none}')
print(f'  precision when a single guess is made: {hit*100//max(1,hit+miss)}%')
st=collections.Counter(); out={}
for i in keep:
    p=infer(wdb[i])
    if not p: st['none']+=1; continue
    out[i]=sorted(p); st['single' if len(p)==1 else 'ambiguous']+=1
    st['board' if p&ALIAS['call board'] else 'npc/object']+=1
    st['in CoA' if any(inCoA(k) for k in p) else 'not in CoA']+=1
print('CUSTOM enders:',dict(st))
json.dump({str(k):v for k,v in out.items()},open('ender_guess.json','w'))
# --- givers: for "return to X" wording the giver is usually X
ret=re.compile(r'^\s*(?:return|report back|go back|head back)\b',re.I)
start=collections.defaultdict(set)
for e,q in db.execute('select id,quest from creature_queststarter'): start[int(q)].add(('c',int(e)))
for e,q in db.execute('select id,quest from gameobject_queststarter'): start[int(q)].add(('g',int(e)))
tot=hit=wrong=0
for q,t in start.items():
    w=wdb.get(q)
    if not w or not ret.match(w['CompletedText'] or ''): continue
    p=infer(w)
    if not p or len(p)!=1: continue
    tot+=1; hit+= bool(p&t); wrong+= not (p&t)
print(f'GIVER=ENDER when text says "return to": {hit}/{tot} correct ({hit*100//max(1,tot)}%)')
g=collections.Counter()
for i in keep:
    w=wdb[i]; p=out.get(i)
    if not p: g['no guess']+=1
    elif ret.match(w['CompletedText'] or ''): g['giver = ender (return wording)']+=1
    else: g['ender only (seek out / speak with: giver differs)']+=1
print('CUSTOM givers:',dict(g))
print('boards in CoA:',[b for b in (402000,412000) if b in gt])
