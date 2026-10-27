/**
 * SDF Duel – backend (Google Apps Script)
 * Stores nicknames (with hashed PINs) and picks in this spreadsheet.
 * Pairs, lock times and results are read from pairs.json on your website,
 * so you never paste pairs by hand.
 */

// >>> CHANGE THIS to the address of your site (keep the slash at the end) <<<
const SITE = 'https://kryptoway.github.io/pitchduel/';

const MAX_FAILS = 5;       // wrong PIN attempts before a temporary block
const BLOCK_MIN = 15;      // block length in minutes

/** Run this ONCE from the editor (menu: Run > setup). */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [['Players', ['nick_lower', 'nick', 'pin_hash', 'created_at']],
   ['Picks', ['key', 'updated_at', 'nick_lower', 'nick', 'pair_id', 'pick']]].forEach(function (t) {
    let s = ss.getSheetByName(t[0]);
    if (!s) { s = ss.insertSheet(t[0]); s.appendRow(t[1]); s.setFrozenRows(1); }
  });
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SALT')) p.setProperty('SALT', Utilities.getUuid() + Utilities.getUuid());
}

function doGet() {
  return json_({ ok: true, service: 'sdf-duel' });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    out = handle_(req);
  } catch (err) {
    out = { ok: false, error: 'bad_request' };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  const a = req.action;
  if (a === 'board') return board_(String(req.month || ''));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (a === 'register') return register_(req.nick, req.pin);
    if (a === 'login') return login_(req.nick, req.pin);
    if (a === 'pick') return pick_(req.nick, req.pin, req.pair, req.choice);
    if (a === 'mypicks') return mypicks_(req.nick, req.pin);
    return { ok: false, error: 'unknown_action' };
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------
function sheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function cleanNick_(n) {
  const t = String(n == null ? '' : n).trim();
  return /^[A-Za-z0-9_]{3,16}$/.test(t) ? t : null;
}
function cleanPin_(p) {
  const t = String(p == null ? '' : p).trim();
  return /^\d{4}$/.test(t) ? t : null;
}
function hash_(nl, pin) {
  const salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + nl + ':' + pin);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function rows_(name, cols) {
  const s = sheet_(name), n = s.getLastRow() - 1;
  return n > 0 ? s.getRange(2, 1, n, cols).getValues() : [];
}

function register_(nick, pin) {
  const n = cleanNick_(nick), p = cleanPin_(pin);
  if (!n) return { ok: false, error: 'bad_nick' };
  if (!p) return { ok: false, error: 'bad_pin' };
  const nl = n.toLowerCase();
  if (['admin', 'moderator', 'sdfduel', 'sportfun'].indexOf(nl) >= 0) return { ok: false, error: 'nick_taken' };
  const exists = rows_('Players', 1).some(function (r) { return r[0] === nl; });
  if (exists) return { ok: false, error: 'nick_taken' };
  sheet_('Players').appendRow([nl, n, hash_(nl, p), new Date().toISOString()]);
  return { ok: true, nick: n };
}

/** Returns the stored display nick if credentials are right, else an error object. */
function auth_(nick, pin) {
  const n = cleanNick_(nick), p = cleanPin_(pin);
  if (!n || !p) return { ok: false, error: 'bad_credentials' };
  const nl = n.toLowerCase(), cache = CacheService.getScriptCache(), fk = 'fail:' + nl;
  if (Number(cache.get(fk) || 0) >= MAX_FAILS) return { ok: false, error: 'too_many_attempts' };
  const row = rows_('Players', 3).filter(function (r) { return r[0] === nl; })[0];
  if (!row || row[2] !== hash_(nl, p)) {
    cache.put(fk, String(Number(cache.get(fk) || 0) + 1), BLOCK_MIN * 60);
    return { ok: false, error: 'bad_credentials' };
  }
  cache.remove(fk);
  return { ok: true, nl: nl, nick: row[1] };
}

function login_(nick, pin) {
  const u = auth_(nick, pin);
  return u.ok ? { ok: true, nick: u.nick } : u;
}

function pairs_() {
  const cache = CacheService.getScriptCache(), c = cache.get('pairs');
  if (c) return JSON.parse(c);
  const res = UrlFetchApp.fetch(SITE + 'pairs.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('pairs_unavailable');
  const txt = res.getContentText();
  const data = JSON.parse(txt);
  if (txt.length < 90000) cache.put('pairs', txt, 120);
  return data;
}

function pick_(nick, pin, pairId, choice) {
  const u = auth_(nick, pin);
  if (!u.ok) return u;
  if (choice !== 'A' && choice !== 'B') return { ok: false, error: 'bad_pick' };
  const pair = (pairs_().pairs || []).filter(function (x) { return x.id === pairId; })[0];
  if (!pair) return { ok: false, error: 'bad_pair' };
  if (Date.now() >= new Date(pair.lock).getTime()) return { ok: false, error: 'locked' };
  const s = sheet_('Picks'), key = u.nl + '|' + pairId, now = new Date().toISOString();
  const keys = rows_('Picks', 1).map(function (r) { return r[0]; });
  const i = keys.indexOf(key);
  if (i >= 0) s.getRange(i + 2, 1, 1, 6).setValues([[key, now, u.nl, u.nick, pairId, choice]]);
  else s.appendRow([key, now, u.nl, u.nick, pairId, choice]);
  return { ok: true, pair: pairId, choice: choice };
}

function mypicks_(nick, pin) {
  const u = auth_(nick, pin);
  if (!u.ok) return u;
  const picks = rows_('Picks', 6).filter(function (r) { return r[2] === u.nl; })
    .map(function (r) { return { pair: r[4], choice: r[5] }; });
  return { ok: true, nick: u.nick, picks: picks };
}

/** Public leaderboard. Only scored pairs count; picks of other players are never shown. */
function board_(month) {
  const cache = CacheService.getScriptCache(), ck = 'board:' + month, c = cache.get(ck);
  if (c) return JSON.parse(c);
  const data = pairs_(), scored = {};
  (data.pairs || []).forEach(function (p) {
    if ((p.result === 'A' || p.result === 'B') && (!month || String(p.month || data.month) === month)) scored[p.id] = p.result;
  });
  const by = {};
  rows_('Picks', 6).forEach(function (r) {
    const res = scored[r[4]];
    if (!res) return;
    const e = by[r[2]] || (by[r[2]] = { nick: r[3], points: 0, answered: 0 });
    e.answered++;
    if (r[5] === res) e.points++;
  });
  const list = Object.keys(by).map(function (k) { return by[k]; });
  list.sort(function (x, y) {
    return y.points - x.points || (y.points / y.answered) - (x.points / x.answered) || x.nick.localeCompare(y.nick);
  });
  const out = { ok: true, month: month || data.month || '', scoredPairs: Object.keys(scored).length,
                board: list.slice(0, 100), updated: new Date().toISOString() };
  cache.put(ck, JSON.stringify(out), 60);
  return out;
}
