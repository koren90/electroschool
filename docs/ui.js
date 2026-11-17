// ElectroSchool – editor a ovládání simulace.
(function () {
'use strict';
const ES = window.ES, $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage'), dlg = $('#dlg'), form = $('#dlgform');
const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.es;
const G = 3, snap = v => Math.round(v / G) * G;

let doc = { items: [], trailer: ES.DEFAULT_TRAILER, real: ES.emptyReal() }, fileName = 'Bez názvu.cad', filePath = null, dirty = false, ver = 0;
const view = { s: 4, ox: 40, oy: 40 }, view_ = view;
let tool = { kind: 'select' }, sel = new Set(), sim = null, simTimer = null, pressed = null;
let undoStack = [], redoStack = [], clip = [], drag = null, spaceDown = false, placeRot = 0;
const mouse = { x: 0, y: 0, rx: 0, ry: 0, in: false };
let jcache = { ver: -1, set: null }, hover = null;
const hover_ = () => hover;
// prvky svázané označením s prvkem pod kurzorem / vybraným prvkem (zvýrazní se oranžově)
function linkedSet() {
  const src = hover || (sel.size === 1 ? doc.items.find(i => sel.has(i.uid)) : null);
  if (!src || tool.kind !== 'select') return null;
  const d = ES.getDef(src.type), k = ES.norm(src.t[0]);
  if (!k || !d.terms || !d.terms.length || d.kind === 'supply' || d.noAuto || d.kind === 'motor3' || d.kind === 'motorYD' || d.kind === 'motor1') return null;
  const out = new Set(); for (const i of doc.items) if (i !== src && ES.norm(i.t[0]) === k) { const e = ES.getDef(i.type); if (e.kind !== 'supply' && !e.noAuto) out.add(i.uid); }
  return out.size ? out : null;
}
function linkHint(it) {
  const k = ES.norm(it.t[0]); if (!k) return '';
  const group = doc.items.filter(i => ES.norm(i.t[0]) === k && ES.getDef(i.type).terms && ES.getDef(i.type).kind !== 'supply' && !ES.getDef(i.type).noAuto);
  if (group.length < 2) return '';
  const cnt = {}; for (const i of group) { const n = ES.getDef(i.type).name; cnt[n] = (cnt[n] || 0) + 1; }
  return it.t[0] + ' je svázané označením s: ' + Object.entries(cnt).map(([n, c]) => (c > 1 ? c + '× ' : '') + n.toLowerCase()).join(', ') + ' (oranžově).';
}

// ------------------------------------------------------------ pomocné
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function touch() { ver++; dirty = true; title(); }
function title() {
  document.title = (dirty ? '• ' : '') + fileName + ' – ElectroSchool';
  if (native) native.postMessage({ cmd: 'title', name: fileName, dirty });
}
function snap_() { return JSON.stringify({ items: doc.items, real: doc.real }); }
function pushUndo() { undoStack.push(snap_()); if (undoStack.length > 150) undoStack.shift(); redoStack = []; }
function restore(json) { const j = JSON.parse(json); if (Array.isArray(j)) doc.items = j; else { doc.items = j.items; doc.real = j.real || ES.emptyReal(); } sel = new Set(); rsel = new Set(); rwsel = -1; touch(); render(); }
function hint(s) { $('#hint').textContent = s; }
const HINTS = {
  select: 'Výběr: klik = vybrat, tažení prvku = přesun, dvojklik = vlastnosti, R = otočit, ⌫ = smazat. Tažení prázdné plochy posouvá výkres, Shift + tažení vybere oblast. Zoom: dva prsty nebo ⌘ + kolečko.',
  band: 'Oblast: tažením přes prvky je vyberete. Pak je lze přesunout nebo smazat.',
  place: 'Kliknutím vložíte součástku. R = otočit, Esc = konec.',
  wire: 'Vodič: klik = začátek, další kliky = lomové body, konec na svorce nebo dvojklikem. Odbočka z vodiče vytvoří tečku; křížení bez tečky spojené není. Shift = obrátit lomení, Esc = konec.',
  gfx: 'Tažením nakreslíte tvar. Esc = konec.',
  text: 'Kliknutím umístíte text.',
  sim: 'SIMULACE: klikáním ovládáte jističe, tlačítka a spínače (Shift + klik = tlačítko zůstane stisknuté). Klik na tepelné relé = vybavení, na pojistku = přepálení/výměna. Najetím myší změříte napětí.',
};

function ask(html, buttons) {
  return new Promise(res => {
    form.innerHTML = html + '<div class="btns">' + buttons.map((b, i) => '<button value="' + b[0] + '"' + (i === buttons.length - 1 ? ' class="primary" autofocus' : '') + '>' + b[1] + '</button>').join('') + '</div>';
    dlg.returnValue = '';
    // Enter potvrdí dialog (jako OK), Esc zruší – kromě víceřádkového pole a otevřeného výběru
    form.onkeydown = e => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      e.preventDefault(); dlg.close(buttons[buttons.length - 1][0]);
    };
    dlg.onclose = () => res(dlg.returnValue);
    dlg.showModal();
  });
}
async function confirmDiscard() {
  if (!dirty) return true;
  return (await ask('<h2>Zahodit neuložené změny?</h2><p>Schéma „' + esc(fileName) + '“ obsahuje změny, které nejsou uložené.</p>', [['no', 'Zrušit'], ['yes', 'Zahodit']])) === 'yes';
}

// ------------------------------------------------------------ kódování souboru
const enc1250 = (() => { const m = new Map(); try { const d = new TextDecoder('windows-1250'); for (let b = 128; b < 256; b++) m.set(d.decode(new Uint8Array([b])), b); } catch (e) {} return m; })();
function decodeBytes(u8) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) {}
  try { return new TextDecoder('windows-1250').decode(u8); } catch (e) { return Array.from(u8, b => String.fromCharCode(b)).join(''); }
}
function encodeText(s) {
  const out = new Uint8Array(s.length); let ok = true;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 128) out[i] = c; else if (enc1250.has(s[i])) out[i] = enc1250.get(s[i]); else { ok = false; break; } }
  return ok ? out : new TextEncoder().encode(s);
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

// ------------------------------------------------------------ geometrie / hit-test
function itemBox(it) {
  const d = ES.getDef(it.type), n = it.n;
  if (d.kind === 'wire' || d.kind === 'gfx') return [Math.min(n[8], n[10]), Math.min(n[9], n[11]), Math.max(n[8], n[10]), Math.max(n[9], n[11])];
  if (d.kind === 'text') { const h = Math.max(2.6, Math.abs(n[11] - n[9]) || 3.4); return [n[8], n[9], n[8] + Math.max(4, (it.extra || '').length * h * 0.55), n[9] + h]; }
  if (d.kind === 'node') return [n[8] - 1, n[9] - 1, n[8] + 1, n[9] + 1];
  if (d.kind === 'unknown') return [n[8] + n[12], n[9] + n[13], n[8] + Math.max(n[14], n[12] + 3), n[9] + Math.max(n[15], n[13] + 3)];
  const b = ES.bboxOf(it); return [n[8] + b[0], n[9] + b[1], n[8] + b[2], n[9] + b[3]];
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy; let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
function hit(x, y) {
  const its = doc.items; let best = null;
  for (let i = its.length - 1; i >= 0; i--) {
    const it = its[i], k = ES.getDef(it.type).kind;
    if (k === 'wire' || k === 'gfx' || k === 'node') continue;
    const b = itemBox(it); if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) {
      // přednost má prvek, jehož střed je blíž
      const dd = Math.hypot(x - (b[0] + b[2]) / 2, y - (b[1] + b[3]) / 2); if (!best || dd < best[1]) best = [it, dd];
    }
  }
  const tol = Math.max(1.2, 5 / view.s);
  for (let i = its.length - 1; i >= 0; i--) { const it = its[i], n = it.n; if (ES.WIRE.has(it.type) && segDist(x, y, n[8], n[9], n[10], n[11]) < tol) return (best && best[1] < 3) ? best[0] : it; }
  if (best) return best[0];
  for (let i = its.length - 1; i >= 0; i--) {
    const it = its[i], d = ES.getDef(it.type), n = it.n; if (d.kind !== 'gfx') continue;
    if (d.shape === 'line') { if (segDist(x, y, n[8], n[9], n[10], n[11]) < tol) return it; }
    else { const b = itemBox(it); if (x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol) return it; }
  }
  return null;
}
function connectsAt(x, y) {
  for (const it of doc.items) {
    if (ES.WIRE.has(it.type)) { const n = it.n; if ((n[8] === x && n[9] === y) || (n[10] === x && n[11] === y) || ES.onSeg(x, y, [n[8], n[9], n[10], n[11]])) return true; }
    else for (const [tx, ty] of ES.termsOf(it)) if (tx === x && ty === y) return true;
  }
  return false;
}
function bounds(items) {
  let b = null;
  for (const it of items) { const q = itemBox(it); b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q.slice(); }
  return b;
}

// ------------------------------------------------------------ vykreslení
function resize() {
  const r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
}
function drawScene(c, opt) {
  const order = k => k === 'gfx' ? 0 : k === 'wire' ? 1 : k === 'text' ? 3 : 2;
  for (let pass = 0; pass < 4; pass++) for (const it of doc.items) {
    if (order(ES.getDef(it.type).kind) !== pass) continue;
    ES.drawItem(c, it, { sim: opt.sim, selected: opt.sel && opt.sel.has(it.uid), linked: opt.link && opt.link.has(it.uid) });
  }
  if (jcache.ver !== ver) { jcache = { ver, set: ES.junctions(doc) }; for (const it of doc.items) if (it.type === ES.NODE) jcache.set.add(it.n[8] + ',' + it.n[9]); }
  for (const k of jcache.set) {
    const [x, y] = k.split(',').map(Number); let col = '#1d1d1f';
    if (opt.sim) { const net = opt.sim.nets.ofKey.get(k); col = ES.potColor(net === undefined ? 0 : opt.sim.netPot[net], true); }
    c.fillStyle = col; c.beginPath(); c.arc(x, y, 0.75, 0, 7); c.fill();
  }
}
// ovládací prvky na plátně: zobrazují se jen tam, kde dávají smysl
function syncBars() {
  const real = mode === 'real', t = real ? rtool : tool, n = real ? rsel.size + (rwsel >= 0 ? 1 : 0) : sel.size;
  const place = t.kind !== 'select' && t.kind !== 'band', draft = real ? !!rdraft : !!(tool.kind === 'wire' && tool.start);
  const one = !real && sel.size === 1 && !place;
  $('#cvTools').hidden = real;
  $('#cvBand').classList.toggle('on', !real && tool.kind === 'band');
  $('#cvProps').hidden = !one;
  $('#cvRot').hidden = real || !(place || n > 0);
  $('#cvDel').hidden = place || n === 0;
  $('#cvDone').hidden = !(place || draft || (!real && tool.kind === 'band'));
  $('#cvCtx').hidden = [...$('#cvCtx').children].every(b => b.hidden);
}
function render() {
  resize(); syncBars();
  if (mode === 'real') return renderReal();
  const dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s);
  // papír
  const cb = bounds(doc.items) || [0, 0, 0, 0];
  const pg = [Math.min(0, cb[0] - 30), Math.min(0, cb[1] - 30), Math.max(420, cb[2] + 60), Math.max(297, cb[3] + 60)];
  ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12; ctx.fillRect(pg[0], pg[1], pg[2] - pg[0], pg[3] - pg[1]); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  // mřížka
  if (!sim && view.s >= 2.2) {
    const step = view.s >= 4 ? G : G * 2, x0 = Math.max(pg[0], Math.floor(-view.ox / view.s / step) * step), y0 = Math.max(pg[1], Math.floor(-view.oy / view.s / step) * step);
    const x1 = Math.min(pg[2], (W - view.ox) / view.s), y1 = Math.min(pg[3], (H - view.oy) / view.s), r = 0.9 / view.s;
    ctx.fillStyle = '#b9bcc6';
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  drawScene(ctx, { sim, sel, link: linkedSet() });
  if (!sim) {
    // svorky při kreslení vodiče
    if (tool.kind === 'wire') {
      ctx.strokeStyle = '#0a66e8'; ctx.lineWidth = 0.25;
      for (const it of doc.items) for (const [x, y] of ES.termsOf(it)) ctx.strokeRect(x - 0.8, y - 0.8, 1.6, 1.6);
      if (mouse.in) { ctx.fillStyle = connectsAt(mouse.x, mouse.y) ? '#0a66e8' : 'rgba(10,102,232,.35)'; ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 1.1, 0, 7); ctx.fill(); }
      if (tool.start) { ctx.strokeStyle = '#0a66e8'; ctx.lineWidth = 0.4; ctx.beginPath(); const pts = route(tool.start, [mouse.x, mouse.y], tool.flip); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.stroke(); }
    }
    if (tool.kind === 'place' && mouse.in) ES.drawItem(ctx, ES.newItem(tool.type, mouse.x, mouse.y, placeRot), { ghost: true });
    if (drag && drag.kind === 'gfx') { const g = ES.newItem(tool.type, drag.x0, drag.y0); g.n[10] = mouse.x; g.n[11] = mouse.y; ES.drawItem(ctx, g, {}); }
    if (drag && drag.kind === 'band') { ctx.strokeStyle = '#0a66e8'; ctx.fillStyle = 'rgba(10,102,232,.1)'; ctx.lineWidth = 1 / view.s; const x = Math.min(drag.x0, mouse.rx), y = Math.min(drag.y0, mouse.ry), w = Math.abs(mouse.rx - drag.x0), h = Math.abs(mouse.ry - drag.y0); ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
  }
  $('#pos').textContent = (sim ? 'čas ' + sim.t.toFixed(1) + ' s   ' : '') + 'x ' + mouse.x + '  y ' + mouse.y + '   ' + Math.round(view.s * 25) + ' %';
}
function route(a, b, flip) {
  if (a[0] === b[0] || a[1] === b[1]) return [a, b];
  let hfirst = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]); if (flip) hfirst = !hfirst;
  return hfirst ? [a, [b[0], a[1]], b] : [a, [a[0], b[1]], b];
}

// ------------------------------------------------------------ pohled
function zoomAt(f, cx, cy) {
  const view = mode === 'real' ? rview : view_, lo = mode === 'real' ? 0.4 : 0.8, hi = mode === 'real' ? 14 : 24;
  const s = Math.max(lo, Math.min(hi, view.s * f)); f = s / view.s;
  view.ox = cx - (cx - view.ox) * f; view.oy = cy - (cy - view.oy) * f; view.s = s; render();
}
function fit() {
  const r = stage.getBoundingClientRect(), b = bounds(doc.items) || [0, 0, 300, 200];
  const w = Math.max(60, b[2] - b[0] + 30), h = Math.max(40, b[3] - b[1] + 30);
  view.s = Math.max(0.8, Math.min(9, Math.min(r.width / w, r.height / h)));
  view.ox = (r.width - (b[0] + b[2]) * view.s) / 2; view.oy = (r.height - (b[1] + b[3]) * view.s) / 2; render();
}
function toWorld(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - view.ox) / view.s, (e.clientY - r.top - view.oy) / view.s]; }

// ------------------------------------------------------------ úpravy
function autoName(d) {
  const lastOf = f => { for (let i = doc.items.length - 1; i >= 0; i--) { const k = ES.getDef(doc.items[i].type); if (f(k) && doc.items[i].t[0]) return doc.items[i].t[0]; } return null; };
  if (d.noAuto) { if (d.kind === 'stage') return String(doc.items.filter(i => ES.getDef(i.type).kind === 'stage').length); return d.pre || ''; }
  if (d.kind === 'supply') return '-X';
  // Pomocný kontakt nemá vlastní pohon, patří k poslední vložené cívce. Stykač dostane
  // označení cívky, která ještě stykač nemá, jinak nové volné číslo (dřív kopíroval
  // označení předchozího stykače, takže jedna cívka spínala všechny stykače).
  if (d.kind === 'contact' && !d.click && d.src === 'act') return lastOf(k => k.kind === 'load' && ['coil', 'ton', 'toff', 'pulse', 'stair'].includes(k.sub)) || lastOf(k => k.kind === 'contactor') || '-KM1';
  if (d.kind === 'contactor') {
    const has = new Set(doc.items.filter(i => ES.getDef(i.type).kind === 'contactor').map(i => ES.norm(i.t[0])));
    const free = doc.items.find(i => ES.getDef(i.type).sub === 'coil' && i.t[0] && !has.has(ES.norm(i.t[0]))); if (free) return free.t[0];
  }
  if (d.kind === 'contact' && (d.src === 'ton' || d.src === 'toff')) return lastOf(k => k.sub === d.src) || lastOf(k => k.sub === 'ton' || k.sub === 'toff') || '-KT1';
  if (d.click === 'trip') return lastOf(k => k.kind === 'thermal') || '-F1';
  if (d.kind === 'load' && d.sub === 'coil') { // cívka převezme jméno stykače, který ještě cívku nemá
    const coils = new Set(doc.items.filter(i => ES.getDef(i.type).sub === 'coil').map(i => ES.norm(i.t[0])));
    const free = doc.items.find(i => ES.getDef(i.type).kind === 'contactor' && !coils.has(ES.norm(i.t[0]))); if (free) return free.t[0];
  }
  return nextFree(d.pre);
}
// nejbližší volné číslo pro předponu (napříč všemi prvky, -KM a KM je totéž)
function nextFree(pre, taken) {
  const base = ES.norm(pre), re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
  let max = 0;
  for (const it of doc.items) { const m = re.exec(ES.norm(it.t[0])); if (m) max = Math.max(max, +m[1]); }
  if (taken) for (const k of taken) { const m = re.exec(k); if (m) max = Math.max(max, +m[1]); }
  return pre + (max + 1);
}
// prvky, které samy něco ovládají (vlastní pohon); kontakty se k nim váží označením
function isDriver(d) { return d.kind === 'contactor' || d.kind === 'thermal' || d.kind === 'key' || (d.kind === 'load' && !['lamp', 'blink', 'horn', 'valve', 'light', 'bell'].includes(d.sub)) || (d.kind === 'contact' && (d.click === 'momentary' || d.click === 'toggle')); }
function place(type, x, y) {
  pushUndo(); const it = ES.newItem(type, x, y, placeRot), d = ES.getDef(type);
  if (d.pre !== undefined) it.t[0] = autoName(d);
  doc.items.push(it); touch(); return it;
}
function addWire(type, a, b) { if (a[0] === b[0] && a[1] === b[1]) return; const w = ES.newItem(type, a[0], a[1]); w.n[10] = b[0]; w.n[11] = b[1]; doc.items.push(w); }
// konec vodiče na jiném vodiči = odbočka: vloží spojovací tečku (uzel)
function autoNode(x, y) {
  if (doc.items.some(i => i.type === ES.NODE && i.n[8] === x && i.n[9] === y)) return;
  if (!doc.items.some(i => ES.WIRE.has(i.type) && ES.onSeg(x, y, [i.n[8], i.n[9], i.n[10], i.n[11]]))) return;
  const nd = ES.newItem(ES.NODE, x, y); nd.n[10] = x; nd.n[11] = y; doc.items.push(nd);
}
// uzly, u kterých po smazání nezůstal žádný konec vodiče, jsou zbytečné
function pruneNodes() {
  const ends = new Set(); for (const i of doc.items) if (ES.WIRE.has(i.type)) { ends.add(i.n[8] + ',' + i.n[9]); ends.add(i.n[10] + ',' + i.n[11]); }
  doc.items = doc.items.filter(i => i.type !== ES.NODE || ends.has(i.n[8] + ',' + i.n[9]));
}
function moveItems(dx, dy) {
  for (const it of doc.items) if (sel.has(it.uid)) {
    const k = ES.getDef(it.type).kind; it.n[8] += dx; it.n[9] += dy;
    if (k === 'wire' || k === 'gfx' || k === 'text' || k === 'node') { it.n[10] += dx; it.n[11] += dy; }
  }
  ver++;
}
function del() { if (!sel.size || sim) return; pushUndo(); doc.items = doc.items.filter(i => !sel.has(i.uid)); pruneNodes(); sel = new Set(); touch(); render(); }
function rotateSel() {
  if (sim) return;
  if (tool.kind === 'place') { placeRot = (placeRot + 1) & 3; render(); return; }
  const its = doc.items.filter(i => sel.has(i.uid)); if (!its.length) return;
  pushUndo();
  const b = bounds(its), cx = snap((b[0] + b[2]) / 2), cy = snap((b[1] + b[3]) / 2), single = its.length === 1;
  for (const it of its) {
    const k = ES.getDef(it.type).kind, n = it.n;
    const rp = (x, y) => single && k !== 'wire' && k !== 'gfx' ? [x, y] : [cx - (y - cy), cy + (x - cx)];
    const p = rp(n[8], n[9]);
    if (k === 'wire' || k === 'gfx') { const q = rp(n[10], n[11]); n[10] = q[0]; n[11] = q[1]; }
    else if (k === 'text' || k === 'node') { n[10] += p[0] - n[8]; n[11] += p[1] - n[9]; }
    else n[17] = (n[17] + 1) & 3;
    n[8] = p[0]; n[9] = p[1];
  }
  touch(); render();
}
function copy() { clip = doc.items.filter(i => sel.has(i.uid)).map(i => JSON.stringify(i)); }
function paste() {
  if (!clip.length || sim) return; pushUndo(); sel = new Set();
  const its = clip.map(s => ES.cloneItem(JSON.parse(s)));
  // Kopie tlačítka, cívky, stykače… dostane nové označení; kontakty ve vložené skupině
  // se přejmenují s ní, ostatní kontakty zůstanou svázané s původní cívkou.
  const exist = new Set(doc.items.map(i => ES.norm(i.t[0])).filter(Boolean)), ren = new Map(), taken = new Set();
  for (const it of its) {
    const d = ES.getDef(it.type), k = ES.norm(it.t[0]);
    if (!k || !isDriver(d) || !exist.has(k) || ren.has(k)) continue;
    const pre = (it.t[0].match(/^(.*?)\d*$/) || [, it.t[0]])[1] || d.pre || 'X', nn = nextFree(pre, taken);
    ren.set(k, nn); taken.add(ES.norm(nn));
  }
  for (const it of its) {
    const k = ES.norm(it.t[0]); if (ren.has(k)) it.t[0] = ren.get(k);
    it.n[8] += 6; it.n[9] += 6; const kd = ES.getDef(it.type).kind; if (kd === 'wire' || kd === 'gfx' || kd === 'text' || kd === 'node') { it.n[10] += 6; it.n[11] += 6; }
    doc.items.push(it); sel.add(it.uid);
  }
  clip = its.map(i => JSON.stringify(i));
  touch(); render();
}

// ------------------------------------------------------------ vlastnosti
// příkon spotřebiče / zásuvky a časy spínacích hodin (společné pro schéma i realitu)
function powerFields(d, it, f) {
  let h = '';
  if (d.click === 'clock') h += f('Zapnuto (s)', 't5', it.t[5], 'type="number" min="0.5" step="0.5"') + f('Vypnuto (s)', 't6', it.t[6], 'type="number" min="0.5" step="0.5"') + '<p>Spínací hodiny v simulaci běží ve zkráceném čase: opakovaně sepnou na dobu „zapnuto“ a rozepnou na dobu „vypnuto“.</p>';
  if (d.defaults && d.defaults[9] && d.kind !== 'motor3') {
    const sock = d.kind === 'socket' || d.kind === 'socket3';
    h += f(sock ? 'Spotřebič v zásuvce (W)' : 'Příkon (W)', 't9', it.t[9], 'type="number" min="1" step="1" placeholder="' + d.defaults[9] + '"');
    if (sock || d.kind === 'load3') h += '<p>V simulaci ' + (sock ? 'kliknutím na zásuvku spotřebič zapojíte / vytáhnete.' : 'kliknutím spotřebič zapnete / vypnete.') + '</p>';
  }
  return h;
}
async function editProps(it) {
  const d = ES.getDef(it.type), n = it.n; let h = '<h2>' + esc(d.name) + '</h2>';
  const f = (label, name, val, attr) => '<label>' + label + '<input name="' + name + '" value="' + esc(val) + '" ' + (attr || '') + '></label>';
  if (d.kind === 'wire') h += '<label>Typ vodiče<select name="wtype">' + [[4000, 'Fázový / obecný'], [4009, 'Nulový (N)'], [4010, 'Ochranný (PE)'], [10106, 'Spojnice GRAFCET']].map(o => '<option value="' + o[0] + '"' + (o[0] === it.type ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
  else if (d.kind === 'text') { h += '<label>Text<input name="extra" value="' + esc(it.extra) + '" autofocus></label>' + f('Velikost', 'size', Math.max(2, Math.abs(n[11] - n[9]) || 4), 'type="number" min="2" max="60" step="1"'); }
  else if (d.kind === 'gfx') h += f('Barva', 'color', '#' + [n[16] & 255, (n[16] >> 8) & 255, (n[16] >> 16) & 255].map(v => v.toString(16).padStart(2, '0')).join(''), 'type="color"') + f('Tloušťka', 'lw', n[18] || 0, 'type="number" min="0" max="8"');
  else if (d.kind === 'node' || d.kind === 'unknown') h += '<p>Tento prvek nemá upravitelné vlastnosti.</p>';
  else {
    if (d.kind !== 'trans') h += f(d.kind === 'stage' ? 'Číslo kroku' : 'Označení', 't0', it.t[0], 'autofocus');
    if (d.kind === 'contact' || d.kind === 'contactor') h += '<p>Kontakt se ovládá cívkou (relé, časovačem, tlačítkem) se stejným označením.</p>';
    if (d.sub === 'ton' || d.sub === 'toff' || d.sub === 'stair' || d.click === 'pir') h += f(d.sub === 'stair' || d.click === 'pir' ? 'Doba svitu (s)' : 'Čas (s)', 't5', it.t[5], 'type="number" min="0" step="0.1"');
    h += powerFields(d, it, f);
    if (d.kind === 'hsw' || d.home) h += '<p>' + esc(d.norm || '') + '</p>';
    if (d.kind === 'mstarter' || d.kind === 'thermal') h += f('Nastavení Iᵣ (A)', 't8', it.t[8], 'type="number" min="0" step="0.1" placeholder="jen ruční vybavení"') + '<p>Proud, na který je nastavená tepelná spoušť (obvykle jmenovitý proud motoru). Při 6× Iᵣ vybaví asi za 15 s.</p>';
    if (d.kind === 'motor3' || d.kind === 'motorYD' || d.kind === 'motor1') h += f('Výkon motoru (kW)', 't9', it.t[9], 'type="number" min="0.1" step="0.1" placeholder="' + (d.kind === 'motor1' ? '0,75' : d.kind === 'motorYD' ? '7,5' : '4') + '"');
    if (d.kind === 'trafo') h += f('Primární napětí (V)', 't6', it.t[6] || '230', 'type="number" min="1"') + f('Sekundární napětí (V)', 't7', it.t[7] || '24', 'type="number" min="1"');
    if (d.sub === 'lamp' || d.sub === 'blink') h += '<label>Barva<select name="t4">' + ES.LAMP_NAME.map((c, i) => '<option value="' + i + '"' + ((parseInt(it.t[4]) || 0) === i ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>';
    if (d.kind === 'trans') h += '<label>Podmínka<input name="extra" value="' + esc(it.extra) + '" autofocus></label><p>Název tlačítka / čidla, čas od aktivace kroku (např. <b>5S</b>), spojky <b>*</b> (a), <b>+</b> (nebo), <b>/</b> (negace). Prázdné = vždy splněno.</p>';
    if (d.kind === 'action') h += '<label>Druh akce<select name="t6">' + [['0', 'po dobu kroku'], ['1', 'Set (zapnout a držet)'], ['2', 'Reset (vypnout)']].map(o => '<option value="' + o[0] + '"' + ((it.t[6] || '0').trim() === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
    const nt = d.kind === 'supply' ? 0 : (d.terms || []).filter((_, i) => d.labels[i] !== undefined).length;
    if (nt) { h += '<p style="margin:10px 0 0">Popisy svorek</p><div class="terms">'; for (let i = 0; i < nt; i++) h += '<input name="term' + i + '" value="' + esc(it.t[2 + i]) + '">'; h += '</div>'; }
  }
  if ((await ask(h, [['no', 'Zrušit'], ['ok', 'OK']])) !== 'ok') return;
  const v = Object.fromEntries(new FormData(form)); pushUndo();
  if (v.wtype) it.type = +v.wtype;
  if (v.t0 !== undefined) it.t[0] = v.t0.replace(/[#*]/g, '');
  if (v.extra !== undefined) it.extra = v.extra.replace(/[#$]/g, '').replace(/\*(\d+)\*(\d+)/g, '·$1·$2');
  if (v.size) { n[10] = n[8] + 6; n[11] = n[9] + (+v.size || 4); }
  if (v.t5 !== undefined) it.t[5] = String(Math.max(0, parseFloat(v.t5) || 0));
  for (const k of ['t6', 't7', 't8', 't9']) if (v[k] !== undefined) it.t[+k.slice(1)] = v[k] === '' ? '' : String(Math.max(0, parseFloat(String(v[k]).replace(',', '.')) || 0));
  if (v.t4 !== undefined) it.t[4] = v.t4;
  if (v.t6 !== undefined) it.t[6] = v.t6;
  if (v.color) { const c = parseInt(v.color.slice(1), 16); n[16] = ((c >> 16) & 255) | (c & 0xff00) | ((c & 255) << 16); n[18] = +v.lw || 0; }
  for (const k in v) if (k.startsWith('term')) it.t[2 + +k.slice(4)] = v[k].replace(/[#*]/g, '');
  touch(); render();
}

// ------------------------------------------------------------ myš
function setTool(t) {
  tool = t; if (t.kind !== 'place') placeRot = 0;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b._tool && b._tool.kind === t.kind && b._tool.type === t.type));
  cv.style.cursor = t.kind === 'select' ? 'default' : 'crosshair';
  hint(HINTS[t.kind]); render();
}
function handleDown(e) {
  if (mode === 'real') return rDown(e);
  const [rx, ry] = toWorld(e), x = snap(rx), y = snap(ry);
  mouse.rx = rx; mouse.ry = ry; mouse.x = x; mouse.y = y;
  if (e.button === 1 || spaceDown) { drag = { kind: 'pan', cx: e.clientX, cy: e.clientY }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (sim) { const it = hit(rx, ry); if (it && ES.simPress(sim, it, true, e.shiftKey, partOf(it, rx, ry))) { pressed = it; simTick(0); } else drag = { kind: 'pan', cx: e.clientX, cy: e.clientY }; return; }
  if (tool.kind === 'place') { place(tool.type, x, y); render(); return; }
  if (tool.kind === 'wire') {
    if (!tool.start) { tool.start = [x, y]; render(); return; }
    if (tool.start[0] === x && tool.start[1] === y) { tool.start = null; render(); return; }
    pushUndo(); const pts = route(tool.start, [x, y], tool.flip || e.shiftKey);
    const end = connectsAt(x, y);
    for (let i = 1; i < pts.length; i++) addWire(tool.type, pts[i - 1], pts[i]);
    if (tool.type !== 10106) for (const q of [pts[0], [x, y]]) autoNode(q[0], q[1]);
    tool.start = end ? null : [x, y]; touch(); render(); return;
  }
  if (tool.kind === 'gfx') { drag = { kind: 'gfx', x0: x, y0: y }; return; }
  if (tool.kind === 'text') {
    ask('<h2>Text</h2><label>Text<input name="extra" autofocus></label><label>Velikost<input name="size" type="number" value="4" min="2" max="60"></label>', [['no', 'Zrušit'], ['ok', 'Vložit']]).then(r => {
      const v = Object.fromEntries(new FormData(form)); if (r !== 'ok' || !v.extra) return;
      pushUndo(); const it = ES.newItem(8, x, y); it.extra = v.extra.replace(/[#$*]/g, ''); it.n[10] = x + 6; it.n[11] = y + (+v.size || 4); doc.items.push(it); touch(); setTool({ kind: 'select' });
    }); return;
  }
  if (tool.kind === 'band') { if (!e.shiftKey) sel = new Set(); drag = { kind: 'band', x0: rx, y0: ry, add: e.shiftKey }; render(); return; }
  const it = hit(rx, ry);
  if (it) {
    if (e.shiftKey) { sel.has(it.uid) ? sel.delete(it.uid) : sel.add(it.uid); } else if (!sel.has(it.uid)) sel = new Set([it.uid]);
    drag = { kind: 'move', lx: x, ly: y, moved: false, sx: e.clientX, sy: e.clientY, touch: e.pointerType === 'touch' };
  } else if (e.shiftKey) drag = { kind: 'band', x0: rx, y0: ry, add: true };
  else { sel = new Set(); drag = { kind: 'pan', cx: e.clientX, cy: e.clientY }; }
  render();
}
function handleMove(e) {
  if (mode === 'real') return rMove(e);
  const [rx, ry] = toWorld(e); mouse.rx = rx; mouse.ry = ry; mouse.x = snap(rx); mouse.y = snap(ry); mouse.in = e.target === cv;
  if (drag) {
    if (drag.kind === 'pan') { view.ox += e.clientX - drag.cx; view.oy += e.clientY - drag.cy; drag.cx = e.clientX; drag.cy = e.clientY; }
    else if (drag.kind === 'move') {
      if (!drag.moved && drag.touch && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < TAP) return; // klepnutí prstem nesmí přístroj posunout
      const dx = mouse.x - drag.lx, dy = mouse.y - drag.ly;
      if (dx || dy) { if (!drag.moved) { pushUndo(); drag.moved = true; } moveItems(dx, dy); drag.lx = mouse.x; drag.ly = mouse.y; }
    }
  }
  if (tool.kind === 'wire') tool.flip = e.shiftKey;
  if (!sim && !drag && tool.kind === 'select' && e.target === cv) { const h = hit(rx, ry); if (h !== hover) { hover = h; hint((h && linkHint(h)) || HINTS.select); } }
  if (!sim || drag) render();
  if (sim && !drag) { const it = hit(rx, ry), c = it && sim.byUid.get(it.uid); hover = it; cv.style.cursor = c && (c.d.click || c.d.kind === 'breaker' || c.d.kind === 'mswitch' || c.d.kind === 'thermal' || c.d.kind === 'fuse' || c.d.kind === 'mstarter' || c.d.kind === 'rcd' || c.d.kind === 'hsw' || c.d.kind === 'socket' || c.d.kind === 'socket3' || c.d.kind === 'load3') ? 'pointer' : 'default'; }
}
function handleUp(e) {
  if (mode === 'real') return rUp(e);
  { const [rx, ry] = toWorld(e); mouse.rx = rx; mouse.ry = ry; mouse.x = snap(rx); mouse.y = snap(ry); }
  if (pressed && sim) { ES.simPress(sim, pressed, false, e.shiftKey); pressed = null; }
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'pan') cv.style.cursor = tool.kind === 'select' ? 'default' : 'crosshair';
  if (d.kind === 'band' && tool.kind === 'band') setTool({ kind: 'select' });
  if (d.kind === 'move' && d.moved) touch();
  if (d.kind === 'band') {
    const x0 = Math.min(d.x0, mouse.rx), y0 = Math.min(d.y0, mouse.ry), x1 = Math.max(d.x0, mouse.rx), y1 = Math.max(d.y0, mouse.ry);
    if (x1 - x0 > 0.5 || y1 - y0 > 0.5) for (const it of doc.items) { const b = itemBox(it); if (b[0] >= x0 && b[2] <= x1 && b[1] >= y0 && b[3] <= y1) sel.add(it.uid); }
  }
  if (d.kind === 'gfx' && (d.x0 !== mouse.x || d.y0 !== mouse.y)) { pushUndo(); const g = ES.newItem(tool.type, d.x0, d.y0); g.n[10] = mouse.x; g.n[11] = mouse.y; doc.items.push(g); touch(); }
  render();
}

// ------------------------------------------------------------ dotyk a ukazatele
// Myš a pero jdou přímo do původních obsluh. Dotyk: jeden prst vybírá a posouvá přístroje, tažení prázdné plochy posouvá výkres,
// dva prsty posouvají a přibližují. Nástroje „vložit“ a „vodič“ se provedou až po zvednutí prstu (prst nezakrývá místo a lze předtím posunout výkres).
const TAP = 10, tp = new Map();
let tg = null, tt = null;
const curView = () => mode === 'real' ? rview : view;
function cancelAction() {
  if (pressed && sim) { ES.simPress(sim, pressed, false, false); pressed = null; }
  drag = null; rdrag = null;
}
function startGesture() {
  const a = [...tp.values()].slice(0, 2), V = curView();
  tg = { d: Math.max(10, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)), cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2, s: V.s, ox: V.ox, oy: V.oy };
}
function doGesture() {
  const a = [...tp.values()].slice(0, 2), V = curView(), r = cv.getBoundingClientRect();
  const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
  const lo = mode === 'real' ? 0.4 : 0.8, hi = mode === 'real' ? 14 : 24, ns = Math.max(lo, Math.min(hi, tg.s * d / tg.d));
  const wx = (tg.cx - r.left - tg.ox) / tg.s, wy = (tg.cy - r.top - tg.oy) / tg.s;
  V.s = ns; V.ox = cx - r.left - wx * ns; V.oy = cy - r.top - wy * ns; render();
}
const touchNow = () => sim || mode === 'real' ? sim || rtool.kind === 'select' : tool.kind === 'select' || tool.kind === 'gfx' || tool.kind === 'band';
cv.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return handleDown(e);
  e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  tp.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tp.size >= 2) { // druhý prst: gesto, první dotyk výběr nemění
    if (tt && !(drag && drag.moved) && !(rdrag && rdrag.moved)) { sel = tt.sel0; rsel = tt.rsel0; rwsel = tt.rwsel0; }
    tt = null; cancelAction(); startGesture(); render(); return;
  }
  tt = { id: e.pointerId, sx: e.clientX, sy: e.clientY, e0: e, now: touchNow(), pan: false, sel0: new Set(sel), rsel0: new Set(rsel), rwsel0: rwsel };
  if (tt.now) handleDown(e);
});
window.addEventListener('pointermove', e => {
  if (e.pointerType !== 'touch') return handleMove(e);
  const p = tp.get(e.pointerId); if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (tg && tp.size >= 2) { e.preventDefault(); doGesture(); return; }
  if (!tt || tt.id !== e.pointerId) return;
  if (tt.now) return handleMove(e);
  if (!tt.pan && Math.hypot(e.clientX - tt.sx, e.clientY - tt.sy) > TAP) { tt.pan = true; tt.lx = tt.sx; tt.ly = tt.sy; }
  if (tt.pan) { const V = curView(); V.ox += e.clientX - tt.lx; V.oy += e.clientY - tt.ly; tt.lx = e.clientX; tt.ly = e.clientY; render(); }
});
function pointerEnd(e) {
  if (e.pointerType !== 'touch') return e.type === 'pointerup' ? handleUp(e) : undefined;
  tp.delete(e.pointerId);
  if (tg) { if (tp.size < 2) { tg = null; tt = null; } return; }
  if (tt && tt.id === e.pointerId) {
    const t = tt; tt = null;
    if (!t.now && !t.pan && e.type === 'pointerup') { handleDown(t.e0); handleUp(e); }
    else if (t.now) handleUp(e);
  }
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
cv.addEventListener('dblclick', e => {
  if (sim) return;
  if (mode === 'real') return rDbl(e);
  if (tool.kind === 'wire') { tool.start = null; render(); return; }
  if (tool.kind !== 'select') return;
  const [rx, ry] = toWorld(e), it = hit(rx, ry); if (it) { sel = new Set([it.uid]); render(); editProps(it); }
});
cv.addEventListener('contextmenu', e => { e.preventDefault(); if (sim) return; if (mode === 'real') { rdraft = null; rSetTool({ kind: 'select' }); return; } if (tool.kind === 'wire' && tool.start) { tool.start = null; render(); } else setTool({ kind: 'select' }); });
cv.addEventListener('mouseleave', () => { mouse.in = false; if (!sim) render(); });
cv.addEventListener('wheel', e => {
  e.preventDefault(); const r = cv.getBoundingClientRect();
  const V = mode === 'real' ? rview : view;
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.012), e.clientX - r.left, e.clientY - r.top);
  else { V.ox -= e.deltaX; V.oy -= e.deltaY; render(); }
}, { passive: false });
cv.addEventListener('gesturestart', e => { e.preventDefault(); if (tg) return; const V = mode === 'real' ? rview : view; V._gs = V.s; });
cv.addEventListener('gesturechange', e => { e.preventDefault(); if (tg) return; const V = mode === 'real' ? rview : view, r = cv.getBoundingClientRect(); zoomAt((V._gs * e.scale) / V.s, e.clientX - r.left, e.clientY - r.top); });

// ------------------------------------------------------------ klávesnice
window.addEventListener('keydown', e => {
  if (dlg.open) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  // psaní do polí (kalkulačky): klávesy patří poli, editor reaguje jen na ⌘S/⌘O/⌘N/⌘R
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && !(mod && 'sonr'.includes(k))) return;
  if (mode === 'calc' && !(mod && 'sonr'.includes(k))) return;
  if (k === ' ') { spaceDown = true; e.preventDefault(); return; }
  if (mod && k === 'r') { e.preventDefault(); cmd('sim'); return; }
  if (mod && k === 's') { e.preventDefault(); cmd(e.shiftKey ? 'saveas' : 'save'); return; }
  if (mod && k === 'o') { e.preventDefault(); cmd('open'); return; }
  if (mod && k === 'n') { e.preventDefault(); cmd('new'); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); cmd('zoomin'); return; }
  if (mod && k === '-') { e.preventDefault(); cmd('zoomout'); return; }
  if (mod && k === '0') { e.preventDefault(); cmd('fit'); return; }
  if (mode === 'real' && !(mod && 'zy'.includes(k))) { rKey(e, k, mod); return; }
  if (k === 'escape') { if (sim) return; if (tool.kind === 'wire' && tool.start) { tool.start = null; render(); } else { sel = new Set(); setTool({ kind: 'select' }); } return; }
  if (sim) return;
  if (mod && k === 'z') { e.preventDefault(); cmd(e.shiftKey ? 'redo' : 'undo'); }
  else if (mod && k === 'y') { e.preventDefault(); cmd('redo'); }
  else if (mod && k === 'c') { e.preventDefault(); cmd('copy'); }
  else if (mod && k === 'x') { e.preventDefault(); cmd('cut'); }
  else if (mod && k === 'v') { e.preventDefault(); cmd('paste'); }
  else if (mod && k === 'a') { e.preventDefault(); cmd('selectall'); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); del(); }
  else if (k === 'r' && !mod) rotateSel();
  else if (k === 'w' && !mod) setTool({ kind: 'wire', type: 4000 });
  else if (k.startsWith('arrow') && sel.size) { e.preventDefault(); pushUndo(); moveItems(k === 'arrowleft' ? -G : k === 'arrowright' ? G : 0, k === 'arrowup' ? -G : k === 'arrowdown' ? G : 0); touch(); render(); }
});
window.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });

// ------------------------------------------------------------ simulace
// levá / pravá kolébka dvojitého spínače podle místa kliknutí
function partOf(it, x, y) { const [lx] = ES.rot(x - it.n[8], y - it.n[9], (4 - (it.n[17] & 3)) & 3); return lx < 3 ? 0 : 1; }
// měření: napětí na prvku / potenciál vodiče pod kurzorem
function probe(hv) {
  if (mode === 'real' && hv === undefined) return rProbe();
  const hover = hv || hover_();
  if (!sim || !hover) return '';
  const c = sim.byUid.get(hover.uid), n = hover.n, V = v => Math.round(Math.hypot(v[0], v[1])) + ' V';
  if (ES.WIRE.has(hover.type)) {
    const net = sim.nets.ofKey.get(n[8] + ',' + n[9]); if (net === undefined) return '';
    const p = sim.netPot[net], names = ES.potNames(p), v = ES.netVoltage(sim, net);
    return 'Vodič: ' + (names.length ? names.join('+') + ', ' : '') + (v ? V(v) + ' proti zemi' + (names.length ? '' : ' (přes zátěž)') : 'bez napětí');
  }
  if (!c) return '';
  const nm = (hover.t[0] || c.d.name) + ': ';
  const M = sim.meas[hover.uid] || {}, A = x => (x || 0).toLocaleString('cs-CZ', { maximumFractionDigits: x < 1 ? 3 : 2 }) + ' A';
  if (c.d.kind === 'load' && c.d.sub === 'stair') return nm + 'schodišťový automat: ' + (M.left > 0 ? 'svítí ještě ' + Math.ceil(M.left) + ' s' : 'v klidu') + ' (nastaveno ' + ES.secondsOf(hover) + ' s)';
  if (c.d.kind === 'load' && c.d.sub === 'pulse') return nm + 'impulsní relé: ' + (sim.pulse[c.key] ? 'sepnuto' : 'rozepnuto') + ' (přepne při každém stisku tlačítka)';
  if (c.d.kind === 'load') return nm + Math.round(sim.volt[hover.uid] || 0) + ' V (jmenovité ' + M.Un + ' V), ' + A(M.I) + (sim.on[hover.uid] ? ' – pod napětím' : (sim.volt[hover.uid] > 5 ? ' – napětí nestačí' : ''));
  if (c.d.kind === 'meter') return nm + (c.d.sub === 'V' ? 'voltmetr ukazuje ' + V([M.V || 0, 0]) : 'ampérmetr ukazuje ' + A(M.I));
  if (c.d.kind === 'mstarter' || c.d.kind === 'thermal') return nm + 'proud ' + A(M.I) + (M.Ir ? ', nastavení Iᵣ ' + M.Ir + ' A, zahřátí spouště ' + Math.round(Math.min(1, M.heat) * 100) + ' %' : ' (bez nastavení – vybavuje se jen ručně)');
  if (c.d.kind === 'rcd') return nm + 'unikající proud ' + Math.round((M.res || 0) * 1000) + ' mA (vybaví nad 30 mA), proud ' + A(M.I) + '. Klik na zapnutý chránič = tlačítko TEST.';
  if (c.d.kind === 'socket') return nm + 'zásuvka: L–N ' + Math.round(M.U || 0) + ' V' + (M.U > 5 && !M.Lok ? ' (fáze na N dutince!)' : '') + ', ochranný kolík ' + (M.pe ? 'připojen ✓' : 'NEPŘIPOJEN ✗') + (sim.plug[hover.uid] ? ', spotřebič ' + M.P + ' W, ' + A(M.I) : ', volná (kliknutím zapojíte spotřebič)');
  if (c.d.kind === 'socket3' || c.d.kind === 'load3') return nm + (c.d.kind === 'socket3' ? 'zásuvka 400 V: ' : 'spotřebič 3f: ') + 'L1–L2 ' + Math.round(M.Ull ? M.Ull[0] : 0) + ' V, L2–L3 ' + Math.round(M.Ull ? M.Ull[1] : 0) + ' V, L3–L1 ' + Math.round(M.Ull ? M.Ull[2] : 0) + ' V, sled fází ' + (M.rot === 'R' ? 'pravotočivý ✓' : M.rot === 'L' ? 'LEVOTOČIVÝ ✗ (prohoďte dvě fáze)' : 'nelze určit') + ', N ' + (M.n ? '✓' : '✗') + ', PE ' + (M.pe ? '✓' : '✗') + (sim.plug[hover.uid] ? ', zapnuto ' + M.P + ' W, ' + A(M.I) + ' na fázi' : ', vypnuto (kliknutím zapnete)');
  if (c.d.kind === 'emeter3') return nm + 'elektroměr 3f: ' + Math.round(M.P || 0) + ' W, L1 ' + A((M.I || [])[0]) + ', L2 ' + A((M.I || [])[1]) + ', L3 ' + A((M.I || [])[2]) + ', odečteno ' + (M.Wh || 0).toFixed(3).replace('.', ',') + ' Wh';
  if (c.d.kind === 'emeter') return nm + 'elektroměr: ' + Math.round(M.U || 0) + ' V, ' + A(M.I) + ', činný výkon ' + Math.round(M.P || 0) + ' W, odečteno ' + (M.Wh || 0).toFixed(3).replace('.', ',') + ' Wh';
  if (c.d.kind === 'hsw') return nm + c.d.name + ' – poloha ' + (sim.sw[hover.uid] | 0) + (c.d.bits === 2 ? ' (klik vlevo/vpravo = levá/pravá kolébka)' : '');
  if (c.d.kind === 'trafo') return nm + 'primár ' + Math.round(M.Up || 0) + ' V, sekundár ' + (M.Us || 0).toFixed(1).replace('.', ',') + ' V, ' + A(M.Is);
  const m = sim.motor[hover.uid];
  if (m) return nm + A(m.I) + ' (Iₙ ' + A(m.In) + '), ' + Math.round(m.U) + ' V na vinutí, ' + Math.round(Math.abs(m.rpm)) + ' ot/min' + (m.dir ? (m.dir > 0 ? ' vpravo' : ' vlevo') : '') + ', moment ' + Math.round(Math.abs(m.tau || 0) * 100) + ' %' + (m.fault ? ' – CHYBÍ FÁZE' : '') + ', celkem ' + Math.floor(m.revs) + ' otáček';
  return '';
}
function simTick(dt) {
  ES.simStep(sim, dt); const pr = probe(); hint(pr || (sim.warn && sim.warn.length ? '⚠ ' + sim.warn.join(' · ') : mode === 'real' ? RHINT.sim : HINTS.sim)); $('#simmsg').textContent = sim.msg || (sim.short ? 'Zkrat!' : ''); render();
}
// varování na sporná označení (ovládání je svázané jen jménem, ne drátem)
function nameWarnings() {
  const by = new Map();
  for (const it of doc.items) { const d = ES.getDef(it.type), k = ES.norm(it.t[0]); if (!k || d.noAuto || d.kind === 'supply') continue; if (!by.has(k)) by.set(k, []); by.get(k).push([it, d]); }
  const w = [];
  for (const [k, g] of by) {
    const coils = g.filter(([, d]) => d.kind === 'load' && ['coil', 'ton', 'toff', 'pulse', 'stair'].includes(d.sub)).length;
    const manual = g.filter(([, d]) => d.click === 'momentary' || d.click === 'toggle' || d.click === 'pir' || d.kind === 'key' || d.kind === 'hsw').length;
    const followers = g.filter(([, d]) => d.kind === 'contactor' || (d.kind === 'contact' && !d.click)).length;
    if (coils > 1) w.push(coils + ' cívky mají stejné označení ' + g[0][0].t[0]);
    if (manual > 1) w.push(manual + ' tlačítka/spínače mají stejné označení ' + g[0][0].t[0] + ' (spínají společně)');
    if (followers && !coils && !manual && !g.some(([, d]) => d.kind === 'thermal')) w.push('k ' + g[0][0].t[0] + ' chybí cívka se stejným označením');
  }
  return w;
}
function simToggle() {
  if (sim) { clearInterval(simTimer); sim = null; pressed = null; hover = null; rhover = null; }
  else {
    tool.start = null; sel = new Set(); rdraft = null; rsel = new Set(); rwsel = -1;
    sim = ES.simStart(doc, mode === 'real'); sim.real = mode === 'real'; sim.byUid = new Map(sim.comps.map(c => [c.it.uid, c]));
    sim.warn = nameWarnings();
    let last = performance.now();
    simTimer = setInterval(() => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; simTick(dt); }, 40);
  }
  document.body.classList.toggle('simulating', !!sim);
  $('#simbtn').textContent = sim ? '■ Zastavit' : '▶ Simulace'; $('#simbtn').classList.toggle('running', !!sim);
  $('#simmsg').textContent = ''; cv.style.cursor = 'default';
  hint(sim ? (mode === 'real' ? RHINT.sim : HINTS.sim) : mode === 'real' ? RHINT[rtool.kind] : HINTS[tool.kind]); render();
}

// ------------------------------------------------------------ soubory
function setDoc(d, name, path, handle) {
  if (sim) simToggle();
  fileHandle = handle || null;
  doc = d; if (!doc.real) doc.real = ES.emptyReal(); rsel = new Set(); rwsel = -1; rdraft = null; rcmp = null; rview.fitted = false; fileName = name; filePath = path || null; dirty = false; ver++; sel = new Set(); undoStack = []; redoStack = [];
  setTool({ kind: 'select' }); title(); if (mode === 'real') rFit(); else fit();
  const unk = new Set(doc.items.filter(i => ES.getDef(i.type).kind === 'unknown').map(i => i.type));
  if (unk.size) ask('<h2>Některé prvky nejsou podporované</h2><p>Schéma obsahuje typy prvků, které ElectroSchool zatím neumí (' + [...unk].join(', ') + '). Zobrazí se čárkovaným rámečkem, v simulaci se neuplatní a při uložení zůstanou zachované.</p>', [['ok', 'OK']]);
}
function loadBytes(name, u8, path, handle) {
  try { setDoc(ES.parseCad(decodeBytes(u8)), name, path, handle); }
  catch (err) { ask('<h2>Soubor nelze otevřít</h2><p>' + esc(err.message) + '</p>', [['ok', 'OK']]); }
}
function download(name, u8, mime) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: mime })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
// Web: File System Access API (Chrome, Edge) – uložení přímo do souboru, další ⌘S přepíše
// tentýž soubor; jinde (Safari, Firefox) se soubor stáhne.
let fileHandle = null;
const CAD_TYPES = [{ description: 'Schéma ElectroSchool / CADe_SIMU', accept: { 'application/octet-stream': ['.cad'] } }];
async function webSave(name, u8, mime, types, handle) {
  if (window.showSaveFilePicker) {
    try {
      const h = handle || await window.showSaveFilePicker({ suggestedName: name, types });
      const w = await h.createWritable(); await w.write(new Blob([u8], { type: mime })); await w.close(); return h;
    } catch (e) { if (e.name === 'AbortError') return null; }
  }
  download(name, u8, mime); return true;
}
async function save(as) {
  const u8 = encodeText(ES.serializeCad(doc));
  if (native) { native.postMessage({ cmd: 'save', name: fileName, path: as ? null : filePath, data: b64(u8) }); return; }
  const h = await webSave(fileName, u8, 'application/octet-stream', CAD_TYPES, as ? null : fileHandle);
  if (!h) return;
  if (h !== true) { fileHandle = h; fileName = h.name || fileName; }
  dirty = false; title(); hint('Uloženo: ' + fileName);
}
async function webOpen() {
  if (window.showOpenFilePicker) {
    try { const [h] = await window.showOpenFilePicker({ types: CAD_TYPES, multiple: false }); const f = await h.getFile(); loadBytes(f.name, new Uint8Array(await f.arrayBuffer()), null, h); }
    catch (e) { if (e.name !== 'AbortError') $('#file').click(); }
  } else $('#file').click();
}
function exportPNG() {
  const b = bounds(doc.items); if (!b) return;
  const m = 9, sc = 8, c = document.createElement('canvas'); c.width = (b[2] - b[0] + 2 * m) * sc; c.height = (b[3] - b[1] + 2 * m) * sc;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.scale(sc, sc); x.translate(m - b[0], m - b[1]);
  drawScene(x, { sim });
  const u8 = unb64(c.toDataURL('image/png').split(',')[1]), name = fileName.replace(/\.cad$/i, '') + '.png';
  if (native) native.postMessage({ cmd: 'export', name, data: b64(u8) }); else webSave(name, u8, 'image/png', [{ description: 'Obrázek PNG', accept: { 'image/png': ['.png'] } }]);
}
$('#file').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) loadBytes(f.name, new Uint8Array(await f.arrayBuffer())); });
$('#examples').addEventListener('change', async e => {
  const i = e.target.value; e.target.value = ''; if (i === '' || !(await confirmDiscard())) return;
  const ex = window.ES_EXAMPLES[+i]; loadBytes(ex.title + '.cad', unb64(ex.data));
});
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && await confirmDiscard()) loadBytes(f.name, new Uint8Array(await f.arrayBuffer())); });

async function cmd(c) {
  if (dlg.open) return;
  if (mode === 'calc' && !['new', 'open', 'save', 'saveas', 'sim', 'png'].includes(c)) return;
  if (mode === 'calc' && ['new', 'open', 'sim', 'png'].includes(c)) setTab('schema');
  if (mode === 'real') switch (c) {
    case 'delete': case 'cut': rDelete(); return;
    case 'copy': case 'paste': case 'rotate': case 'selectall': return;
    case 'fit': rFit(); return;
    case 'png': rExportPNG(); return;
    case 'rfrom': rFromSchema(); return;
    case 'rto': rToSchema(); return;
    case 'rcmp': rCompare(); return;
  }
  switch (c) {
    case 'new': if (await confirmDiscard()) setDoc({ items: [], trailer: ES.DEFAULT_TRAILER, real: ES.emptyReal() }, 'Bez názvu.cad'); view.s = 4; view.ox = 40; view.oy = 40; render(); break;
    case 'open': if (await confirmDiscard()) { if (native) native.postMessage({ cmd: 'open' }); else webOpen(); } break;
    case 'save': save(false); break;
    case 'saveas': save(true); break;
    case 'png': exportPNG(); break;
    case 'undo': if (!sim && undoStack.length) { redoStack.push(snap_()); const r = redoStack; restore(undoStack.pop()); redoStack = r; } break;
    case 'redo': if (!sim && redoStack.length) { undoStack.push(snap_()); const r = redoStack, j = r.pop(); restore(j); redoStack = r; } break;
    case 'copy': copy(); break;
    case 'cut': copy(); del(); break;
    case 'paste': paste(); break;
    case 'delete': del(); break;
    case 'rotate': rotateSel(); break;
    case 'selectall': if (!sim) { sel = new Set(doc.items.map(i => i.uid)); render(); } break;
    case 'zoomin': zoomAt(1.25, cv.clientWidth / 2, cv.clientHeight / 2); break;
    case 'zoomout': zoomAt(0.8, cv.clientWidth / 2, cv.clientHeight / 2); break;
    case 'fit': fit(); break;
    case 'sim': simToggle(); break;
  }
}
document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => { cmd(b.dataset.cmd); b.blur(); }));

// ------------------------------------------------------------ paleta
// sada palety: průmyslová elektrotechnika / domovní instalace
let pset = (() => { try { return localStorage.getItem('es.set') || 'ind'; } catch (e) { return 'ind'; } })();
function setPicker(pal, rebuild) {
  const box = document.createElement('div'); box.className = 'setpick';
  for (const [k, n] of [['ind', 'Průmysl'], ['home', 'Domovní instalace']]) {
    const b = document.createElement('button'); b.textContent = n; b.className = k === pset ? 'active' : '';
    b.onclick = () => { pset = k; try { localStorage.setItem('es.set', k); } catch (e) {} buildPalette(); buildRealPalette(); setTool({ kind: 'select' }); rSetTool({ kind: 'select' }); };
    box.append(b);
  }
  pal.append(box);
}
const secHead = (name, norm) => { const h = document.createElement('h3'); h.textContent = name; if (norm) { const n = document.createElement('small'); n.textContent = norm; h.append(n); } return h; };
function buildPalette() {
  const pal = $('#palette'); pal.innerHTML = ''; setPicker(pal);
  const section = (name, norm) => { const h = secHead(name, norm); h.onclick = () => h.classList.toggle('closed'); const d = document.createElement('div'); d.className = 'items'; pal.append(h, d); return d; };
  const add = (box, titleText, t, draw) => {
    const b = document.createElement('button'); b.className = 'tool'; b.title = titleText; b._tool = t;
    if (typeof draw === 'string') { b.classList.add('text'); b.textContent = draw; }
    else { const c = document.createElement('canvas'); c.width = c.height = 96; draw(c.getContext('2d')); b.append(c); }
    b.onclick = () => setTool(Object.assign({}, t)); box.append(b);
  };
  const wireIcon = (col, dash) => c => { c.strokeStyle = col; c.lineWidth = 6; c.lineCap = 'round'; if (dash) c.setLineDash([18, 8, 4, 8]); c.beginPath(); c.moveTo(14, 76); c.lineTo(14, 30); c.lineTo(82, 30); c.stroke(); c.setLineDash([]); c.fillStyle = col; c.beginPath(); c.arc(14, 76, 7, 0, 7); c.arc(82, 30, 7, 0, 7); c.fill(); };
  const t0 = section('Nástroje');
  add(t0, 'Výběr a přesun (Esc)', { kind: 'select' }, '↖︎');
  add(t0, 'Vodič (W)', { kind: 'wire', type: 4000 }, wireIcon('#1d1d1f'));
  add(t0, 'Nulový vodič N', { kind: 'wire', type: 4009 }, wireIcon('#1e6fd9'));
  add(t0, 'Ochranný vodič PE', { kind: 'wire', type: 4010 }, wireIcon('#2e9e3e', true));
  for (const cat of [...ES.CATS.filter(c => c.set !== 'both'), ...ES.CATS.filter(c => c.set === 'both')]) {
    if (cat.set !== 'both' && cat.set !== pset) continue;
    const box = section(cat.name, cat.norm);
    for (const code of cat.items) {
      const d = ES.LIB[code];
      if (d.kind === 'text') { add(box, 'Text', { kind: 'text', type: 8 }, 'Abc'); continue; }
      if (d.kind === 'gfx') { add(box, d.name, { kind: 'gfx', type: code }, c => { c.scale(96 / 16, 96 / 16); const g = ES.newItem(code, 3, 4); g.n[10] = 13; g.n[11] = 12; ES.drawItem(c, g, {}); }); continue; }
      add(box, d.name, { kind: 'place', type: code }, c => {
        const it = ES.newItem(code, 0, 0); it.t[0] = '';
        const xs = d.terms.map(p => p[0]), ys = d.terms.map(p => p[1]);
        let b = [Math.min(-7, ...xs) - 1, Math.min(0, ...ys) - 1, Math.max(3, ...xs) + 3, Math.max(12, ...ys) + 1];
        if (d.sym === 'supply') b = [-3, -9, Math.max(6, ...xs) + 3, 2]; if (d.sym === 'motor') b = [-4, -1, 20, 25];
        if (d.sym === 'stage') b = [-7, -1, 7, 13]; if (d.sym === 'trans') b = [-6, -3, 6, 9]; if (d.sym === 'action') { b = [-4, -9, 20, 9]; it.t[0] = 'A'; } if (d.sym === 'key') b = [-6, -6, 6, 6];
        if (d.sym === 'breaker' || d.sym === 'rcd') b[0] = -8; if (d.sym === 'meter') b = [-6, -1, 6, 13]; if (d.sym === 'trafo') b = [-3, -1, 9, 25]; if (d.deco === 'thermal') b[0] = -11;
        const s = 92 / Math.max(b[2] - b[0], b[3] - b[1]);
        c.translate(48 - (b[0] + b[2]) / 2 * s, 48 - (b[1] + b[3]) / 2 * s); c.scale(s, s); ES.drawItem(c, it, { noText: d.sym !== 'supply' && d.sym !== 'motor' && d.sym !== 'action' });
      });
    }
    if (cat.name === 'GRAFCET') add(box, 'Spojnice GRAFCET', { kind: 'wire', type: 10106 }, wireIcon('#1d1d1f'));
  }
}


// ------------------------------------------------------------ realita
// Skutečné přístroje se svorkami; stejné prvky jako ve schématu, spojují se barevnými vodiči.
const R = ES.Real;
const rview = { s: 2.4, ox: 40, oy: 40, fitted: false };
let mode = 'schema', rtool = { kind: 'select' }, rsel = new Set(), rwsel = -1, rdraft = null, rdrag = null, rhover = null, rcmp = null, rsc = null;
let wcol = '#1b1b1b';
const rmouse = { x: 0, y: 0, in: false };
const RHINT = {
  select: 'Realita: tažením ze svorky na svorku natáhnete vodič (klikáním do prázdna lomíte). Přístroj přesunete tažením, dvojklik = vlastnosti a barva, ⌫ = smazat. Barvu vodiče zvolíte v paletě.',
  place: 'Kliknutím vložíte přístroj (pomocný kontakt položte přímo na stykač, kontaktní blok na tlačítko). Esc = konec.',
  wire: 'Vodič: klik na svorku = začátek, kliky do prázdna = lomové body, klik na další svorku = konec. ⌫ = zrušit poslední lom, Esc = zrušit.',
  sim: 'SIMULACE PODLE REALITY: proud teče jen nataženými vodiči. Klikáním ovládáte jističe, tlačítka a přepínače (Shift = tlačítko zůstane stisknuté). Najetím na svorku změříte napětí.',
};
function rToWorld(e) { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - rview.ox) / rview.s, (e.clientY - r.top - rview.oy) / rview.s]; }
function rScene() { rsc = R.scene(doc); return rsc; }
function rHit(x, y, devFirst) {
  const sc = rsc || rScene(), tol = Math.max(1.6, 5 / rview.s);
  const dev = () => { for (let i = sc.devs.length - 1; i >= 0; i--) { const g = sc.devs[i]; if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return { dev: g }; } return null; };
  if (devFirst) { const d = dev(); if (d) return d; }
  let best = null;
  for (const t of sc.T.values()) { const dd = Math.hypot(t.x - x, t.y - y); if (dd < Math.max(3.4, 6 / rview.s) && (!best || dd < best[1])) best = [t, dd]; }
  if (best) return { term: best[0] };
  const ws = doc.real.wires;
  for (let i = ws.length - 1; i >= 0; i--) {
    const w = ws[i], A = sc.T.get(w.a[0] + ':' + w.a[1]), B = sc.T.get(w.b[0] + ':' + w.b[1]); if (!A || !B) continue;
    const pts = (R.routes(doc, sc)[i]) || R.wirePts(A, B, w.p);
    for (let k = 1; k < pts.length; k++) if (segDist(x, y, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) < tol) return { wire: i };
  }
  return dev();
}
function renderReal() {
  const dpr = window.devicePixelRatio || 1, W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#d3d6db'; ctx.fillRect(0, 0, W, H);
  const sc = rScene();
  ctx.translate(rview.ox, rview.oy); ctx.scale(rview.s, rview.s);
  if (rview.s > 1) { // montážní deska s rastrem
    const x0 = Math.floor(-rview.ox / rview.s / 10) * 10, y0 = Math.floor(-rview.oy / rview.s / 10) * 10, x1 = (W - rview.ox) / rview.s, y1 = (H - rview.oy) / rview.s, r = 0.5;
    ctx.fillStyle = '#b9bdc4'; for (let x = x0; x <= x1; x += 10) for (let y = y0; y <= y1; y += 10) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  R.drawScene(ctx, doc, sc, { sim, sel: rsel, wsel: rwsel, fast: !!(rdrag && rdrag.kind === 'move' && rdrag.moved) });
  if (rcmp) for (const k of rcmp) { const t = sc.T.get(k); if (t) { ctx.strokeStyle = '#e53935'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(t.x, t.y, 4.6, 0, 7); ctx.stroke(); } }
  const ht = rhover && rhover.term;
  if (!sim && (rdraft || rtool.kind === 'wire')) for (const t of sc.T.values()) { ctx.strokeStyle = 'rgba(10,102,232,.45)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(t.x, t.y, 3.9, 0, 7); ctx.stroke(); }
  if (ht) { ctx.strokeStyle = '#0a66e8'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(ht.x, ht.y, 4.2, 0, 7); ctx.stroke(); }
  if (rdraft && !sim) {
    const from = sc.T.get(rdraft.from.key); if (from) { const B = ht && ht.key !== from.key ? ht : { x: rmouse.x, y: rmouse.y }; ctx.globalAlpha = 0.8; R.drawWire(ctx, R.wirePts(from, B, rdraft.p), wcol, false); ctx.globalAlpha = 1; }
  }
  if (rtool.kind === 'place' && rmouse.in && !sim) {
    const g = R.presetDevice(rtool.types, ''); g.x = rmouse.x - g.w / 2; g.y = rmouse.y - g.h / 2; ctx.globalAlpha = 0.55; R.drawDevice(ctx, g, { icon: true }); ctx.globalAlpha = 1;
  }
  $('#pos').textContent = (sim ? 'čas ' + sim.t.toFixed(1) + ' s   ' : '') + 'realita   ' + Math.round(rview.s / 2.4 * 100) + ' %';
}
function rFit() {
  const sc = rScene(), r = stage.getBoundingClientRect();
  let b = null; for (const g of sc.devs) { const q = [g.x, g.y, g.x + g.w, g.y + g.h]; b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q; }
  if (b) for (const pts of R.routes(doc, sc)) if (pts) for (const [x, y] of pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  if (!b) b = [0, 0, 300, 200];
  const w = b[2] - b[0] + 40, h = b[3] - b[1] + 40;
  rview.s = Math.max(0.4, Math.min(5, Math.min(r.width / w, r.height / h))); rview.ox = (r.width - (b[0] + b[2]) * rview.s) / 2; rview.oy = (r.height - (b[1] + b[3]) * rview.s) / 2;
  rview.fitted = true; render();
}
function rSetTool(t) {
  rtool = t; rdraft = null;
  document.querySelectorAll('#rpalette .tool').forEach(b => b.classList.toggle('active', !!b._rt && b._rt.kind === t.kind && b._rt.name === t.name));
  cv.style.cursor = t.kind === 'select' ? 'default' : 'crosshair'; hint(RHINT[t.kind]); render();
}
// prvek, který se ovládá kliknutím na přístroj v simulaci
function pressTarget(g) { return g.items.find(i => { const d = ES.getDef(i.type); return d.click || ['breaker', 'mswitch', 'mstarter', 'rcd', 'fuse', 'thermal', 'hsw', 'socket', 'socket3', 'load3'].includes(d.kind); }); }
function rDown(e) {
  const [x, y] = rToWorld(e); rmouse.x = x; rmouse.y = y; rmouse.in = true;
  if (e.button === 1 || spaceDown) { rdrag = { kind: 'pan', cx: e.clientX, cy: e.clientY }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (sim) {
    const h = rHit(x, y, true), g = h && (h.dev || (h.term && h.term.g)), it = g && pressTarget(g);
    if (it && ES.simPress(sim, it, true, e.shiftKey, x < g.x + g.w / 2 ? 0 : 1)) { pressed = it; simTick(0); } else rdrag = { kind: 'pan', cx: e.clientX, cy: e.clientY };
    return;
  }
  const h = rHit(x, y);
  if (rtool.kind === 'place') { rPlace(rtool.types, x, y, h && (h.dev || (h.term && h.term.g))); return; }
  if (rdraft) { if (h && h.term) rFinish(h.term); else rdraft.p.push([Math.round(x * 2) / 2, Math.round(y * 2) / 2]); render(); return; }
  if (h && h.term) { rdraft = { from: h.term, p: [], down: [e.clientX, e.clientY] }; rsel = new Set(); rwsel = -1; render(); return; }
  if (rtool.kind === 'wire') return;
  if (h && h.wire !== undefined) { rwsel = h.wire; rsel = new Set(); render(); return; }
  if (h && h.dev) {
    const u = h.dev.uid; rwsel = -1;
    if (e.shiftKey) { rsel.has(u) ? rsel.delete(u) : rsel.add(u); } else if (!rsel.has(u)) rsel = new Set([u]);
    rdrag = { kind: 'move', lx: x, ly: y, moved: false, sx: e.clientX, sy: e.clientY, touch: e.pointerType === 'touch' }; render(); return;
  }
  rsel = new Set(); rwsel = -1; rdrag = { kind: 'pan', cx: e.clientX, cy: e.clientY }; render();
}
function rMove(e) {
  const [x, y] = rToWorld(e); rmouse.x = x; rmouse.y = y; rmouse.in = e.target === cv;
  if (rdrag && rdrag.kind === 'pan') { rview.ox += e.clientX - rdrag.cx; rview.oy += e.clientY - rdrag.cy; rdrag.cx = e.clientX; rdrag.cy = e.clientY; }
  else if (rdrag && rdrag.kind === 'move') {
    if (!rdrag.moved && rdrag.touch && Math.hypot(e.clientX - rdrag.sx, e.clientY - rdrag.sy) < TAP) return;
    const dx = Math.round(x - rdrag.lx), dy = Math.round(y - rdrag.ly);
    if (dx || dy) {
      if (!rdrag.moved) { pushUndo(); rdrag.moved = true; }
      for (const u of rsel) { const p = doc.real.pos[u]; if (p) { p[0] += dx; p[1] += dy; } }
      // lomy vodičů mezi přesouvanými přístroji jdou s nimi
      const owner = new Map(); for (const g of rsc.devs) for (const it of g.items) owner.set(it.uid, g.uid);
      for (const w of doc.real.wires) if (w.p && w.p.length && rsel.has(owner.get(w.a[0])) && rsel.has(owner.get(w.b[0]))) for (const q of w.p) { q[0] += dx; q[1] += dy; }
      rdrag.lx += dx; rdrag.ly += dy; ver++;
    }
  }
  if (e.target === cv && !rdrag) {
    const h = rHit(x, y, !!sim); rhover = h;
    if (sim) { const g = h && (h.dev || (h.term && h.term.g)); cv.style.cursor = g && pressTarget(g) ? 'pointer' : 'default'; }
    else if (!rdraft && rtool.kind === 'select') hint(h && h.term ? 'Svorka ' + R.termName(h.term) + ' – tažením natáhnete vodič.' : h && h.dev ? (h.dev.name ? h.dev.name + ' – ' : '') + ES.getDef(h.dev.main.type).name + (h.dev.items.length > 1 ? ' (' + h.dev.items.length + ' prvky schématu)' : '') + '. Dvojklik = vlastnosti.' : RHINT.select);
  }
  if (!sim || rdrag) render();
}
function rUp(e) {
  if (pressed && sim) { ES.simPress(sim, pressed, false, e.shiftKey); pressed = null; }
  if (rdraft && rdraft.down) {
    const moved = Math.hypot(e.clientX - rdraft.down[0], e.clientY - rdraft.down[1]) > 5; rdraft.down = null;
    if (moved) { const [x, y] = rToWorld(e), h = rHit(x, y); if (h && h.term && h.term.key !== rdraft.from.key) rFinish(h.term); else rdraft = null; render(); }
  }
  if (!rdrag) return;
  const d = rdrag; rdrag = null; cv.style.cursor = rtool.kind === 'select' ? 'default' : 'crosshair';
  if (d.kind === 'move' && d.moved) touch();
  render();
}
function rFinish(t) {
  const f = rdraft.from, p = rdraft.p; rdraft = null;
  if (t.key === f.key) return;
  pushUndo(); doc.real.wires.push({ a: [f.it.uid, f.ti], b: [t.it.uid, t.ti], c: wcol, p });
  rcmp = null; touch();
}
function rKey(e, k, mod) {
  if (sim || mod) return;
  if (k === 'escape') { if (rdraft) rdraft = null; else { rsel = new Set(); rwsel = -1; rSetTool({ kind: 'select' }); } render(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (rdraft) { if (rdraft.p.length) rdraft.p.pop(); else rdraft = null; render(); } else rDelete(); return; }
  if (k === 'w') rSetTool({ kind: 'wire', name: 'wire' });
  if (k.startsWith('arrow') && rsel.size) { e.preventDefault(); pushUndo(); const dx = k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0, dy = k === 'arrowup' ? -1 : k === 'arrowdown' ? 1 : 0; for (const u of rsel) { const p = doc.real.pos[u]; if (p) { p[0] += dx; p[1] += dy; } } touch(); render(); }
}
function rDelete() {
  if (sim) return;
  if (rwsel >= 0) { pushUndo(); doc.real.wires.splice(rwsel, 1); rwsel = -1; touch(); render(); return; }
  if (!rsel.size) return;
  pushUndo();
  const gone = new Set(); for (const g of rScene().devs) if (rsel.has(g.uid)) for (const it of g.items) gone.add(it.uid);
  doc.items = doc.items.filter(i => !gone.has(i.uid)); pruneNodes();
  doc.real.wires = doc.real.wires.filter(w => !gone.has(w.a[0]) && !gone.has(w.b[0]));
  for (const u of gone) { delete doc.real.pos[u]; delete doc.real.col[u]; }
  rsel = new Set(); rcmp = null; touch(); render();
}
// vložení přístroje: prvky vzniknou i ve schématu (na volném místě)
function rPlace(types, x, y, onto) {
  pushUndo();
  const items = types.map(t => ES.newItem(t, 0, 0)), d0 = ES.getDef(types[0]);
  let name, adopt = false;
  if (types.length === 1 && onto && onto.fam && onto.fam === R.famOf(d0) && onto.name) { name = onto.name; adopt = true; }
  else if (types.length === 1) name = autoName(d0);
  else name = nextFree(d0.pre || '-X');
  for (const it of items) if (ES.getDef(it.type).pre !== undefined) it.t[0] = name;
  R.placeInSchema(doc, items);
  doc.items.push(...items);
  if (!adopt) {
    const g = R.devices({ items, real: doc.real })[0];
    if (g) { const L = R.layout(g); if (!doc.real.pos[g.uid] && !R.devices(doc).some(o => o.uid !== g.uid && o.items.includes(g.main))) doc.real.pos[g.uid] = [Math.round(x - L.w / 2), Math.round(y - L.h / 2)]; }
  }
  rcmp = null; touch(); render();
  hint(adopt ? 'Kontakt přidán k přístroji ' + name + '.' : (name ? name + ' vložen – ve schématu je na volném místě.' : 'Přístroj vložen.'));
}
async function rEditDevice(g) {
  const col = doc.real.col[g.uid] || {}, it = g.main, d = g.d;
  const f = (label, name, val, attr) => '<label>' + label + '<input name="' + name + '" value="' + esc(val) + '" ' + (attr || '') + '></label>';
  const cpick = (label, name, val, def) => '<label>' + label + '<input type="color" name="' + name + '" value="' + (val || def) + '" style="width:56px;padding:1px"></label>';
  const names = g.items.map(i => { const e = ES.getDef(i.type); return e.name.toLowerCase() + (e.labels && e.labels.length ? ' ' + e.labels.slice(0, 2).join('–') : ''); });
  let h = '<h2>' + esc(g.name || d.name) + '</h2><p>Ve schématu: ' + esc(names.join(', ')) + '.</p>';
  if (d.pre !== undefined && g.type !== 'supply') h += f('Označení', 't0', g.name, 'autofocus');
  h += cpick('Barva těla', 'bc', col.b, '#f5f5f3');
  if (['button', 'breaker', 'rcd', 'mstarter', 'mswitch'].includes(g.type)) h += cpick(g.type === 'button' ? 'Barva hmatníku' : 'Barva ovládání', 'hc', col.h, '#2b2b2e');
  if (g.type === 'lamp' || g.type === 'blink') h += '<label>Barva světla<select name="t4">' + ES.LAMP_NAME.map((c, i) => '<option value="' + i + '"' + ((parseInt(it.t[4]) || 0) === i ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></label>';
  if (g.type === 'timer') h += f('Čas (s)', 't5', it.t[5], 'type="number" min="0" step="0.1"');
  if (g.type === 'thermal' || g.type === 'mstarter') h += f('Nastavení Ir (A)', 't8', it.t[8], 'type="number" min="0" step="0.1"');
  if (/^motor/.test(g.type)) h += f('Výkon motoru (kW)', 't9', it.t[9], 'type="number" min="0.1" step="0.1"');
  h += powerFields(ES.getDef(it.type), it, f);
  if (ES.getDef(it.type).click === 'pir' || d.sub === 'stair') h += f('Doba svitu (s)', 't5', it.t[5], 'type="number" min="0" step="0.1"');
  if (g.type === 'trafo') h += f('Primární napětí (V)', 't6', it.t[6] || '230', 'type="number" min="1"') + f('Sekundární napětí (V)', 't7', it.t[7] || '24', 'type="number" min="1"');
  const addOpts = g.fam === 'K' ? [[7000, 'pomocný NO'], [7001, 'pomocný NC']] : g.fam === 'T' ? (ES.getDef(it.type).sub === 'toff' ? [[7008, 'časový NO'], [7009, 'časový NC']] : [[7004, 'časový NO'], [7005, 'časový NC']])
    : g.fam === 'S' ? ({ push: [[8000, 'blok NO'], [8001, 'blok NC']], mushroom: [[8004, 'blok NO'], [8005, 'blok NC']], toggle: [[8008, 'blok NO'], [8009, 'blok NC']], limit: [[8012, 'NO'], [8013, 'NC']] }[ES.getDef(g.items[0].type).deco] || []) : [];
  if (addOpts.length) h += '<label>Přidat kontakt<select name="addc"><option value="">–</option>' + addOpts.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select></label>';
  if ((await ask(h, [['no', 'Zrušit'], ['ok', 'OK']])) !== 'ok') return;
  const v = Object.fromEntries(new FormData(form)); pushUndo();
  let nm = g.name;
  if (v.t0 !== undefined && v.t0.replace(/[#*]/g, '') !== g.name) { nm = v.t0.replace(/[#*]/g, ''); for (const m of g.items) m.t[0] = nm; }
  const c = {}; if (v.bc && v.bc.toLowerCase() !== '#f5f5f3') c.b = v.bc; if (v.hc && v.hc.toLowerCase() !== '#2b2b2e') c.h = v.hc;
  if (c.b || c.h) doc.real.col[g.uid] = c; else delete doc.real.col[g.uid];
  if (v.t4 !== undefined) it.t[4] = v.t4;
  if (v.t5 !== undefined) it.t[5] = String(Math.max(0, parseFloat(v.t5) || 0));
  for (const k of ['t6', 't7', 't8', 't9']) if (v[k] !== undefined) it.t[+k.slice(1)] = v[k] === '' ? '' : String(Math.max(0, parseFloat(String(v[k]).replace(',', '.')) || 0));
  if (v.addc) {
    if (!nm) { nm = nextFree(d.pre || '-K'); for (const m of g.items) m.t[0] = nm; }
    const n = ES.newItem(+v.addc, 0, 0); n.t[0] = nm; R.placeInSchema(doc, [n]); doc.items.push(n);
  }
  rcmp = null; touch(); render();
}
async function rEditWire(i) {
  const w = doc.real.wires[i]; rwsel = i; render();
  let h = '<h2>Vodič</h2><label>Barva<select name="c">' + R.WCOL.map(o => '<option value="' + o[0] + '"' + (o[0] === w.c ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
  if (w.p && w.p.length) h += '<label>Lomové body<span><input type="checkbox" name="clr" style="width:auto"> zrušit (' + w.p.length + ')</span></label>';
  const r = await ask(h, [['del', 'Smazat vodič'], ['no', 'Zrušit'], ['ok', 'OK']]);
  if (r === 'del') { rwsel = i; rDelete(); return; }
  if (r !== 'ok') return;
  const v = Object.fromEntries(new FormData(form)); pushUndo(); w.c = v.c; wcol = v.c; if (v.clr) w.p = []; touch(); render();
}
function rDbl(e) {
  const [x, y] = rToWorld(e), h = rHit(x, y);
  if (rdraft) { rdraft = null; render(); return; }
  if (h && h.wire !== undefined) rEditWire(h.wire);
  else if (h && (h.dev || h.term)) { const g = h.dev || h.term.g; rsel = new Set([g.uid]); render(); rEditDevice(g); }
}
function rProbe() {
  if (!sim || !rhover) return '';
  const V = v => Math.round(Math.hypot(v[0], v[1])) + ' V';
  if (rhover.term) {
    const t = rhover.term, net = sim.nets.ofKey.get(t.key); if (net === undefined) return '';
    const names = ES.potNames(sim.netPot[net]), v = ES.netVoltage(sim, net);
    return 'Svorka ' + R.termName(t) + ': ' + (names.length ? names.join('+') + ', ' : '') + (v ? V(v) + ' proti zemi' : 'bez napětí');
  }
  if (rhover.dev) { const g = rhover.dev, it = g.items.find(i => sim.meas[i.uid] || sim.motor[i.uid]) || g.main; return probe(it) || ((g.name || g.d.name) + (g.type === 'contactor' || g.type === 'relay' ? (sim.coil[ES.keyOf(g.main)] ? ': přitažený' : ': odpadlý') : '')); }
  return '';
}
const wlabel = c => R.WNAME[c] || c;
async function rFromSchema() {
  if (sim) return;
  const n = doc.real.wires.length;
  if (n && (await ask('<h2>Zapojit podle schématu</h2><p>V realitě je už natažených ' + n + ' vodičů. Nahradit je zapojením ze schématu? Barvy se určí podle potenciálu (L1 hnědá, L2 černá, L3 šedá, N modrá, PE zelenožlutá).</p>', [['no', 'Zrušit'], ['ok', 'Nahradit']])) !== 'ok') return;
  pushUndo(); doc.real.wires = R.wiresFromSchema(doc); rcmp = null; touch(); render();
  hint('Nataženo ' + doc.real.wires.length + ' vodičů podle schématu.');
}
async function rToSchema() {
  if (sim) return;
  if ((await ask('<h2>Překreslit schéma podle reality</h2><p>Všechny vodiče ve schématu se smažou a nakreslí znovu podle vodičů v realitě (značky zůstanou na svých místech). Barva vodiče určí jeho typ: zelenožlutá = PE, světle modrá = N.</p>', [['no', 'Zrušit'], ['ok', 'Překreslit']])) !== 'ok') return;
  pushUndo(); const res = R.schemaFromReal(doc); touch();
  const bad = res.missing.length + res.extra.length;
  const r = await ask('<h2>Schéma překresleno</h2><p>Nakresleno ' + res.wires + ' úseků vodičů.' + (res.failed ? ' ' + res.failed + ' spojů se nepodařilo vést volnou cestou (jsou nakresleny přímo, zkontrolujte je).' : '') +
    (res.conflicts ? ' Na ' + res.conflicts + ' místech se svorky různých přístrojů ve schématu překrývají – rozmístěte je.' : '') + (bad ? ' Schéma se od reality liší v ' + bad + ' spojích.' : ' Zapojení schématu odpovídá realitě.') + '</p>', [['stay', 'Zůstat v realitě'], ['go', 'Zobrazit schéma']]);
  if (r === 'go') { setTab('schema'); fit(); } else render();
}
async function rCompare() {
  const c = R.compare(doc), pairs = [...c.missing.map(p => ['chybí', p]), ...c.extra.map(p => ['navíc', p])];
  rcmp = new Set(); for (const [, p] of pairs) for (const t of p) rcmp.add(t.key);
  render();
  if (!pairs.length) { rcmp = null; await ask('<h2>Porovnání se schématem</h2><p>Zapojení v realitě přesně odpovídá schématu. ✔︎</p>', [['ok', 'OK']]); render(); return; }
  await ask('<h2>Porovnání se schématem</h2><p>Nalezeno ' + pairs.length + ' rozdílů (svorky jsou v realitě označené červeně):</p><p style="color:var(--text);max-height:220px;overflow:auto">' +
    pairs.slice(0, 40).map(([k, p]) => (k === 'chybí' ? '✗ chybí spoj ' : '＋ spoj navíc ') + esc(R.termName(p[0])) + ' – ' + esc(R.termName(p[1]))).join('<br>') + '</p>', [['ok', 'OK']]);
  render();
}
function rExportPNG() {
  const sc = rScene(); if (!sc.devs.length) return;
  let b = null; for (const g of sc.devs) { const q = [g.x, g.y, g.x + g.w, g.y + g.h]; b = b ? [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])] : q; }
  const m = 25, k = 5, c = document.createElement('canvas'); c.width = (b[2] - b[0] + 2 * m) * k; c.height = (b[3] - b[1] + 2 * m) * k;
  const x = c.getContext('2d'); x.fillStyle = '#d3d6db'; x.fillRect(0, 0, c.width, c.height); x.scale(k, k); x.translate(m - b[0], m - b[1]);
  R.drawScene(x, doc, sc, { sim });
  const u8 = unb64(c.toDataURL('image/png').split(',')[1]), name = fileName.replace(/\.cad$/i, '') + ' - realita.png';
  if (native) native.postMessage({ cmd: 'export', name, data: b64(u8) }); else webSave(name, u8, 'image/png', [{ description: 'Obrázek PNG', accept: { 'image/png': ['.png'] } }]);
}
function buildRealPalette() {
  const pal = $('#rpalette'); pal.innerHTML = ''; setPicker(pal);
  const section = (name, norm) => { const h = secHead(name, norm); h.onclick = () => h.classList.toggle('closed'); const d = document.createElement('div'); d.className = 'items'; pal.append(h, d); return d; };
  const t0 = section('Nástroje');
  const tb = (box, title, t, content) => { const b = document.createElement('button'); b.className = 'tool'; b.title = title; b._rt = t; if (typeof content === 'string') { b.classList.add('text'); b.textContent = content; } else b.append(content); b.onclick = () => rSetTool(Object.assign({}, t)); box.append(b); return b; };
  tb(t0, 'Výběr a přesun (Esc)', { kind: 'select' }, '↖︎');
  const wc = document.createElement('canvas'); wc.width = wc.height = 96;
  const drawW = () => { const c = wc.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 96, 96); c.scale(4, 4); R.drawWire(c, R.wirePts({ x: 4, y: 19, dir: [0, -1] }, { x: 20, y: 5, dir: [0, 1] }), wcol, false); };
  drawW(); tb(t0, 'Vodič (W)', { kind: 'wire', name: 'wire' }, wc);
  const sw = section('Barva vodiče', 'ČSN EN 60445 · ČSN 33 2000-5-51');
  for (const [c, n] of R.WCOL) {
    const b = document.createElement('button'); b.className = 'swatch' + (c === wcol ? ' active' : ''); b.title = n;
    b.style.background = c === 'gnye' ? 'repeating-linear-gradient(45deg,#2f9e44 0 6px,#f3d21c 6px 12px)' : c;
    b.onclick = () => { wcol = c; pal.querySelectorAll('.swatch').forEach(x => x.classList.toggle('active', x === b)); drawW(); if (rwsel >= 0 && !sim) { pushUndo(); doc.real.wires[rwsel].c = c; touch(); render(); } else if (rtool.kind !== 'wire') rSetTool({ kind: 'wire', name: 'wire' }); };
    sw.append(b);
  }
  for (const [cat, list, set, norm] of R.PRESETS) {
    if ((set || 'ind') !== pset) continue;
    const box = section(cat, norm);
    for (const [name, types] of list) {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const g = R.presetDevice(types, ''), x = c.getContext('2d'), s = 88 / Math.max(g.w, g.h);
      x.translate(48 - g.w * s / 2, 48 - g.h * s / 2); x.scale(s, s); R.drawDevice(x, g, { icon: true });
      tb(box, name, { kind: 'place', name, types }, c);
    }
  }
}

// ------------------------------------------------------------ start
window.ESApp = {
  cmd, isDirty: () => dirty, setTab: t => setTab(t),
  loadFile: async (name, data, path) => { if (await confirmDiscard()) loadBytes(name, unb64(data), path); },
  saved: (name, path) => { fileName = name; filePath = path; dirty = false; title(); },
  _debug: () => ({ doc, sim, view, rview, mode, hit, setTool, sel }),
};
(window.ES_EXAMPLES || []).forEach((ex, i) => { const o = document.createElement('option'); o.value = i; o.textContent = ex.title; $('#examples').append(o); });
// záložky Schéma / Kalkulačky
function setTab(t) {
  if (t === mode) return;
  if (sim && t !== 'calc') simToggle(); // simulace běží buď podle schématu, nebo podle reality
  mode = t;
  document.body.classList.toggle('calc', t === 'calc'); document.body.classList.toggle('real', t === 'real');
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  if (t === 'calc') { window.ESCalc.build($('#calcview')); return; }
  hint(sim ? (t === 'real' ? RHINT.sim : HINTS.sim) : t === 'real' ? RHINT[rtool.kind] : HINTS[tool.kind]);
  if (t === 'real' && !rview.fitted) rFit(); else render();
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); b.blur(); }));
$('#cvBand').addEventListener('click', () => setTool(tool.kind === 'band' ? { kind: 'select' } : { kind: 'band' }));
$('#cvProps').addEventListener('click', () => { const it = doc.items.find(i => sel.has(i.uid)); if (it) editProps(it); });
$('#cvDone').addEventListener('click', () => { if (mode === 'real') { rdraft = null; rSetTool({ kind: 'select' }); } else if (tool.kind === 'wire' && tool.start) { tool.start = null; render(); } else setTool({ kind: 'select' }); });
$('#menubtn').addEventListener('click', () => { const o = $('#bar').classList.toggle('menuopen'); $('#menubtn').setAttribute('aria-expanded', String(o)); });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#bar')) { $('#bar').classList.remove('menuopen'); $('#menubtn').setAttribute('aria-expanded', 'false'); } });
$('#bar').addEventListener('change', () => $('#bar').classList.remove('menuopen'));
$('#bar').addEventListener('click', e => { if (e.target.closest('[data-cmd]')) $('#bar').classList.remove('menuopen'); });
buildPalette(); buildRealPalette(); setTool({ kind: 'select' }); title();
new ResizeObserver(render).observe(stage);
window.addEventListener('beforeunload', e => { if (dirty && !native) { e.preventDefault(); e.returnValue = ''; } });
if (native) native.postMessage({ cmd: 'ready' });
})();
