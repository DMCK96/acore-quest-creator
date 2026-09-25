import re,sqlite3,sys,os
db=sqlite3.connect('../coa.sqlite')
def parse_values(s,i):
    rows=[];n=len(s)
    while i<n:
        c=s[i]
        if c=='(':
            row=[];i+=1;buf=[];inq=False
            while True:
                c=s[i]
                if inq:
                    if c=='\\': buf.append({'n':'\n','r':'\r','t':'\t','0':'\0'}.get(s[i+1],s[i+1]));i+=2;continue
                    if c=="'":
                        if s[i+1:i+2]=="'": buf.append("'");i+=2;continue
                        inq=False;i+=1;continue
                    buf.append(c);i+=1;continue
                if c=="'": inq=True;quoted=True;i+=1;continue
                if c==',' or c==')':
                    v=''.join(buf).strip() if not row or True else ''
                    row.append(None if v=='NULL' and not quoted_flag[0] else v)
                    buf=[];quoted_flag[0]=False
                    i+=1
                    if c==')': break
                    continue
                buf.append(c);i+=1
            rows.append(row)
        elif c==';': return rows,i+1
        else: i+=1
    return rows,i
quoted_flag=[False]
for path in sys.argv[1:]:
    t=os.path.basename(path)[:-4]
    s=open(path,encoding='utf-8',errors='replace').read()
    m=re.search(r'CREATE TABLE `[^`]+` \((.*?)\n\)',s,re.S)
    cols=re.findall(r'^\s*`([^`]+)`',m.group(1),re.M)
    db.execute(f'DROP TABLE IF EXISTS "{t}"')
    db.execute(f'CREATE TABLE "{t}" ('+','.join(f'"{c}"' for c in cols)+')')
    cnt=0
    for mm in re.finditer(r'INSERT INTO `[^`]+`(?: \([^)]*\))? VALUES\s*',s):
        rows,_=parse_values(s,mm.end())
        rows=[r for r in rows if len(r)==len(cols)]
        db.executemany(f'INSERT INTO "{t}" VALUES ('+','.join('?'*len(cols))+')',rows); cnt+=len(rows)
    db.commit(); print(t,len(cols),cnt,flush=True)
