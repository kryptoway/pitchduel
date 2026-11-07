import json,os,sys,urllib.request,urllib.parse
K=os.environ.get('API_FOOTBALL_KEY','')
if not K: sys.exit('Brak sekretu API_FOOTBALL_KEY')
B='https://v3.football.api-sports.io'
def get(path,**q):
    u=B+path+('?'+urllib.parse.urlencode(q) if q else '')
    r=urllib.request.urlopen(urllib.request.Request(u,headers={'x-apisports-key':K}),timeout=30)
    return json.load(r)
def show(name,j,n=2):
    print('==',name,'| results:',j.get('results'),'| errors:',j.get('errors'))
    return j.get('response') or []
s=get('/status');r=s.get('response')
if isinstance(r,dict):print('plan:',r.get('subscription'),'| requests:',r.get('requests'))
else:print('status:',s)
fx=show('PL fixtures 2026-11-07 (season 2026)',get('/fixtures',league=39,season=2026,date='2026-11-07'))
for f in fx[:3]:print(' ',f['fixture']['id'],f['teams']['home']['name'],'-',f['teams']['away']['name'],f['fixture']['status']['short'])
if fx:
    fid=fx[0]['fixture']['id']
    L=show('lineups',get('/fixtures/lineups',fixture=fid))
    for t in L:print(' ',t['team']['name'],'startXI',len(t.get('startXI',[])),'subs',len(t.get('substitutes',[])))
    E=show('events',get('/fixtures/events',fixture=fid))
    print(' event types:',sorted({e['type']+'/'+e['detail'] for e in E})[:8])
lv=show('live=all',get('/fixtures',live='all'))
print(' live now:',len(lv))
