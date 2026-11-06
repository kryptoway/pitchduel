#!/usr/bin/env python3
"""Wpisuje result (A/B/void) w pairs.json na podstawie punktów z dashboard.html.
Użycie: python3 tools/grade.py          -> tylko podgląd
        python3 tools/grade.py --write  -> zapisuje pairs.json
Pojedynek jest oceniany tylko gdy obaj zawodnicy mają wpisane punkty w danej rundzie.
Remis lub DNP któregokolwiek zawodnika = void. Pary z już wpisanym wynikiem nie są ruszane."""
import re, json, sys
h = open('dashboard.html', encoding='utf-8').read()
d = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', h, re.S).group(1))
pl = {p['id']: p for p in d['players']}
pr = json.load(open('pairs.json', encoding='utf-8'))

def find_round(label):
    key = label.split()[0]  # "3-5 Nov" -> "3-5"
    for c in d['comps']:
        for i, r in enumerate(c['rounds']):
            if re.sub(r'[A-Za-z]+$', '', r) == key:
                return c['id'], i
    return None

def pts(pid, cid, i):
    arr = pl.get(pid, {}).get('pts', {}).get(cid, [])
    return arr[i] if i < len(arr) else None

changed = 0
for p in pr['pairs']:
    if p.get('result') is not None:
        continue
    loc = find_round(p['round'])
    if not loc:
        continue
    a, b = pts(p['a']['id'], *loc), pts(p['b']['id'], *loc)
    if a in (None, '') or b in (None, ''):
        print(f"czeka   {p['id']:14} {p['a']['name']} / {p['b']['name']}: brak punktów ({a} / {b})")
        continue
    if a == 'DNP' or b == 'DNP' or a == b:
        res = 'void'
    else:
        res = 'A' if a > b else 'B'
    print(f"wynik   {p['id']:14} {p['a']['name']} {a} vs {p['b']['name']} {b} -> {res}")
    p['result'] = res
    changed += 1
print(f"\nZmian: {changed}")
if '--write' in sys.argv and changed:
    json.dump(pr, open('pairs.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('Zapisano pairs.json')
