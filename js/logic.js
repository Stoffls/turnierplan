// Turnierplan – Turnierlogik (ohne Oberfläche, ohne Speicher)
// Alle Funktionen arbeiten auf einem einfachen Turnier-Objekt, das 1:1 gespeichert wird.

export const SPORTS = {
  tischtennis: { label: 'Tischtennis', unit: 'Punkte', mode: 'punkte', pointsToWin: 11, winBy2: true, cap: 0, setsToWin: 2, format: 'einzel' },
  squash: { label: 'Squash', unit: 'Punkte', mode: 'punkte', pointsToWin: 11, winBy2: true, cap: 0, setsToWin: 3, format: 'einzel' },
  padel: { label: 'Padel', unit: 'Spiele', mode: 'punkte', pointsToWin: 6, winBy2: true, cap: 7, setsToWin: 2, format: 'doppel' },
  eigene: { label: 'Eigene Sportart', unit: 'Punkte', mode: 'punkte', pointsToWin: 11, winBy2: true, cap: 0, setsToWin: 2, format: 'einzel' },
};

export const MODES = {
  punkte: 'Punkte je Satz',
  saetze: 'Satzergebnis (z. B. 2:1)',
  sieger: 'Nur Sieger',
};

export const SYSTEMS = {
  rr: 'Jeder gegen jeden',
  groups: 'Gruppen + KO-Runde',
  koall: 'KO mit allen Plätzen',
  swiss: 'Schweizer System',
  ko: 'KO-System',
};

export const BYE = 'BYE';

// ---------- Hilfen ----------

export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomId(len = 10, rng = Math.random) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(rng() * chars.length)];
  return s;
}

const isPow2 = (n) => n >= 1 && (n & (n - 1)) === 0;
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

function bitReversedOrder(k) {
  const bits = Math.round(Math.log2(k));
  const idx = [];
  for (let i = 0; i < k; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    idx.push({ i, r });
  }
  return idx.sort((x, y) => x.r - y.r).map((x) => x.i);
}

export function koRoundName(slots) {
  if (slots === 2) return 'Finale';
  if (slots === 4) return 'Halbfinale';
  if (slots === 8) return 'Viertelfinale';
  if (slots === 16) return 'Achtelfinale';
  return `Runde der letzten ${slots}`;
}

export function entryName(t, entryId) {
  if (entryId === BYE) return 'Freilos';
  const e = t.entries.find((x) => x.id === entryId);
  return e ? e.names.join(' / ') : '?';
}

export function ruleText(r) {
  const unit = r.unit || 'Punkte';
  if (r.mode === 'sieger') return `Gewertet wird nur der Sieger · ${r.setsToWin} Gewinnsätze (Best of ${2 * r.setsToWin - 1})`;
  let s = `Satz bis ${r.pointsToWin} ${unit}`;
  if (r.winBy2) s += `, 2 ${unit} Vorsprung`;
  if (r.winBy2 && r.cap) s += `, spätestens bei ${r.cap}`;
  s += ` · ${r.setsToWin} Gewinnsätze (Best of ${2 * r.setsToWin - 1})`;
  return s;
}

// ---------- Ergebnisprüfung ----------

// Ist w:l ein gültiges Satzende für den Gewinner mit w?
export function setValid(r, w, l) {
  const P = r.pointsToWin;
  if (!(w > l) || l < 0) return false;
  if (!r.winBy2) return w === P && l < P;
  if (w === P) return l <= P - 2;
  if (w > P) {
    if (r.cap && w === r.cap && l === r.cap - 1) return true;
    return w - l === 2 && (!r.cap || w <= r.cap);
  }
  return false;
}

function setRuleHint(r) {
  const unit = (r.unit || 'Punkte') === 'Spiele' ? 'Spielen' : 'Punkten';
  if (!r.winBy2) return `Ein Satz endet bei genau ${r.pointsToWin} ${unit}.`;
  let s = `Ein Satz endet bei ${r.pointsToWin} ${unit} mit mindestens 2 Vorsprung, ab Gleichstand mit genau 2 Vorsprung`;
  if (r.cap) s += ` oder spätestens bei ${r.cap}:${r.cap - 1}`;
  return s + '.';
}

const isInt = (v) => Number.isInteger(v) && v >= 0;

// input: {kind:'punkte', sets:[{a,b}]} | {kind:'saetze', a, b} | {kind:'sieger', winner} | {kind:'kampflos', winner}
export function validateResult(r, input) {
  const need = r.setsToWin;
  if (input.kind === 'kampflos' || input.kind === 'sieger') {
    if (input.winner !== 'a' && input.winner !== 'b') return { ok: false, error: 'Bitte den Sieger auswählen.' };
    const w = input.winner;
    return {
      ok: true,
      result: {
        type: input.kind,
        winner: w,
        setsA: input.kind === 'kampflos' ? (w === 'a' ? need : 0) : null,
        setsB: input.kind === 'kampflos' ? (w === 'b' ? need : 0) : null,
        sets: null,
      },
    };
  }
  if (input.kind === 'saetze') {
    const a = input.a, b = input.b;
    if (!isInt(a) || !isInt(b)) return { ok: false, error: 'Bitte beide Satzzahlen eintragen.' };
    if (Math.max(a, b) !== need || Math.min(a, b) >= need) {
      return { ok: false, error: `Gewonnen hat, wer zuerst ${need} Sätze hat. Gültig ist z. B. ${need}:${need - 1} oder ${need}:0.` };
    }
    return { ok: true, result: { type: 'saetze', winner: a > b ? 'a' : 'b', setsA: a, setsB: b, sets: null } };
  }
  // Punkte je Satz
  const rows = [...(input.sets || [])];
  while (rows.length && rows[rows.length - 1].a === null && rows[rows.length - 1].b === null) rows.pop();
  if (!rows.length) return { ok: false, error: 'Bitte die Punkte der Sätze eintragen.' };
  let sa = 0, sb = 0;
  const sets = [];
  for (let i = 0; i < rows.length; i++) {
    const { a, b } = rows[i];
    const n = i + 1;
    if (sa === need || sb === need) return { ok: false, error: `Das Spiel war nach Satz ${i} schon entschieden. Satz ${n} bitte leer lassen.` };
    if (!isInt(a) || !isInt(b)) return { ok: false, error: `Satz ${n}: bitte beide Punktzahlen eintragen.` };
    if (a > b && setValid(r, a, b)) sa++;
    else if (b > a && setValid(r, b, a)) sb++;
    else return { ok: false, error: `Satz ${n}: ${a}:${b} ist kein gültiges Satzende. ${setRuleHint(r)}` };
    sets.push({ a, b });
  }
  if (sa < need && sb < need) return { ok: false, error: `Noch nicht entschieden: Gewonnen hat, wer zuerst ${need} Sätze hat (bisher ${sa}:${sb}).` };
  return { ok: true, result: { type: 'punkte', winner: sa > sb ? 'a' : 'b', setsA: sa, setsB: sb, sets } };
}

export function resultText(res, side = null) {
  if (!res) return '';
  if (res.type === 'sieger') return 'Sieg';
  if (res.type === 'kampflos') return 'kampflos';
  let s = `${res.setsA}:${res.setsB}`;
  if (res.sets) s += ` (${res.sets.map((x) => `${x.a}:${x.b}`).join(', ')})`;
  return s;
}

// ---------- Planung / Vorschlag ----------

export function groupSizes(n, g) {
  const base = Math.floor(n / g), extra = n % g;
  return Array.from({ length: g }, (_, i) => base + (i < extra ? 1 : 0));
}

export const GROUP_LAYOUTS = { '2-1': true, '2-2': true, '4-1': true, '4-2': true };

export function defaultGroups(n) {
  return { groups: n >= 12 ? 4 : 2, advance: 2 };
}

export function countMatches(n, sys) {
  switch (sys.type) {
    case 'rr': return (n * (n - 1)) / 2;
    case 'groups': {
      const q = sys.groups * sys.advance;
      const gm = groupSizes(n, sys.groups).reduce((s, k) => s + (k * (k - 1)) / 2, 0);
      return gm + (q - 1) + (sys.thirdPlace && q >= 4 ? 1 : 0);
    }
    case 'koall': return (n / 2) * Math.log2(n);
    case 'swiss': return sys.swissRounds * Math.floor(n / 2);
    case 'ko': return n - 1 + (sys.thirdPlace && n >= 4 ? 1 : 0);
    default: return 0;
  }
}

export function systemAvailable(n, sys) {
  switch (sys.type) {
    case 'rr': return n >= 2 ? null : 'mindestens 2 Teilnehmer';
    case 'groups': {
      if (!GROUP_LAYOUTS[`${sys.groups}-${sys.advance}`]) return 'diese Gruppeneinteilung ist nicht möglich';
      const min = Math.min(...groupSizes(n, sys.groups));
      if (min < sys.advance + 1) return `mindestens ${sys.groups * (sys.advance + 1)} Teilnehmer`;
      return null;
    }
    case 'koall': return [4, 8, 16, 32].includes(n) ? null : 'nur bei 4, 8, 16 oder 32 Teilnehmern';
    case 'swiss': {
      if (n < 4) return 'mindestens 4 Teilnehmer';
      if (!(sys.swissRounds >= 1 && sys.swissRounds <= n - 1)) return `1 bis ${n - 1} Runden möglich`;
      return null;
    }
    case 'ko': return n >= 2 ? null : 'mindestens 2 Teilnehmer';
    default: return 'unbekannt';
  }
}

export function minutesFor(matches, tables, duration) {
  return Math.ceil(matches / Math.max(1, tables)) * duration;
}

// Liefert alle Systeme mit Spielanzahl, Dauer und ob es in die Zeit passt, plus Empfehlung.
export function planOptions(n, tables, duration, available, prefs = {}) {
  const slots = Math.floor(available / duration) * Math.max(1, tables);
  const perRound = Math.max(1, Math.floor(n / 2));
  const fitRounds = Math.max(1, Math.min(n - 1, Math.floor(slots / perRound)));
  const dg = defaultGroups(n);
  const defs = {
    rr: { type: 'rr' },
    groups: { type: 'groups', groups: prefs.groups || dg.groups, advance: prefs.advance || dg.advance, thirdPlace: prefs.thirdPlace ?? true },
    koall: { type: 'koall' },
    swiss: { type: 'swiss', swissRounds: prefs.swissRounds || fitRounds },
    ko: { type: 'ko', thirdPlace: prefs.thirdPlace ?? true },
  };
  const list = Object.keys(SYSTEMS).map((type) => {
    const sys = defs[type];
    const reason = systemAvailable(n, sys);
    const matches = reason ? 0 : countMatches(n, sys);
    const minutes = reason ? 0 : minutesFor(matches, tables, duration);
    return { type, label: SYSTEMS[type], sys, reason, matches, minutes, fits: !reason && minutes <= available };
  });
  const by = Object.fromEntries(list.map((o) => [o.type, o]));
  // Empfehlung: möglichst viele Spiele pro Person, die in die Zeit passen
  const swissAuto = { type: 'swiss', swissRounds: fitRounds };
  const swissAutoOk = !systemAvailable(n, swissAuto) && fitRounds >= 3 && minutesFor(countMatches(n, swissAuto), tables, duration) <= available;
  let recommended = 'ko';
  if (by.rr.fits) recommended = 'rr';
  else if (by.groups.fits) recommended = 'groups';
  else if (by.koall.fits) recommended = 'koall';
  else if (swissAutoOk) recommended = 'swiss';
  return { list, recommended, fitRounds };
}

// ---------- Erstellen ----------

function newMatch(t, props) {
  t.seq = (t.seq || 0) + 1;
  return {
    id: 'm' + t.seq,
    no: 0,
    order: 0,
    stage: 'rr',
    round: 1,
    group: null,
    label: '',
    a: null,
    b: null,
    status: 'offen',
    result: null,
    reportedBy: null,
    reportedName: null,
    table: null,
    skips: 0,
    place: null,
    log: [],
    ...props,
  };
}

function rrRounds(ids) {
  const list = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// Reihenfolge so wählen, dass möglichst niemand zwei Spiele direkt hintereinander hat.
function orderWithRest(matches, tables) {
  const rest = [...matches];
  const out = [];
  const look = Math.max(4, tables * 3);
  while (rest.length) {
    const recent = new Set();
    out.slice(-Math.max(1, tables)).forEach((m) => { recent.add(m.a.entry); recent.add(m.b.entry); });
    let pick = 0;
    for (let i = 0; i < Math.min(look, rest.length); i++) {
      if (!recent.has(rest[i].a.entry) && !recent.has(rest[i].b.entry)) { pick = i; break; }
    }
    out.push(rest.splice(pick, 1)[0]);
  }
  return out;
}

function buildKO(t, slots, thirdPlace, stage = 'ko') {
  const created = [];
  let cur = slots;
  let round = 1;
  let semis = null;
  while (cur.length > 1) {
    const next = [];
    const roundMatches = [];
    for (let i = 0; i < cur.length; i += 2) {
      const m = newMatch(t, { stage, round, a: cur[i], b: cur[i + 1], label: koRoundName(cur.length) });
      roundMatches.push(m);
      next.push({ winnerOf: m.id });
    }
    if (cur.length === 4) semis = roundMatches;
    created.push(...roundMatches);
    cur = next;
    round++;
  }
  const final = created[created.length - 1];
  final.place = 1;
  if (thirdPlace && semis) {
    const p3 = newMatch(t, { stage, round: final.round, a: { loserOf: semis[0].id }, b: { loserOf: semis[1].id }, label: 'Spiel um Platz 3', place: 3 });
    created.splice(created.length - 1, 0, p3);
  }
  return created;
}

function buildPlacement(t, refs, offset, round, out) {
  const n = refs.length;
  if (n === 2) {
    out.push(newMatch(t, { stage: 'platz', round, offset, a: refs[0], b: refs[1], label: offset === 0 ? 'Finale' : `Spiel um Platz ${offset + 1}`, place: offset + 1 }));
    return;
  }
  const winners = [], losers = [];
  for (let i = 0; i < n; i += 2) {
    const m = newMatch(t, { stage: 'platz', round, offset, a: refs[i], b: refs[i + 1], label: offset === 0 ? koRoundName(n) : `Platzierung ${offset + 1}–${offset + n}` });
    out.push(m);
    winners.push({ winnerOf: m.id });
    losers.push({ loserOf: m.id });
  }
  buildPlacement(t, winners, offset, round + 1, out);
  buildPlacement(t, losers, offset + n / 2, round + 1, out);
}

const GROUP_SLOTS = {
  '2-1': [['A', 1], ['B', 1]],
  '2-2': [['A', 1], ['B', 2], ['B', 1], ['A', 2]],
  '4-1': [['A', 1], ['B', 1], ['C', 1], ['D', 1]],
  '4-2': [['A', 1], ['B', 2], ['C', 1], ['D', 2], ['B', 1], ['A', 2], ['D', 1], ['C', 2]],
};

function assignOrder(t, matches) {
  for (const m of matches) {
    t.nextOrder = (t.nextOrder || 0) + 1;
    m.order = t.nextOrder;
    m.no = t.nextOrder;
  }
}

// cfg: {name, sport, rules, entries:[[names]], tables, durationMin, availableMin, system}
export function createTournament(cfg, rng = Math.random, now = Date.now()) {
  const n = cfg.entries.length;
  const sys = { ...cfg.system };
  const reason = systemAvailable(n, sys);
  if (reason) throw new Error(`${SYSTEMS[sys.type]} ist hier nicht möglich: ${reason}.`);
  const t = {
    id: randomId(10, rng),
    v: 1,
    name: cfg.name,
    sport: cfg.sport,
    rules: { ...cfg.rules },
    tables: cfg.tables,
    durationMin: cfg.durationMin,
    availableMin: cfg.availableMin,
    system: sys,
    createdAt: now,
    archived: false,
    seq: 0,
    nextOrder: 0,
    entries: [],
    groups: [],
    matches: [],
    swissRound: 0,
  };
  const drawn = shuffle(cfg.entries.map((names, i) => ({ id: 'e' + (i + 1), names: names.map((x) => x.trim()) })), rng);
  drawn.forEach((e, i) => { e.draw = i + 1; });
  t.entries = [...drawn].sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)));
  const ids = drawn.map((e) => e.id);

  if (sys.type === 'rr') {
    const all = rrRounds(ids).flatMap((pairs, r) => pairs.map(([a, b]) => newMatch(t, { stage: 'rr', round: r + 1, a: { entry: a }, b: { entry: b }, label: `Runde ${r + 1}` })));
    const ordered = orderWithRest(all, t.tables);
    assignOrder(t, ordered);
    t.matches = ordered;
  } else if (sys.type === 'groups') {
    const names = 'ABCDEFGH'.slice(0, sys.groups).split('');
    t.groups = names.map((g) => ({ name: g, entryIds: [] }));
    ids.forEach((id, i) => t.groups[i % sys.groups].entryIds.push(id));
    const perGroup = t.groups.map((g) => rrRounds(g.entryIds));
    const maxR = Math.max(...perGroup.map((r) => r.length));
    const all = [];
    for (let r = 0; r < maxR; r++) {
      t.groups.forEach((g, gi) => {
        (perGroup[gi][r] || []).forEach(([a, b]) => all.push(newMatch(t, { stage: 'gruppe', group: g.name, round: r + 1, a: { entry: a }, b: { entry: b }, label: `Gruppe ${g.name} · Runde ${r + 1}` })));
      });
    }
    const ordered = orderWithRest(all, t.tables);
    const slots = GROUP_SLOTS[`${sys.groups}-${sys.advance}`].map(([g, p]) => ({ group: g, place: p }));
    const ko = buildKO(t, slots, sys.thirdPlace);
    assignOrder(t, [...ordered, ...ko]);
    t.matches = [...ordered, ...ko];
  } else if (sys.type === 'ko') {
    const S = nextPow2(n);
    const pairsCount = S / 2;
    const byes = S - n;
    const byePairs = new Set(bitReversedOrder(pairsCount).slice(0, byes));
    const slots = [];
    let k = 0;
    for (let p = 0; p < pairsCount; p++) {
      slots.push({ entry: ids[k++] });
      if (byePairs.has(p)) slots.push({ bye: true });
      else slots.push({ entry: ids[k++] });
    }
    const ko = buildKO(t, slots, sys.thirdPlace && n >= 4);
    assignOrder(t, ko);
    t.matches = ko;
  } else if (sys.type === 'koall') {
    const out = [];
    buildPlacement(t, ids.map((id) => ({ entry: id })), 0, 1, out);
    const sorted = out.map((m, i) => ({ m, i })).sort((x, y) => x.m.round - y.m.round || y.m.offset - x.m.offset || x.i - y.i).map((x) => x.m);
    assignOrder(t, sorted);
    t.matches = sorted;
  } else if (sys.type === 'swiss') {
    swissNextRound(t);
  }
  normalize(t);
  return t;
}

// ---------- Auswertung ----------

export function analyze(t) {
  const byId = new Map(t.matches.map((m) => [m.id, m]));
  const stateCache = new Map();
  const groupCache = new Map();

  function sideEntry(ref) {
    if (!ref) return null;
    if (ref.entry) return ref.entry;
    if (ref.bye) return BYE;
    if (ref.winnerOf || ref.loserOf) {
      const src = byId.get(ref.winnerOf || ref.loserOf);
      if (!src) return null;
      const s = state(src);
      if (!s.done) return null;
      return ref.winnerOf ? s.winnerEntry : s.loserEntry;
    }
    if (ref.group) {
      if (!groupComplete(ref.group)) return null;
      const row = groupTable(ref.group)[ref.place - 1];
      return row ? row.entry : BYE;
    }
    return null;
  }

  function state(m) {
    if (stateCache.has(m.id)) return stateCache.get(m.id);
    const a = sideEntry(m.a), b = sideEntry(m.b);
    let s;
    if (a === BYE || b === BYE) {
      if (a === null || b === null) s = { a, b, done: false, auto: true, ready: false };
      else {
        const winSide = a === BYE ? 'b' : 'a';
        const winnerEntry = winSide === 'a' ? a : b;
        s = { a, b, done: true, auto: true, ready: false, winSide, winnerEntry, loserEntry: BYE };
      }
    } else if (m.status === 'fertig' && m.result) {
      const winSide = m.result.winner;
      s = { a, b, done: true, auto: false, ready: false, winSide, winnerEntry: winSide === 'a' ? a : b, loserEntry: winSide === 'a' ? b : a };
    } else {
      s = { a, b, done: false, auto: false, ready: !!(a && b) };
    }
    stateCache.set(m.id, s);
    return s;
  }

  function groupMatches(g) { return t.matches.filter((m) => m.group === g); }
  function groupComplete(g) { return groupMatches(g).every((m) => m.status === 'fertig'); }
  function groupTable(g) {
    if (groupCache.has(g)) return groupCache.get(g);
    const grp = t.groups.find((x) => x.name === g);
    const rows = standings(t, grp ? grp.entryIds : [], groupMatches(g), state);
    groupCache.set(g, rows);
    return rows;
  }

  return { state, groupComplete, groupTable, byId };
}

export function standings(t, entryIds, matches, state) {
  const rows = new Map(entryIds.map((id) => [id, { entry: id, played: 0, wins: 0, losses: 0, setsW: 0, setsL: 0, ptsW: 0, ptsL: 0, byes: 0 }]));
  const done = [];
  for (const m of matches) {
    const s = state(m);
    if (!s.done) continue;
    if (s.auto) {
      const r = rows.get(s.winnerEntry);
      if (r && m.stage === 'swiss') { r.played++; r.wins++; r.byes++; }
      continue;
    }
    const ra = rows.get(s.a), rb = rows.get(s.b);
    if (!ra || !rb) continue;
    done.push({ m, s });
    ra.played++; rb.played++;
    const res = m.result;
    if (res.winner === 'a') { ra.wins++; rb.losses++; } else { rb.wins++; ra.losses++; }
    if (res.setsA != null) { ra.setsW += res.setsA; ra.setsL += res.setsB; rb.setsW += res.setsB; rb.setsL += res.setsA; }
    if (res.sets) for (const x of res.sets) { ra.ptsW += x.a; ra.ptsL += x.b; rb.ptsW += x.b; rb.ptsL += x.a; }
  }
  const draw = new Map(t.entries.map((e) => [e.id, e.draw || 0]));
  const key = (r) => [r.wins, r.setsW - r.setsL, r.ptsW - r.ptsL];
  const list = [...rows.values()].sort((x, y) => {
    const kx = key(x), ky = key(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return ky[i] - kx[i];
    return 0;
  });
  // Direkter Vergleich innerhalb gleichstehender Blöcke, danach Los (Auslosungsreihenfolge)
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i + 1;
    while (j < list.length && key(list[j]).every((v, k) => v === key(list[i])[k])) j++;
    const block = list.slice(i, j);
    if (block.length > 1) {
      const ids = new Set(block.map((r) => r.entry));
      const h2h = new Map(block.map((r) => [r.entry, 0]));
      for (const { m, s } of done) {
        if (ids.has(s.a) && ids.has(s.b)) h2h.set(s.winnerEntry, h2h.get(s.winnerEntry) + 1);
      }
      block.sort((x, y) => h2h.get(y.entry) - h2h.get(x.entry) || draw.get(x.entry) - draw.get(y.entry));
      block.forEach((r) => { r.h2h = h2h.get(r.entry); });
    }
    out.push(...block);
    i = j;
  }
  out.forEach((r, i) => { r.rank = i + 1; });
  return out;
}

// ---------- Schweizer System ----------

function swissNextRound(t) {
  const view = analyze(t);
  const swiss = t.matches.filter((m) => m.stage === 'swiss');
  const ids = t.entries.map((e) => e.id);
  const round = (t.swissRound || 0) + 1;
  let order;
  if (round === 1) order = [...t.entries].sort((x, y) => x.draw - y.draw).map((e) => e.id);
  else order = standings(t, ids, swiss, view.state).map((r) => r.entry);
  const played = new Map(ids.map((id) => [id, new Set()]));
  const hadBye = new Set();
  for (const m of swiss) {
    const a = m.a.entry, b = m.b.bye ? null : m.b.entry;
    if (b) { played.get(a).add(b); played.get(b).add(a); } else hadBye.add(a);
  }
  const created = [];
  let pool = [...order];
  if (pool.length % 2) {
    let idx = pool.length - 1;
    while (idx >= 0 && hadBye.has(pool[idx])) idx--;
    if (idx < 0) idx = pool.length - 1;
    const byeId = pool.splice(idx, 1)[0];
    created.push(newMatch(t, { stage: 'swiss', round, a: { entry: byeId }, b: { bye: true }, label: `Runde ${round}` }));
  }
  let steps = 0;
  function pairUp(list) {
    if (!list.length) return [];
    if (++steps > 200000) return null;
    const [p, ...rest] = list;
    for (let i = 0; i < rest.length; i++) {
      if (played.get(p).has(rest[i])) continue;
      const sub = pairUp(rest.filter((_, k) => k !== i));
      if (sub) return [[p, rest[i]], ...sub];
    }
    return null;
  }
  let pairs = pairUp(pool);
  if (!pairs) { // keine Lösung ohne Wiederholung: der Reihe nach paaren
    pairs = [];
    for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
  }
  const real = pairs.map(([a, b]) => newMatch(t, { stage: 'swiss', round, a: { entry: a }, b: { entry: b }, label: `Runde ${round}` }));
  const all = [...real, ...created];
  assignOrder(t, all);
  t.matches.push(...all);
  t.swissRound = round;
}

// ---------- Nach jeder Änderung ----------

export function normalize(t) {
  // Schweizer System: nächste Runde, sobald die aktuelle fertig ist
  if (t.system.type === 'swiss') {
    for (;;) {
      const v = analyze(t);
      const cur = t.matches.filter((m) => m.stage === 'swiss' && m.round === t.swissRound);
      if (t.swissRound >= t.system.swissRounds || !cur.every((m) => v.state(m).done)) break;
      swissNextRound(t);
    }
  }
  const view = analyze(t);
  const T = Math.max(1, t.tables || 1);
  const busy = new Set();
  const used = new Set();
  for (const m of t.matches) {
    if (m.table == null) continue;
    const s = view.state(m);
    if (m.status !== 'offen' || !s.ready || m.table > T || used.has(m.table) || busy.has(s.a) || busy.has(s.b)) { m.table = null; continue; }
    used.add(m.table); busy.add(s.a); busy.add(s.b);
  }
  const queue = t.matches.filter((m) => m.status === 'offen' && m.table == null && view.state(m).ready).sort((x, y) => x.order - y.order);
  for (let tab = 1; tab <= T; tab++) {
    if (used.has(tab)) continue;
    const m = queue.find((x) => x.table == null && !busy.has(view.state(x).a) && !busy.has(view.state(x).b));
    if (!m) break;
    m.table = tab;
    used.add(tab);
    busy.add(view.state(m).a); busy.add(view.state(m).b);
  }
  return t;
}

// ---------- Fortschritt, Warteschlange, Rangliste ----------

export function progress(t, view = analyze(t)) {
  // Freilos-Spiele (automatisch) zählen nicht als Spiel
  const counted = t.matches.filter((m) => !view.state(m).auto);
  const done = counted.filter((m) => m.status === 'fertig').length;
  let total = counted.length;
  // Schweizer System: künftige Runden mitzählen
  if (t.system.type === 'swiss') total += Math.max(0, t.system.swissRounds - t.swissRound) * Math.floor(t.entries.length / 2);
  const allDone = t.matches.every((m) => view.state(m).done) && (t.system.type !== 'swiss' || t.swissRound >= t.system.swissRounds);
  return { done, total, finished: total > 0 && allDone };
}

export function queue(t, view = analyze(t)) {
  const onTable = t.matches.filter((m) => m.table != null).sort((x, y) => x.table - y.table);
  const waiting = t.matches.filter((m) => m.status === 'offen' && m.table == null && view.state(m).ready).sort((x, y) => x.order - y.order);
  const later = t.matches.filter((m) => m.status === 'offen' && !view.state(m).done && !view.state(m).ready && !view.state(m).auto).sort((x, y) => x.order - y.order);
  return { onTable, waiting, later };
}

export function remainingMinutes(t, view = analyze(t)) {
  const p = progress(t, view);
  const open = Math.max(0, p.total - p.done);
  return minutesFor(open, t.tables, t.durationMin);
}

function koLoserPlaces(t, view, matches) {
  // Verlierer einer KO-Runde mit k Startplätzen belegen gemeinsam die Plätze k/2+1 bis k
  const out = [];
  const rounds = [...new Set(matches.filter((m) => !m.place).map((m) => m.round))];
  for (const r of rounds) {
    const ms = matches.filter((m) => m.round === r && !m.place);
    const realLosers = ms.filter((m) => { const s = view.state(m); return !s.auto && !(s.a === BYE || s.b === BYE); }).length;
    const from = ms.length + 1, to = ms.length + realLosers;
    for (const m of ms) {
      const s = view.state(m);
      if (!s.done || s.loserEntry === BYE) continue;
      out.push({ entry: s.loserEntry, place: from === to ? `${from}` : `${from}–${to}`, sort: from });
    }
  }
  return out;
}

export function finalRanking(t, view = analyze(t)) {
  const type = t.system.type;
  const ids = t.entries.map((e) => e.id);
  if (type === 'rr' || type === 'swiss') {
    const stage = type === 'rr' ? 'rr' : 'swiss';
    return standings(t, ids, t.matches.filter((m) => m.stage === stage), view.state).map((r) => ({ entry: r.entry, place: `${r.rank}`, sort: r.rank, row: r }));
  }
  const out = [];
  const placed = new Set();
  const add = (entry, place, sort) => { if (entry && entry !== BYE && !placed.has(entry)) { placed.add(entry); out.push({ entry, place, sort }); } };
  const koMatches = t.matches.filter((m) => m.stage === 'ko' || m.stage === 'platz');
  for (const m of koMatches.filter((x) => x.place)) {
    const s = view.state(m);
    if (!s.done) continue;
    add(s.winnerEntry, `${m.place}`, m.place);
    add(s.loserEntry, `${m.place + 1}`, m.place + 1);
  }
  if (type === 'ko' || type === 'groups') {
    const final = koMatches.find((m) => m.place === 1);
    const hasP3 = koMatches.some((m) => m.place === 3);
    if (!hasP3) {
      const semis = koMatches.filter((m) => m.label === 'Halbfinale');
      for (const m of semis) { const s = view.state(m); if (s.done) add(s.loserEntry, '3', 3); }
    }
    for (const x of koLoserPlaces(t, view, koMatches.filter((m) => m !== final && m.label !== 'Halbfinale'))) add(x.entry, x.place, x.sort);
  }
  if (type === 'groups') {
    const q = t.system.groups * t.system.advance;
    const rest = [];
    for (const g of t.groups) {
      if (!view.groupComplete(g.name)) continue;
      view.groupTable(g.name).forEach((r) => { if (r.rank > t.system.advance) rest.push(r); });
    }
    const draw = new Map(t.entries.map((e) => [e.id, e.draw]));
    rest.sort((x, y) => x.rank - y.rank || y.wins - x.wins || (y.setsW - y.setsL) - (x.setsW - x.setsL) || (y.ptsW - y.ptsL) - (x.ptsW - x.ptsL) || draw.get(x.entry) - draw.get(y.entry));
    rest.forEach((r, i) => add(r.entry, `${q + i + 1}`, q + i + 1));
  }
  return out.sort((x, y) => x.sort - y.sort);
}

// ---------- Aktionen ----------

function sideOf(view, m, entryId) {
  if (!entryId) return null;
  const s = view.state(m);
  if (s.a === entryId) return 'a';
  if (s.b === entryId) return 'b';
  return null;
}

export function entryOfName(t, name) {
  if (!name) return null;
  const e = t.entries.find((x) => x.names.some((n) => n.toLowerCase() === name.toLowerCase()));
  return e ? e.id : null;
}

function getMatch(t, id) {
  const m = t.matches.find((x) => x.id === id);
  if (!m) throw new Error('Dieses Spiel gibt es nicht mehr.');
  return m;
}

function addLog(m, actor, text, now) {
  m.log.push({ at: now, by: actor.name || (actor.admin ? 'Admin' : '?'), text });
}

// Spiele, die (direkt oder indirekt) von diesem Spiel abhängen
export function dependents(t, id) {
  const m0 = t.matches.find((x) => x.id === id);
  const out = new Set();
  const stack = [m0];
  while (stack.length) {
    const cur = stack.pop();
    for (const m of t.matches) {
      if (out.has(m)) continue;
      const refs = [m.a, m.b];
      const hit = refs.some((r) => r && ((r.winnerOf && r.winnerOf === cur.id) || (r.loserOf && r.loserOf === cur.id) || (r.group && cur.stage === 'gruppe' && r.group === cur.group)));
      if (hit) { out.add(m); stack.push(m); }
    }
  }
  return [...out];
}

export function blockingDependents(t, id) {
  return dependents(t, id).filter((m) => m.status !== 'offen');
}

function resetMatch(m, actor, now, why) {
  m.status = 'offen';
  m.result = null;
  m.reportedBy = null;
  m.reportedName = null;
  addLog(m, actor, why, now);
}

// actor: {name, admin:boolean}
export function reportResult(t, id, input, actor, opts = {}, now = Date.now()) {
  const view = analyze(t);
  const m = getMatch(t, id);
  const s = view.state(m);
  if (s.auto) throw new Error('Bei einem Freilos gibt es kein Ergebnis.');
  if (!s.a || !s.b) throw new Error('Die Gegner stehen noch nicht fest.');
  const side = sideOf(view, m, entryOfName(t, actor.name));
  if (!actor.admin) {
    if (!side) throw new Error('Ergebnisse können nur die beiden Spieler oder ein Admin eintragen.');
    if (m.status === 'fertig') throw new Error('Das Ergebnis ist schon bestätigt. Änderungen nur durch den Admin.');
    if (m.status === 'strittig') throw new Error('Das Ergebnis wurde abgelehnt und liegt beim Admin.');
    if (m.status === 'gemeldet' && m.reportedBy !== side) throw new Error('Dein Gegner hat schon ein Ergebnis eingetragen. Bitte bestätigen oder ablehnen.');
  }
  const v = validateResult(t.rules, input);
  if (!v.ok) throw new Error(v.error);
  if (input.kind === 'kampflos' && !actor.admin) throw new Error('Kampflos werten darf nur der Admin.');
  const blocking = blockingDependents(t, id);
  if (m.status === 'fertig' && blocking.length) {
    if (!opts.force) { const e = new Error('Folgespiele haben schon Ergebnisse.'); e.code = 'DEPENDENTS'; e.matches = blocking.map((x) => x.no); throw e; }
    for (const d of blocking) resetMatch(d, actor, now, `Ergebnis zurückgesetzt, weil Spiel ${m.no} geändert wurde`);
  }
  const before = m.status === 'fertig' ? resultText(m.result) : null;
  m.result = v.result;
  m.table = null;
  if (actor.admin) {
    m.status = 'fertig';
    m.reportedBy = side;
    m.reportedName = actor.name || 'Admin';
    addLog(m, actor, before ? `Ergebnis geändert von ${before} auf ${resultText(v.result)} (Admin)` : `Ergebnis ${resultText(v.result)} eingetragen (Admin)`, now);
  } else {
    m.status = 'gemeldet';
    m.reportedBy = side;
    m.reportedName = actor.name;
    addLog(m, actor, `Ergebnis ${resultText(v.result)} eingetragen, wartet auf Bestätigung`, now);
  }
  normalize(t);
  return t;
}

export function confirmResult(t, id, actor, now = Date.now()) {
  const view = analyze(t);
  const m = getMatch(t, id);
  if (m.status !== 'gemeldet') throw new Error('Hier wartet kein Ergebnis auf Bestätigung.');
  const side = sideOf(view, m, entryOfName(t, actor.name));
  if (!side || side === m.reportedBy) throw new Error('Bestätigen kann nur der Gegner.');
  m.status = 'fertig';
  addLog(m, actor, `Ergebnis ${resultText(m.result)} bestätigt`, now);
  normalize(t);
  return t;
}

export function rejectResult(t, id, actor, now = Date.now()) {
  const view = analyze(t);
  const m = getMatch(t, id);
  if (m.status !== 'gemeldet') throw new Error('Hier wartet kein Ergebnis auf Bestätigung.');
  const side = sideOf(view, m, entryOfName(t, actor.name));
  if (!side || side === m.reportedBy) throw new Error('Ablehnen kann nur der Gegner.');
  m.status = 'strittig';
  addLog(m, actor, `Ergebnis ${resultText(m.result)} abgelehnt – entscheidet der Admin`, now);
  normalize(t);
  return t;
}

export function resetResult(t, id, actor, opts = {}, now = Date.now()) {
  if (!actor.admin) throw new Error('Zurücksetzen darf nur der Admin.');
  const m = getMatch(t, id);
  const blocking = blockingDependents(t, id);
  if (blocking.length) {
    if (!opts.force) { const e = new Error('Folgespiele haben schon Ergebnisse.'); e.code = 'DEPENDENTS'; e.matches = blocking.map((x) => x.no); throw e; }
    for (const d of blocking) resetMatch(d, actor, now, `Ergebnis zurückgesetzt, weil Spiel ${m.no} zurückgesetzt wurde`);
  }
  resetMatch(m, actor, now, 'Ergebnis zurückgesetzt (Admin)');
  normalize(t);
  return t;
}

export function skipMatch(t, id, actor, now = Date.now()) {
  const view = analyze(t);
  const m = getMatch(t, id);
  if (m.status !== 'offen' || view.state(m).done) throw new Error('Nur offene Spiele können übersprungen werden.');
  if (!view.state(m).ready) throw new Error('Die Gegner stehen noch nicht fest.');
  if (!actor.admin && !sideOf(view, m, entryOfName(t, actor.name))) throw new Error('Überspringen können die beiden Spieler oder ein Admin.');
  t.nextOrder = (t.nextOrder || 0) + 1;
  m.order = t.nextOrder;
  m.table = null;
  m.skips = (m.skips || 0) + 1;
  addLog(m, actor, 'Übersprungen, wird später nachgeholt', now);
  // Damit das übersprungene Spiel nicht sofort wieder auf denselben Tisch kommt,
  // werden zuerst die anderen Spiele verteilt.
  normalize(t);
  return t;
}

export function setTables(t, n, actor) {
  if (!actor.admin) throw new Error('Nur der Admin kann die Tische ändern.');
  const k = Math.round(Number(n));
  if (!(k >= 1 && k <= 20)) throw new Error('Bitte 1 bis 20 Tische angeben.');
  t.tables = k;
  normalize(t);
  return t;
}

export function setDuration(t, min, actor) {
  if (!actor.admin) throw new Error('Nur der Admin kann die Spieldauer ändern.');
  const k = Math.round(Number(min));
  if (!(k >= 1 && k <= 300)) throw new Error('Bitte eine Spieldauer zwischen 1 und 300 Minuten angeben.');
  t.durationMin = k;
  return t;
}

export function renameEntryName(t, entryId, idx, newName, actor) {
  if (!actor.admin) throw new Error('Nur der Admin kann Namen ändern.');
  const name = String(newName || '').trim();
  if (!name) throw new Error('Der Name darf nicht leer sein.');
  const clash = t.entries.some((e) => e.names.some((n, i) => n.toLowerCase() === name.toLowerCase() && !(e.id === entryId && i === idx)));
  if (clash) throw new Error(`Den Namen „${name}“ gibt es schon.`);
  const e = t.entries.find((x) => x.id === entryId);
  if (!e || idx < 0 || idx >= e.names.length) throw new Error('Teilnehmer nicht gefunden.');
  e.names[idx] = name;
  return t;
}

// Prüft die Teilnehmerliste vor dem Erstellen
export function validateEntries(entries, format) {
  const per = format === 'doppel' ? 2 : 1;
  const seen = new Set();
  for (const e of entries) {
    if (e.length !== per || e.some((n) => !String(n).trim())) return format === 'doppel' ? 'Jedes Doppel braucht zwei Namen.' : 'Bitte keine leeren Namen.';
    for (const n of e) {
      const k = n.trim().toLowerCase();
      if (seen.has(k)) return `Der Name „${n.trim()}“ kommt doppelt vor. Jeder Name muss eindeutig sein.`;
      seen.add(k);
    }
  }
  if (entries.length < 2) return format === 'doppel' ? 'Bitte mindestens 2 Doppel eintragen.' : 'Bitte mindestens 2 Teilnehmer eintragen.';
  return null;
}
