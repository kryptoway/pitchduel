#!/usr/bin/env python3
"""Zapisuje live.json: kto z naszych zawodnikow jest teraz na boisku + wynik meczu.
Uzycie: live.py prev.json out.json   (klucz w env API_FOOTBALL_KEY)
Dane z API-Football (plan Free: /fixtures?live=all + /fixtures/lineups)."""
import json,os,re,sys,unicodedata,urllib.parse,urllib.request,datetime as dt
from zoneinfo import ZoneInfo
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMIT=96                      # dzienny bezpiecznik (limit planu: 100)
FIN={'FT','AET','PEN','AWD','WO','CANC','ABD','PST','SUSP'}
ALIAS={'ACM':['ac milan','milan'],'ARS':['arsenal'],'ATH':['athletic club','athletic bilbao'],
'ATM':['atletico madrid','atletico de madrid'],'B04':['bayer leverkusen','bayer 04 leverkusen'],
'BAR':['barcelona','fc barcelona'],'BET':['real betis','betis'],'BOU':['bournemouth','afc bournemouth'],
'BVB':['borussia dortmund','dortmund'],'CHE':['chelsea'],'COM':['como','como 1907'],
'CRY':['crystal palace'],'EVE':['everton'],'FCB':['bayern munich','bayern munchen','bayern'],
'INT':['inter','inter milan','internazionale'],'IPS':['ipswich','ipswich town'],'JUV':['juventus'],
'LEE':['leeds','leeds united'],'LIV':['liverpool'],'MCI':['manchester city'],
'MUN':['manchester united'],'NAP':['napoli','ssc napoli'],'NEW':['newcastle','newcastle united'],
'NFO':['nottingham forest'],'OM':['marseille','olympique marseille'],
'PSG':['paris saint germain','paris saint germain fc','psg'],'RMD':['real madrid'],'ROM':['as roma','roma'],
'SGE':['eintracht frankfurt'],'STU':['vfb stuttgart','stuttgart'],'TOT':['tottenham','tottenham hotspur']}
def norm(s):
    s=str(s or '').lower()
    for a,b in (('ø','o'),('æ','ae'),('ł','l'),('ß','ss'),('đ','d'),('ı','i')):s=s.replace(a,b)
    s=unicodedata.normalize('NFKD',s);s=''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+',' ',s).strip()
A2C={norm(a):c for c,al in ALIAS.items() for a in al}
def team_code(name):return A2C.get(norm(name))
def name_match(api,ours):
    a,o=norm(api).split(),norm(ours).split()
    if not a or not o:return False
    if a==o:return True
    if len(a)>len(o) and a[-len(o):]==o:return True       # "t alexander arnold" ~ "alexander arnold"
    if len(a)>=2 and len(o)>=2 and a[-1]==o[-1] and a[0][0]==o[0][0]:return True   # "l martinez" ~ "lautaro martinez"
    if len(a)==1 and a[0] in o:return True                 # "gabriel" ~ "gabriel magalhaes"
    if len(o)==1 and a[-1]==o[0]:return True               # "l diaz" ~ "diaz"
    return False
def load_players():
    s=open(os.path.join(ROOT,'dashboard.html'),encoding='utf-8').read()
    d=json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>',s,re.S).group(1))
    by={}
    for p in d['players']:by.setdefault(p['club'],[]).append(p)
    return by
def pick(api_name,club,by):
    c=[p for p in by.get(club,[]) if name_match(api_name,p['name'])]
    return c[0]['id'] if len(c)==1 else None
def active(now,prev):
    if any((m or {}).get('st') for m in (prev.get('matches') or {}).values()):return True
    try:st=json.load(open(os.path.join(ROOT,'status.json')))['players']
    except Exception:return False
    tz=ZoneInfo('Europe/Warsaw')
    for v in st.values():
        n=v.get('next','-')
        if not re.match(r'\d{4}-\d\d-\d\d \d\d:\d\d',n or ''):continue
        ko=dt.datetime.strptime(n[:16],'%Y-%m-%d %H:%M').replace(tzinfo=tz)
        if ko-dt.timedelta(minutes=10)<=now<=ko+dt.timedelta(minutes=175):return True
    return False
def api(path,**q):
    u='https://v3.football.api-sports.io'+path+('?'+urllib.parse.urlencode(q) if q else '')
    r=urllib.request.urlopen(urllib.request.Request(u,headers={'x-apisports-key':os.environ['API_FOOTBALL_KEY']}),timeout=30)
    return json.load(r)
def on_pitch(st,events):
    on=set(st['xi'])
    for e in sorted(events or [],key=lambda e:((e['time'].get('elapsed') or 0),(e['time'].get('extra') or 0))):
        pid=(e.get('player') or {}).get('id');t=e.get('type');d=e.get('detail') or ''
        if t=='subst':
            aid=(e.get('assist') or {}).get('id')
            if pid:on.discard(pid)
            if aid:on.add(aid)
        elif t=='Card' and d in('Red Card','Second Yellow card') and pid:on.discard(pid)
    return on
def run(prev,now,call=api):
    by=load_players();out={'matches':{},'players':{},'calls':prev.get('calls') or {}}
    day=now.astimezone(dt.timezone.utc).strftime('%Y-%m-%d')
    if out['calls'].get('d')!=day:out['calls']={'d':day,'n':0}
    if not active(now,prev) or out['calls']['n']>=LIMIT:
        return None
    def c(*a,**k):
        out['calls']['n']+=1;return call(*a,**k)
    live=c('/fixtures',live='all').get('response') or []
    pm=prev.get('state') or {};st_new={}
    for f in live:
        hc,ac=team_code(f['teams']['home']['name']),team_code(f['teams']['away']['name'])
        if not(hc or ac):continue
        fid=str(f['fixture']['id']);s=f['fixture']['status'];code=s.get('short')
        if code in FIN:continue
        stt=pm.get(fid)
        if not stt and out['calls']['n']<LIMIT:
            xi,mp,tc=[],{},{}
            for t in c('/fixtures/lineups',fixture=fid).get('response') or []:
                code_t=team_code(t['team']['name']);tc[t['team']['id']]=code_t
                for row in t.get('startXI') or []:
                    xi.append(row['player']['id'])
                for row in (t.get('startXI') or [])+(t.get('substitutes') or []):
                    pl=row['player']
                    if code_t:
                        oid=pick(pl['name'],code_t,by)
                        if oid:mp[str(pl['id'])]=oid
            if xi:stt={'xi':xi,'map':mp}
        short=lambda n,cd:cd or norm(n)[:3].upper()
        m={'h':short(f['teams']['home']['name'],hc),'a':short(f['teams']['away']['name'],ac),
           'gh':f['goals']['home'] or 0,'ga':f['goals']['away'] or 0,'min':s.get('elapsed'),'st':code}
        out['matches'][fid]=m
        if stt:
            st_new[fid]=stt
            for pid in on_pitch(stt,f.get('events')):
                oid=stt['map'].get(str(pid))
                if oid:out['players'][str(oid)]={'f':fid}
    out['state']=st_new;return out
def main():
    prev={}
    try:prev=json.load(open(sys.argv[1]))
    except Exception:pass
    now=dt.datetime.now(dt.timezone.utc)
    res=run(prev,now)
    changed=False
    if res is not None:
        res['updated']=now.strftime('%Y-%m-%dT%H:%M:%SZ')
        key=lambda d:json.dumps({k:d.get(k) for k in('matches','players','calls')},sort_keys=True)
        changed=key(res)!=key(prev)
        json.dump(res,open(sys.argv[2],'w'),separators=(',',':'),ensure_ascii=False)
        print('live matches (ours):',len(res['matches']),'| on pitch:',len(res['players']),'| calls today:',res['calls']['n'])
    else:print('poza oknem meczow lub limit - bez zapytan')
    go=os.environ.get('GITHUB_OUTPUT')
    if go:open(go,'a').write('changed=%s\n'%('true' if changed else 'false'))
if __name__=='__main__':main()
