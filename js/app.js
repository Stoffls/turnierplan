// Turnierplan – Oberfläche
import * as L from './logic.js';
import { createStore } from './store.js';
import { FIREBASE_CONFIG } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return MEM[k] ?? null; } }
function lsSet(k, v) { MEM[k] = v; try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nur im Arbeitsspeicher */ } }
const MEM = {};

const S = {
  store: null,
  settings: { admins: [] },
  settingsLoaded: false,
  list: [],
  listLoaded: false,
  route: { name: 'home' },
  t: null,
  tMissing: false,
  tUnsub: null,
  tab: 'jetzt',
  mineOnly: false,
  wiz: null,
};

// ---------- Zeit & Zahlen ----------
function fmtMin(m) {
  m = Math.max(0, Math.round(m));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
function clock(ts) { const d = new Date(ts); return d.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }); }
function dateStr(ts) { return new Date(ts).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function intOrNull(v) { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isInteger(n) ? n : NaN; }

// ---------- Rollen ----------
function adminSession() {
  const a = lsGet('tp_admin');
  if (!a) return null;
  return S.settings.admins.find((x) => x.id === a.id && x.hash === a.hash) || null;
}
const isAdmin = () => !!adminSession();
function myName(t = S.t) { if (!t) return null; const v = lsGet('tp_me_' + t.id); return v && v !== '__zuschauer' ? v : null; }
function identityChosen(t = S.t) { return !!(t && lsGet('tp_me_' + t.id)); }
function myEntry(t = S.t) {
  const n = myName(t);
  return n ? L.entryOfName(t, n) : null;
}
function actor() {
  const a = adminSession();
  return { name: myName() || (a ? a.name : null), admin: !!a };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Meldungen ----------
let toastTimer = null;
function toast(msg, kind = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 6000 : 3000);
}

async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    console.error(e);
    toast(e && e.message ? e.message : 'Das hat nicht geklappt. Bitte nochmal versuchen.', 'err');
    return false;
  }
}

// ---------- Navigation ----------
function go(route) {
  if (S.tUnsub && !(route.name === 't' && S.route.name === 't' && route.id === S.route.id)) { S.tUnsub(); S.tUnsub = null; S.t = null; S.tMissing = false; }
  S.route = route;
  try {
    const h = route.name === 't' ? '#t-' + route.id : '';
    if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
  } catch (e) { /* in manchen Ansichten nicht erlaubt */ }
  if (route.name === 't' && !S.tUnsub) {
    S.tab = 'jetzt';
    S.tUnsub = S.store.subscribe(route.id, (t) => {
      S.t = t;
      S.tMissing = !t;
      render();
    }, onStoreError);
  }
  if (route.name === 'new') S.wiz = newWizard();
  closeModal();
  render();
  window.scrollTo(0, 0);
}

function routeFromHash() {
  const m = /^#t-([a-z0-9]+)$/.exec(location.hash || '');
  return m ? { name: 't', id: m[1] } : { name: 'home' };
}

function onStoreError(e) {
  console.error(e);
  const msg = e && e.code === 'permission-denied'
    ? 'Kein Zugriff auf die Datenbank. Bitte die Firestore-Regeln prüfen (siehe Anleitung).'
    : 'Keine Verbindung zur Datenbank. Bitte Internetverbindung prüfen.';
  toast(msg, 'err');
}

// ---------- Rendern ----------
function render() {
  const main = $('#main');
  $('#hdr-right').innerHTML = headerRight();
  if (S.route.name === 'home') main.innerHTML = viewHome();
  else if (S.route.name === 't') { main.innerHTML = viewTournament(); afterTournamentRender(); }
  else if (S.route.name === 'new') { if (!$('#wiz')) { main.innerHTML = viewWizard(); } renderWizParts(); }
  else if (S.route.name === 'settings') main.innerHTML = viewSettings();
}

function headerRight() {
  const a = adminSession();
  const demo = S.store && S.store.mode === 'demo' ? '<span class="pill demo" title="Daten nur auf diesem Gerät">Demo</span>' : '';
  if (a) return `${demo}<button class="chip admin" data-action="go-settings" type="button">Admin · ${esc(a.name)}</button>`;
  if (!S.settings.admins.length) return demo;
  return `${demo}<button class="chip" data-action="admin-login" type="button">Admin</button>`;
}

function viewHome() {
  const admin = isAdmin();
  const demoNote = S.store.mode === 'demo' ? `<div class="note">Demo-Modus: Alles wird nur auf diesem Gerät gespeichert. Admin „Stoffl“, PIN 1234. Für den echten Einsatz mit Handys kommt die Firebase-Anbindung dazu.</div>` : '';
  let first = '';
  if (S.settingsLoaded && !S.settings.admins.length) {
    first = `<section class="card hero-card"><h2>Willkommen</h2><p>Lege zuerst den Admin an. Der Admin erstellt Turniere und darf alle Ergebnisse ändern.</p><button class="btn primary" data-action="first-admin" type="button">Admin anlegen</button></section>`;
  }
  const items = S.list.map((t) => ({ t, view: L.analyze(t) })).map((x) => ({ ...x, pr: L.progress(x.t, x.view) }));
  const running = items.filter((x) => !x.pr.finished).sort((a, b) => b.t.createdAt - a.t.createdAt);
  const done = items.filter((x) => x.pr.finished).sort((a, b) => b.t.createdAt - a.t.createdAt);
  const card = ({ t, pr }) => `
    <button class="tcard" data-action="open-t" data-id="${esc(t.id)}" type="button">
      <span class="tcard-top"><span class="tcard-name">${esc(t.name)}</span><span class="pill ${pr.finished ? 'done' : 'live'}">${pr.finished ? 'Beendet' : 'Läuft'}</span></span>
      <span class="tcard-meta">${esc((L.SPORTS[t.sport] || L.SPORTS.eigene).label)} · ${esc(L.SYSTEMS[t.system.type])} · ${t.entries.length} ${t.rules.format === 'doppel' ? 'Doppel' : 'Teilnehmer'} · ${dateStr(t.createdAt)}</span>
      <span class="bar"><span style="width:${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%"></span></span>
      <span class="tcard-meta">${pr.done} von ${pr.total} Spielen</span>
    </button>`;
  const loading = !S.listLoaded ? '<p class="muted">Turniere werden geladen …</p>' : '';
  const empty = S.listLoaded && !items.length ? `<p class="muted">Noch kein Turnier angelegt.${admin ? '' : ' Der Admin legt Turniere an.'}</p>` : '';
  return `
    ${demoNote}
    ${first}
    ${admin ? '<div class="row-end"><button class="btn primary" data-action="new-t" type="button">+ Neues Turnier</button></div>' : ''}
    <h2 class="sec">Laufende Turniere</h2>
    ${loading}${empty}
    <div class="stack">${running.map(card).join('') || (S.listLoaded && items.length ? '<p class="muted">Gerade läuft kein Turnier.</p>' : '')}</div>
    ${done.length ? `<h2 class="sec">Abgeschlossen</h2><div class="stack">${done.map(card).join('')}</div>` : ''}
  `;
}

// ---------- Turnier ----------
function refLabel(t, ref, view) {
  if (!ref) return '?';
  if (ref.entry) return L.entryName(t, ref.entry);
  if (ref.bye) return 'Freilos';
  if (ref.group) return `${ref.place}. Gruppe ${ref.group}`;
  const src = view.byId.get(ref.winnerOf || ref.loserOf);
  return `${ref.winnerOf ? 'Sieger' : 'Verlierer'} Spiel ${src ? src.no : '?'}`;
}
function sideLabel(t, m, side, view) {
  const s = view.state(m);
  const e = side === 'a' ? s.a : s.b;
  if (e) return L.entryName(t, e);
  return refLabel(t, side === 'a' ? m.a : m.b, view);
}
function isPlaceholder(m, side, view) { const s = view.state(m); return !(side === 'a' ? s.a : s.b); }

function statusChip(m, view) {
  const s = view.state(m);
  if (s.auto) return s.done ? '<span class="pill done">Freilos</span>' : '<span class="pill">Freilos</span>';
  if (m.status === 'fertig') return '';
  if (m.status === 'gemeldet') return '<span class="pill wait">wartet auf Bestätigung</span>';
  if (m.status === 'strittig') return '<span class="pill bad">abgelehnt · Admin</span>';
  if (m.table != null) return `<span class="pill live">Tisch ${m.table}</span>`;
  if (m.skips) return `<span class="pill skip">übersprungen</span>`;
  return '';
}

function mySide(m, view, me) {
  if (!me) return null;
  const s = view.state(m);
  return s.a === me ? 'a' : s.b === me ? 'b' : null;
}

function matchLine(t, m, view, me, opts = {}) {
  const s = view.state(m);
  const res = m.result;
  const show = res && (m.status === 'fertig' || m.status === 'gemeldet' || m.status === 'strittig');
  const winA = s.done && s.winSide === 'a', winB = s.done && s.winSide === 'b';
  const mine = !!mySide(m, view, me);
  return `
    <button class="mline ${mine ? 'mine' : ''} ${s.done ? 'is-done' : ''}" data-action="open-m" data-id="${m.id}" type="button">
      <span class="mno">${m.no}</span>
      <span class="mbody">
        <span class="mlabel">${esc(opts.label ?? m.label)}</span>
        <span class="mplayers">
          <span class="${winA ? 'win' : ''} ${isPlaceholder(m, 'a', view) ? 'ph' : ''}">${esc(sideLabel(t, m, 'a', view))}</span>
          <span class="vs">–</span>
          <span class="${winB ? 'win' : ''} ${isPlaceholder(m, 'b', view) ? 'ph' : ''}">${esc(sideLabel(t, m, 'b', view))}</span>
        </span>
      </span>
      <span class="mres">${show && res.setsA != null ? `<span class="score">${res.setsA}:${res.setsB}</span>` : ''}${show && res.type === 'kampflos' ? '<span class="pill">kampflos</span>' : ''}${statusChip(m, view)}</span>
    </button>`;
}

function viewTournament() {
  if (S.tMissing) return `<button class="back" data-action="go-home" type="button">← Alle Turniere</button><div class="card"><p>Dieses Turnier gibt es nicht (mehr).</p></div>`;
  const t = S.t;
  if (!t) return '<p class="muted">Turnier wird geladen …</p>';
  const view = L.analyze(t);
  const pr = L.progress(t, view);
  const rem = L.remainingMinutes(t, view);
  const sport = (L.SPORTS[t.sport] || L.SPORTS.eigene).label;
  const tabs = [['jetzt', 'Jetzt'], ['plan', 'Spielplan'], ['tabelle', 'Tabelle'], ['info', 'Info']];
  let body = '';
  if (!identityChosen(t)) body = viewWhoAmI(t);
  else if (S.tab === 'jetzt') body = tabNow(t, view, pr);
  else if (S.tab === 'plan') body = tabPlan(t, view);
  else if (S.tab === 'tabelle') body = tabTable(t, view, pr);
  else body = tabInfo(t, view);
  const me = myName(t);
  return `
    <button class="back" data-action="go-home" type="button">← Alle Turniere</button>
    <header class="t-head">
      <p class="eyebrow">${esc(sport)} · ${esc(L.SYSTEMS[t.system.type])}${t.rules.format === 'doppel' ? ' · Doppel' : ''}</p>
      <h1>${esc(t.name)}</h1>
      <div class="bar big"><span style="width:${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%"></span></div>
      <p class="meta">${pr.finished ? 'Turnier beendet' : `${pr.done} von ${pr.total} Spielen · Restzeit ca. ${fmtMin(rem)} (bis ca. ${clock(Date.now() + rem * 60000)})`}</p>
      ${identityChosen(t) ? `<p class="who">${me ? `Du bist <strong>${esc(me)}</strong>` : 'Du schaust zu'} · <button class="link" data-action="change-me" type="button">ändern</button></p>` : ''}
    </header>
    ${identityChosen(t) ? `<nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" class="tab ${S.tab === k ? 'on' : ''}" data-action="tab" data-tab="${k}" type="button">${l}</button>`).join('')}</nav>` : ''}
    <div class="tab-body">${body}</div>`;
}

function viewWhoAmI(t) {
  const names = t.entries.flatMap((e) => e.names).sort((a, b) => a.localeCompare(b, 'de'));
  return `
    <section class="card">
      <h2>Wer bist du?</h2>
      <p class="muted">Wähle deinen Namen. Dann kannst du bei deinen Spielen das Ergebnis eintragen und bestätigen.</p>
      <div class="namegrid">${names.map((n) => `<button class="namebtn" data-action="set-me" data-name="${esc(n)}" type="button">${esc(n)}</button>`).join('')}</div>
      <button class="btn ghost" data-action="set-me" data-name="__zuschauer" type="button">Nur zuschauen</button>
    </section>`;
}

function tabNow(t, view, pr) {
  const me = myEntry(t);
  const admin = isAdmin();
  const q = L.queue(t, view);
  const out = [];
  if (pr.finished) {
    const rank = L.finalRanking(t, view);
    out.push(`<section class="card champion"><p class="eyebrow">Turnier beendet</p><h2>Sieger: ${esc(rank[0] ? L.entryName(t, rank[0].entry) : '–')}</h2>
      <ol class="podium">${rank.slice(0, 3).map((r) => `<li><span class="place">${esc(r.place)}.</span> ${esc(L.entryName(t, r.entry))}</li>`).join('')}</ol>
      <button class="btn ghost" data-action="tab" data-tab="tabelle" type="button">Ganze Rangliste</button></section>`);
  }
  // Bestätigungen für mich
  const toConfirm = t.matches.filter((m) => m.status === 'gemeldet' && mySide(m, view, me) && mySide(m, view, me) !== m.reportedBy);
  for (const m of toConfirm) {
    out.push(`<section class="card alert">
      <p class="eyebrow">Bitte bestätigen · Spiel ${m.no}</p>
      <p><strong>${esc(m.reportedName)}</strong> hat eingetragen:</p>
      <p class="bigscore">${esc(sideLabel(t, m, 'a', view))} <span>${esc(L.resultText(m.result))}</span> ${esc(sideLabel(t, m, 'b', view))}</p>
      <div class="btnrow"><button class="btn primary" data-action="confirm" data-id="${m.id}" type="button">Stimmt, bestätigen</button><button class="btn danger" data-action="reject" data-id="${m.id}" type="button">Stimmt nicht</button></div>
    </section>`);
  }
  if (admin) {
    for (const m of t.matches.filter((x) => x.status === 'strittig')) {
      out.push(`<section class="card alert bad">
        <p class="eyebrow">Ergebnis abgelehnt · Spiel ${m.no}</p>
        <p>${esc(sideLabel(t, m, 'a', view))} – ${esc(sideLabel(t, m, 'b', view))}: eingetragen ${esc(L.resultText(m.result))} von ${esc(m.reportedName)}. Bitte als Admin entscheiden.</p>
        <button class="btn primary" data-action="enter" data-id="${m.id}" type="button">Ergebnis festlegen</button>
      </section>`);
    }
  }
  // Am Tisch
  if (!pr.finished) {
    out.push(`<h2 class="sec">${t.tables > 1 ? 'An den Tischen' : 'Am Tisch'}</h2>`);
    if (!q.onTable.length) {
      const waitingConf = t.matches.filter((m) => m.status === 'gemeldet' || m.status === 'strittig').length;
      out.push(`<div class="card muted">${waitingConf ? 'Gerade ist kein Spiel bereit. Es fehlen noch Bestätigungen oder Entscheidungen des Admins.' : 'Gerade ist kein Spiel bereit.'}</div>`);
    }
    for (const m of q.onTable) {
      const side = mySide(m, view, me);
      out.push(`<section class="card table-card ${side ? 'mine' : ''}">
        <div class="table-top"><span class="tablenr">Tisch ${m.table}</span><span class="muted">Spiel ${m.no} · ${esc(m.label)}</span></div>
        ${side ? '<p class="you">Du spielst jetzt</p>' : ''}
        <div class="duel"><span>${esc(sideLabel(t, m, 'a', view))}</span><span class="vs">gegen</span><span>${esc(sideLabel(t, m, 'b', view))}</span></div>
        <div class="btnrow">
          ${side || admin ? `<button class="btn primary" data-action="enter" data-id="${m.id}" type="button">Ergebnis eintragen</button>` : ''}
          ${side || admin ? `<button class="btn ghost" data-action="skip" data-id="${m.id}" type="button">Spiel überspringen</button>` : ''}
        </div>
      </section>`);
    }
    // Warten auf Bestätigung (nicht meine)
    const pending = t.matches.filter((m) => (m.status === 'gemeldet' && !toConfirm.includes(m)) || (m.status === 'strittig' && !admin));
    if (pending.length) {
      out.push(`<h2 class="sec">Wartet auf Bestätigung</h2><div class="list">${pending.map((m) => matchLine(t, m, view, me)).join('')}</div>`);
    }
    if (q.waiting.length) {
      const myIdx = q.waiting.findIndex((m) => mySide(m, view, me));
      let hint = '';
      if (me && myIdx >= 0) {
        const mins = Math.ceil((myIdx + 1) / Math.max(1, t.tables)) * t.durationMin;
        hint = `<p class="hint">Dein nächstes Spiel ist Nummer ${myIdx + 1} in der Warteschlange, ca. in ${fmtMin(mins)}.</p>`;
      }
      out.push(`<h2 class="sec">Als Nächstes</h2>${hint}<div class="list">${q.waiting.slice(0, 6).map((m) => matchLine(t, m, view, me)).join('')}</div>`);
      if (q.waiting.length > 6) out.push(`<p class="muted small">… und ${q.waiting.length - 6} weitere im Spielplan.</p>`);
    }
    if (q.later.length) out.push(`<p class="muted small">Danach ${q.later.length === 1 ? 'folgt 1 Spiel' : `folgen ${q.later.length} Spiele`}, deren Gegner noch nicht feststehen.</p>`);
  }
  return out.join('');
}

function stageGroups(t) {
  const type = t.system.type;
  const ms = [...t.matches].sort((a, b) => a.no - b.no);
  if (type === 'groups') {
    return [['Gruppenphase', ms.filter((m) => m.stage === 'gruppe')], ['KO-Runde', ms.filter((m) => m.stage === 'ko')]];
  }
  const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((r) => {
    const list = ms.filter((m) => m.round === r);
    let title = `Runde ${r}`;
    if (type === 'ko' || type === 'koall') {
      const labels = [...new Set(list.map((m) => m.label))];
      title = labels.includes('Finale') ? 'Finalrunde' : labels.find((l) => !l.startsWith('Platzierung')) || `Runde ${r}`;
      if (type === 'koall') title = `Runde ${r}`;
    }
    return [title, list];
  });
}

function tabPlan(t, view) {
  const me = myEntry(t);
  const groups = stageGroups(t);
  const filt = (list) => (S.mineOnly && me ? list.filter((m) => mySide(m, view, me)) : list).filter((m) => !(view.state(m).auto && view.state(m).done && S.mineOnly));
  const swissNote = t.system.type === 'swiss' && t.swissRound < t.system.swissRounds ? `<p class="muted small">Runde ${t.swissRound + 1} von ${t.system.swissRounds} wird ausgelost, sobald Runde ${t.swissRound} fertig ist.</p>` : '';
  return `
    ${me ? `<div class="seg"><button class="${!S.mineOnly ? 'on' : ''}" data-action="mine" data-v="0" type="button">Alle Spiele</button><button class="${S.mineOnly ? 'on' : ''}" data-action="mine" data-v="1" type="button">Meine Spiele</button></div>` : ''}
    <p class="muted small">Tippe auf ein Spiel für Details, Ergebnis und Verlauf. Die Nummer bleibt fix, die Reihenfolge am Tisch kann sich durch Überspringen ändern.</p>
    ${groups.map(([title, list]) => { const l = filt(list); return l.length ? `<h2 class="sec">${esc(title)}</h2><div class="list">${l.map((m) => matchLine(t, m, view, me)).join('')}</div>` : ''; }).join('')}
    ${swissNote}`;
}

function standingsTable(t, rows, advance = 0) {
  const pts = t.rules.mode === 'punkte';
  const sets = t.rules.mode !== 'sieger';
  return `<div class="tablewrap"><table class="st">
    <thead><tr><th>Pl.</th><th class="l">Name</th><th>Sp</th><th>S</th><th>N</th>${sets ? '<th>Sätze</th>' : ''}${pts ? `<th>${esc(t.rules.unit || 'Punkte')}</th>` : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${advance && r.rank <= advance ? 'adv' : ''}"><td>${r.rank}</td><td class="l">${esc(L.entryName(t, r.entry))}</td><td>${r.played}</td><td><strong>${r.wins}</strong></td><td>${r.losses}</td>${sets ? `<td>${r.setsW}:${r.setsL}</td>` : ''}${pts ? `<td>${r.ptsW}:${r.ptsL}</td>` : ''}</tr>`).join('')}</tbody>
  </table></div>`;
}

function tabTable(t, view, pr) {
  const me = myEntry(t);
  const type = t.system.type;
  const parts = [];
  const tie = '<p class="muted small">Reihenfolge bei Gleichstand: Siege, Satzdifferenz, Punktdifferenz, direkter Vergleich, Los.</p>';
  if (type === 'groups') {
    for (const g of t.groups) {
      const rows = view.groupTable(g.name);
      parts.push(`<h2 class="sec">Gruppe ${esc(g.name)}${view.groupComplete(g.name) ? ' <span class="pill done">fertig</span>' : ''}</h2>${standingsTable(t, rows, t.system.advance)}`);
    }
    parts.push(`<p class="muted small">Markiert: kommt in die KO-Runde (${t.system.advance === 1 ? 'Gruppensieger' : 'Plätze 1 und 2'}).</p>${tie}`);
    parts.push(`<h2 class="sec">KO-Runde</h2><div class="list">${t.matches.filter((m) => m.stage === 'ko').sort((a, b) => a.no - b.no).map((m) => matchLine(t, m, view, me)).join('')}</div>`);
  } else if (type === 'rr' || type === 'swiss') {
    const rows = L.standings(t, t.entries.map((e) => e.id), t.matches.filter((m) => m.stage === type), view.state);
    parts.push(`<h2 class="sec">${pr.finished ? 'Endstand' : 'Zwischenstand'}</h2>${standingsTable(t, rows)}${tie}`);
    if (type === 'swiss') parts.push('<p class="muted small">Ein Freilos zählt als Sieg ohne Sätze.</p>');
  } else {
    for (const [title, list] of stageGroups(t)) {
      parts.push(`<h2 class="sec">${esc(title)}</h2><div class="list">${list.filter((m) => !(view.state(m).auto && view.state(m).done)).map((m) => matchLine(t, m, view, me)).join('') || '<p class="muted small">Nur Freilose in dieser Runde.</p>'}</div>`);
    }
  }
  if (type !== 'rr' && type !== 'swiss') {
    const rank = L.finalRanking(t, view);
    parts.push(`<h2 class="sec">${pr.finished ? 'Endstand' : 'Bisher feststehende Plätze'}</h2>${rank.length ? `<ol class="ranking">${rank.map((r) => `<li><span class="place">${esc(r.place)}.</span><span>${esc(L.entryName(t, r.entry))}</span></li>`).join('')}</ol>` : '<p class="muted small">Noch keine Platzierung fest.</p>'}`);
  }
  return parts.join('');
}

function tournamentLink(t) { return `${location.origin}${location.pathname}#t-${t.id}`; }

function tabInfo(t, view) {
  const admin = isAdmin();
  const sys = t.system;
  let sysText = L.SYSTEMS[sys.type];
  if (sys.type === 'groups') sysText += ` · ${sys.groups} Gruppen, ${sys.advance === 1 ? 'Gruppensieger' : 'die besten 2'} kommen weiter${sys.thirdPlace ? ' · mit Spiel um Platz 3' : ''}`;
  if (sys.type === 'ko') sysText += sys.thirdPlace ? ' · mit Spiel um Platz 3' : '';
  if (sys.type === 'swiss') sysText += ` · ${sys.swissRounds} Runden`;
  const groupOf = (id) => { const g = t.groups.find((x) => x.entryIds.includes(id)); return g ? ` · Gruppe ${g.name}` : ''; };
  const link = tournamentLink(t);
  return `
    <section class="card">
      <h2>Für die Spieler</h2>
      <p class="muted">QR-Code scannen oder Link schicken. Jeder wählt dann seinen Namen.</p>
      <div class="qrbox"><div id="qr" class="qr" aria-label="QR-Code zum Turnier"></div></div>
      <p class="linktext" id="tlink">${esc(link)}</p>
      <button class="btn ghost" data-action="copy-link" type="button">Link kopieren</button>
      ${S.store.mode === 'demo' ? '<p class="muted small">Im Demo-Modus funktioniert der Link nur auf diesem Gerät.</p>' : ''}
    </section>
    <section class="card">
      <h2>Regeln</h2>
      <dl class="facts">
        <dt>Wertung</dt><dd>${esc(L.ruleText(t.rules))}</dd>
        <dt>Eingabe</dt><dd>${esc(L.MODES[t.rules.mode])}</dd>
        <dt>System</dt><dd>${esc(sysText)}</dd>
        <dt>Tische</dt><dd>${t.tables}</dd>
        <dt>Spieldauer</dt><dd>ca. ${t.durationMin} min je Spiel</dd>
      </dl>
      ${admin ? `<div class="btnrow"><button class="btn ghost" data-action="edit-tables" type="button">Tische ändern</button><button class="btn ghost" data-action="edit-duration" type="button">Spieldauer ändern</button></div>` : ''}
    </section>
    <section class="card">
      <h2>${t.rules.format === 'doppel' ? 'Doppel' : 'Teilnehmer'} (${t.entries.length})</h2>
      <ul class="plain">${t.entries.map((e) => `<li>${esc(e.names.join(' / '))}<span class="muted">${groupOf(e.id)}</span></li>`).join('')}</ul>
      ${admin ? '<button class="btn ghost" data-action="rename" type="button">Namen ändern</button>' : ''}
    </section>
    ${admin ? `<section class="card"><h2>Turnier löschen</h2><p class="muted">Löscht das Turnier mit allen Ergebnissen für alle.</p><button class="btn danger" data-action="delete-t" type="button">Turnier löschen</button></section>` : ''}`;
}

let qrLoading = null;
function loadQR() {
  if (window.QRCode) return Promise.resolve();
  if (!qrLoading) {
    qrLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => res();
      s.onerror = () => { qrLoading = null; rej(new Error('QR-Code konnte nicht geladen werden.')); };
      document.head.appendChild(s);
    });
  }
  return qrLoading;
}

function afterTournamentRender() {
  const el = $('#qr');
  if (!el || !S.t) return;
  const link = tournamentLink(S.t);
  loadQR().then(() => {
    const target = $('#qr');
    if (!target || target.dataset.done === link) return;
    target.innerHTML = '';
    // eslint-disable-next-line no-undef
    new QRCode(target, { text: link, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    target.dataset.done = link;
  }).catch(() => { const t = $('#qr'); if (t) t.innerHTML = '<p class="muted small">QR-Code braucht Internet. Den Link unten kannst du trotzdem schicken.</p>'; });
}

// ---------- Spiel-Dialog ----------
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  document.body.classList.add('noscroll');
  const f = m.querySelector('input:not([type=hidden]), select');
  if (f && !f.dataset.nofocus) setTimeout(() => f.focus(), 30);
}
function closeModal() {
  const m = $('#modal');
  if (!m) return;
  m.hidden = true;
  m.innerHTML = '';
  document.body.classList.remove('noscroll');
}

function findM(id) { return S.t && S.t.matches.find((x) => x.id === id); }

function openMatch(id) {
  const t = S.t, m = findM(id);
  if (!m) return;
  const view = L.analyze(t);
  const s = view.state(m);
  const me = myEntry(t);
  const side = mySide(m, view, me);
  const admin = isAdmin();
  let status = 'Offen';
  if (s.auto) status = s.done ? `Freilos – ${L.entryName(t, s.winnerEntry)} kommt kampflos weiter` : 'Freilos';
  else if (m.status === 'fertig') status = 'Ergebnis bestätigt';
  else if (m.status === 'gemeldet') status = `Eingetragen von ${m.reportedName}, wartet auf Bestätigung`;
  else if (m.status === 'strittig') status = 'Ergebnis abgelehnt, entscheidet der Admin';
  else if (m.table != null) status = `Läuft gerade an Tisch ${m.table}`;
  else if (!s.ready) status = 'Gegner stehen noch nicht fest';
  else if (m.skips) status = `Wartet (${m.skips}× übersprungen)`;
  else status = 'Wartet auf einen freien Tisch';

  const canEnter = !s.auto && !!s.a && !!s.b && (admin || (side && (m.status === 'offen' || (m.status === 'gemeldet' && m.reportedBy === side))));
  const canConfirm = m.status === 'gemeldet' && side && side !== m.reportedBy;
  const canSkip = m.status === 'offen' && s.ready && (admin || side);
  const canReset = admin && !s.auto && m.status !== 'offen';
  const res = m.result ? `<p class="bigscore">${esc(L.resultText(m.result))}${m.result.winner ? ` <small>für ${esc(sideLabel(t, m, m.result.winner, view))}</small>` : ''}</p>` : '';
  openModal(`
    <div class="sheet-head"><h2>Spiel ${m.no}</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <p class="eyebrow">${esc(m.label)}</p>
    <div class="duel small"><span>${esc(sideLabel(t, m, 'a', view))}</span><span class="vs">gegen</span><span>${esc(sideLabel(t, m, 'b', view))}</span></div>
    <p class="status-line">${esc(status)}</p>
    ${res}
    <div class="btnrow wrap">
      ${canConfirm ? `<button class="btn primary" data-action="confirm" data-id="${m.id}" type="button">Bestätigen</button><button class="btn danger" data-action="reject" data-id="${m.id}" type="button">Ablehnen</button>` : ''}
      ${canEnter ? `<button class="btn ${canConfirm ? 'ghost' : 'primary'}" data-action="enter" data-id="${m.id}" type="button">${m.status === 'offen' ? 'Ergebnis eintragen' : 'Ergebnis ändern'}</button>` : ''}
      ${canSkip ? `<button class="btn ghost" data-action="skip" data-id="${m.id}" type="button">Überspringen</button>` : ''}
      ${canReset ? `<button class="btn ghost" data-action="reset" data-id="${m.id}" type="button">Zurücksetzen</button>` : ''}
    </div>
    ${!side && !admin && !s.auto && m.status !== 'fertig' ? '<p class="muted small">Eintragen können nur die beiden Spieler oder der Admin.</p>' : ''}
    ${m.log.length ? `<h3 class="sec small">Verlauf</h3><ul class="log">${[...m.log].reverse().map((l) => `<li><span class="muted">${clock(l.at)} · ${esc(l.by)}</span> ${esc(l.text)}</li>`).join('')}</ul>` : ''}
  `);
}

function openEnter(id) {
  const t = S.t, m = findM(id);
  if (!m) return;
  const view = L.analyze(t);
  const r = t.rules;
  const nameA = sideLabel(t, m, 'a', view), nameB = sideLabel(t, m, 'b', view);
  const admin = isAdmin();
  const prev = m.result;
  let form = '';
  if (r.mode === 'punkte') {
    const n = 2 * r.setsToWin - 1;
    const rows = Array.from({ length: n }, (_, i) => {
      const p = prev && prev.sets && prev.sets[i];
      return `<tr><th>Satz ${i + 1}</th><td><input id="sa${i}" class="num" type="number" inputmode="numeric" min="0" max="99" value="${p ? p.a : ''}" data-set="${i}" data-side="a" aria-label="Satz ${i + 1} ${esc(nameA)}"></td><td><input id="sb${i}" class="num" type="number" inputmode="numeric" min="0" max="99" value="${p ? p.b : ''}" data-set="${i}" data-side="b" aria-label="Satz ${i + 1} ${esc(nameB)}"></td></tr>`;
    }).join('');
    form = `<table class="sets"><thead><tr><th></th><th>${esc(nameA)}</th><th>${esc(nameB)}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">${esc(L.ruleText(r))}. Nicht gespielte Sätze leer lassen.</p>`;
  } else if (r.mode === 'saetze') {
    form = `<div class="setsum"><label>${esc(nameA)}<input id="ssa" class="num" type="number" inputmode="numeric" min="0" max="9" value="${prev && prev.setsA != null ? prev.setsA : ''}"></label><span class="vs">:</span><label>${esc(nameB)}<input id="ssb" class="num" type="number" inputmode="numeric" min="0" max="9" value="${prev && prev.setsB != null ? prev.setsB : ''}"></label></div>
      <p class="muted small">Gewonnene Sätze. ${r.setsToWin} Gewinnsätze (Best of ${2 * r.setsToWin - 1}).</p>`;
  } else {
    form = winnerPick(nameA, nameB, prev && prev.winner);
  }
  openModal(`
    <div class="sheet-head"><h2>Ergebnis · Spiel ${m.no}</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <form id="resform" data-id="${m.id}" novalidate>
      <div id="normalform">${form}</div>
      ${admin && r.mode !== 'sieger' ? `<label class="check"><input id="walkover" type="checkbox"> Kampflos (Gegner nicht angetreten)</label><div id="woform" hidden>${winnerPick(nameA, nameB, null, 'wo')}</div>` : ''}
      <p id="reshint" class="reshint" aria-live="polite"></p>
      <div id="depwarn"></div>
      <div class="btnrow"><button class="btn primary" type="submit">${admin ? 'Speichern' : 'Eintragen'}</button><button class="btn ghost" data-action="open-m" data-id="${m.id}" type="button">Zurück</button></div>
      ${!admin ? '<p class="muted small">Dein Gegner muss das Ergebnis danach bestätigen.</p>' : ''}
    </form>`);
  updateResHint();
}

function winnerPick(a, b, sel, prefix = 'w') {
  return `<div class="pick" role="radiogroup" aria-label="Sieger">
    <label class="pickbtn"><input type="radio" name="${prefix}win" value="a" ${sel === 'a' ? 'checked' : ''}><span>${esc(a)}</span></label>
    <label class="pickbtn"><input type="radio" name="${prefix}win" value="b" ${sel === 'b' ? 'checked' : ''}><span>${esc(b)}</span></label>
  </div>`;
}

function readResInput() {
  const t = S.t;
  const r = t.rules;
  const wo = $('#walkover');
  if (wo && wo.checked) {
    const v = document.querySelector('input[name=wowin]:checked');
    return { kind: 'kampflos', winner: v ? v.value : null };
  }
  if (r.mode === 'punkte') {
    const n = 2 * r.setsToWin - 1;
    const sets = [];
    for (let i = 0; i < n; i++) sets.push({ a: intOrNull($('#sa' + i).value), b: intOrNull($('#sb' + i).value) });
    return { kind: 'punkte', sets };
  }
  if (r.mode === 'saetze') return { kind: 'saetze', a: intOrNull($('#ssa').value), b: intOrNull($('#ssb').value) };
  const v = document.querySelector('input[name=wwin]:checked');
  return { kind: 'sieger', winner: v ? v.value : null };
}

function updateResHint() {
  const el = $('#reshint');
  if (!el || !S.t) return;
  const id = $('#resform').dataset.id;
  const m = findM(id);
  if (!m) return;
  const input = readResInput();
  const empty = input.kind === 'punkte' ? input.sets.every((s) => s.a === null && s.b === null) : input.kind === 'saetze' ? input.a === null && input.b === null : !input.winner;
  if (empty) { el.textContent = ''; el.className = 'reshint'; return; }
  const v = L.validateResult(S.t.rules, input);
  const view = L.analyze(S.t);
  if (v.ok) {
    el.textContent = `${L.resultText(v.result)} – Sieger: ${sideLabel(S.t, m, v.result.winner, view)}`;
    el.className = 'reshint ok';
  } else {
    el.textContent = v.error;
    el.className = 'reshint err';
  }
}

async function submitResult(id, force = false) {
  const input = readResInput();
  const v = L.validateResult(S.t.rules, input);
  if (!v.ok) { updateResHint(); toast(v.error, 'err'); return; }
  const who = actor();
  try {
    await S.store.update(S.t.id, (t) => L.reportResult(t, id, input, who, { force }));
    toast(who.admin ? 'Ergebnis gespeichert' : 'Eingetragen. Dein Gegner muss noch bestätigen.');
    closeModal();
  } catch (e) {
    if (e && e.code === 'DEPENDENTS') {
      $('#depwarn').innerHTML = `<div class="card alert bad"><p>${e.matches.length === 1 ? `Spiel ${e.matches[0]} hat schon ein Ergebnis und hängt` : `Die Spiele ${e.matches.join(', ')} haben schon Ergebnisse und hängen`} von diesem Spiel ab. Beim Speichern ${e.matches.length === 1 ? 'wird dieses Ergebnis' : 'werden diese Ergebnisse'} zurückgesetzt.</p><button class="btn danger" data-action="force-save" data-id="${id}" type="button">Trotzdem speichern</button></div>`;
      return;
    }
    toast(e.message || 'Speichern hat nicht geklappt.', 'err');
  }
}

// ---------- Kleine Dialoge ----------
function askConfirm(text, okLabel, onOk, danger = true) {
  openModal(`
    <div class="sheet-head"><h2>Bitte bestätigen</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <p>${text}</p>
    <div class="btnrow"><button class="btn ${danger ? 'danger' : 'primary'}" id="ask-ok" type="button">${esc(okLabel)}</button><button class="btn ghost" data-action="close" type="button">Abbrechen</button></div>`);
  $('#ask-ok').addEventListener('click', async () => { await onOk(); });
}

function promptNumber(title, label, value, min, max, onOk) {
  openModal(`
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <form id="numform" novalidate><label class="field">${esc(label)}<input id="numval" type="number" inputmode="numeric" min="${min}" max="${max}" value="${value}"></label>
    <div class="btnrow"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" data-action="close" type="button">Abbrechen</button></div></form>`);
  $('#numform').addEventListener('submit', async (e) => { e.preventDefault(); const ok = await onOk($('#numval').value); if (ok) closeModal(); });
}

function openRename() {
  const t = S.t;
  openModal(`
    <div class="sheet-head"><h2>Namen ändern</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <form id="renform" novalidate>
      ${t.entries.map((e) => e.names.map((n, i) => `<label class="field">${t.rules.format === 'doppel' ? `Doppel ${e.id.slice(1)}, Spieler ${i + 1}` : `Teilnehmer ${e.id.slice(1)}`}<input type="text" id="ren-${e.id}-${i}" data-e="${e.id}" data-i="${i}" value="${esc(n)}" data-orig="${esc(n)}" autocomplete="off" data-nofocus="1"></label>`).join('')).join('')}
      <div class="btnrow"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" data-action="close" type="button">Abbrechen</button></div>
      <p class="muted small">Wer sich schon mit dem alten Namen angemeldet hat, wählt seinen Namen danach neu.</p>
    </form>`);
  $('#renform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const changes = [...document.querySelectorAll('#renform input[data-e]')].filter((i) => i.value.trim() !== i.dataset.orig).map((i) => ({ e: i.dataset.e, i: Number(i.dataset.i), v: i.value }));
    if (!changes.length) { closeModal(); return; }
    const ok = await act(() => S.store.update(S.t.id, (t) => { for (const c of changes) L.renameEntryName(t, c.e, c.i, c.v, actor()); }), 'Namen gespeichert');
    if (ok) closeModal();
  });
}

// ---------- Admin ----------
function openFirstAdmin() {
  openModal(`
    <div class="sheet-head"><h2>Admin anlegen</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <form id="adminform" novalidate>
      <label class="field">Name<input id="ad-name" type="text" autocomplete="name"></label>
      <label class="field">PIN (4 bis 8 Ziffern)<input id="ad-pin" type="password" inputmode="numeric" autocomplete="new-password"></label>
      <label class="field">PIN wiederholen<input id="ad-pin2" type="password" inputmode="numeric" autocomplete="new-password"></label>
      <p id="ad-err" class="reshint err" aria-live="polite"></p>
      <div class="btnrow"><button class="btn primary" type="submit">Anlegen</button><button class="btn ghost" data-action="close" type="button">Abbrechen</button></div>
    </form>`);
  $('#adminform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#ad-name').value.trim(), pin = $('#ad-pin').value.trim(), pin2 = $('#ad-pin2').value.trim();
    const err = (msg) => { $('#ad-err').textContent = msg; };
    if (!name) return err('Bitte einen Namen eingeben.');
    if (!/^\d{4,8}$/.test(pin)) return err('Die PIN muss aus 4 bis 8 Ziffern bestehen.');
    if (pin !== pin2) return err('Die beiden PINs stimmen nicht überein.');
    if (S.settings.admins.some((a) => a.name.toLowerCase() === name.toLowerCase())) return err('Diesen Admin gibt es schon.');
    const salt = L.randomId(12);
    const hash = await sha256(salt + ':' + pin);
    const id = 'a' + L.randomId(8);
    const wasEmpty = !S.settings.admins.length;
    const ok = await act(() => S.store.updateSettings((s) => {
      s.admins = s.admins || [];
      if (wasEmpty && s.admins.length) throw new Error('Es wurde inzwischen schon ein Admin angelegt. Bitte als Admin anmelden.');
      if (!wasEmpty && !isAdmin()) throw new Error('Nur ein Admin kann weitere Admins anlegen.');
      s.admins.push({ id, name, salt, hash });
    }), 'Admin angelegt');
    if (ok) { if (wasEmpty) lsSet('tp_admin', { id, hash }); closeModal(); render(); }
  });
}

function openAdminLogin() {
  const admins = S.settings.admins;
  openModal(`
    <div class="sheet-head"><h2>Admin-Anmeldung</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <form id="loginform" novalidate>
      <label class="field">Admin<select id="lg-id">${admins.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field">PIN<input id="lg-pin" type="password" inputmode="numeric" autocomplete="current-password"></label>
      <p id="lg-err" class="reshint err" aria-live="polite"></p>
      <div class="btnrow"><button class="btn primary" type="submit">Anmelden</button><button class="btn ghost" data-action="close" type="button">Abbrechen</button></div>
    </form>`);
  $('#loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = S.settings.admins.find((x) => x.id === $('#lg-id').value);
    if (!a) return;
    const hash = await sha256(a.salt + ':' + $('#lg-pin').value.trim());
    if (hash !== a.hash) { $('#lg-err').textContent = 'Die PIN stimmt nicht.'; return; }
    lsSet('tp_admin', { id: a.id, hash });
    closeModal();
    toast(`Angemeldet als ${a.name}`);
    render();
  });
}

function viewSettings() {
  const me = adminSession();
  if (!me) return `<button class="back" data-action="go-home" type="button">← Alle Turniere</button><div class="card"><p>Nur für Admins.</p></div>`;
  return `
    <button class="back" data-action="go-home" type="button">← Alle Turniere</button>
    <h1>Einstellungen</h1>
    <section class="card">
      <h2>Admins</h2>
      <p class="muted">Admins legen Turniere an, ändern jedes Ergebnis und entscheiden abgelehnte Ergebnisse.</p>
      <ul class="plain">${S.settings.admins.map((a) => `<li class="spread"><span>${esc(a.name)}${a.id === me.id ? ' <span class="muted">(du)</span>' : ''}</span>${a.id !== me.id ? `<button class="btn ghost sm" data-action="remove-admin" data-id="${esc(a.id)}" type="button">Entfernen</button>` : ''}</li>`).join('')}</ul>
      <div class="btnrow wrap"><button class="btn primary" data-action="add-admin" type="button">Admin hinzufügen</button><button class="btn ghost" data-action="change-pin" type="button">Meine PIN ändern</button></div>
    </section>
    <section class="card">
      <h2>Abmelden</h2>
      <p class="muted">Auf diesem Gerät als Admin abmelden.</p>
      <button class="btn ghost" data-action="logout" type="button">Abmelden</button>
    </section>
    <p class="muted small">Datenspeicher: ${S.store.mode === 'online' ? 'Online (Firebase)' : 'Demo – nur auf diesem Gerät'}</p>`;
}

function openChangePin() {
  openModal(`
    <div class="sheet-head"><h2>PIN ändern</h2><button class="x" data-action="close" aria-label="Schließen" type="button">×</button></div>
    <form id="pinform" novalidate>
      <label class="field">Neue PIN (4 bis 8 Ziffern)<input id="pn-pin" type="password" inputmode="numeric" autocomplete="new-password"></label>
      <label class="field">PIN wiederholen<input id="pn-pin2" type="password" inputmode="numeric" autocomplete="new-password"></label>
      <p id="pn-err" class="reshint err" aria-live="polite"></p>
      <div class="btnrow"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" data-action="close" type="button">Abbrechen</button></div>
    </form>`);
  $('#pinform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('#pn-pin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) { $('#pn-err').textContent = 'Die PIN muss aus 4 bis 8 Ziffern bestehen.'; return; }
    if (pin !== $('#pn-pin2').value.trim()) { $('#pn-err').textContent = 'Die beiden PINs stimmen nicht überein.'; return; }
    const me = adminSession();
    const salt = L.randomId(12);
    const hash = await sha256(salt + ':' + pin);
    const ok = await act(() => S.store.updateSettings((s) => { const a = s.admins.find((x) => x.id === me.id); if (!a) throw new Error('Admin nicht gefunden.'); a.salt = salt; a.hash = hash; }), 'PIN geändert');
    if (ok) { lsSet('tp_admin', { id: me.id, hash }); closeModal(); render(); }
  });
}

// ---------- Neues Turnier ----------
function newWizard() {
  const sp = L.SPORTS.tischtennis;
  return {
    sport: 'tischtennis',
    name: `${sp.label} ${dateStr(Date.now())}`,
    nameTouched: false,
    rules: { mode: sp.mode, unit: sp.unit, pointsToWin: sp.pointsToWin, winBy2: sp.winBy2, cap: sp.cap, setsToWin: sp.setsToWin, format: sp.format },
    entries: [],
    tables: 1,
    hours: 4,
    duration: 15,
    sysType: null,
    groups: null,
    advance: null,
    thirdPlace: true,
    swissRounds: null,
  };
}

function viewWizard() {
  const W = S.wiz;
  if (!isAdmin()) return `<button class="back" data-action="go-home" type="button">← Alle Turniere</button><div class="card"><p>Nur Admins können Turniere anlegen.</p></div>`;
  const r = W.rules;
  return `
    <div id="wiz">
    <button class="back" data-action="go-home" type="button">← Abbrechen</button>
    <h1>Neues Turnier</h1>
    <section class="card">
      <h2><span class="step">1</span> Turnier</h2>
      <label class="field">Name<input id="w-name" data-w="name" type="text" value="${esc(W.name)}" autocomplete="off"></label>
      <label class="field">Sportart<select id="w-sport" data-w="sport">${Object.entries(L.SPORTS).map(([k, v]) => `<option value="${k}" ${W.sport === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
    </section>
    <section class="card">
      <h2><span class="step">2</span> Regeln</h2>
      <div class="grid2">
        <label class="field">Ergebnis eintragen als<select id="w-mode" data-w="mode">${Object.entries(L.MODES).map(([k, v]) => `<option value="${k}" ${r.mode === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field">Spielform<select id="w-format" data-w="format"><option value="einzel" ${r.format === 'einzel' ? 'selected' : ''}>Einzel</option><option value="doppel" ${r.format === 'doppel' ? 'selected' : ''}>Doppel</option></select></label>
        <label class="field">Satz bis<span class="inline"><input id="w-points" data-w="pointsToWin" class="num" type="number" inputmode="numeric" min="1" max="99" value="${r.pointsToWin}"><select id="w-unit" data-w="unit"><option ${r.unit === 'Punkte' ? 'selected' : ''}>Punkte</option><option ${r.unit === 'Spiele' ? 'selected' : ''}>Spiele</option></select></span></label>
        <label class="field">Gewinnsätze<span class="inline"><input id="w-sets" data-w="setsToWin" class="num" type="number" inputmode="numeric" min="1" max="9" value="${r.setsToWin}"><span id="w-bestof" class="muted">Best of ${2 * r.setsToWin - 1}</span></span></label>
        <label class="check"><input id="w-by2" data-w="winBy2" type="checkbox" ${r.winBy2 ? 'checked' : ''}> Mit 2 Vorsprung gewinnen</label>
        <label class="field">Satz endet spätestens bei<span class="inline"><input id="w-cap" data-w="cap" class="num" type="number" inputmode="numeric" min="0" max="99" value="${r.cap}"><span class="muted">0 = ohne Grenze</span></span></label>
      </div>
      <p id="w-ruletext" class="rule-preview"></p>
    </section>
    <section class="card">
      <h2><span class="step">3</span> <span id="w-entries-title">Teilnehmer</span></h2>
      <form id="w-addform" class="addrow" novalidate>
        <input id="w-add1" type="text" placeholder="Name" autocomplete="off" aria-label="Name">
        <input id="w-add2" type="text" placeholder="Partner" autocomplete="off" aria-label="Name Partner" ${r.format === 'doppel' ? '' : 'hidden'}>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
      <div id="w-entries"></div>
    </section>
    <section class="card">
      <h2><span class="step">4</span> Zeit</h2>
      <div class="grid3">
        <label class="field">Tische / Felder<input id="w-tables" data-w="tables" class="num" type="number" inputmode="numeric" min="1" max="20" value="${W.tables}"></label>
        <label class="field">Zeit (Stunden)<input id="w-hours" data-w="hours" class="num" type="number" inputmode="decimal" min="0.5" max="24" step="0.5" value="${W.hours}"></label>
        <label class="field">Minuten je Spiel<input id="w-dur" data-w="duration" class="num" type="number" inputmode="numeric" min="1" max="300" value="${W.duration}"></label>
      </div>
    </section>
    <section class="card">
      <h2><span class="step">5</span> Turniersystem</h2>
      <div id="w-system"></div>
    </section>
    <p id="w-err" class="reshint err" aria-live="polite"></p>
    <div class="row-end"><button class="btn primary big" data-action="create-t" type="button">Auslosen und Turnier starten</button></div>
    </div>`;
}

function wizN() { return S.wiz.entries.length; }

function renderWizParts() {
  if (!$('#wiz')) return;
  const W = S.wiz;
  const r = W.rules;
  $('#w-ruletext').textContent = r.pointsToWin >= 1 && r.setsToWin >= 1 ? L.ruleText(r) : '';
  $('#w-bestof').textContent = r.setsToWin >= 1 ? `Best of ${2 * r.setsToWin - 1}` : '';
  $('#w-cap').disabled = !r.winBy2;
  const dbl = r.format === 'doppel';
  $('#w-add2').hidden = !dbl;
  $('#w-entries-title').textContent = dbl ? 'Doppel' : 'Teilnehmer';
  $('#w-entries').innerHTML = W.entries.length
    ? `<ol class="entrylist">${W.entries.map((e, i) => `<li><span>${esc(e.join(' / '))}</span><button class="x sm" data-action="w-remove" data-i="${i}" aria-label="${esc(e.join(' / '))} entfernen" type="button">×</button></li>`).join('')}</ol><p class="muted small">${W.entries.length} ${dbl ? 'Doppel' : 'Teilnehmer'}. Die Auslosung passiert beim Start per Zufall.</p>`
    : `<p class="muted small">Noch niemand eingetragen. Jeder Name muss eindeutig sein, damit sich jeder Spieler selbst auswählen kann.</p>`;
  renderWizSystem();
}

function renderWizSystem() {
  const W = S.wiz;
  const n = wizN();
  const box = $('#w-system');
  if (n < 2) { box.innerHTML = '<p class="muted">Sobald mindestens 2 Teilnehmer eingetragen sind, schlägt die App das passende System vor.</p>'; return; }
  const avail = Math.round(Number(W.hours) * 60);
  const tables = Math.max(1, Math.round(Number(W.tables)) || 1);
  const dur = Math.max(1, Math.round(Number(W.duration)) || 15);
  const prefs = { groups: W.groups, advance: W.advance, thirdPlace: W.thirdPlace, swissRounds: W.swissRounds };
  const p = L.planOptions(n, tables, dur, avail, prefs);
  const sel = W.sysType && !p.list.find((o) => o.type === W.sysType).reason ? W.sysType : p.recommended;
  const chosen = p.list.find((o) => o.type === sel);
  const perPlayer = (o) => {
    if (o.type === 'rr') return `je ${n - 1} Spiele`;
    if (o.type === 'koall') return `je ${Math.log2(n)} Spiele`;
    if (o.type === 'swiss') return `je ${o.sys.swissRounds} Spiele`;
    if (o.type === 'ko') return '1 bis ' + Math.ceil(Math.log2(n)) + ' Spiele';
    if (o.type === 'groups') { const sz = L.groupSizes(n, o.sys.groups); return `mind. ${Math.min(...sz) - 1} Spiele`; }
    return '';
  };
  const rows = p.list.map((o) => `
    <label class="sysopt ${o.reason ? 'na' : ''} ${o.type === sel ? 'on' : ''}">
      <input type="radio" name="w-sys" value="${o.type}" ${o.type === sel ? 'checked' : ''} ${o.reason ? 'disabled' : ''} data-action="w-sys">
      <span class="sysname">${esc(o.label)}${o.type === p.recommended ? ' <span class="pill live">Empfehlung</span>' : ''}</span>
      <span class="sysmeta">${o.reason ? esc('Nicht möglich: ' + o.reason) : `${o.matches} Spiele · ca. ${fmtMin(o.minutes)} · ${perPlayer(o)}`}</span>
      <span class="sysfit">${o.reason ? '' : o.fits ? '<span class="fit ok">passt</span>' : `<span class="fit no">${fmtMin(o.minutes - avail)} zu lang</span>`}</span>
    </label>`).join('');
  let extra = '';
  if (sel === 'groups') {
    const g = chosen.sys;
    extra = `<div class="grid3">
      <label class="field">Gruppen<select id="w-groups" data-wsys="groups"><option value="2" ${g.groups === 2 ? 'selected' : ''}>2 Gruppen</option><option value="4" ${g.groups === 4 ? 'selected' : ''}>4 Gruppen</option></select></label>
      <label class="field">Weiter kommen<select id="w-adv" data-wsys="advance"><option value="1" ${g.advance === 1 ? 'selected' : ''}>Gruppensieger</option><option value="2" ${g.advance === 2 ? 'selected' : ''}>Die besten 2</option></select></label>
      <label class="check"><input id="w-p3" type="checkbox" data-wsys="thirdPlace" ${g.thirdPlace ? 'checked' : ''} ${g.groups * g.advance < 4 ? 'disabled' : ''}> Spiel um Platz 3</label>
    </div><p class="muted small">Gruppengrößen: ${L.groupSizes(n, g.groups).join(' und ')}. Danach ${g.groups * g.advance === 2 ? 'direkt das Finale' : g.groups * g.advance === 4 ? 'Halbfinale und Finale' : 'Viertelfinale, Halbfinale und Finale'}.</p>`;
  } else if (sel === 'ko') {
    extra = `<label class="check"><input id="w-p3" type="checkbox" data-wsys="thirdPlace" ${chosen.sys.thirdPlace ? 'checked' : ''} ${n < 4 ? 'disabled' : ''}> Spiel um Platz 3</label>${n !== 2 && (n & (n - 1)) !== 0 ? `<p class="muted small">Bei ${n} Teilnehmern bekommen ${2 ** Math.ceil(Math.log2(n)) - n} per Los ein Freilos in der ersten Runde.</p>` : ''}`;
  } else if (sel === 'swiss') {
    extra = `<label class="field">Runden<input id="w-rounds" class="num" type="number" inputmode="numeric" min="1" max="${n - 1}" value="${chosen.sys.swissRounds}" data-wsys="swissRounds"></label><p class="muted small">Jede Runde wird erst ausgelost, wenn die vorige fertig ist. Gleich Starke spielen gegeneinander, niemand zweimal gegen denselben.${n % 2 ? ' Bei ungerader Zahl bekommt pro Runde einer ein Freilos.' : ''}</p>`;
  } else if (sel === 'rr' && n % 2) {
    extra = '<p class="muted small">Bei ungerader Zahl hat pro Runde einer Pause.</p>';
  }
  box.innerHTML = `<div class="sysopts">${rows}</div>${extra ? `<div class="sysextra">${extra}</div>` : ''}
    <p class="muted small">Zeit gerechnet mit ${tables} ${tables === 1 ? 'Tisch' : 'Tischen'} und ${dur} min je Spiel, verfügbar ${fmtMin(avail)}.${tables > 1 ? ' Bei mehreren Tischen ist das ein Richtwert, weil KO-Spiele auf ihre Vorrunde warten.' : ''}</p>`;
  W._chosen = chosen;
}

function wizInput(el) {
  const W = S.wiz;
  const k = el.dataset.w;
  if (k === 'name') { W.name = el.value; W.nameTouched = true; return; }
  if (k === 'sport') {
    W.sport = el.value;
    const sp = L.SPORTS[W.sport];
    const oldFormat = W.rules.format;
    W.rules = { mode: sp.mode, unit: sp.unit, pointsToWin: sp.pointsToWin, winBy2: sp.winBy2, cap: sp.cap, setsToWin: sp.setsToWin, format: sp.format };
    if (!W.nameTouched) W.name = `${sp.label} ${dateStr(Date.now())}`;
    if (oldFormat !== W.rules.format && W.entries.length) { W.entries = []; toast('Spielform geändert: Teilnehmerliste geleert.'); }
    $('#main').innerHTML = viewWizard();
    renderWizParts();
    return;
  }
  if (k === 'format') {
    if (W.rules.format !== el.value) {
      W.rules.format = el.value;
      if (W.entries.length) { W.entries = []; toast('Spielform geändert: Teilnehmerliste geleert.'); }
    }
  } else if (k === 'mode' || k === 'unit') W.rules[k] = el.value;
  else if (k === 'winBy2') W.rules.winBy2 = el.checked;
  else if (k === 'pointsToWin' || k === 'setsToWin' || k === 'cap') W.rules[k] = intOrNull(el.value) ?? 0;
  else if (k === 'tables' || k === 'duration' || k === 'hours') W[k] = el.value;
  renderWizParts();
}

function wizSysInput(el) {
  const W = S.wiz;
  const k = el.dataset.wsys;
  const n = wizN();
  if (k === 'thirdPlace') { W.thirdPlace = el.checked; renderWizSystem(); return; }
  const before = { groups: W.groups, advance: W.advance, swissRounds: W.swissRounds };
  const val = Number(el.value);
  const dg = L.defaultGroups(n);
  const cand = k === 'swissRounds'
    ? { type: 'swiss', swissRounds: val }
    : { type: 'groups', groups: k === 'groups' ? val : (W.groups || dg.groups), advance: k === 'advance' ? val : (W.advance || dg.advance) };
  const reason = Number.isInteger(val) ? L.systemAvailable(n, cand) : 'bitte eine ganze Zahl eingeben';
  if (reason) {
    Object.assign(W, before);
    toast(`Nicht möglich: ${reason}.`, 'err');
  } else if (k === 'swissRounds') W.swissRounds = val;
  else { W.groups = cand.groups; W.advance = cand.advance; }
  renderWizSystem();
}

function wizAdd() {
  const W = S.wiz;
  const a = $('#w-add1').value.trim();
  const b = $('#w-add2').value.trim();
  const dbl = W.rules.format === 'doppel';
  const err = (m) => { toast(m, 'err'); };
  if (!a || (dbl && !b)) return err(dbl ? 'Bitte beide Namen des Doppels eingeben.' : 'Bitte einen Namen eingeben.');
  const names = dbl ? [a, b] : [a];
  if (dbl && a.toLowerCase() === b.toLowerCase()) return err('Die beiden Namen müssen verschieden sein.');
  const all = W.entries.flat().map((x) => x.toLowerCase());
  const dup = names.find((x) => all.includes(x.toLowerCase()));
  if (dup) return err(`„${dup}“ ist schon eingetragen. Jeder Name muss eindeutig sein.`);
  W.entries.push(names);
  $('#w-add1').value = ''; $('#w-add2').value = '';
  $('#w-add1').focus();
  renderWizParts();
}

async function wizCreate() {
  const W = S.wiz;
  const r = W.rules;
  const err = (m) => { $('#w-err').textContent = m; toast(m, 'err'); };
  $('#w-err').textContent = '';
  if (!W.name.trim()) return err('Bitte einen Namen für das Turnier eingeben.');
  if (!(Number.isInteger(r.pointsToWin) && r.pointsToWin >= 1 && r.pointsToWin <= 99)) return err('„Satz bis“ muss zwischen 1 und 99 liegen.');
  if (!(Number.isInteger(r.setsToWin) && r.setsToWin >= 1 && r.setsToWin <= 9)) return err('Gewinnsätze müssen zwischen 1 und 9 liegen.');
  if (r.winBy2 && r.cap && r.cap <= r.pointsToWin) return err('„Spätestens bei“ muss größer als „Satz bis“ sein (oder 0 für ohne Grenze).');
  const tables = Number(W.tables), dur = Number(W.duration), hours = Number(W.hours);
  if (!(Number.isInteger(tables) && tables >= 1 && tables <= 20)) return err('Bitte 1 bis 20 Tische angeben.');
  if (!(Number.isInteger(dur) && dur >= 1 && dur <= 300)) return err('Minuten je Spiel: bitte 1 bis 300.');
  if (!(hours > 0 && hours <= 24)) return err('Zeit: bitte zwischen 0,5 und 24 Stunden.');
  const eErr = L.validateEntries(W.entries, r.format);
  if (eErr) return err(eErr);
  renderWizSystem();
  const chosen = W._chosen;
  if (!chosen || chosen.reason) return err('Bitte ein mögliches Turniersystem wählen.');
  const rules = { ...r, cap: r.winBy2 ? (r.cap || 0) : 0 };
  let t;
  try {
    t = L.createTournament({ name: W.name.trim(), sport: W.sport, rules, entries: W.entries, tables, durationMin: dur, availableMin: Math.round(hours * 60), system: chosen.sys });
  } catch (e) { return err(e.message); }
  const btn = document.querySelector('[data-action=create-t]');
  if (btn) btn.disabled = true;
  const ok = await act(() => S.store.create(t), 'Turnier ausgelost und gestartet');
  if (btn) btn.disabled = false;
  if (ok) {
    const a = adminSession();
    if (a && L.entryOfName(t, a.name)) lsSet('tp_me_' + t.id, a.name);
    go({ name: 't', id: t.id });
  }
}

// ---------- Ereignisse ----------
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) {
    if (ev.target.id === 'modal') closeModal();
    return;
  }
  const a = el.dataset.action;
  const id = el.dataset.id;
  switch (a) {
    case 'go-home': go({ name: 'home' }); break;
    case 'go-settings': go({ name: 'settings' }); break;
    case 'open-t': go({ name: 't', id }); break;
    case 'new-t': go({ name: 'new' }); break;
    case 'first-admin': openFirstAdmin(); break;
    case 'admin-login': openAdminLogin(); break;
    case 'add-admin': openFirstAdmin(); break;
    case 'change-pin': openChangePin(); break;
    case 'logout': lsSet('tp_admin', null); toast('Abgemeldet'); go({ name: 'home' }); break;
    case 'remove-admin': {
      const ad = S.settings.admins.find((x) => x.id === id);
      if (!ad) break;
      askConfirm(`${esc(ad.name)} als Admin entfernen?`, 'Entfernen', async () => {
        const ok = await act(() => S.store.updateSettings((s) => { s.admins = s.admins.filter((x) => x.id !== id); }), 'Admin entfernt');
        if (ok) { closeModal(); render(); }
      });
      break;
    }
    case 'close': closeModal(); break;
    case 'tab': S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'mine': S.mineOnly = el.dataset.v === '1'; render(); break;
    case 'set-me': lsSet('tp_me_' + S.t.id, el.dataset.name); S.tab = 'jetzt'; render(); break;
    case 'change-me': lsSet('tp_me_' + S.t.id, null); render(); break;
    case 'open-m': openMatch(id); break;
    case 'enter': openEnter(id); break;
    case 'force-save': submitResult(id, true); break;
    case 'confirm': {
      const ok = await act(() => S.store.update(S.t.id, (t) => L.confirmResult(t, id, actor())), 'Ergebnis bestätigt');
      if (ok) closeModal();
      break;
    }
    case 'reject': {
      const m = findM(id);
      askConfirm(`Ergebnis ${esc(L.resultText(m && m.result))} ablehnen? Das Spiel geht dann zur Entscheidung an den Admin.`, 'Ablehnen', async () => {
        const ok = await act(() => S.store.update(S.t.id, (t) => L.rejectResult(t, id, actor())), 'Abgelehnt. Der Admin entscheidet.');
        if (ok) closeModal();
      });
      break;
    }
    case 'skip': {
      const ok = await act(() => S.store.update(S.t.id, (t) => L.skipMatch(t, id, actor())), 'Übersprungen. Das Spiel wird später nachgeholt.');
      if (ok) closeModal();
      break;
    }
    case 'reset': {
      const deps = L.blockingDependents(S.t, id);
      askConfirm(`Ergebnis von Spiel ${findM(id).no} zurücksetzen?${deps.length ? ` Dabei ${deps.length === 1 ? `wird auch das Ergebnis von Spiel ${deps[0].no}` : `werden auch die Ergebnisse der Spiele ${deps.map((d) => d.no).join(', ')}`} zurückgesetzt.` : ''}`, 'Zurücksetzen', async () => {
        const ok = await act(() => S.store.update(S.t.id, (t) => L.resetResult(t, id, actor(), { force: true })), 'Zurückgesetzt');
        if (ok) closeModal();
      });
      break;
    }
    case 'copy-link': {
      const text = tournamentLink(S.t);
      try { await navigator.clipboard.writeText(text); toast('Link kopiert'); } catch (e) {
        const n = $('#tlink'); const range = document.createRange(); range.selectNodeContents(n); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); toast('Link markiert – jetzt kopieren');
      }
      break;
    }
    case 'edit-tables': promptNumber('Tische ändern', 'Anzahl Tische / Felder', S.t.tables, 1, 20, (v) => act(() => S.store.update(S.t.id, (t) => L.setTables(t, v, actor())), 'Tische geändert')); break;
    case 'edit-duration': promptNumber('Spieldauer ändern', 'Minuten je Spiel', S.t.durationMin, 1, 300, (v) => act(() => S.store.update(S.t.id, (t) => L.setDuration(t, v, actor())), 'Spieldauer geändert')); break;
    case 'rename': openRename(); break;
    case 'delete-t': askConfirm(`„${esc(S.t.name)}“ mit allen Ergebnissen endgültig löschen?`, 'Endgültig löschen', async () => {
      const tid = S.t.id;
      const ok = await act(() => S.store.remove(tid), 'Turnier gelöscht');
      if (ok) go({ name: 'home' });
    }); break;
    case 'w-remove': S.wiz.entries.splice(Number(el.dataset.i), 1); renderWizParts(); break;
    case 'create-t': wizCreate(); break;
    default: break;
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.closest('#resform')) { updateResHint(); return; }
  if (el.dataset.w && el.type !== 'checkbox' && el.tagName !== 'SELECT') wizInput(el);
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.closest('#resform')) {
    if (el.id === 'walkover') { $('#woform').hidden = !el.checked; $('#normalform').hidden = el.checked; }
    updateResHint();
    return;
  }
  if (el.dataset.w && (el.type === 'checkbox' || el.tagName === 'SELECT')) wizInput(el);
  if (el.dataset.wsys) wizSysInput(el);
  if (el.name === 'w-sys') { S.wiz.sysType = el.value; renderWizSystem(); }
});
document.addEventListener('submit', (ev) => {
  const f = ev.target;
  if (f.id === 'resform') { ev.preventDefault(); submitResult(f.dataset.id); }
  if (f.id === 'w-addform') { ev.preventDefault(); wizAdd(); }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#modal').hidden) closeModal(); });
window.addEventListener('hashchange', () => { const r = routeFromHash(); if (r.name === 't' && !(S.route.name === 't' && S.route.id === r.id)) go(r); });

// ---------- Demo-Beispiel ----------
async function seedDemo() {
  const salt = 'demo-salt';
  const hash = await sha256(salt + ':1234');
  await S.store.updateSettings((s) => { s.admins = [{ id: 'a-demo', name: 'Stoffl', salt, hash }]; });
  lsSet('tp_admin', { id: 'a-demo', hash });
  const names = ['Anna', 'Ben', 'Clara', 'David', 'Eva', 'Felix', 'Gabi', 'Stoffl'].map((n) => [n]);
  const t = L.createTournament({ name: 'Beispiel: Tischtennis-Abend', sport: 'tischtennis', rules: { ...L.SPORTS.tischtennis }, entries: names, tables: 1, durationMin: 15, availableMin: 240, system: { type: 'groups', groups: 2, advance: 2, thirdPlace: true } });
  const sample = [[{ a: 11, b: 7 }, { a: 9, b: 11 }, { a: 11, b: 5 }], [{ a: 8, b: 11 }, { a: 11, b: 13 }], [{ a: 11, b: 4 }, { a: 11, b: 9 }], [{ a: 12, b: 10 }, { a: 6, b: 11 }, { a: 11, b: 8 }]];
  const admin = { name: 'Stoffl', admin: true };
  for (let i = 0; i < sample.length; i++) {
    const m = L.queue(t).onTable[0];
    L.reportResult(t, m.id, { kind: 'punkte', sets: sample[i] }, admin, {}, Date.now() - (sample.length - i) * 15 * 60000);
  }
  // Ein Ergebnis wartet auf Bestätigung
  const m = L.queue(t).onTable[0];
  const s = L.analyze(t).state(m);
  L.reportResult(t, m.id, { kind: 'punkte', sets: [{ a: 11, b: 6 }, { a: 11, b: 8 }] }, { name: t.entries.find((e) => e.id === s.a).names[0], admin: false });
  await S.store.create(t);
}

// ---------- Start ----------
async function start() {
  try {
    S.store = await createStore(FIREBASE_CONFIG);
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = '<div class="card"><h2>Keine Verbindung</h2><p>Die Datenbank ist nicht erreichbar. Bitte Internetverbindung prüfen und die Seite neu laden.</p></div>';
    return;
  }
  if (S.store.mode === 'demo' && !lsGet('tp_demo_seeded')) {
    lsSet('tp_demo_seeded', true);
    try { await seedDemo(); } catch (e) { console.error(e); }
  }
  S.store.subscribeSettings((s) => { S.settings = { admins: [], ...s }; S.settingsLoaded = true; if (S.route.name !== 'new') render(); else $('#hdr-right').innerHTML = headerRight(); }, onStoreError);
  S.store.subscribeList((list) => { S.list = list; S.listLoaded = true; if (S.route.name === 'home') render(); }, onStoreError);
  go(routeFromHash());
}

start();
