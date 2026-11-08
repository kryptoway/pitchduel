#!/usr/bin/env python3
"""Odswieza statystyki w pairs.json na podstawie danych z dashboard.html.
- pary jeszcze nie rozliczone (bez 'result'): avg, played, max, form (ostatnie 4 rundy z danymi)
- wszystkie pary: dopisuje do form rywala i wynik meczu (o, h, s), jesli sa w dashboardzie
Uzycie: python3 tools/refresh_pairs.py [--dry]"""
import json,os,re,sys
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
num=lambda v:isinstance(v,(int,float)) and not isinstance(v,bool)
norm=lambda r:re.sub(r'[NPCL]\s*$','',str(r).strip(),flags=re.I)
D=json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>',open(os.path.join(ROOT,'dashboard.html'),encoding='utf-8').read(),re.S).group(1))
P={p['id']:p for p in D['players']}
rounds=[(c['id'],r) for c in D['comps'] for r in c['rounds']]
def val(p,ci,r):
    c=next(c for c in D['comps'] if c['id']==ci);a=(p['pts'] or {}).get(ci) or []
    i=c['rounds'].index(r);return a[i] if i<len(a) else None
has=[(ci,r) for ci,r in rounds if any(val(p,ci,r) is not None for p in D['players'])]
rev=list(reversed(has))                              # najnowsza pierwsza, jak w dashboardzie
def fx(club,label,pid=None):
    out={}
    for k,v in D['fx'].items():
        ci,r=k.split('|')
        if norm(r)==norm(label) and club in v:
            m=v[club];out={'o':m['o'],'h':1 if m.get('h') else 0}
            if m.get('s'):out['s']=m['s']
            if m.get('d'):out['d']=m['d']
            break
    for k,v in (D.get('gi') or {}).items():
        if norm(k.split('|')[1])==norm(label):
            gg=(v or {}).get(str(pid)) or (v or {}).get(pid) or {}
            if gg.get('g'):out['g']=gg['g']
            if gg.get('a'):out['a']=gg['a']
    return out
def no_match(club,ci,r):
    """True gdy terminarz rundy jest znany, a klub w nim nie wystepuje (klub nie gral w tej rundzie)."""
    m=D['fx'].get(ci+'|'+r)
    if m: return club not in m
    v=[val(p,ci,r) for p in D['players'] if p.get('club')==club]
    v=[x for x in v if x is not None]
    return True   # brak terminarza rundy: DNP bez danych meczu nie jest weryfikowalna nieobecnosc -> pomijamy
def stats(p):
    v=[x for ci,r in has for x in [val(p,ci,r)] if num(x)]
    return (round(sum(v)/len(v),1) if v else 0),len(v),(max(v) if v else 0)
pj=json.load(open(os.path.join(ROOT,'pairs.json'),encoding='utf-8'))
for q in pj['pairs']:
    for s in 'ab':
        x=q[s];p=P.get(x['id'])
        if not q.get('result') and p:
            x['avg'],x['played'],x['max']=stats(p)
            got=[(ci,r) for ci,r in rev if num(val(p,ci,r))][:4]       # tylko rundy, w ktorych zawodnik zagral (liczba pkt); bez DNP i rund bez danych; 4 ostatnie
            x['form']=[{'r':r,'v':val(p,ci,r)} for ci,r in got]
        x['form']=[f for f in x['form'] if num(f['v'])]      # nigdy nie pokazuj DNP w formie
        for f in x['form']:
            for k in('o','h','s','d','g','a'):f.pop(k,None)
            f.update(fx(x['club'],f['r'],x['id']))
            f.pop('nm',None)
            if f['v']=='DNP' and any(norm(k.split('|')[1])==norm(f['r']) and x['club'] not in v for k,v in D['fx'].items() if v):f['nm']=1   # klub nie gral
        order={norm(r):i for i,(ci,r) in enumerate(rounds)}
        x['form'].sort(key=lambda f:-order.get(norm(f['r']),-1))   # najnowsza pierwsza
out=json.dumps(pj,ensure_ascii=False,indent=1)+'\n'
if '--check' in sys.argv:
    cur=open(os.path.join(ROOT,'pairs.json'),encoding='utf-8').read()
    print('pairs.json AKTUALNY' if cur==out else 'pairs.json NIEAKTUALNY wzgledem dashboardu: uruchom python3 tools/refresh_pairs.py');sys.exit(0 if cur==out else 1)
if '--dry' in sys.argv:print(out[:0]);print('ok (dry)')
else:open(os.path.join(ROOT,'pairs.json'),'w',encoding='utf-8').write(out);print('pairs.json zapisany')
