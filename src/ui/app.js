import { newGame, advanceDay, threadAction } from '../engine/sim.js';
import { makeCtx, commit, player, playerBands, dayLabel, SAVE_VERSION } from '../engine/state.js';
import { createRng } from '../engine/rng.js';
import { cred, TIER_LABELS } from '../engine/people.js';
import { generateBandName } from '../engine/band.js';
import { startBand, postRecruitment, removeMember } from '../engine/recruiting.js';
import { buyGear, sellGear, fundBand, payout, woodshed, fireMember, leaveBand } from '../engine/economy.js';
import { schedulePractice, cancelEvent } from '../engine/schedule.js';
import { bookGig } from '../engine/gigs.js';
import { bookRecording, releaseRecording } from '../engine/studio.js';
import { socialPost } from '../engine/social.js';
import { applyToOpening } from '../engine/scene.js';
import { STUDIO_TYPES, GEAR_BY_ID, GEAR_SLOTS } from '../engine/data.js';
import { requiredSlots } from '../engine/people.js';
import { SELL_BACK } from '../engine/economy.js';
import { createView, dashboardView, inboxView, calendarView, shopView, sceneView } from './views.js';
import { bandView } from './bandview.js';
import { esc, money } from './util.js';

const SAVE_KEY = 'bandleader-save-v1';
const UI_KEY = 'bandleader-ui-v1';

let ctx = null;
const ui = {
  tab: 'dashboard',
  bandId: null,
  bandSection: 'overview',
  threadId: null,
  eventId: null,
  calOffset: 0,
  inboxFilter: 'all',
  shopAll: false,
  create: { first: '', last: '', instrument: 'guitar', vocals: 'none', attrs: { skill: 3, experience: 2, charisma: 3, reliability: 2 }, seed: randomSeed() },
  newBand: { name: '', genre: 'punk' },
  recruit: { roles: [{ instrument: 'drums', vocals: 'none' }], payLevel: 'none' },
  studio: { type: 'basement', sessions: 4, songs: 3 },
};

function randomSeed() {
  const words = ['basement', 'feedback', 'tour-van', 'setlist', 'distortion', 'encore', 'mosh', 'reverb', 'soundcheck', 'b-side'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function save() {
  if (!ctx) return;
  commit(ctx);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(ctx.state));
    localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab, bandId: ui.bandId, bandSection: ui.bandSection }));
  } catch (e) { /* storage full or blocked: game still runs */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.version !== SAVE_VERSION) return null;
    const u = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    Object.assign(ui, u);
    return s;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const TABS = [['dashboard', 'Dashboard'], ['inbox', 'Inbox'], ['calendar', 'Calendar'], ['band', 'Bands'], ['scene', 'Scene'], ['shop', 'Gear shop']];

function render() {
  const main = document.getElementById('main');
  const tabs = document.getElementById('tabs');
  const status = document.getElementById('status');
  const adv = document.getElementById('advance');
  if (!ctx) {
    tabs.innerHTML = '';
    status.innerHTML = '';
    adv.innerHTML = '';
    main.innerHTML = createView(ui);
    return;
  }
  const { state } = ctx;
  const p = player(state);
  if (ui.tab === 'inbox') {
    // The thread you're looking at counts as read (before the badge is counted).
    const t = state.threads.find((x) => x.id === ui.threadId) || state.threads.slice().sort((a, b) => (a.resolved - b.resolved) || (b.day - a.day))[0];
    if (t && t.unread) { t.unread = false; save(); }
  }
  const pending = state.threads.filter((t) => !t.resolved).length;
  const unread = state.threads.filter((t) => t.unread).length;
  status.innerHTML = `<span><b>${dayLabel(state.day, true)}</b> (day ${state.day + 1})</span><span>Cash <b>${money(state.cash)}</b></span><span>Cred <b>${cred(p)}</b> (${TIER_LABELS[p.tier]})</span><span>Bands <b>${playerBands(state).length}</b></span>`;
  adv.innerHTML = `<button class="btn" data-action="advance" data-days="1">Next day</button><button class="btn primary" data-action="advance" data-days="7">Next week ⏩</button>`;
  tabs.innerHTML = TABS.map(([k, l]) => `<button class="tab ${ui.tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}">${l}${k === 'inbox' && (pending || unread) ? `<span class="badge">${pending || unread}</span>` : ''}</button>`).join('');
  const view = { dashboard: dashboardView, inbox: inboxView, calendar: calendarView, band: bandView, scene: sceneView, shop: shopView }[ui.tab] || dashboardView;
  main.innerHTML = view(state, ui);
}

let toastTimer = null;
// tone: true / 'bad' = error, 'good' = success, anything else = neutral.
function toast(msg, tone = '') {
  if (!msg) return;
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${tone === true ? 'bad' : tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
}

function act(fn) {
  const res = fn();
  save();
  render();
  if (res && res.msg) toast(res.msg, res.ok === false ? 'bad' : 'good');
  return res;
}

function modal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="panel">${html}</div>`;
  m.classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); pendingConfirm = null; }

// In-game "are you sure?" box. Native confirm() can be silently blocked by
// the browser, which made buttons look broken.
let pendingConfirm = null;
function confirmBox({ title, body = '', yes = 'Confirm', danger = false, onYes }) {
  modal(`<h3>${title}</h3>${body}<div class="actions"><button class="btn ${danger ? 'danger' : 'primary'}" data-action="confirm-yes">${yes}</button><button class="btn" data-action="close-modal">Cancel</button></div>`);
  pendingConfirm = onYes;
  document.querySelector('#modal [data-action=confirm-yes]')?.focus();
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
function advance(days) {
  const { state } = ctx;
  const before = new Set(state.threads.filter((t) => !t.resolved).map((t) => t.id));
  let passed = 0;
  for (let i = 0; i < days; i++) {
    advanceDay(ctx);
    passed++;
    // Stop early when something needs a decision.
    const fresh = state.threads.filter((t) => !t.resolved && !before.has(t.id));
    if (days > 1 && fresh.length) break;
  }
  save();
  const fresh = state.threads.filter((t) => !t.resolved && !before.has(t.id));
  const doneToday = playerBands(state).flatMap((b) => b.events.filter((e) => e.status === 'done' && e.day > state.day - passed && e.day <= state.day));
  render();
  const parts = [`${passed} day${passed > 1 ? 's' : ''} passed.`];
  if (doneToday.length) parts.push(`${doneToday.length} event(s) happened.`);
  if (fresh.length) parts.push(`${fresh.length} message(s) need you.`);
  toast(parts.join(' '));
}

// ---------------------------------------------------------------------------
// Event handling
// ---------------------------------------------------------------------------
const val = (id) => document.getElementById(id)?.value;

const handlers = {
  'create-attr': (d) => {
    const a = d.attr;
    const c = ui.create;
    c.attrs[a] = Math.max(1, Math.min(10, c.attrs[a] + Number(d.delta)));
    const total = Object.values(c.attrs).reduce((s, v) => s + v, 0);
    if (total > 10) c.attrs[a] -= total - 10;
    readCreate();
    render();
  },
  'create-go': () => {
    readCreate();
    const c = ui.create;
    if (!c.first.trim()) return toast('Give yourself a name first.', true);
    const state = newGame(c.seed || randomSeed(), { first: c.first.trim(), last: c.last.trim(), instrument: c.instrument, vocals: c.instrument === 'vocals' ? 'lead' : c.vocals, attrs: c.attrs });
    ctx = makeCtx(state);
    ui.tab = 'shop';
    ui.recruit.roles = [{ instrument: c.instrument === 'drums' ? 'guitar' : 'drums', vocals: 'none' }];
    save();
    render();
    toast('Welcome! Start by buying the gear your role needs.');
  },
  tab: (d) => { ui.tab = d.tab; ui.eventId = null; ui.calDay = null; render(); window.scrollTo(0, 0); },
  advance: (d) => advance(Number(d.days)),
  'open-band': (d) => { ui.tab = 'band'; ui.bandId = d.band; ui.bandSection = ui.bandSection || 'overview'; render(); },
  'band-section': (d) => { ui.bandSection = d.section; ui.eventId = null; render(); },
  'open-thread': (d) => { ui.threadId = d.thread; render(); },
  'inbox-filter': (d) => { ui.inboxFilter = d.filter; ui.threadId = null; render(); },
  'thread-act': (d) => act(() => threadAction(ctx, d.thread, d.act)),
  'open-event': (d) => { ui.eventId = d.event; ui.calDay = null; render(); },
  'cal-band': (d) => { ui.calBand = d.band || null; render(); },
  'cal-day': (d) => { ui.calDay = Number(d.day); ui.eventId = null; render(); },
  cal: (d) => { ui.calOffset = Number(d.delta) === 0 ? 0 : ui.calOffset + Number(d.delta); render(); },
  'confirm-yes': () => { const fn = pendingConfirm; closeModal(); fn?.(); },
  'cancel-event': (d) => confirmBox({ title: 'Cancel this event?', body: '<p class="small muted">Cancelling a show hurts your reputation with promoters.</p>', yes: 'Cancel it', danger: true, onYes: () => act(() => cancelEvent(ctx, d.band, d.event)) }),
  sell: (d) => {
    const p = player(ctx.state);
    const g = GEAR_BY_ID[p.gear[Number(d.index)]];
    if (!g) return;
    const value = Math.round(g.price * SELL_BACK);
    const left = p.gear.filter((id, i) => i !== Number(d.index) && GEAR_BY_ID[id]?.slot === g.slot).length;
    const needed = requiredSlots(p).includes(g.slot) && !left;
    confirmBox({
      title: `Sell ${esc(g.name)}?`,
      body: `<p>You'll get <b>${money(value)}</b> (half of the ${money(g.price)} it cost). Cash after: <b>${money(ctx.state.cash + value)}</b>.</p>${needed ? `<p class="warn small">This is your only ${esc(GEAR_SLOTS[g.slot].toLowerCase())}. You can't play shows without one.</p>` : ''}`,
      yes: `Sell for ${money(value)}`,
      danger: needed,
      onYes: () => act(() => sellGear(ctx, Number(d.index))),
    });
  },
  buy: (d) => {
    const g = GEAR_BY_ID[d.gear];
    const p = player(ctx.state);
    const owned = p.gear.map((id) => GEAR_BY_ID[id]).filter((x) => x?.slot === g.slot);
    const best = owned.reduce((m, x) => Math.max(m, x.tier), 0);
    confirmBox({
      title: `Buy ${esc(g.name)}?`,
      body: `<p>${esc(GEAR_SLOTS[g.slot])} · Tier ${g.tier}. Costs <b>${money(g.price)}</b>. Cash after: <b>${money(ctx.state.cash - g.price)}</b>.</p>
        ${owned.length ? `<p class="small ${g.tier > best ? 'good' : 'warn'}">You already own ${owned.map((x) => esc(x.name)).join(', ')}. ${g.tier > best ? 'This is an upgrade.' : 'This isn\'t an upgrade.'}</p>` : ''}`,
      yes: `Buy for ${money(g.price)}`,
      onYes: () => act(() => buyGear(ctx, d.gear)),
    });
  },
  'shop-filter': (d) => { ui.shopAll = d.all === '1'; render(); },
  woodshed: () => act(() => woodshed(ctx)),
  'nb-randname': () => { ui.newBand.name = generateBandName(createRng(Math.random() * 1e9)); render(); },
  'nb-create': () => {
    ui.newBand.name = (val('nb-name') || '').trim();
    ui.newBand.genre = val('nb-genre');
    if (!ui.newBand.name) return toast('Name your band.', true);
    act(() => {
      const b = startBand(ctx, ui.newBand);
      ui.tab = 'band'; ui.bandId = b.id; ui.bandSection = 'recruit';
      ui.newBand.name = '';
      return { ok: true, msg: `${b.name} exists! Now post for members.` };
    });
  },
  apply: (d) => act(() => applyToOpening(ctx, d.opening)),
  schedule: (d) => act(() => schedulePractice(ctx, d.band, Number(d.day))),
  book: (d) => act(() => bookGig(ctx, d.band, d.offer)),
  record: (d) => act(() => bookRecording(ctx, d.band, { type: ui.studio.type, sessions: ui.studio.sessions, songs: ui.studio.songs })),
  release: (d) => act(() => releaseRecording(ctx, d.band, d.rec)),
  post: (d) => act(() => socialPost(ctx, d.band, d.type)),
  fund: (d) => act(() => fundBand(ctx, d.band, Number(val('fund-amt')))),
  payout: (d) => act(() => payout(ctx, d.band, Number(val('payout-amt')))),
  fire: (d) => confirmBox({ title: `Fire ${esc(ctx.state.people[d.person]?.first || 'them')}?`, body: '<p class="small muted">The band\'s morale takes a hit, and you\'ll need a replacement.</p>', yes: 'Fire', danger: true, onYes: () => act(() => fireMember(ctx, d.band, d.person)) }),
  'leave-band': (d) => {
    const b = ctx.state.bands[d.band];
    const lead = b?.leaderId === ctx.state.playerId;
    confirmBox({ title: lead ? `Break up ${esc(b.name)}?` : `Leave ${esc(b.name)}?`, body: '<p class="small muted">This can\'t be undone.</p>', yes: lead ? 'Break up' : 'Leave', danger: true, onYes: () => { ui.bandId = null; act(() => leaveBand(ctx, d.band)); } });
  },
  'recruit-add': () => { ui.recruit.roles.push({ instrument: 'guitar', vocals: 'none' }); render(); },
  'recruit-del': (d) => { ui.recruit.roles.splice(Number(d.index), 1); render(); },
  'recruit-post': (d) => act(() => postRecruitment(ctx, d.band, { roles: ui.recruit.roles.map((r) => ({ ...r, vocals: r.instrument === 'vocals' ? 'lead' : r.vocals })), payLevel: ui.recruit.payLevel })),
  'recruit-stop': (d) => act(() => { ctx.state.bands[d.band].recruiting = null; return { ok: true, msg: 'Post taken down.' }; }),
  export: () => {
    if (!ctx) return;
    save();
    modal(`<h3>Export save</h3><p class="small muted">Copy this text somewhere safe. Paste it into Import on any device.</p><textarea id="exp" rows="10" style="width:100%">${esc(JSON.stringify(ctx.state))}</textarea><div class="actions"><button class="btn primary" data-action="copy-export">Copy</button><button class="btn" data-action="close-modal">Close</button></div>`);
  },
  'copy-export': () => { navigator.clipboard?.writeText(val('exp')); toast('Copied.'); },
  import: () => modal('<h3>Import save</h3><textarea id="imp" rows="10" style="width:100%" placeholder="Paste save text"></textarea><div class="actions"><button class="btn primary" data-action="do-import">Load it</button><button class="btn" data-action="close-modal">Cancel</button></div>'),
  'do-import': () => {
    try {
      const s = JSON.parse(val('imp'));
      if (s.version !== SAVE_VERSION || !s.people) throw new Error('bad');
      ctx = makeCtx(s);
      save(); closeModal(); render(); toast('Save loaded.');
    } catch { toast('That doesn\'t look like a Bandleader save.', true); }
  },
  'close-modal': closeModal,
  reset: () => confirmBox({
    title: 'Start a new game?',
    body: '<p class="small muted">Your current save will be erased. Use Export save first if you want to keep it.</p>',
    yes: 'Erase and restart',
    danger: true,
    onYes: () => {
      localStorage.removeItem(SAVE_KEY);
      ctx = null;
      ui.create.seed = randomSeed();
      ui.tab = 'dashboard';
      render();
    },
  }),
};

function readCreate() {
  const c = ui.create;
  if (document.getElementById('c-first')) {
    c.first = val('c-first');
    c.last = val('c-last');
    c.seed = val('c-seed');
  }
}

const changeHandlers = {
  'create-inst': (el) => { readCreate(); ui.create.instrument = el.value; render(); },
  'create-vox': (el) => { readCreate(); ui.create.vocals = el.value; render(); },
  'nb-genre': (el) => { ui.newBand.name = val('nb-name'); ui.newBand.genre = el.value; render(); },
  'studio-type': (el) => {
    ui.studio.type = el.value;
    const s = STUDIO_TYPES[el.value];
    ui.studio.sessions = Math.max(s.minSessions, Math.min(s.maxSessions, ui.studio.sessions));
    render();
  },
  'studio-num': () => { ui.studio.songs = Number(val('st-songs')) || 1; ui.studio.sessions = Number(val('st-sessions')) || 1; render(); },
  'recruit-role': (el) => { const r = ui.recruit.roles[Number(el.dataset.index)]; r[el.dataset.field] = el.value; if (r.instrument === 'vocals') r.vocals = 'lead'; render(); },
  'recruit-pay': (el) => { ui.recruit.payLevel = el.value; },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const h = handlers[el.dataset.action];
  if (!h) return;
  ev.preventDefault();
  h(el.dataset);
});
document.addEventListener('change', (ev) => {
  const el = ev.target.closest('[data-change]');
  if (!el) return;
  changeHandlers[el.dataset.change]?.(el);
});
document.getElementById('modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (ev) => {
  const modalOpen = !document.getElementById('modal').classList.contains('hidden');
  if (ev.key === 'Escape' && modalOpen) return closeModal();
  if (!ctx || modalOpen || ev.target.matches('input, textarea, select')) return;
  if (ev.key === 'n') advance(1);
  if (ev.key === 'w') advance(7);
});

const saved = load();
if (saved) ctx = makeCtx(saved);
render();

// Exposed for debugging in the console.
window.bandleader = { get state() { return ctx?.state; }, removeMember };
