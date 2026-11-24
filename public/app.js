{
'use strict';
const C = window.APP_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
};
const params = new URLSearchParams(location.search);

/* ---------- Hora de Madrid ---------- */
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const dn = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
function absOfMs(ms) {
  const p = {}; for (const x of FMT.formatToParts(new Date(ms))) p[x.type] = x.value;
  return dn(`${p.year}-${p.month}-${p.day}`) * 1440 + (+p.hour) * 60 + (+p.minute) + (+p.second) / 60;
}
const T0 = Date.now();
const FAKE = params.get('now'); // pruebas: ?now=2026-11-24T07:30
function nowAbs() {
  if (FAKE) return dn(FAKE.slice(0, 10)) * 1440 + (+FAKE.slice(11, 13)) * 60 + (+FAKE.slice(14, 16)) + (Date.now() - T0) / 60000;
  return absOfMs(Date.now());
}
const hm = a => { let m = Math.round(a); m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const dur = min => { min = Math.max(0, Math.round(min)); if (min < 60) return `${min} min`; const h = Math.floor(min / 60), m = min % 60; return m ? `${h} h ${m} min` : `${h} h`; };
const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MON = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dateOf = n => new Date(n * 864e5);
const dowOf = n => DOW[dateOf(n).getUTCDay()];
const dayLabel = n => `${dowOf(n).slice(0, 3)} ${dateOf(n).getUTCDate()}`;

/* ---------- Datos ---------- */
function dataBase() {
  if (C.DATA_URL) return C.DATA_URL.replace(/\/?$/, '/');
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0], repo = location.pathname.split('/')[1] || `${owner}.github.io`;
    return `https://raw.githubusercontent.com/${owner}/${repo}/data/`;
  }
  return 'data/';
}
const DATA = dataBase();
async function getJSON(url, ms = 12000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}

const S = {
  sched: null, live: { byId: {}, byNum: {}, ts: 0 }, liveMode: '', directRetry: 0,
  hist: null, alerts: null, wx: null, inst: null,
  dir: params.get('sentido') === 'S' ? 'S' : store.get('dir', 'N'),
  view: 'tren', tab: 'ahora', origin: null, err: '',
};

function prep(s) {
  s.svc = {}; for (const [k, v] of Object.entries(s.services)) s.svc[k] = new Set(v);
  s.baseN = dn(s.base);
  s.byName = {}; s.stations.forEach((st, i) => { s.byName[norm(st.n)] = i; });
  const H = s.home, hlat = s.stations[H].lat;
  for (const t of s.trips) {
    t.hi = t.t.findIndex(x => x[0] === H);
    t.dir = t.hi >= 0 && t.hi < t.t.length - 1 ? (s.stations[t.t[t.hi + 1][0]].lat > hlat ? 'N' : 'S') : null;
    t.pos = {}; t.t.forEach((x, i) => { if (!(x[0] in t.pos)) t.pos[x[0]] = i; });
  }
  // Renfe repite trenes (p. ej. 13001 y 35001 son el mismo Regional): se agrupan
  const groups = {};
  for (const t of s.trips) { t.key = `${t.f}|${t.hi >= 0 ? t.t[t.hi][2] : t.t[0][2]}|${t.t[t.t.length - 1][0]}`; (groups[t.key] ||= []).push(t); }
  for (const t of s.trips) t.alts = groups[t.key].filter(o => o !== t);
  s.homeName = s.stations[H].n;
  return s;
}
const sn = i => S.sched.stations[i]?.n ?? '¿?';
const idxOf = name => S.sched.byName[norm(name)];

function instances() {
  const today = Math.floor(nowAbs() / 1440);
  if (S.inst && S.inst.key === today && S.inst.sched === S.sched) return S.inst.list;
  const list = [];
  for (let d = today - 1; d <= today + 1; d++) {
    const di = d - S.sched.baseN;
    const seen = new Set(); // Renfe repite algunos trenes con calendarios solapados
    for (const t of S.sched.trips) {
      if (!S.sched.svc[t.s]?.has(di)) continue;
      const k = t.key;
      if (seen.has(k)) continue; seen.add(k);
      list.push({ t, dayN: d, off: d * 1440 });
    }
  }
  S.inst = { key: today, sched: S.sched, list };
  return list;
}

/* ---------- Tiempo real (GTFS-RT de Renfe) ---------- */
const gk = (o, k) => o == null ? undefined : (o[k] ?? o[k.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]);
function trainNum(...vals) {
  for (const v of vals) {
    if (!v) continue; const s = String(v).trim();
    if (/^\d{3,6}$/.test(s)) return s.replace(/^0+/, '') || s;
    const m = [...s.matchAll(/(?:^|\D)(\d{5})(?=\D|$)/g)];
    if (m.length) return m[m.length - 1][1].replace(/^0+/, '');
  }
  return null;
}
function parseRT(tuList, vpList) {
  const byId = {}, byNum = {};
  for (const j of tuList) for (const e of gk(j, 'entity') || []) {
    const tu = gk(e, 'tripUpdate'); if (!tu) continue;
    const trip = gk(tu, 'trip') || {}; const tid = gk(trip, 'tripId') || gk(e, 'id');
    const rec = {};
    const rel = String(gk(trip, 'scheduleRelationship') ?? '').toUpperCase();
    if (['CANCELED', 'CANCELLED', 'DELETED', '3', '5'].includes(rel)) rec.x = 1;
    const d = gk(tu, 'delay'); if (d != null) rec.d = +d;
    const u = (gk(tu, 'stopTimeUpdate') || []).map(s => {
      const dep = gk(s, 'departure') || {}, arr = gk(s, 'arrival') || {};
      const dd = gk(dep, 'delay') ?? gk(arr, 'delay');
      return [gk(s, 'stopId'), dd == null ? null : +dd];
    });
    if (u.length) { rec.u = u; if (rec.d == null) { const k = u.find(x => x[1] != null); if (k) rec.d = k[1]; } }
    byId[tid] = rec; const n = trainNum(tid); if (n) byNum[n] = rec;
  }
  for (const j of vpList) for (const e of gk(j, 'entity') || []) {
    const v = gk(e, 'vehicle'); if (!v) continue;
    const tid = gk(gk(v, 'trip') || {}, 'tripId'); const pos = gk(v, 'position') || {};
    const lbl = gk(gk(v, 'vehicle') || {}, 'label');
    const veh = { st: gk(v, 'currentStatus') ?? '', sid: gk(v, 'stopId'), lat: gk(pos, 'latitude'), lon: gk(pos, 'longitude') };
    let rec = byId[tid] || byNum[trainNum(tid, lbl)];
    if (!rec) { rec = byId[tid] = {}; const n = trainNum(tid, lbl); if (n) byNum[n] = rec; }
    rec.v = veh;
  }
  return { byId, byNum };
}
async function fetchLive() {
  const order = [];
  if (C.PROXY) order.push('proxy');
  if (Date.now() >= S.directRetry) order.push('direct');
  order.push('respaldo');
  for (const m of order) {
    try {
      if (m === 'respaldo') {
        const j = await getJSON(`${DATA}live.json?t=${Date.now()}`);
        S.live = { byId: j.trips || {}, byNum: {}, ts: (j.ts || 0) * 1000 };
      } else {
        const base = (m === 'proxy' ? C.PROXY : C.RENFE_RT).replace(/\/$/, '');
        const names = ['trip_updates', 'trip_updates_LD', 'vehicle_positions', 'vehicle_positions_LD'];
        const res = await Promise.allSettled(names.map(n => getJSON(`${base}/${n}.json`, 9000)));
        if (res[0].status !== 'fulfilled') throw new Error('sin datos');
        const ok = i => res[i].status === 'fulfilled' ? [res[i].value] : [];
        S.live = parseRT([...ok(0), ...ok(1)], [...ok(2), ...ok(3)]);
        const ts = +(gk(gk(res[0].value, 'header') || {}, 'timestamp') || 0);
        S.live.ts = ts ? ts * 1000 : Date.now();
      }
      S.liveMode = m; return true;
    } catch (e) { if (m === 'direct') S.directRetry = Date.now() + 10 * 60e3; }
  }
  S.liveMode = 'none'; return false;
}
const rec1 = t => S.live.byId[t.id] || (t.n ? S.live.byNum[t.n] : null) || null;
const liveRec = t => { let r = rec1(t); if (r) return r; for (const a of t.alts || []) { r = rec1(a); if (r) return r; } return null; };
function delayAt(t, i) {
  const r = liveRec(t); if (!r) return null;
  if (r.u) {
    let best = null, bi = -1;
    for (const [sid, d] of r.u) {
      if (d == null) continue; const si = S.sched.stops[sid]; const k = si == null ? null : t.pos[si];
      if (k != null && k <= i && k > bi) { bi = k; best = d; }
    }
    if (best != null) return best;
  }
  return r.d ?? null;
}
function status(inst, i) {
  const t = inst.t, r = liveRec(t);
  if (r?.x) return { k: 'x', txt: 'Suprimido', m: 0 };
  const d = delayAt(t, i);
  if (d != null) { const m = Math.round(d / 60); return m <= 1 ? { k: 'ok', txt: 'En hora', m: Math.max(0, m) } : { k: 'late', txt: `+${m} min`, m }; }
  if (r && (r.d != null || r.u)) return { k: 'nd', txt: 'Renfe no da su retraso', m: 0 };
  if (nowAbs() >= inst.off + t.t[0][2] - 1) return { k: 'nd', txt: S.liveMode === 'none' ? 'Según horario' : 'Aún sin dato de Renfe', m: 0 };
  return { k: 'plan', txt: 'Previsto', m: 0 };
}

/* ---------- Cálculos ---------- */
function departures(dir) {
  const now = nowAbs(), out = [];
  for (const inst of instances()) {
    const t = inst.t; if (t.dir !== dir) continue;
    const dep = inst.off + t.t[t.hi][2];
    if (dep < now - 180 || dep > now + 1440 * 1.6) continue;
    const st = status(inst, t.hi); const est = dep + st.m;
    if (est < now - 0.5) continue;
    out.push({ ...inst, i: t.hi, dep, est, st });
  }
  return out.sort((a, b) => a.dep - b.dep);
}
function backTrips(oi) {
  const now = nowAbs(), out = [];
  for (const inst of instances()) {
    const t = inst.t, i = t.pos[oi];
    if (t.hi <= 0 || i == null || i >= t.hi) continue;
    const dep = inst.off + t.t[i][2];
    if (dep < now - 180 || dep > now + 1440 * 1.6) continue;
    const st = status(inst, i); const est = dep + st.m;
    if (est < now - 0.5) continue;
    const arr = inst.off + t.t[t.hi][1] + Math.max(st.m, Math.round((delayAt(t, t.hi) ?? 0) / 60));
    out.push({ ...inst, i, dep, est, st, arr });
  }
  return out.sort((a, b) => a.dep - b.dep);
}
function keyStop(t, from) {
  const sj = idxOf('Santa Justa');
  const k = sj != null ? t.pos[sj] : null;
  return k != null && k > from && k < t.t.length - 1 ? k : t.t.length - 1;
}
function textColor(hex) {
  const n = parseInt(hex || '777777', 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#14110d' : '#fff';
}
const DEFC = { C1: '78B4E1', Regional: '7A2A8F' };
const lineColor = t => { const n = parseInt(t.c || '0', 16), lum = ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000; return !t.c || lum > 215 ? (DEFC[t.l] || '7A2A8F') : t.c; };
const badge = t => `<span class="line" style="background:#${esc(lineColor(t))};color:${textColor(lineColor(t))}">${esc(t.l === 'Regional' ? 'Regional' : t.l)}</span>`;
const stTag = st => `<span class="st ${st.k}">${esc(st.txt)}</span>`;
function dayTag(abs) {
  const today = Math.floor(nowAbs() / 1440), d = Math.floor(abs / 1440);
  return d === today ? '' : d === today + 1 ? 'mañana' : d === today - 1 ? 'ayer' : dowOf(d);
}

/* ---------- Pintado: Ahora ---------- */
function card(x, hero) {
  const t = x.t, now = nowAbs(), st = x.st;
  const mins = x.est - now;
  const when = st.k === 'x' ? 'No sale' : mins < 1 ? 'Saliendo' : `en ${dur(mins)}`;
  const day = dayTag(x.dep);
  const origin = x.i === 0 ? `Empieza en ${sn(t.t[0][0])}` : `Viene de <b>${esc(sn(t.t[0][0]))}</b>, salió a las ${hm(x.off + t.t[0][2])}`;
  const k = keyStop(t, x.i);
  const travel = t.t[k][1] - t.t[x.i][2];
  const last = t.t.length - 1;
  const arrive = x.off + t.t[last][1] + st.m;
  const facts = [origin, `<span><b>${esc(sn(t.t[k][0]))}</b> en ${travel} min</span>`];
  if (k !== last) facts.push(`<span>${esc(t.h)} a las <b>${hm(arrive)}</b></span>`);
  const route = t.t.slice(x.i + 1).map((s, j) => `<li class="${x.i + 1 + j === k || x.i + 1 + j === last ? 'k' : ''}">${esc(sn(s[0]))}</li>`).join('');
  const timeHtml = st.k === 'late' ? `${hm(x.est)}<s>${hm(x.dep)}</s>` : hm(x.dep);
  const shareTxt = `Voy en el ${t.l === 'Regional' ? 'Regional' : t.l} de las ${hm(x.dep)} de ${sn(t.t[x.i][0])} hacia ${t.h}${day ? ` (${day})` : ''}. ${st.k === 'late' ? `Lleva ${st.m} min de retraso.` : st.k === 'x' ? 'Renfe lo da por suprimido.' : st.k === 'ok' ? 'Va en hora.' : ''}`;
  return `<article class="card ${hero ? 'hero' : ''} ${st.k === 'x' ? 'x' : ''}">
    <div class="c-top">${badge(t)}<span class="dest">${esc(t.h)}</span>${day ? `<span class="day">· ${esc(day)}</span>` : ''}</div>
    <div class="c-main"><div class="big num">${timeHtml}</div><div class="when">${stTag(st)}<b>${esc(when)}</b></div></div>
    <div class="facts">${facts.map(f => `<span>${f}</span>`).join('')}</div>
    ${hero ? `<ul class="route">${route}</ul>` : ''}
    <button class="share" type="button" data-share="${esc(shareTxt)}">Avisa a quien vaya contigo</button>
  </article>`;
}
function laterRow(x, plain) {
  const t = x.t, day = dayTag(x.dep);
  const st = x.st.k === 'nd' ? { ...x.st, txt: 'Sin dato' } : x.st;
  return `<li><span class="t num">${hm(x.est)}</span>${badge(t)}<span class="d">${esc(t.h)}${day ? ` <span class="day">· ${esc(day)}</span>` : ''}</span>${stTag(st)}</li>`;
}
function renderAhora() {
  const deps = departures(S.dir);
  $('#cards').innerHTML = deps.length ? deps.slice(0, 3).map((x, i) => card(x, i === 0)).join('')
    : `<p class="empty">No hay trenes en este sentido en las próximas horas.</p>`;
  const rest = deps.slice(3, 15);
  $('#later').innerHTML = rest.length ? rest.map(x => laterRow(x)).join('') : '<li class="empty" style="display:block">Nada más por ahora.</li>';
  // Mañana
  const today = Math.floor(nowAbs() / 1440), tm = today + 1;
  const tmw = instances().filter(x => x.dayN === tm && x.t.dir === S.dir)
    .map(x => ({ ...x, i: x.t.hi, dep: x.off + x.t.t[x.t.hi][2], est: x.off + x.t.t[x.t.hi][2], st: { k: 'plan', txt: 'Previsto', m: 0 } }))
    .sort((a, b) => a.dep - b.dep);
  const open = $('#tomorrow').open;
  $('#tomorrow').innerHTML = tmw.length
    ? `<summary><span>Mañana (${dowOf(tm)}): <b>${tmw.length}</b> trenes, el primero a las <b>${hm(tmw[0].dep)}</b></span></summary><ol class="later plain">${tmw.map(x => `<li><span class="t num">${hm(x.dep)}</span>${badge(x.t)}<span class="d">${esc(x.t.h)}</span></li>`).join('')}</ol>`
    : `<summary><span>Mañana (${dowOf(tm)}): sin trenes en el horario</span></summary>`;
  $('#tomorrow').open = open;
  renderLastBack();
  renderWxMini();
  renderIncMini();
  renderMap();
}
function renderLastBack() {
  const sj = idxOf('Santa Justa'); const el = $('#lastBack');
  if (sj == null) { el.innerHTML = ''; return; }
  const now = nowAbs(); const today = Math.floor((now - 240) / 1440); // el día de servicio cambia a las 4:00
  const cand = instances().filter(x => x.t.hi > 0 && x.t.pos[sj] != null && x.t.pos[sj] < x.t.hi)
    .map(x => ({ x, dep: x.off + x.t.t[x.t.pos[sj]][2], arr: x.off + x.t.t[x.t.hi][1] }));
  const todays = cand.filter(c => c.x.dayN === today).sort((a, b) => b.dep - a.dep);
  if (!todays.length) { el.innerHTML = ''; return; }
  const last = todays[0];
  if (last.dep >= now) {
    el.innerHTML = `Último tren de vuelta desde Santa Justa: <b class="num">${hm(last.dep)}</b> (${esc(last.x.t.l)}, llega a ${esc(S.sched.homeName)} a las ${hm(last.arr)}).`;
  } else {
    const next = cand.filter(c => c.dep > now).sort((a, b) => a.dep - b.dep)[0];
    el.innerHTML = `Hoy ya no quedan trenes de vuelta desde Santa Justa${next ? `. El siguiente sale a las <b class="num">${hm(next.dep)}</b>${dayTag(next.dep) ? ` (${dayTag(next.dep)})` : ''}` : ''}.`;
  }
}
function renderIncMini() {
  const act = activeAlerts().filter(a => a.home);
  $('#incMini').innerHTML = act.slice(0, 2).map(a => `<div class="inc"><h3>${esc(a.h || 'Aviso de Renfe')}</h3><p>${linkPhones(a.d)}</p><p class="sub"><a href="#avisos">Ver avisos</a></p></div>`).join('');
}

/* ---------- Mapa de la línea ---------- */
function trainPos(inst) {
  const t = inst.t, r = liveRec(t), v = r?.v;
  if (v) {
    const si = v.sid != null ? S.sched.stops[v.sid] : undefined;
    const stc = String(v.st).toUpperCase();
    if (si != null && t.pos[si] != null) {
      const i = t.pos[si];
      if (stc.includes('STOPPED') || stc === '1' || i === 0) return { a: si, b: si, f: 0, real: true };
      return { a: t.t[i - 1][0], b: si, f: stc.includes('INCOMING') || stc === '0' ? 0.8 : 0.5, real: true };
    }
    if (v.lat && v.lon) {
      let best = null, bd = 1e9;
      for (const [s] of t.t) { const st = S.sched.stations[s]; const d = (st.lat - v.lat) ** 2 + (st.lon - v.lon) ** 2; if (d < bd) { bd = d; best = s; } }
      if (best != null) return { a: best, b: best, f: 0, real: true };
    }
  }
  const m = Math.round((r?.d ?? 0) / 60);
  const now = nowAbs() - inst.off - Math.max(0, m);
  const seq = t.t;
  if (now < seq[0][2] || now > seq[seq.length - 1][1]) return null;
  for (let i = 0; i < seq.length; i++) {
    if (now >= seq[i][1] && now <= seq[i][2]) return { a: seq[i][0], b: seq[i][0], f: 0 };
    if (i < seq.length - 1 && now > seq[i][2] && now < seq[i + 1][1]) return { a: seq[i][0], b: seq[i + 1][0], f: (now - seq[i][2]) / (seq[i + 1][1] - seq[i][2]) };
  }
  return null;
}
function renderMap() {
  const names = (C.MAP || []).map(idxOf).filter(i => i != null);
  if (names.length < 2) { $('#map').innerHTML = '<p class="empty">Sin esquema de la línea.</p>'; return; }
  const k = {}; names.forEach((s, i) => { k[s] = i; });
  const ROW = 46, TOP = 8;
  const now = nowAbs();
  const marks = [];
  for (const inst of instances()) {
    const t = inst.t, r = liveRec(t);
    if (r?.x) continue;
    if (now < inst.off + t.t[0][2] - 1 || now > inst.off + t.t[t.t.length - 1][1] + 60) continue;
    const p = trainPos(inst); if (!p) continue;
    let y;
    if (k[p.a] != null && k[p.b] != null) y = k[p.a] + (k[p.b] - k[p.a]) * p.f;
    else if (k[p.a] != null && p.f < 0.35) y = k[p.a];
    else if (k[p.b] != null && p.f > 0.65) y = k[p.b];
    else continue;
    const goingN = t.dir ? t.dir === 'N' : (S.sched.stations[t.t[t.t.length - 1][0]].lat > S.sched.stations[t.t[0][0]].lat);
    const m = Math.round((delayAt(t, t.t.length - 1) ?? r?.d ?? 0) / 60);
    let when = '';
    if (t.hi >= 0) {
      const ht = inst.off + (t.hi === t.t.length - 1 ? t.t[t.hi][1] : t.t[t.hi][2]) + Math.max(0, m);
      when = t.hi === t.t.length - 1 ? `llega ${hm(ht)}` : ht >= now ? `por ${S.sched.homeName} ${hm(ht)}` : `salió ${hm(ht)}`;
    }
    marks.push({ y, t, real: !!p.real, up: goingN, m, when });
  }
  marks.sort((a, b) => a.y - b.y);
  let prev = -9, shift = 0;
  const html = marks.map(mk => {
    shift = mk.y - prev < 0.55 ? shift + 1 : 0; prev = mk.y;
    const top = TOP + mk.y * ROW + ROW / 2 + shift * 22;
    const bg = `#${lineColor(mk.t)}`, fg = textColor(lineColor(mk.t));
    const lbl = `${mk.t.l === 'Regional' ? 'R' : mk.t.l} → ${mk.t.h}${mk.when ? ` · ${mk.when}` : ''}${mk.m > 1 ? ` · +${mk.m}` : ''}`;
    return `<div class="trn ${mk.real ? '' : 'est'}" style="top:${top}px"><i style="background:${bg};color:${fg}">${mk.up ? '↑' : '↓'}</i><span class="p ${mk.real ? '' : 'est'}" style="background:${bg};color:${fg}">${esc(lbl)}</span></div>`;
  }).join('');
  $('#map').innerHTML = `<div class="rail"></div>${names.map(s => `<div class="stn ${s === S.sched.home ? 'h' : ''}">${esc(sn(s))}</div>`).join('')}${html}${marks.length ? '' : '<p class="sub" style="padding:0 16px">Ahora mismo no hay trenes en este tramo.</p>'}`;
}

/* ---------- Vuelta ---------- */
function originIdx() {
  const want = S.origin || params.get('de') || store.get('origin', 'Santa Justa');
  let i = idxOf(want);
  if (i == null || i === S.sched.home) i = idxOf('Santa Justa') ?? S.sched.stations.findIndex((_, j) => j !== S.sched.home);
  return i;
}
function durations() {
  const H = S.sched.home, acc = {};
  for (const t of S.sched.trips) {
    if (t.hi <= 0) continue;
    for (let i = 0; i < t.hi; i++) (acc[t.t[i][0]] ||= []).push(t.t[t.hi][1] - t.t[i][2]);
  }
  return Object.entries(acc).map(([s, v]) => { v.sort((a, b) => a - b); return { s: +s, m: Math.round(v[Math.floor(v.length / 2)]) }; })
    .filter(x => x.s !== H && x.m <= 120).sort((a, b) => S.sched.stations[b.s].lat - S.sched.stations[a.s].lat);
}
function renderVuelta() {
  const oi = originIdx();
  $('#originName').textContent = sn(oi);
  const list = backTrips(oi);
  $('#backCards').innerHTML = list.length ? list.slice(0, 2).map((x, j) => {
    const t = x.t, st = x.st, mins = x.est - nowAbs(), day = dayTag(x.dep);
    return `<article class="card ${j === 0 ? 'hero' : ''} ${st.k === 'x' ? 'x' : ''}">
      <div class="c-top">${badge(t)}<span class="dest">${esc(t.h)}</span>${day ? `<span class="day">· ${esc(day)}</span>` : ''}</div>
      <div class="c-main"><div class="big num">${st.k === 'late' ? `${hm(x.est)}<s>${hm(x.dep)}</s>` : hm(x.dep)}</div><div class="when">${stTag(st)}<b>${st.k === 'x' ? 'No sale' : mins < 1 ? 'Saliendo' : `en ${dur(mins)}`}</b></div></div>
      <div class="facts"><span>Sale de <b>${esc(sn(oi))}</b></span><span>Llega a ${esc(S.sched.homeName)} a las <b>${hm(x.arr)}</b> · ${Math.round(x.arr - x.est)} min</span>${x.i === 0 ? '' : `<span>Viene de ${esc(sn(t.t[0][0]))}</span>`}</div>
      <button class="share" type="button" data-share="${esc(`Vuelvo a ${S.sched.homeName} en el ${t.l} de las ${hm(x.dep)} desde ${sn(oi)}; llego a las ${hm(x.arr)}.`)}">Avisa a quien te espera</button>
    </article>`;
  }).join('') : `<p class="empty">No hay trenes de ${esc(sn(oi))} a ${esc(S.sched.homeName)} en las próximas horas.</p>`;
  $('#backLater').innerHTML = list.slice(2, 12).map(x => `<li><span class="t num">${hm(x.est)}</span>${badge(x.t)}<span class="d">llega ${hm(x.arr)}${dayTag(x.dep) ? ` · ${dayTag(x.dep)}` : ''}</span>${stTag(x.st.k === 'nd' ? { ...x.st, txt: 'Sin dato' } : x.st)}</li>`).join('');
  const d = durations();
  const item = x => `<li><button type="button" data-origin="${esc(sn(x.s))}" class="${x.s === oi ? 'on' : ''}"><span>${esc(sn(x.s))}</span><b>${x.m} min</b></button></li>`;
  $('#durations').innerHTML = d.map(item).join('');
  $('#originList').innerHTML = d.map(item).join('');
}

/* ---------- Cómo va (puntualidad) ---------- */
function renderStats() {
  const el = $('#stats');
  if (!S.hist) { el.innerHTML = `<div class="skel"></div>`; return; }
  const today = Math.floor(nowAbs() / 1440);
  const all = Object.values(S.hist).filter(r => dn(r.day) > today - 8 && (r.fz || dn(r.day) < today));
  const recs = all.filter(r => r.dir === S.dir);
  const dirName = S.dir === 'N' ? 'hacia Sevilla' : 'hacia Lebrija y Cádiz';
  if (!recs.length) {
    el.innerHTML = `<div class="kpi"><h2>Aún no hay historial ${dirName}</h2><p class="sub">Se va llenando solo según salen los trenes de ${esc(S.sched.homeName)}. En unas horas verás aquí cuántos salen a su hora.</p></div>`;
    return;
  }
  const withD = recs.filter(r => !r.x && r.dl != null);
  const on = withD.filter(r => r.dl <= 3);
  const late = withD.filter(r => r.dl > 3);
  const pct = withD.length ? Math.round(on.length / withD.length * 100) : 0;
  const x = recs.filter(r => r.x).length, nd = recs.filter(r => !r.x && r.dl == null).length;
  const avgLate = late.length ? Math.round(late.reduce((s, r) => s + r.dl, 0) / late.length) : 0;
  const days = new Set(recs.map(r => r.day)).size;
  const bands = [[0, 480, 'Antes de 8'], [480, 660, '8 a 11'], [660, 840, '11 a 14'], [840, 1020, '14 a 17'], [1020, 1200, '17 a 20'], [1200, 3000, 'Desde 20']]
    .map(([a, b, n]) => { const rs = withD.filter(r => r.s >= a && r.s < b); return { n, c: rs.length, avg: rs.length ? rs.reduce((s, r) => s + Math.max(0, r.dl), 0) / rs.length : 0, ok: rs.length ? Math.round(rs.filter(r => r.dl <= 3).length / rs.length * 100) : 0 }; });
  const max = Math.max(1, ...bands.map(b => b.avg));
  const top = [...withD].sort((a, b) => b.dl - a.dl).slice(0, 5);
  el.innerHTML = `
    <div class="kpi"><div class="pct num">${pct}%</div>
      <p><b>de los trenes ${dirName} salió de ${esc(S.sched.homeName)} a su hora</b> en los últimos ${days === 1 ? 'día' : `${Math.min(days, 7)} días`}: ${on.length} de ${withD.length}, con hasta 3 minutos de margen según Renfe.</p></div>
    <div class="kpis">
      <div><b class="num">${x}</b><span>suprimidos</span></div>
      <div><b class="num">${avgLate} min</b><span>retraso medio de los que salieron tarde</span></div>
      <div><b class="num">${nd}</b><span>sin dato de Renfe</span></div>
    </div>
    <section class="block"><h2>Retraso medio según la hora</h2>
      <div class="bars">${bands.map(b => `<div class="bar"><span>${b.n}</span><span class="tr"><i style="width:${(b.avg / max * 100).toFixed(1)}%"></i></span><span class="v">${b.c ? `${b.avg.toFixed(1)} min · ${b.ok}%` : 'sin datos'}</span></div>`).join('')}</div>
      <p class="sub">Minutos de retraso al salir de ${esc(S.sched.homeName)} y porcentaje que salió a su hora.</p></section>
    <section class="block"><h2>Los que más se retrasaron</h2>
      <ol class="rank">${top.length ? top.map(r => `<li><span>${esc(r.l)} a ${esc(r.h)}, ${hm(r.s)}<small>${dayLabel(dn(r.day))}</small></span><b>${r.dl} min</b></li>`).join('') : '<li>Sin retrasos registrados.</li>'}</ol></section>`;
}

/* ---------- Avisos ---------- */
function activeAlerts() {
  if (!S.alerts) return [];
  return Object.entries(S.alerts).filter(([, a]) => a.on).map(([id, a]) => ({ id, ...a })).sort((a, b) => b.home - a.home);
}
function linkPhones(s) {
  return esc(s).replace(/(\+?34\s?)?([6789]\d{2})[\s.]?(\d{3})[\s.]?(\d{3})/g, (m, p, a, b, c) => `<a href="tel:+34${a}${b}${c}">${a} ${b} ${c}</a>`);
}
function sinceTxt(sec) {
  const d = Math.max(0, Math.floor((Date.now() / 1000 - sec) / 86400));
  return d === 0 ? 'desde hoy' : d === 1 ? 'desde ayer' : `desde hace ${d} días`;
}
function renderAvisos() {
  const act = activeAlerts();
  $('#incidents').innerHTML = !S.alerts ? '<div class="skel"></div>' : act.length
    ? act.map(a => `<div class="inc"><h3>${esc(a.h || 'Aviso de Renfe')}</h3><p>${linkPhones(a.d)}</p><p class="sub">Renfe lo comunica ${sinceTxt(a.start || a.first)}</p></div>`).join('')
    : `<p class="note">Renfe no informa ahora mismo de incidencias que afecten a ${esc(S.sched?.homeName || C.PLACE)}.</p>`;
  const acc = act.filter(a => /ascensor|escalera|accesib|rampa/i.test(`${a.h} ${a.d}`));
  $('#access').innerHTML = acc.length ? acc.map(a => {
    const since = a.start || a.first; const days = Math.max(0, Math.floor((Date.now() / 1000 - since) / 86400));
    const d = new Date(since * 1000);
    return `<div class="kpi"><div class="pct num">${days}</div><p><b>${days === 1 ? 'día' : 'días'} con ${/escalera/i.test(a.h + a.d) ? 'la escalera mecánica' : 'el ascensor'} fuera de servicio</b>, desde el ${d.getDate()} de ${MON[d.getMonth()]}.</p><p class="sub">${linkPhones(a.d || a.h)}</p></div>`;
  }).join('') : `<p class="note">Ninguna avería de ascensores o accesos comunicada por Renfe ahora mismo.</p>`;
  $('#avisoDot').hidden = !act.some(a => a.home);
}

/* ---------- Tiempo ---------- */
const WX = c => c === 0 ? ['Despejado', 'sun'] : c <= 2 ? ['Poco nuboso', 'part'] : c === 3 ? ['Nublado', 'cloud'] : c <= 48 ? ['Niebla', 'fog']
  : c <= 57 ? ['Llovizna', 'rain'] : c <= 67 ? ['Lluvia', 'rain'] : c <= 77 ? ['Nieve', 'snow'] : c <= 82 ? ['Chubascos', 'rain'] : c <= 86 ? ['Nieve', 'snow'] : ['Tormenta', 'storm'];
function icon(kind, day = true) {
  const sun = day ? '<circle cx="12" cy="12" r="4.5" fill="#f2a516"/><g stroke="#f2a516" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g>'
    : '<path d="M15.5 3.5a8 8 0 1 0 5 13.6 7 7 0 0 1-5-13.6Z" fill="#c9b8e8"/>';
  const cloud = (x = 0, y = 0, f = 'currentColor') => `<path transform="translate(${x} ${y})" d="M7 19a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 10a3.5 3.5 0 0 1 .5 7H7Z" fill="${f}" opacity=".55"/>`;
  const body = {
    sun, part: `<g transform="translate(-3 -3) scale(.8)">${sun}</g>${cloud(1, 2)}`, cloud: cloud(0, 0), fog: `${cloud(0, -2)}<path d="M4 20h16M6 22.5h12" stroke="currentColor" stroke-width="1.6" opacity=".6"/>`,
    rain: `${cloud(0, -3)}<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#3b82c4" stroke-width="2" stroke-linecap="round"/>`,
    snow: `${cloud(0, -3)}<g fill="#7fb3e0"><circle cx="8" cy="20" r="1.3"/><circle cx="12" cy="21" r="1.3"/><circle cx="16" cy="20" r="1.3"/></g>`,
    storm: `${cloud(0, -3)}<path d="M12 16l-2.5 4h3l-1.5 3.5" stroke="#f2a516" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  }[kind];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
async function fetchWx() {
  const P = C.WEATHER || []; if (!P.length) return;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${P.map(p => p.lat)}&longitude=${P.map(p => p.lon)}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day&hourly=temperature_2m,precipitation_probability,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FMadrid&forecast_days=7`;
  try { const j = await getJSON(url); const arr = Array.isArray(j) ? j : [j]; S.wx = {}; P.forEach((p, i) => { S.wx[p.name] = arr[i]; }); }
  catch (e) { /* sin tiempo */ }
}
function rainSoon(w) {
  const h = w.hourly; const i = h.time.findIndex(t => t >= w.current.time.slice(0, 13));
  const p = Math.max(0, ...h.precipitation_probability.slice(Math.max(0, i), i + 3).filter(v => v != null));
  return p >= 20 ? `${p} % de lluvia` : 'sin lluvia';
}
function renderWxMini() {
  const el = $('#wxMini'); if (!S.wx) { el.innerHTML = ''; return; }
  const names = S.dir === 'N' ? ['Sevilla'] : ['Lebrija', 'Cádiz'];
  el.innerHTML = `<div class="wx">${names.filter(n => S.wx[n]).map(n => { const w = S.wx[n], c = w.current, [txt, k] = WX(c.weather_code); return `<a class="w" href="#tiempo" style="text-decoration:none;color:inherit">${icon(k, c.is_day)}<div><b class="num">${Math.round(c.temperature_2m)}°</b><small>${esc(n)} · ${txt.toLowerCase()}, ${rainSoon(w)}</small></div></a>`; }).join('')}</div>`;
}
function renderTiempo() {
  const el = $('#weather');
  if (!S.wx) { el.innerHTML = '<div class="skel"></div>'; return; }
  const main = S.wx[(C.WEATHER || [])[0]?.name]; if (!main) { el.innerHTML = '<p class="empty">No hay previsión disponible.</p>'; return; }
  const c = main.current, [txt, k] = WX(c.weather_code), h = main.hourly;
  const i0 = Math.max(0, h.time.findIndex(t => t >= c.time.slice(0, 13)));
  const hours = h.time.slice(i0, i0 + 14).map((t, j) => { const q = i0 + j; return `<div><span>${t.slice(11, 13)} h</span>${icon(WX(h.weather_code[q])[1], h.is_day[q])}<b>${Math.round(h.temperature_2m[q])}°</b><span>${h.precipitation_probability[q] ?? 0}%</span></div>`; }).join('');
  const d = main.daily;
  const days = d.time.map((t, j) => `<li><span>${j === 0 ? 'Hoy' : j === 1 ? 'Mañana' : DOW[new Date(t + 'T12:00:00Z').getUTCDay()].replace(/^./, s => s.toUpperCase())}</span>${icon(WX(d.weather_code[j])[1])}<span class="rain">${d.precipitation_probability_max[j] ?? 0} % lluvia</span><b class="num">${Math.round(d.temperature_2m_min[j])}° / ${Math.round(d.temperature_2m_max[j])}°</b></li>`).join('');
  const others = (C.WEATHER || []).slice(1).filter(p => S.wx[p.name]).map(p => { const w = S.wx[p.name], cc = w.current, [tt, kk] = WX(cc.weather_code); return `<div class="w">${icon(kk, cc.is_day)}<div><b class="num">${Math.round(cc.temperature_2m)}°</b><small>${esc(p.name)} · ${tt.toLowerCase()}, ${rainSoon(w)}</small></div></div>`; }).join('');
  el.innerHTML = `<div class="wbig">${icon(k, c.is_day)}<div class="temp num">${Math.round(c.temperature_2m)}°</div><div><b>${esc((C.WEATHER[0] || {}).name)}</b> · ${txt}. Sensación de ${Math.round(c.apparent_temperature)}°, viento ${Math.round(c.wind_speed_10m)} km/h.</div></div>
    <div class="hours" tabindex="0" aria-label="Próximas horas">${hours}</div>
    <section class="block"><h2>Próximos días</h2><ul class="days">${days}</ul></section>
    <section class="block"><h2>Donde vas</h2><div class="wx">${others}</div><p class="sub">Previsión de Open-Meteo.</p></section>`;
}

/* ---------- Más ---------- */
function renderMas() {
  $('#newsList').innerHTML = (C.NEWS || []).map(n => `<li>${esc(n.text)} <small>${esc(n.date)}</small></li>`).join('');
  const modes = { direct: 'directamente de Renfe, cada 20 segundos', proxy: 'de Renfe a través de tu proxy, cada 20 segundos', respaldo: 'del recolector de la app, que consulta Renfe cada 30 segundos y publica cada minuto', none: 'sin conexión: se muestra el horario' };
  const gen = S.sched ? new Date(S.sched.generated * 1000) : null;
  $('#about').innerHTML = `<p>Horario programado y retrasos de <b>Renfe Operadora</b> (data.renfe.com): Cercanías Sevilla y Media Distancia. Ahora mismo los retrasos llegan ${modes[S.liveMode] || 'conectando…'}. Cuando Renfe no da dato, se muestra la hora del horario.</p>
    <p class="sub">${gen ? `Horario actualizado el ${gen.getDate()} de ${MON[gen.getMonth()]} a las ${String(gen.getHours()).padStart(2, '0')}:${String(gen.getMinutes()).padStart(2, '0')}. ` : ''}${S.sched ? `${S.sched.trips.length} trenes por ${esc(S.sched.homeName)} en el horario.` : ''}</p>`;
  $$('#themeSeg button').forEach(b => b.setAttribute('aria-selected', String((document.documentElement.dataset.theme || '') === b.dataset.theme)));
}

/* ---------- Cabecera, aviso de novedades ---------- */
function tick() {
  const now = nowAbs(), m = now % 1440, h = Math.floor(m / 60);
  $('#clock').textContent = hm(m);
  $('#greet').textContent = `${h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'}, ${C.PLACE || 'Utrera'}`;
  const live = $('#live'); const age = S.live.ts ? Math.max(0, (Date.now() - S.live.ts) / 1000) : null;
  let cls = '', b = 'Conectando…', em = '';
  if (S.liveMode === 'none') { b = 'Sólo horario'; em = 'sin conexión con Renfe'; }
  else if (age != null) {
    cls = age < 300 ? 'on' : 'slow'; b = age < 300 ? 'En directo' : 'Datos antiguos';
    em = age < 60 ? `hace ${Math.round(age)} s` : age < 3600 ? `hace ${Math.round(age / 60)} min` : `hace ${Math.round(age / 3600)} h`;
  }
  live.className = `live ${cls}`; $('b', live).textContent = b; $('em', live).textContent = em ? `· ${em}` : '';
}
function renderNews() {
  const n = (C.NEWS || [])[0]; const seen = store.get('newsSeen', '');
  $('#news').innerHTML = n && seen !== n.id && S.tab === 'ahora' ? `<div class="banner"><span>Novedad: ${esc(n.text)} <a href="#novedades">Ver novedades</a></span><button type="button" aria-label="Cerrar aviso" data-close-news="${esc(n.id)}">×</button></div>` : '';
}

/* ---------- Navegación ---------- */
const TABS = ['ahora', 'vuelta', 'como-va'];
const MAS = ['novedades', 'escribeme', 'instalar', 'legal'];
function route() {
  let h = decodeURIComponent((location.hash || '').slice(1));
  if (!h) h = params.get('vuelta') ? 'vuelta' : params.get('de') ? 'vuelta' : 'ahora';
  if (TABS.includes(h)) { S.view = 'tren'; S.tab = h; }
  else if (MAS.includes(h) || h === 'mas') S.view = 'mas';
  else if (['avisos', 'tiempo'].includes(h)) S.view = h;
  else { S.view = 'tren'; }
  $$('.view').forEach(v => v.classList.toggle('on', v.id === `v-${S.view}`));
  $$('.tab').forEach(v => v.classList.toggle('on', v.id === `t-${S.tab}`));
  $$('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === S.tab));
  $('#v-tren').classList.toggle('no-dir', S.tab === 'vuelta');
  $$('.bottom a').forEach(a => { const on = a.dataset.view === S.view; a.classList.toggle('on', on); a.toggleAttribute('aria-current', on); });
  render();
  if (MAS.includes(h)) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: 'smooth' }), 30);
  else window.scrollTo(0, 0);
}
function render() {
  $$('.seg[role=tablist] button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.dir === S.dir)));
  renderNews(); tick();
  if (!S.sched) {
    $('#cards').innerHTML = S.err ? `<p class="note">${esc(S.err)}</p>` : '<div class="skel"></div><div class="skel" style="height:120px"></div>';
    if (S.view === 'avisos') renderAvisos();
    if (S.view === 'tiempo') renderTiempo();
    if (S.view === 'mas') renderMas();
    return;
  }
  try {
    if (S.view === 'tren') { if (S.tab === 'ahora') renderAhora(); else if (S.tab === 'vuelta') renderVuelta(); else renderStats(); }
    else if (S.view === 'avisos') renderAvisos();
    else if (S.view === 'tiempo') renderTiempo();
    else renderMas();
    $('#avisoDot').hidden = !activeAlerts().some(a => a.home);
  } catch (e) { console.error(e); }
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.tm); toast.tm = setTimeout(() => { t.hidden = true; }, 2600); }
async function share(text) {
  const url = location.origin + location.pathname;
  try { if (navigator.share) { await navigator.share({ title: C.NAME, text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copiado. Pégalo donde quieras.'); } catch (e) { toast(url); }
}

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button,[data-dir]'); if (!b) return;
  if (b.dataset.dir) { S.dir = b.dataset.dir; store.set('dir', S.dir); render(); }
  else if (b.dataset.share != null) share(b.dataset.share);
  else if (b.id === 'shareApp') share(`Para saber cuándo pasa el próximo tren por ${C.PLACE} y si va con retraso:`);
  else if (b.dataset.closeNews) { store.set('newsSeen', b.dataset.closeNews); renderNews(); }
  else if (b.dataset.origin) { S.origin = b.dataset.origin; store.set('origin', S.origin); $('#originDlg').open && $('#originDlg').close(); renderVuelta(); $('#t-vuelta').scrollIntoView({ behavior: 'smooth' }); }
  else if (b.id === 'changeOrigin') { const d = $('#originDlg'); if (d.showModal) d.showModal(); }
  else if (b.dataset.theme != null && b.closest('#themeSeg')) {
    const t = b.dataset.theme; if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { if (!t) localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch (er) { /* */ }
    renderMas();
  }
});
window.addEventListener('hashchange', route);
$('#contact').addEventListener('submit', e => {
  e.preventDefault();
  const msg = $('#cMsg').value.trim(), name = $('#cName').value.trim(); const out = $('#cOut');
  if (!msg) return;
  const body = `${msg}\n\n${name ? `— ${name}` : ''}`;
  if (C.CONTACT_URL) { window.open(`${C.CONTACT_URL}${C.CONTACT_URL.includes('?') ? '&' : '?'}title=${encodeURIComponent(msg.slice(0, 60))}&body=${encodeURIComponent(body)}`, '_blank', 'noopener'); out.textContent = 'Se ha abierto una pestaña para enviarlo. Gracias.'; }
  else if (C.CONTACT_EMAIL) { location.href = `mailto:${C.CONTACT_EMAIL}?subject=${encodeURIComponent('Próximo tren')}&body=${encodeURIComponent(body)}`; out.textContent = `Se abrirá tu correo. Si no, escribe a ${C.CONTACT_EMAIL}.`; }
  else out.textContent = 'El contacto aún no está configurado.';
});
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').hidden = true; });
if (/iphone|ipad|ipod/i.test(navigator.userAgent)) $('#installTxt').textContent = 'En iPhone: abre esta página en Safari, toca el botón de compartir y elige «Añadir a pantalla de inicio».';
if (matchMedia('(display-mode: standalone)').matches) $('#installTxt').textContent = 'Ya la tienes instalada.';

/* ---------- Carga ---------- */
async function loadSched() {
  try {
    const s = await getJSON(`${DATA}schedule.json?d=${Math.floor(Date.now() / 3.6e6)}`, 20000);
    S.sched = prep(s); S.inst = null; S.err = '';
    const today = Math.floor(nowAbs() / 1440);
    if (today - S.sched.baseN >= S.sched.days) S.err = 'El horario está caducado: se actualizará en cuanto el recolector vuelva a funcionar.';
  } catch (e) {
    if (!S.sched) S.err = 'No he podido cargar el horario. Lo vuelvo a intentar en unos segundos…';
    setTimeout(loadSched, 15000);
  }
  render();
}
async function loadSide() {
  const [h, a] = await Promise.allSettled([getJSON(`${DATA}history.json?t=${Date.now()}`), getJSON(`${DATA}alerts.json?t=${Date.now()}`)]);
  if (h.status === 'fulfilled') S.hist = h.value; else if (!S.hist) S.hist = {};
  if (a.status === 'fulfilled') S.alerts = a.value; else if (!S.alerts) S.alerts = {};
  if (['avisos'].includes(S.view) || S.tab === 'como-va' || S.tab === 'ahora') render();
}
async function liveLoop() { await fetchLive(); render(); setTimeout(liveLoop, (C.REFRESH_S || 20) * 1000); }

route();
loadSched().then(() => { liveLoop(); loadSide(); });
fetchWx().then(render);
setInterval(tick, 1000);
setInterval(() => { if (!document.hidden) render(); }, 30000);
setInterval(loadSide, 120000);
setInterval(fetchWx, 15 * 60000);
setInterval(loadSched, 6 * 3600000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { fetchLive().then(render); } });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
