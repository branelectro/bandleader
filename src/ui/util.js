import { ATTRS, ATTR_LABELS, GEAR_BY_ID, GEAR_TIERS, GEAR_SLOTS, EXTRAS_BY_ID, DAY_NAMES } from '../engine/data.js?v=3';
import { cred, displayName, roleLabel, TIER_LABELS, xpToNext, missingGear, requiredSlots, bestInSlot } from '../engine/people.js?v=3';
import { fmtMoney } from '../engine/state.js?v=3';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = fmtMoney;
export const pct = (v) => `${Math.round(v)}%`;
// Per-unit prices keep their cents: 60¢, $2.40, $1.05.
export const unitPrice = (u) => (u < 1 ? `${Math.round(u * 100)}¢` : `$${u.toFixed(2)}`);

// Each band keeps one color for its whole life (stored on the band so it
// survives saves and never shifts when you join or leave other bands).
export const BAND_COLORS = ['#6cb7ff', '#ff8a5c', '#59d38c', '#c792ff', '#ffd25c', '#ff6fb5', '#4fd6d0', '#b5e35a'];
export function bandColor(state, band) {
  if (!band.color) {
    const used = new Set(Object.values(state.bands).map((b) => b.color).filter(Boolean));
    band.color = BAND_COLORS.find((c) => !used.has(c)) || BAND_COLORS[Object.keys(state.bands).indexOf(band.id) % BAND_COLORS.length];
  }
  return band.color;
}
export function bandDot(state, band) {
  return `<span class="dot" style="background:${bandColor(state, band)}"></span>`;
}
// "The band fund is short" box with a one-click top-up from your own cash.
export function fundBox(state, band, need, why) {
  const short = Math.ceil(need - band.cash);
  if (!band || short <= 0) return '';
  const canAll = state.cash >= short;
  return `<div class="item fund-box">
    <div class="small">Band fund has <b>${money(band.cash)}</b>, but ${why} needs <b>${money(need)}</b>. Short by <b>${money(short)}</b>.</div>
    <div class="row" style="margin-top:.35rem">
      <button class="btn small primary" data-action="fund-quick" data-band="${band.id}" data-amount="${short}" ${canAll ? '' : 'disabled'}>Add ${money(short)} from your cash</button>
      ${!canAll && state.cash >= 1 ? `<button class="btn small" data-action="fund-quick" data-band="${band.id}" data-amount="${Math.floor(state.cash)}">Add all you have (${money(state.cash)})</button>` : ''}
      <span class="small muted">You have ${money(state.cash)}.</span>
    </div>
  </div>`;
}

// Seven clickable evenings: red = work night, green = free.
export function dayToggles(busy, action) {
  return `<div class="daytoggle">${DAY_NAMES.map((n, i) => `<button class="${busy.includes(i) ? 'busy' : ''}" data-action="${action}" data-day="${i}" title="${busy.includes(i) ? 'Work night (click to free it up)' : 'Free (click to make it a work night)'}">${n} · ${busy.includes(i) ? 'work' : 'free'}</button>`).join('')}</div>`;
}

export const EVENT_ICONS = { practice: '🥁', gig: '🎤', recording: '🎙️' };
export const EVENT_NAMES = { practice: 'Practice', gig: 'Show', recording: 'Recording' };

export function bar(value, max = 100, cls = '') {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="bar ${cls}"><span style="width:${w}%"></span></div>`;
}

export function stat(label, value, sub = '') {
  return `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

export function credBadge(p) {
  return `<span class="cred">${cred(p)} <small>cred</small></span>`;
}

export function attrRows(p, { xp = false } = {}) {
  return ATTRS.map((a) => {
    const v = p.attrs[a];
    const xpBar = xp && a !== 'reliability' && v < 10 ? bar(p.xp[a] || 0, xpToNext(v), 'xp') : '';
    return `<div class="attr"><span>${ATTR_LABELS[a]}</span><div>${bar(v, 10, a === 'reliability' ? 'good' : '')}${xpBar ? `<div style="margin-top:2px">${xpBar}</div>` : ''}</div><span class="num">${v}</span></div>`;
  }).join('');
}

export function daysStrip(p) {
  return `<div class="days" title="Evenings they're usually free (green) or busy (red)">${DAY_NAMES.map((d, i) => `<span class="${p.busy.includes(i) ? 'busy' : ''}">${d[0]}${d[1]}</span>`).join('')}</div>`;
}

export function gearList(p) {
  if (!p.gear.length) return '<span class="muted small">No gear</span>';
  return `<div class="tags">${p.gear.map((id) => {
    const g = GEAR_BY_ID[id];
    return g ? `<span class="tag" title="${esc(GEAR_TIERS[g.tier])}">T${g.tier} ${esc(g.name)}</span>` : '';
  }).join('')}</div>`;
}

export function extrasList(p) {
  if (!p.extras.length) return '';
  return `<div class="tags">${p.extras.map((id) => `<span class="tag extra" title="${esc(EXTRAS_BY_ID[id]?.detail)}">★ ${esc(EXTRAS_BY_ID[id]?.label)}</span>`).join('')}</div>`;
}

export function memberCard(p, { band = null, extra = '', compact = false } = {}) {
  const missing = missingGear(p);
  const known = band && band.songs ? Math.round(Math.min(1, (band.known[p.id] || 0) / band.songs) * 100) : null;
  const pay = band?.pay[p.id];
  return `<div class="member">
    <div class="head">
      <div>
        <div class="name">${esc(displayName(p))}${p.isPlayer ? ' <span class="tag good">you</span>' : ''}${band && band.leaderId === p.id ? ' <span class="tag warn">leader</span>' : ''}</div>
        <div class="muted small">${esc(roleLabel(p))} · ${TIER_LABELS[p.tier]}${p.isPlayer ? '' : ` · ${esc(p.job)}`}</div>
      </div>
      ${credBadge(p)}
    </div>
    ${compact ? '' : `<div style="margin:.5rem 0">${attrRows(p)}</div>`}
    <div class="row small" style="margin:.35rem 0">${daysStrip(p)}${pay ? `<span class="tag warn">${money(pay)}/event</span>` : ''}${known !== null ? `<span class="tag ${known < 60 ? 'bad' : ''}">knows ${known}% of songs</span>` : ''}</div>
    ${gearList(p)}
    ${missing.length ? `<div class="small bad" style="margin-top:.3rem">Missing: ${missing.map((s) => GEAR_SLOTS[s]).join(', ')}</div>` : ''}
    ${extrasList(p)}
    ${extra}
  </div>`;
}

export function gearSlotSummary(p) {
  return requiredSlots(p).map((s) => `${GEAR_SLOTS[s]}: ${bestInSlot(p, s) ? `T${bestInSlot(p, s)}` : '<span class="bad">none</span>'}`).join(' · ');
}
