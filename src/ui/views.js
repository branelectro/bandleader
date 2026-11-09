import {
  ATTRS, ATTR_LABELS, INSTRUMENTS, INSTRUMENT_IDS, VOCAL_LABELS, GENRES, GENRE_IDS, GEAR_CATALOG, GEAR_SLOTS, GEAR_TIERS,
  GEAR_BY_ID, DAY_NAMES, AMATEUR_POINT_CAP, VENUE_TIERS,
} from '../engine/data.js';
import { cred, credBreakdown, displayName, roleLabel, TIER_LABELS, requiredSlots, shortName, SEMIPRO_AT, PRO_AT, attrTotal, availabilityChance } from '../engine/people.js';
import { player, playerBands, dayLabel, weekday } from '../engine/state.js';
import { membersOf, lineupCheck } from '../engine/band.js';
import { standingLabel } from '../engine/gigs.js';
import { SELL_BACK } from '../engine/economy.js';
import { esc, money, bar, stat, credBadge, attrRows, gearList, extrasList, daysStrip, memberCard, gearSlotSummary, bandColor, bandDot, EVENT_ICONS, EVENT_NAMES } from './util.js';

// ---------------------------------------------------------------------------
// Character creation
// ---------------------------------------------------------------------------
export function createView(ui) {
  const c = ui.create;
  const used = ATTRS.reduce((s, a) => s + c.attrs[a], 0);
  const left = AMATEUR_POINT_CAP - used;
  const preview = { attrs: c.attrs, instrument: c.instrument, vocals: c.instrument === 'vocals' ? 'lead' : c.vocals, gear: [], extras: [] };
  return `<div class="hero"><h1>BANDLEADER</h1><p class="muted">Start a band from nothing. Every scene, member and venue is generated fresh for each playthrough.</p></div>
  <div class="grid two">
    <div class="panel stack">
      <h2>Who are you?</h2>
      <div class="row">
        <label class="field" style="flex:1">First name<input type="text" id="c-first" value="${esc(c.first)}" maxlength="20"></label>
        <label class="field" style="flex:1">Last name<input type="text" id="c-last" value="${esc(c.last)}" maxlength="20"></label>
      </div>
      <div class="row">
        <label class="field" style="flex:1">Instrument
          <select id="c-inst" data-change="create-inst">${INSTRUMENT_IDS.map((i) => `<option value="${i}" ${c.instrument === i ? 'selected' : ''}>${INSTRUMENTS[i].label}</option>`).join('')}</select>
        </label>
        <label class="field" style="flex:1">Vocals
          <select id="c-vox" data-change="create-vox" ${c.instrument === 'vocals' ? 'disabled' : ''}>${Object.entries(VOCAL_LABELS).map(([k, v]) => `<option value="${k}" ${(c.instrument === 'vocals' ? 'lead' : c.vocals) === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
      </div>
      <p class="small muted">Singing on top of an instrument bumps your starting cred (lead +4, backing +2) and makes you easier to build a small band around.</p>
      <div>
        <div class="row between"><h3>Attributes</h3><span class="${left ? 'warn' : 'good'}">${left} point${left === 1 ? '' : 's'} left</span></div>
        <p class="small muted">Amateurs start with ${AMATEUR_POINT_CAP} points total. Everything grows by practicing, gigging and recording.</p>
        ${ATTRS.map((a) => `<div class="row between" style="margin:.35rem 0">
          <span style="width:7rem">${ATTR_LABELS[a]}</span>
          <div class="stepper">
            <button class="btn" data-action="create-attr" data-attr="${a}" data-delta="-1" ${c.attrs[a] <= 1 ? 'disabled' : ''}>−</button>
            <span class="num" style="width:1.5rem">${c.attrs[a]}</span>
            <button class="btn" data-action="create-attr" data-attr="${a}" data-delta="1" ${left <= 0 ? 'disabled' : ''}>+</button>
          </div>
          <span class="small muted" style="flex:1;min-width:10rem">${{ skill: 'How well you play.', experience: 'Stage time. Helps you keep it together live.', charisma: 'Stage presence and style. Sells the show.', reliability: 'Do you show up? Bands notice.' }[a]}</span>
        </div>`).join('')}
      </div>
      <label class="field">World seed (same seed = same scene)<input type="text" id="c-seed" value="${esc(c.seed)}"></label>
      <button class="btn primary" data-action="create-go">Start playing</button>
    </div>
    <div class="panel stack">
      <h2>Preview</h2>
      <div class="row between"><div><b>${esc(c.first || 'You')} ${esc(c.last)}</b><div class="muted small">${esc(roleLabel(preview))}</div></div><span class="cred">${cred(preview)} <small>cred</small></span></div>
      ${attrRows(preview)}
      <p class="small muted">Cred is your overall worth: attributes, plus singing, gear, a PA and any extras. Bands and recruits judge you by it. You start with $350 and no gear; the shop has what you'll need: ${requiredSlots(preview).map((s) => GEAR_SLOTS[s]).join(', ')}.</p>
      <h3>How it plays</h3>
      <ul class="small">
        <li>Post on socials to recruit. Auditions show up in your inbox.</li>
        <li>Pick a genre. Each needs a different minimum lineup. Small bands are cheap and easy to schedule but need a demo to book bars. Big bands impress venues but cost more and take longer to teach.</li>
        <li>Schedule practices on the calendar. Members with day jobs will ask to reschedule (or just not show).</li>
        <li>Basement shows are easy and grow you fast, until you've won over the same crowd. Then you need bars, a real recording, and bigger bills.</li>
        <li>Press <b>Next day</b> or <b>Next week</b> to let time pass.</li>
      </ul>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export function dashboardView(state, ui) {
  const p = player(state);
  const bands = playerBands(state);
  const total = attrTotal(p);
  const nextTier = p.tier === 'amateur' ? `Semi-pro at ${SEMIPRO_AT} attribute points (you have ${total})` : p.tier === 'semipro' ? `Pro at ${PRO_AT} attribute points (you have ${total})` : 'Top tier';
  return `<div class="grid two">
    <div class="panel stack">
      <div class="row between">
        <div><h2>${esc(displayName(p))}</h2><div class="muted">${esc(roleLabel(p))} · ${TIER_LABELS[p.tier]}</div></div>
        ${credBadge(p)}
      </div>
      <div class="stats">
        ${stat('Cash', money(state.cash), 'personal')}
        ${stat('Bands', bands.length)}
        ${stat('Gigs played', state.stats.gigs)}
        ${stat('Releases', state.stats.releases)}
      </div>
      <div>${attrRows(p, { xp: true })}</div>
      <p class="small muted">${nextTier}. Yellow bars are XP toward the next point.</p>
      <details><summary class="small">Cred breakdown</summary><table class="simple">${credBreakdown(p).map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${Math.round(b.value)}</td></tr>`).join('')}</table></details>
      <div><h4>Your gear</h4>
        <p class="small">${gearSlotSummary(p)}</p>
        ${p.gear.length ? `<table class="simple">${p.gear.map((id, i) => { const g = GEAR_BY_ID[id]; return `<tr><td>${esc(GEAR_SLOTS[g.slot])}</td><td>${esc(g.name)}</td><td><span class="tag">T${g.tier}</span></td><td><button class="btn small ghost" data-action="sell" data-index="${i}">Sell ${money(g.price * SELL_BACK)}</button></td></tr>`; }).join('')}</table>` : '<p class="muted small">You own nothing. Hit the shop.</p>'}
      </div>
      <div class="row"><button class="btn" data-action="woodshed" ${state.flags.woodshedDay === state.day ? 'disabled' : ''}>Practice alone today</button><span class="small muted">Small skill XP, once per day.</span></div>
    </div>
    <div class="stack">
      ${nextSteps(state)}
      <div class="panel">
        <div class="row between"><h2>Your bands</h2><button class="btn small" data-action="tab" data-tab="scene">Start / join a band</button></div>
        ${bands.length ? bands.map((b) => bandSummaryCard(state, b)).join('') : '<p class="muted">You\'re not in a band yet. Start one from the Scene tab, or answer someone\'s post.</p>'}
      </div>
      <div class="panel">
        <h2>Feed</h2>
        <div class="news">${state.news.slice(0, 40).map((n) => `<div class="${n.tone}"><span class="muted small">${dayLabel(n.day)}</span> ${esc(n.text)}</div>`).join('') || '<span class="muted">Nothing yet.</span>'}</div>
      </div>
    </div>
  </div>`;
}

// Contextual hints so a new player always knows a sensible next move.
function nextSteps(state) {
  const p = player(state);
  const tips = [];
  const missing = requiredSlots(p).filter((s) => !p.gear.some((id) => GEAR_BY_ID[id]?.slot === s));
  if (missing.length) tips.push(`Buy gear you need to play: ${missing.map((s) => GEAR_SLOTS[s]).join(', ')}. <button class="btn small" data-action="tab" data-tab="shop">Shop</button>`);
  const pending = state.threads.filter((t) => !t.resolved && t.actions.length).length;
  if (pending) tips.push(`${pending} message(s) waiting for your answer. <button class="btn small" data-action="tab" data-tab="inbox">Inbox</button>`);
  const bands = playerBands(state);
  if (!bands.length) tips.push('Start a band or audition for one. <button class="btn small" data-action="tab" data-tab="scene">Scene</button>');
  for (const b of bands.filter((x) => x.leaderId === state.playerId)) {
    const lc = lineupCheck(b, membersOf(state, b));
    const upcoming = b.events.filter((e) => e.status === 'scheduled');
    const open = `<button class="btn small" data-action="open-band" data-band="${b.id}">Open</button>`;
    if (!lc.ok && !b.recruiting) tips.push(`${esc(b.name)}: ${esc(lc.problems[0])} Post for members. ${open}`);
    else if (!lc.ok) tips.push(`${esc(b.name)}: recruiting post is live. Press Next week and watch your inbox.`);
    else if (!upcoming.some((e) => e.type === 'practice')) tips.push(`${esc(b.name)}: schedule a practice. That's how you write songs and get tight. ${open}`);
    else if (b.songs < VENUE_TIERS[0].songs) tips.push(`${esc(b.name)}: you need ${VENUE_TIERS[0].songs} songs for a basement show (you have ${b.songs}). Keep practicing.`);
    else if (!upcoming.some((e) => e.type === 'gig')) tips.push(`${esc(b.name)}: you have enough songs. Book a show! ${open}`);
    if (lc.ok && state.day - b.lastPostDay > 3 && b.followers > 0) tips.push(`${esc(b.name)}: you haven't posted in a while. Engagement is slipping.`);
  }
  if (!tips.length) return '';
  return `<div class="panel"><h3>Next steps</h3><ul class="small" style="margin:0;padding-left:1.1rem">${tips.slice(0, 4).map((t) => `<li style="margin:.3rem 0">${t}</li>`).join('')}</ul></div>`;
}

function bandSummaryCard(state, b) {
  const next = b.events.filter((e) => e.status === 'scheduled').sort((x, y) => x.day - y.day)[0];
  const lc = lineupCheck(b, membersOf(state, b));
  return `<div class="item" style="margin-top:.6rem">
    <div class="row between"><div>${bandDot(state, b)}<b>${esc(b.name)}</b> <span class="muted small">${GENRES[b.genre].label} · ${b.memberIds.length} members${b.leaderId === state.playerId ? ' · you lead' : ''}</span></div>
      <button class="btn small" data-action="open-band" data-band="${b.id}">Open</button></div>
    <div class="stats" style="margin-top:.5rem">
      ${stat('Followers', b.followers.toLocaleString())}
      ${stat('Engagement', `${Math.round(b.engagement)}%`)}
      ${stat('Band fund', money(b.cash))}
      ${stat('Standing', esc(standingLabel(b.standing)))}
    </div>
    <div class="small muted" style="margin-top:.4rem">${next ? `Next: ${esc(next.title)} · ${dayLabel(next.day)}` : 'Nothing scheduled.'}${lc.ok ? '' : ` <span class="warn">· ${esc(lc.problems[0])}</span>`}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
const KIND_LABEL = { audition: 'Audition', reschedule: 'Schedule', payRequest: 'Pay request', fire: 'Band drama', joinOffer: 'Offer', result: 'Result', dm: 'DM', bandChat: 'Band chat', note: 'Note' };

export function inboxView(state, ui) {
  const threads = state.threads.slice().sort((a, b) => (a.resolved - b.resolved) || (b.day - a.day));
  const filter = ui.inboxFilter || 'all';
  const shown = threads.filter((t) => filter === 'all' || (filter === 'pending' ? !t.resolved : t.kind === filter));
  const sel = state.threads.find((t) => t.id === ui.threadId) || shown[0];
  return `<div class="subnav">${['all', 'pending', 'audition', 'result'].map((f) => `<button class="chip ${filter === f ? 'active' : ''}" data-action="inbox-filter" data-filter="${f}">${f === 'all' ? 'All' : f === 'pending' ? 'Needs you' : KIND_LABEL[f] + 's'}</button>`).join('')}</div>
  <div class="inbox">
    <div class="thread-list">${shown.map((t) => `<button class="thread-btn ${sel && sel.id === t.id ? 'active' : ''} ${!t.resolved ? 'pending' : ''}" data-action="open-thread" data-thread="${t.id}">
      <div class="t">${t.unread ? '● ' : ''}${esc(t.title)}</div>
      <div class="s">${KIND_LABEL[t.kind] || t.kind} · ${dayLabel(t.day)}${!t.resolved && t.actions.length ? ' · <span class="warn">needs answer</span>' : !t.resolved ? ' · waiting on leader' : ''}</div>
    </button>`).join('') || '<p class="muted">Empty.</p>'}</div>
    <div class="panel">${sel ? threadDetail(state, sel) : '<p class="muted">Select a message.</p>'}</div>
  </div>`;
}

function threadDetail(state, t) {
  const band = t.bandId ? state.bands[t.bandId] : null;
  let body = '';
  if (t.kind === 'audition') {
    const c = state.people[t.data.personId];
    if (c) {
      const role = band?.recruiting?.roles[t.data.roleIndex];
      body += memberCard(c, { extra: `<p class="small muted" style="margin-top:.4rem">${c.busy.length ? `Works as a ${esc(c.job)}. Usually busy ${c.busy.map((d) => DAY_NAMES[d]).join(', ')} evenings.` : 'Evenings are wide open.'}</p>` });
      if (band) body += auditionFit(state, band, c, role);
    }
  }
  const msgs = t.messages.map((m) => {
    const who = m.from ? state.people[m.from] : null;
    const me = m.from === state.playerId;
    return `<div class="msg ${me ? 'me' : ''}">${who ? `<div class="from">${esc(me ? 'You' : shortName(who))}</div>` : ''}${esc(m.text)}<div class="small muted">${dayLabel(m.day)}</div></div>`;
  }).join('');
  return `<h3>${esc(t.title)}</h3>${band ? `<div class="muted small" style="margin-bottom:.5rem">${esc(band.name)}</div>` : ''}
    ${t.kind === 'audition' ? body + '<hr>' + msgs : msgs + body}
    ${t.actions.length ? `<div class="actions">${t.actions.map((a, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-action="thread-act" data-thread="${t.id}" data-act="${a.id}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    ${t.outcome ? `<p class="small muted" style="margin-top:.6rem">→ ${esc(t.outcome)}</p>` : ''}
    ${!t.actions.length && !t.outcome && !t.data?.npcLeader ? '<p class="small muted" style="margin-top:.6rem">Just letting you know: no reply needed.</p>' : ''}
    ${t.data?.npcLeader && !t.resolved ? `<p class="small muted">${esc(shortName(state.people[band.leaderId]))} runs this band and will decide ${t.actions.length ? 'once you answer (or tomorrow if you don\'t)' : 'tomorrow, after everyone has weighed in'}.</p>` : ''}
    ${t.expires && !t.resolved ? `<p class="small warn">Answer by ${dayLabel(t.expires)}.</p>` : ''}`;
}

function auditionFit(state, band, c, role) {
  const ms = membersOf(state, band);
  const notes = [];
  if (role?.filled) notes.push('<span class="warn">You already filled this role.</span>');
  const hasPA = ms.some((m) => m.gear.some((g) => g.startsWith('pa-')));
  if (!hasPA && c.gear.some((g) => g.startsWith('pa-'))) notes.push('<span class="good">Your band has no PA. This person has one.</span>');
  const freeShared = [0, 1, 2, 3, 4, 5, 6].filter((d) => !c.busy.includes(d) && !ms.some((m) => m.busy.includes(d)));
  notes.push(`Evenings everyone (including them) is usually free: <b>${freeShared.map((d) => DAY_NAMES[d]).join(', ') || 'none!'}</b>`);
  return `<p class="small" style="margin-top:.5rem">${notes.join('<br>')}</p>`;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export function calendarView(state, ui) {
  const start = state.day - weekday(state.day) + (ui.calOffset || 0) * 7 - 7;
  const days = Array.from({ length: 35 }, (_, i) => start + i);
  const allBands = playerBands(state);
  if (ui.calBand && !allBands.some((b) => b.id === ui.calBand)) ui.calBand = null;
  const bands = ui.calBand ? allBands.filter((b) => b.id === ui.calBand) : allBands;
  const evs = {};
  for (const b of bands) for (const e of b.events) { (evs[e.day] = evs[e.day] || []).push({ b, e }); }
  const sel = ui.eventId && allBands.flatMap((b) => b.events.map((e) => ({ b, e }))).find((x) => x.e.id === ui.eventId);
  const selDay = ui.calDay ?? (sel ? sel.e.day : null);
  return `${allBands.length > 1 ? `<div class="subnav">
      <button class="chip ${!ui.calBand ? 'active' : ''}" data-action="cal-band" data-band="">All bands</button>
      ${allBands.map((b) => `<button class="chip ${ui.calBand === b.id ? 'active' : ''}" data-action="cal-band" data-band="${b.id}">${bandDot(state, b)}${esc(b.name)}</button>`).join('')}
    </div>` : ''}
    <div class="row between" style="margin-bottom:.6rem">
      <div class="row"><button class="btn small" data-action="cal" data-delta="-1">‹ Earlier</button><button class="btn small" data-action="cal" data-delta="0">Today</button><button class="btn small" data-action="cal" data-delta="1">Later ›</button></div>
      <div class="legend">${Object.keys(EVENT_ICONS).map((t) => `<span>${EVENT_ICONS[t]} ${EVENT_NAMES[t]}</span>`).join('')}</div>
    </div>
    <div class="cal">${DAY_NAMES.map((d) => `<div class="dow">${d}</div>`).join('')}
    ${days.map((d) => d < 0 ? '<div class="day past"></div>' : `<div class="day clickable ${d === state.day ? 'today' : ''} ${d < state.day ? 'past' : ''} ${d === selDay ? 'selected' : ''}" data-action="cal-day" data-day="${d}">
      <div class="d">Day ${d + 1}${weekday(d) === 0 ? ` <span class="muted">· wk ${Math.floor(d / 7) + 1}</span>` : ''}${d === state.day ? ' <span class="warn">· today</span>' : ''}</div>
      ${(evs[d] || []).map(({ b, e }) => `<button class="ev ${e.type} ${e.status}" style="--band:${bandColor(state, b)}" data-action="open-event" data-event="${e.id}" title="${esc(b.name)}: ${esc(e.title)} (${e.status})">${EVENT_ICONS[e.type]} ${esc(bands.length > 1 ? b.name : e.title)}</button>`).join('')}
    </div>`).join('')}</div>
    ${selDay != null ? `<div class="panel" style="margin-top:1rem">${dayPanel(state, selDay, sel)}</div>` : '<p class="muted small" style="margin-top:.6rem">Click a day to see what\'s on it or schedule a practice. Click an event for details.</p>'}`;
}

// Everything about one day: its events, and (for bands you lead) scheduling.
function dayPanel(state, day, sel) {
  const bands = playerBands(state);
  const items = bands.flatMap((b) => b.events.filter((e) => e.day === day).map((e) => ({ b, e })));
  const parts = [`<h3>${dayLabel(day, true)} <span class="muted small">(day ${day + 1})</span></h3>`];
  if (sel) parts.push(eventDetail(state, sel.b, sel.e));
  else if (items.length) parts.push(`<div class="list">${items.map(({ b, e }) => `<div class="item" style="border-left-color:${bandColor(state, b)}"><div class="row between"><b>${EVENT_ICONS[e.type]} ${esc(e.title)}</b><span class="tag">${bandDot(state, b)}${esc(b.name)}</span></div>${e.result ? `<div class="small">${esc(e.result.summary)}</div>` : ''}<button class="btn small ghost" data-action="open-event" data-event="${e.id}">Details</button></div>`).join('')}</div>`);
  else parts.push('<p class="muted small">Nothing on this day.</p>');

  if (day > state.day) {
    const led = bands.filter((b) => b.leaderId === state.playerId);
    if (!led.length) parts.push('<p class="small muted">You don\'t lead any bands, so you can\'t schedule anything. Your band leaders handle their own calendars.</p>');
    for (const b of led) {
      const ms = membersOf(state, b);
      const taken = b.events.some((e) => e.day === day && e.status === 'scheduled');
      const free = ms.filter((m) => availabilityChance(m, weekday(day)) > 0.5);
      const busy = ms.filter((m) => !free.includes(m));
      const other = items.some(({ b: ob, e }) => ob.id !== b.id && e.status === 'scheduled');
      parts.push(`<div class="item" style="margin-top:.5rem;border-left-color:${bandColor(state, b)}">
        <div class="row between"><b>${bandDot(state, b)}${esc(b.name)}</b>${ms.length < 2 ? '<span class="small muted">needs another member first</span>' : taken ? '<span class="small muted">already has something this day</span>' : `<button class="btn small primary" data-action="schedule" data-band="${b.id}" data-day="${day}">Schedule practice</button>`}</div>
        ${ms.length >= 2 ? `<div class="small">Usually free: <b class="${busy.length ? 'warn' : 'good'}">${free.length}/${ms.length}</b>${busy.length ? ` · usually busy: ${busy.map(shortName).join(', ')}` : ''}</div>` : ''}
        ${other ? '<div class="small warn">⚠ You already have another band that day.</div>' : ''}
      </div>`);
    }
  } else if (day < state.day) {
    parts.push('<p class="small muted">That day is in the past.</p>');
  }
  return parts.join('');
}

export function eventDetail(state, b, e) {
  const lead = b.leaderId === state.playerId;
  const people = (ids) => (ids || []).map((id) => state.people[id]).filter(Boolean).map(shortName).join(', ');
  const rolls = e.rolled && e.status === 'scheduled' ? Object.entries(e.rolls).filter(([, v]) => v === 'notice').map(([id]) => state.people[id]).filter(Boolean) : [];
  return `<div class="row between"><h3>${EVENT_ICONS[e.type]} ${esc(e.title)}</h3><span class="tag">${bandDot(state, b)}${esc(b.name)}</span></div>
    <p class="muted">${dayLabel(e.day, true)} · ${e.status}</p>
    ${e.type === 'gig' ? `<p>${esc(VENUE_TIERS[e.data.offer.tier].label)} · cap ${e.data.offer.capacity} · with ${e.data.offer.bill.map((x) => `${esc(x.name)} (${x.followers})`).join(', ')}</p>` : ''}
    ${rolls.length ? `<p class="warn small">Gave notice they can't make it: ${rolls.map(shortName).join(', ')}</p>` : ''}
    ${e.result ? `<p>${esc(e.result.summary)}</p>${e.result.present ? `<p class="small muted">Present: ${people(e.result.present)}</p>` : ''}` : ''}
    <div class="row">${eventButtons(state, b, e)}</div>`;
}

// Practices go through the band (propose a new day or skipping it). Shows and
// studio sessions are booked with someone else, so the leader can only cancel.
export function eventButtons(state, b, e) {
  if (e.status !== 'scheduled') return '';
  const lead = b.leaderId === state.playerId;
  if (e.type === 'practice') return `<button class="btn small" data-action="resched-open" data-band="${b.id}" data-event="${e.id}">${lead ? 'Reschedule / cancel…' : 'Ask to reschedule / skip…'}</button>`;
  if (lead) return `<button class="btn danger small" data-action="cancel-event" data-band="${b.id}" data-event="${e.id}">Cancel ${e.type === 'gig' ? '(hurts your rep)' : 'session'}</button>`;
  return '';
}

// ---------------------------------------------------------------------------
// Gear shop
// ---------------------------------------------------------------------------
export function shopView(state, ui) {
  const p = player(state);
  const mine = ui.shopAll ? Object.keys(GEAR_SLOTS) : [...new Set([...requiredSlots(p), 'mic', 'pa'])];
  return `<div class="row between"><h2>Gear shop</h2><div class="row"><span>Cash: <b>${money(state.cash)}</b></span><button class="chip ${ui.shopAll ? '' : 'active'}" data-action="shop-filter" data-all="0">For your role</button><button class="chip ${ui.shopAll ? 'active' : ''}" data-action="shop-filter" data-all="1">Everything</button></div></div>
  <p class="muted small">Every member needs the gear for their role to play a show. Better gear raises your cred and the band's sound. A PA lets you play basement shows without renting one. You can sell back at ${Math.round(SELL_BACK * 100)}%.</p>
  <div class="panel tight" style="margin-bottom:1rem">
    <h3>Your gear</h3>
    ${p.gear.length ? `<table class="simple">${p.gear.map((id, i) => { const g = GEAR_BY_ID[id]; return g ? `<tr><td>${esc(GEAR_SLOTS[g.slot])}</td><td>${esc(g.name)}</td><td><span class="tag">T${g.tier}</span></td><td style="text-align:right"><button class="btn small" data-action="sell" data-index="${i}">Sell for ${money(g.price * SELL_BACK)}</button></td></tr>` : ''; }).join('')}</table>` : '<p class="muted small">You don\'t own anything yet.</p>'}
  </div>
  <div class="grid three">${mine.map((slot) => `<div class="panel tight"><h3>${GEAR_SLOTS[slot]}</h3>
    ${GEAR_CATALOG.filter((g) => g.slot === slot).map((g) => `<div class="row between" style="margin:.35rem 0"><div><div>${esc(g.name)}</div><div class="small muted">T${g.tier} · ${GEAR_TIERS[g.tier]}${p.gear.includes(g.id) ? ' · <span class="good">owned</span>' : ''}</div></div>
      <button class="btn small ${state.cash >= g.price ? 'primary' : ''}" data-action="buy" data-gear="${g.id}" ${state.cash < g.price ? 'disabled' : ''}>${money(g.price)}</button></div>`).join('')}
  </div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Scene board
// ---------------------------------------------------------------------------
export function sceneView(state, ui) {
  const p = player(state);
  const sc = ui.newBand;
  const myCred = cred(p);
  return `<div class="grid two">
    <div class="panel stack">
      <h2>Start a band</h2>
      <label class="field">Band name<div class="row"><input type="text" id="nb-name" value="${esc(sc.name)}" maxlength="40" style="flex:1"><button class="btn small" data-action="nb-randname">🎲</button></div></label>
      <label class="field">Genre<select id="nb-genre" data-change="nb-genre">${GENRE_IDS.map((g) => `<option value="${g}" ${sc.genre === g ? 'selected' : ''}>${GENRES[g].label} (${GENRES[g].min}+ members)</option>`).join('')}</select></label>
      <p class="small">${esc(GENRES[sc.genre].blurb)}</p>
      <p class="small muted">${genreRuleText(sc.genre)}</p>
      <button class="btn primary" data-action="nb-create">Start ${esc(sc.name || 'band')}</button>
      <p class="small muted">You'll lead it: you run the schedule, recruit, and book shows. You can be in as many bands as your calendar allows.</p>
    </div>
    <div class="panel">
      <h2>Bands looking for members</h2>
      <p class="small muted">Your cred: <b>${myCred}</b>. Bands won't take someone too far below what they're looking for. Joining means their leader runs the schedule.</p>
      <div class="list">${state.openings.filter((o) => !o.taken).map((o) => {
        const sb = state.scene.find((b) => b.id === o.sceneId);
        if (!sb) return '';
        const fitsRole = p.instrument === o.instrument;
        const reach = myCred >= o.minCred ? 'good' : myCred >= o.minCred - 8 ? 'warn' : 'bad';
        return `<div class="item">
          <div class="row between"><b>${esc(sb.name)}</b><span class="tag">${GENRES[sb.genre].label}</span></div>
          <div class="small">Need: <b>${esc(INSTRUMENTS[o.instrument].noun)}</b>${o.vocals !== 'none' ? ' (backing vox a plus)' : ''} · ${sb.followers} followers · ${esc(standingLabel(sb.tier))} level</div>
          <div class="small muted">"${esc(o.blurb)}" ${o.pays ? `· Pays ${money(o.pays)}/event` : '· Unpaid'} · until ${dayLabel(o.expires)}</div>
          <div class="row" style="margin-top:.35rem"><span class="tag ${reach}">wants ~${o.minCred} cred</span>
          ${o.applied ? '<span class="tag">applied</span>' : `<button class="btn small" data-action="apply" data-opening="${o.id}" ${fitsRole ? '' : 'disabled title="Not your instrument"'}>Audition</button>`}</div>
        </div>`;
      }).join('') || '<p class="muted">No openings right now. Check back next week.</p>'}</div>
    </div>
  </div>
  <div class="panel" style="margin-top:1rem">
    <h2>The local scene</h2>
    <p class="small muted">These bands share bills with you. Ones with real followings pull new people to your shows.</p>
    <table class="simple"><tr><th>Band</th><th>Genre</th><th>Followers</th><th>Level</th></tr>
    ${state.scene.slice().sort((a, b) => b.followers - a.followers).slice(0, 30).map((b) => `<tr><td>${esc(b.name)}</td><td>${GENRES[b.genre].label}</td><td class="num">${b.followers.toLocaleString()}</td><td>${esc(standingLabel(b.tier))}</td></tr>`).join('')}
    </table>
  </div>`;
}

export function genreRuleText(genre) {
  const g = GENRES[genre];
  if (g.rule === 'core') return `Minimum ${g.min}: a guitarist or bassist, a drummer, and somebody who sings.`;
  if (g.rule === 'four') return `Minimum ${g.min}: guitar, bass, drums, and somebody who sings.`;
  return `Minimum ${g.min}: guitar, bass, drums, a singer, and something extra (keys, a second guitar, violin, sax).`;
}

export { bar, daysStrip, gearList, extrasList };
