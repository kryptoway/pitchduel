import json,os,sys,urllib.request,urllib.parse
K=os.environ.get('API_FOOTBALL_KEY','')
if not K: sys.exit('Brak sekretu API_FOOTBALL_KEY')
B='https://v3.football.api-sports.io'
def get(path,**q):
    u=B+path+('?'+urllib.parse.urlencode(q) if q else '')
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'x-apisports-key':K}),timeout=30))
big={39,140,78,135,61,2,3,848,45,143,81,66,137}
lv=get('/fixtures',live='all');R=lv.get('response') or []
print('live=all results:',len(R),'errors:',lv.get('errors'))
for f in R:
    L=f['league']
    print(f"  {L['id']:>4} {L['name'][:24]:<24} {f['teams']['home']['name'][:18]} {f['goals']['home']}-{f['goals']['away']} {f['teams']['away']['name'][:18]} {f['fixture']['status']['short']} {f['fixture']['status'].get('elapsed')}' events={len(f.get('events') or [])} lineups={len(f.get('lineups') or [])}")
pick=[f for f in R if f['league']['id'] in big] or R
if pick:
    f=pick[0];fid=f['fixture']['id'];print('\nTEST fixture',fid,f['teams']['home']['name'],'-',f['teams']['away']['name'])
    print('keys in live item:',sorted(f.keys()))
    for ev in (f.get('events') or [])[:6]:print('  ev',ev['time'],ev['type'],ev['detail'],ev['team']['name'],'|',ev['player'].get('name'),'|',ev['assist'].get('name'))
    ln=get('/fixtures/lineups',fixture=fid);print('lineups errors:',ln.get('errors'),'results:',ln.get('results'))
    for t in ln.get('response') or []:print(' ',t['team']['name'],'XI:',[p['player']['name'] for p in t['startXI']][:5],'...')
    ev=get('/fixtures/events',fixture=fid);print('events errors:',ev.get('errors'),'results:',ev.get('results'))
    ids=get('/fixtures',ids=str(fid));print('fixtures?ids errors:',ids.get('errors'),'results:',ids.get('results'))
