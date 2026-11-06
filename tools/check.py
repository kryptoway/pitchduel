#!/usr/bin/env python3
"""Tylko odczyt: sprawdza spójność danych w dashboard.html i niczego nie zmienia.
Użycie: python3 tools/check.py"""
import re, json
h = open('dashboard.html', encoding='utf-8').read()
d = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', h, re.S).group(1))
pl = {p['id']: p for p in d['players']}
comps = {c['id']: c for c in d['comps']}
issues = 0
def warn(m):
    global issues; issues += 1; print('UWAGA ', m)

# 1) suma goli/asyst z rund (gi) vs suma miesięczna (g/a)
sums = {}
for key, per in d.get('gi', {}).items():
    cid = key.split('|')[0]
    for pid, v in per.items():
        s = sums.setdefault((cid, int(pid)), [0, 0])
        s[0] += v.get('g', 0); s[1] += v.get('a', 0)
for (cid, pid), (g, a) in sorted(sums.items()):
    p = pl.get(pid)
    if not p: warn(f'gi: nieznany zawodnik {pid}'); continue
    tg, ta = p.get('g', {}).get(cid, 0), p.get('a', {}).get(cid, 0)
    if g > tg: warn(f"{p['name']} {cid}: gole z rund {g} > suma miesięczna {tg}")
    if a > ta: warn(f"{p['name']} {cid}: asysty z rund {a} > suma miesięczna {ta}")

# 2) gole/asysty wpisane w rundzie, w której zawodnik ma DNP lub brak punktów
for key, per in d.get('gi', {}).items():
    cid, rnd = key.split('|')
    if cid not in comps or rnd not in comps[cid]['rounds']: warn(f'gi: nieznana runda {key}'); continue
    i = comps[cid]['rounds'].index(rnd)
    for pid, v in per.items():
        p = pl.get(int(pid)); arr = p['pts'].get(cid, []) if p else []
        val = arr[i] if i < len(arr) else None
        if (v.get('g') or v.get('a')) and val in (None, '', 'DNP'):
            warn(f"{p['name'] if p else pid} {key}: są gole/asysty, ale punkty = {val}")

# 3) długości tablic punktów vs liczba rund
for p in d['players']:
    for cid, arr in p['pts'].items():
        if cid in comps and len(arr) > len(comps[cid]['rounds']):
            warn(f"{p['name']} {cid}: {len(arr)} punktów, a rund {len(comps[cid]['rounds'])}")

# 4) pairs.json: zawodnicy istnieją, wynik ma dozwoloną wartość
pr = json.load(open('pairs.json', encoding='utf-8'))
for q in pr['pairs']:
    for s in 'ab':
        if q[s]['id'] not in pl: warn(f"pairs {q['id']}: brak zawodnika {q[s]['id']} w dashboardzie")
    if q.get('result') not in (None, 'A', 'B', 'void'): warn(f"pairs {q['id']}: zły result {q.get('result')}")
print(f'\nSprawdzono. Uwag: {issues}')
