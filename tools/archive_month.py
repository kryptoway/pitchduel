#!/usr/bin/env python3
"""Zapisuje kopie pairs.json jako pairs-YYYY-MM.json (miesiac bierze z pola "month").

Backend gry (Apps Script) czyta stare miesiace wlasnie z tych plikow, wiec dzieki
kopii puchary, medale i perfect rundy z poprzednich miesiecy nie znikaja, gdy
pairs.json przechodzi na kolejny miesiac. Uruchamia sie samo (GitHub Actions) po
kazdej zmianie pairs.json; recznie: python3 tools/archive_month.py
"""
import json, re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'pairs.json'
raw = src.read_bytes()
month = str(json.loads(raw).get('month', ''))
if not re.fullmatch(r'\d{4}-\d{2}', month):
    sys.exit('pairs.json: brak poprawnego pola "month" (RRRR-MM)')
dst = root / f'pairs-{month}.json'
if dst.exists() and dst.read_bytes() == raw:
    print(f'{dst.name}: bez zmian')
else:
    dst.write_bytes(raw)
    print(f'{dst.name}: zapisano')
