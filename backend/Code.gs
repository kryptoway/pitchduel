/**
 * SDF Duel – backend (Google Apps Script)
 * Stores nicknames (with hashed PINs) and picks in this spreadsheet.
 * Pairs, lock times and results are read from pairs.json on your website,
 * so you never paste pairs by hand.
 */

// >>> CHANGE THIS to the address of your site (keep the slash at the end) <<<
const SITE = 'https://kryptoway.github.io/pitchduel/';

// First month of the game (YYYY-MM). Trophies are counted from this month on.
const MONTHS_START = '2026-11';
const MIN_ANSWERED = 5;    // minimum scored picks to win a monthly medal

// Wallet bonuses (stars that go to the wallet only, never to the leaderboard)
const BONUS_INVITE = 1;                     // inviter AND invited player, once the invited player has played a round
const BONUS_MEDAL = { 1: 3, 2: 2, 3: 1 };   // monthly podium: gold / silver / bronze
const BONUS_PERFECT = 2;                    // every Perfect Round (all scored pairs of a round picked and correct)

const MAX_FAILS = 5;       // wrong PIN attempts before a temporary block
const BLOCK_MIN = 15;      // block length in minutes

/** Run this ONCE from the editor (menu: Run > setup). */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [['Players', ['nick_lower', 'nick', 'pin_hash', 'created_at', 'x_handle', 'invited_by']],
   ['Picks', ['key', 'updated_at', 'nick_lower', 'nick', 'pair_id', 'pick']],
   ['Wallet', ['key', 'created_at', 'nick_lower', 'delta', 'reason']]].forEach(function (t) {
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
  if (a === 'trophies') return trophies_();
  if (a === 'mytrophies') return mytrophies_(req.nick, req.pin);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (a === 'register') return register_(req.nick, req.pin, req.x, req.ref);
    if (a === 'login') return login_(req.nick, req.pin, req.x);
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

/** X (Twitter) handle: optional. Returns '' if empty, null if invalid, else the handle without @. */
function cleanX_(x) {
  let s = String(x == null ? '' : x).trim();
  if (!s) return '';
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').replace(/[\/?#].*$/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s : null;
}

function setX_(nl, x) {
  const sh = sheet_('Players');
  if (!sh.getRange(1, 5).getValue()) sh.getRange(1, 5).setValue('x_handle');
  const i = rows_('Players', 1).findIndex(function (r) { return r[0] === nl; });
  if (i >= 0) sh.getRange(i + 2, 5).setValue(x);
}

function register_(nick, pin, x, ref) {
  const n = cleanNick_(nick), p = cleanPin_(pin), xh = cleanX_(x);
  if (!n) return { ok: false, error: 'bad_nick' };
  if (!p) return { ok: false, error: 'bad_pin' };
  if (xh === null) return { ok: false, error: 'bad_x' };
  const nl = n.toLowerCase();
  if (['admin', 'moderator', 'sdfduel', 'sportfun'].indexOf(nl) >= 0) return { ok: false, error: 'nick_taken' };
  const exists = rows_('Players', 1).some(function (r) { return r[0] === nl; });
  if (exists) return { ok: false, error: 'nick_taken' };
  // invitation: remember who invited this player (only an existing, different player counts)
  let inv = '';
  const rn = cleanNick_(ref);
  if (rn && rn.toLowerCase() !== nl && rows_('Players', 1).some(function (r) { return r[0] === rn.toLowerCase(); })) inv = rn.toLowerCase();
  const psh = sheet_('Players');
  if (!psh.getRange(1, 6).getValue()) psh.getRange(1, 6).setValue('invited_by');
  psh.appendRow([nl, n, hash_(nl, p), new Date().toISOString(), xh, inv]);
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

function login_(nick, pin, x) {
  const u = auth_(nick, pin);
  if (!u.ok) return u;
  const xh = cleanX_(x);
  if (xh === null) return { ok: false, error: 'bad_x' };
  if (xh) setX_(u.nl, xh); // only changes the handle when a new one is typed in
  return { ok: true, nick: u.nick };
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
  const pd = pairs_();
  const pair = (pd.pairs || []).filter(function (x) { return x.id === pairId; })[0];
  if (!pair) return { ok: false, error: 'bad_pair' };
  if ((pd.soon || []).indexOf(pair.round) >= 0) return { ok: false, error: 'locked' }; // round announced but not open yet
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

/** Public leaderboard for one month ("2026-11") or all months ("all"). Only scored pairs count. */
function board_(month) {
  // Only accept "all", empty (= current month) or YYYY-MM. Anything else would make the script
  // fetch a pairs-<anything>.json file from the site on every call and waste the daily quota.
  if (month !== 'all' && month !== '' && !/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'bad_month' };
  const cache = CacheService.getScriptCache(), ck = 'board:' + month, c = cache.get(ck);
  if (c) return JSON.parse(c);
  const months = monthsList_(), cur = String(pairs_().month || '');
  const use = month === 'all' ? months : [month || cur], scored = {};
  use.forEach(function (mo) {
    const d = monthPairs_(mo);
    if (!d) return;
    (d.pairs || []).forEach(function (p) { if (p.result === 'A' || p.result === 'B') scored[p.id] = p.result; });
  });
  const xmap = {};
  rows_('Players', 5).forEach(function (r) { if (r[4]) xmap[r[0]] = String(r[4]); });
  const by = {};
  rows_('Picks', 6).forEach(function (r) {
    const res = scored[r[4]];
    if (!res) return;
    const e = by[r[2]] || (by[r[2]] = { nick: r[3], x: xmap[r[2]] || '', points: 0, answered: 0 });
    e.answered++;
    if (r[5] === res) e.points++;
  });
  const list = Object.keys(by).map(function (k) { return by[k]; });
  list.sort(boardSort_);
  const out = { ok: true, month: month || cur, months: months, scoredPairs: Object.keys(scored).length,
                board: list.slice(0, 100), updated: new Date().toISOString() };
  try { const bt = JSON.stringify(out); if (bt.length < 90000) cache.put(ck, bt, 60); } catch (e) {}
  return out;
}

// ---------- trophies & achievements ----------
// Past months are read from pairs-YYYY-MM.json (copy pairs.json there when a month ends).
var ACH_ = [
  ['hattrick', 'Hat-trick', '3 correct picks in a row'],
  ['onfire', 'On Fire', '5 correct picks in a row'],
  ['unstop', 'Unstoppable', '8 correct picks in a row']
];

function monthsList_() {
  const cur = String(pairs_().month || '');
  if (!/^\d{4}-\d{2}$/.test(cur)) return [];
  const a = MONTHS_START.split('-').map(Number), b = cur.split('-').map(Number), out = [];
  let y = a[0], m = a[1];
  while (y < b[0] || (y === b[0] && m <= b[1])) {
    out.push(y + '-' + ('0' + m).slice(-2));
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function monthPairs_(month) {
  const cur = pairs_();
  if (String(cur.month) === month) return cur;
  const cache = CacheService.getScriptCache(), key = 'pm:' + month, c = cache.get(key);
  if (c) return JSON.parse(c);
  const res = UrlFetchApp.fetch(SITE + 'pairs-' + month + '.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const txt = res.getContentText(), data = JSON.parse(txt);
  if (txt.length < 90000) cache.put(key, txt, 300);
  return data;
}

function boardSort_(x, y) {
  return y.points - x.points || (y.points / y.answered) - (x.points / x.answered) || x.nick.localeCompare(y.nick);
}

/** Cache helpers: gzip + base64 so big results still fit the 100 KB cache limit. */
function cachePutBig_(cache, key, txt, ttl) {
  try {
    const b = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(txt, 'application/json', 'x.json')).getBytes());
    if (b.length < 95000) cache.put(key, b, ttl);
  } catch (e) {}
}
function cacheGetBig_(cache, key) {
  try {
    const c = cache.get(key);
    if (!c) return null;
    return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(c), 'application/x-gzip', 'x.gz')).getDataAsString();
  } catch (e) { return null; }
}

function compute_() {
  const cache = CacheService.getScriptCache(), cc = cacheGetBig_(cache, 'tcalc');
  if (cc) return JSON.parse(cc);
  const months = monthsList_(), picks = rows_('Picks', 6), byPair = {}, nicks = {}, players = {}, pickedBy = {};
  picks.forEach(function (r) {
    (byPair[r[4]] = byPair[r[4]] || []).push({ nl: r[2], ch: r[5] });
    nicks[r[2]] = r[3];
  });
  const P = function (nl) { return players[nl] || (players[nl] = { n: nicks[nl], e: {}, m: [] }); };
  picks.forEach(function (r) { P(r[2]).e.rookie = 1; (pickedBy[r[2]] = pickedBy[r[2]] || {})[r[4]] = 1; });
  const chrono = [], outMonths = [], awards = [], roundsAll = [];
  months.forEach(function (mo) {
    const d = monthPairs_(mo);
    if (!d || !(d.pairs || []).length) { outMonths.push({ month: mo, final: false, scored: 0, total: 0, podium: [], lead: [] }); return; }
    const prs = d.pairs, graded = prs.filter(function (p) { return p.result === 'A' || p.result === 'B'; });
    const final = prs.every(function (p) { return p.result === 'A' || p.result === 'B' || p.result === 'void'; });
    const st = {};
    graded.forEach(function (p) {
      chrono.push({ lock: String(p.lock || ''), id: p.id, res: p.result });
      (byPair[p.id] || []).forEach(function (k) {
        const e = st[k.nl] || (st[k.nl] = { pts: 0, ans: 0 });
        e.ans++; if (k.ch === p.result) e.pts++;
      });
    });
    // perfect rounds
    const rounds = {};
    prs.forEach(function (p) { const r = String(p.round || d.round || ''); (rounds[r] = rounds[r] || []).push(p); });
    // rounds for the participation streak (void pairs are ignored)
    Object.keys(rounds).forEach(function (r) {
      const act = rounds[r].filter(function (p) { return p.result !== 'void'; });
      if (!act.length) return;
      let lockMax = '', closed = true;
      act.forEach(function (p) {
        const l = String(p.lock || '');
        if (l > lockMax) lockMax = l;
        if (!(Date.parse(l) < Date.now())) closed = false;
      });
      roundsAll.push({ lock: lockMax, ids: act.map(function (p) { return p.id; }), closed: closed });
    });
    Object.keys(rounds).forEach(function (r) {
      const all = rounds[r], g = all.filter(function (p) { return p.result === 'A' || p.result === 'B'; });
      const done = all.every(function (p) { return p.result === 'A' || p.result === 'B' || p.result === 'void'; });
      if (!done || g.length < 1) return;   // finished round with at least one scored pair (void pairs are ignored)
      const ok = {};
      g.forEach(function (p) {
        (byPair[p.id] || []).forEach(function (k) { if (k.ch === p.result) ok[k.nl] = (ok[k.nl] || 0) + 1; });
      });
      // Perfect round = every scored pair of the round picked AND correct (void pairs do not count).
      Object.keys(ok).forEach(function (nl) {
        if (ok[nl] === g.length) { P(nl).e.perfect = 1; P(nl).pr = (P(nl).pr || 0) + 1; awards.push({ t: 'pr', k: r, nick: nicks[nl] }); }
      });
    });
    Object.keys(st).forEach(function (nl) {   // Duel Stars: 1 per correct pick, void pairs give nothing
      const pl = P(nl);
      pl.stt = (pl.stt || 0) + st[nl].pts;
      pl.stm = st[nl].pts;                      // stars of the latest month in the list
    });
    const list = Object.keys(st).map(function (nl) {
      const e = st[nl];
      if (e.ans >= 8 && e.pts / e.ans >= 0.75) P(nl).e.sharp = 1;
      if (graded.length >= 8 && e.ans >= graded.length) P(nl).e.ever = 1;
      return { nl: nl, nick: nicks[nl], points: e.pts, answered: e.ans };
    }).sort(boardSort_);
    const cut = function (x) { return { nick: x.nick, points: x.points, answered: x.answered }; };
    let podium = [], lead = [];
    if (final) {
      podium = list.filter(function (x) { return x.answered >= MIN_ANSWERED; }).slice(0, 3);
      podium.forEach(function (x, i) { P(x.nl).m.push([mo, i + 1]); });
    } else lead = list.slice(0, 3);
    outMonths.push({ month: mo, final: final, scored: graded.length, total: prs.length, podium: podium.map(cut), lead: lead.map(cut) });
  });
  // participation streak: a round counts as played when at least half of its pairs were picked.
  // A round that is still open and not yet played does not break the streak.
  roundsAll.sort(function (a, b) { return a.lock < b.lock ? -1 : a.lock > b.lock ? 1 : 0; });
  Object.keys(nicks).forEach(function (nl) {
    const mine = pickedBy[nl] || {};
    let run = 0, bestRun = 0, played = 0;
    roundsAll.forEach(function (R) {
      let n = 0;
      R.ids.forEach(function (id) { if (mine[id]) n++; });
      if (n * 2 >= R.ids.length) { played++; run++; if (run > bestRun) bestRun = run; }
      else if (R.closed) run = 0;
    });
    P(nl).s = { cur: run, best: bestRun, played: played };
  });
  // invitations: an invited player counts for the inviter once he has played at least one round
  rows_('Players', 6).forEach(function (r) {
    const by = String(r[5] || '').toLowerCase();
    if (!by || by === r[0]) return;
    const pl = P(by);
    if (!pl.n) pl.n = String(by);
    pl.inv = pl.inv || { total: 0, active: 0 };
    pl.inv.total++;
    const inv = players[r[0]];
    if (inv && inv.s && inv.s.played >= 1) pl.inv.active++;
  });
  // streaks
  chrono.sort(function (a, b) { return a.lock < b.lock ? -1 : a.lock > b.lock ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
  const run = {}, best = {};
  chrono.forEach(function (p) {
    (byPair[p.id] || []).forEach(function (k) {
      if (k.ch === p.res) {
        P(k.nl).e.firstblood = 1;
        run[k.nl] = (run[k.nl] || 0) + 1;
        if (run[k.nl] > (best[k.nl] || 0)) best[k.nl] = run[k.nl];
      } else run[k.nl] = 0;
    });
  });
  Object.keys(best).forEach(function (nl) {
    if (best[nl] >= 3) P(nl).e.hattrick = 1;
    if (best[nl] >= 5) P(nl).e.onfire = 1;
    if (best[nl] >= 8) P(nl).e.unstop = 1;
  });
  // wallet bonuses (derived, so they can never get out of sync with the game data)
  Object.keys(players).forEach(function (nl) {
    const pl = players[nl], w = { inv: 0, med: 0, prf: 0 };
    pl.m.forEach(function (x) { w.med += BONUS_MEDAL[x[1]] || 0; });
    w.prf = (pl.pr || 0) * BONUS_PERFECT;
    pl.w = w;
  });
  rows_('Players', 6).forEach(function (r) {
    const by = String(r[5] || '').toLowerCase(), me = players[r[0]];
    if (!by || by === r[0] || !me || !me.s || me.s.played < 1 || !players[by]) return;
    players[by].w.inv += BONUS_INVITE;   // the inviter
    me.w.inv += BONUS_INVITE;            // the invited player
  });
  const out = { months: outMonths, players: players, awards: awards };
  const txt = JSON.stringify(out);
  cachePutBig_(cache, 'tcalc', txt, 180);
  return out;
}

/** Public: monthly podiums + how many players hold each achievement. */
function trophies_() {
  const c = compute_(), total = Object.keys(c.players).length;
  const ach = ACH_.map(function (a) {
    const hold = Object.keys(c.players).filter(function (nl) { return c.players[nl].e[a[0]]; });
    return { id: a[0], name: a[1], desc: a[2], count: hold.length,
             holders: hold.slice(0, 5).map(function (nl) { return c.players[nl].n; }) };
  });
  return { ok: true, minAnswered: MIN_ANSWERED, months: c.months, awards: c.awards || [], ach: ach, players: total, updated: new Date().toISOString() };
}

/** Sum of manual wallet entries (spending on Pro etc. is negative). The sheet is optional. */
function walletSheet_(nl) {
  const s = sheet_('Wallet');
  if (!s) return 0;
  let t = 0;
  rows_('Wallet', 5).forEach(function (r) { if (r[2] === nl) t += Number(r[3]) || 0; });
  return t;
}

/** Private: the trophies of one logged-in player. */
function mytrophies_(nick, pin) {
  const u = auth_(nick, pin);
  if (!u.ok) return u;
  const p = compute_().players[u.nl] || { e: {}, m: [] };
  const w = p.w || { inv: 0, med: 0, prf: 0 }, spent = walletSheet_(u.nl), earned = p.stt || 0;
  const wallet = { stars: earned, invites: w.inv, medals: w.med, perfect: w.prf, other: spent,
                   balance: earned + w.inv + w.med + w.prf + spent };
  return { ok: true, nick: u.nick, wallet: wallet, streak: p.s || { cur: 0, best: 0, played: 0 }, stars: { total: p.stt || 0, month: p.stm || 0 }, invites: p.inv || { total: 0, active: 0 }, earned: Object.keys(p.e),
           medals: p.m.map(function (x) { return { month: x[0], place: x[1] }; }) };
}

/* ---------- Backup: daily copy of this spreadsheet to Drive ---------- */

/** Makes a dated copy of the spreadsheet in the Drive folder "SDF backup" and keeps the newest 14 copies. */
function backupSheet_() {
  const KEEP = 14, FOLDER = 'SDF backup';
  const ss = SpreadsheetApp.getActiveSpreadsheet(), file = DriveApp.getFileById(ss.getId());
  const it = DriveApp.getFoldersByName(FOLDER), folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
  const stamp = Utilities.formatDate(new Date(), 'Europe/Warsaw', 'yyyy-MM-dd HH:mm');
  file.makeCopy('SDF Duel data backup ' + stamp, folder);
  const copies = [], files = folder.getFiles();
  while (files.hasNext()) { const f = files.next(); if (f.getName().indexOf('SDF Duel data backup ') === 0) copies.push(f); }
  copies.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  copies.slice(KEEP).forEach(function (f) { f.setTrashed(true); });
}

/** Run this ONCE by hand (it asks for Drive permission). It schedules backupSheet_ every night around 03:00. */
function setupBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupSheet_') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupSheet_').timeBased().everyDays(1).atHour(3).create();
  backupSheet_();
}
