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
last4=list(reversed(has[-4:]))                      # najnowsza pierwsza, jak w dashboardzie
def fx(club,label):
    for k,v in D['fx'].items():
        ci,r=k.split('|')
        if norm(r)==norm(label) and club in v:
            m=v[club];out={'o':m['o'],'h':1 if m.get('h') else 0}
            if m.get('s'):out['s']=m['s']
            return out
    return {}
def stats(p):
    v=[x for ci,r in has for x in [val(p,ci,r)] if num(x)]
    return (round(sum(v)/len(v),1) if v else 0),len(v),(max(v) if v else 0)
pj=json.load(open(os.path.join(ROOT,'pairs.json'),encoding='utf-8'))
for q in pj['pairs']:
    for s in 'ab':
        x=q[s];p=P.get(x['id'])
        if not q.get('result') and p:
            x['avg'],x['played'],x['max']=stats(p)
            x['form']=[{'r':r,'v':(lambda v:'DNP' if v=='DNP' else v if num(v) else None)(val(p,ci,r))} for ci,r in last4]
        for f in x['form']:
            f.update(fx(x['club'],f['r']))
        order={norm(r):i for i,(ci,r) in enumerate(rounds)}
        x['form'].sort(key=lambda f:-order.get(norm(f['r']),-1))   # najnowsza pierwsza
out=json.dumps(pj,ensure_ascii=False,indent=1)+'\n'
if '--dry' in sys.argv:print(out[:0]);print('ok (dry)')
else:open(os.path.join(ROOT,'pairs.json'),'w',encoding='utf-8').write(out);print('pairs.json zapisany')
