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
import { STUDIO_TYPES } from '../engine/data.js';
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
  const pending = state.threads.filter((t) => !t.resolved).length;
  const unread = state.threads.filter((t) => t.unread).length;
  status.innerHTML = `<span><b>${dayLabel(state.day, true)}</b></span><span>Cash <b>${money(state.cash)}</b></span><span>Cred <b>${cred(p)}</b> (${TIER_LABELS[p.tier]})</span><span>Bands <b>${playerBands(state).length}</b></span>`;
  adv.innerHTML = `<button class="btn" data-action="advance" data-days="1">Next day</button><button class="btn primary" data-action="advance" data-days="7">Next week ⏩</button>`;
  tabs.innerHTML = TABS.map(([k, l]) => `<button class="tab ${ui.tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}">${l}${k === 'inbox' && (pending || unread) ? `<span class="badge">${pending || unread}</span>` : ''}</button>`).join('');
  const view = { dashboard: dashboardView, inbox: inboxView, calendar: calendarView, band: bandView, scene: sceneView, shop: shopView }[ui.tab] || dashboardView;
  main.innerHTML = view(state, ui);
  if (ui.tab === 'inbox') {
    // Opening the inbox marks the visible thread read.
    const t = state.threads.find((x) => x.id === ui.threadId) || state.threads.slice().sort((a, b) => (a.resolved - b.resolved) || (b.day - a.day))[0];
    if (t && t.unread) { t.unread = false; save(); }
  }
}

let toastTimer = null;
function toast(msg, bad = false) {
  if (!msg) return;
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${bad ? 'bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
}

function act(fn) {
  const res = fn();
  save();
  render();
  if (res && res.msg) toast(res.msg, res.ok === false);
  return res;
}

function modal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="panel">${html}</div>`;
  m.classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }

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
  tab: (d) => { ui.tab = d.tab; ui.eventId = null; render(); window.scrollTo(0, 0); },
  advance: (d) => advance(Number(d.days)),
  'open-band': (d) => { ui.tab = 'band'; ui.bandId = d.band; ui.bandSection = ui.bandSection || 'overview'; render(); },
  'band-section': (d) => { ui.bandSection = d.section; ui.eventId = null; render(); },
  'open-thread': (d) => { ui.threadId = d.thread; render(); },
  'inbox-filter': (d) => { ui.inboxFilter = d.filter; ui.threadId = null; render(); },
  'thread-act': (d) => act(() => threadAction(ctx, d.thread, d.act)),
  'open-event': (d) => { ui.eventId = d.event; render(); },
  cal: (d) => { ui.calOffset = Number(d.delta) === 0 ? 0 : ui.calOffset + Number(d.delta); render(); },
  'cancel-event': (d) => { if (confirm('Cancel this event?')) act(() => cancelEvent(ctx, d.band, d.event)); },
  sell: (d) => { if (confirm('Sell this item?')) act(() => sellGear(ctx, Number(d.index))); },
  buy: (d) => act(() => buyGear(ctx, d.gear)),
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
  fire: (d) => { if (confirm('Fire this member?')) act(() => fireMember(ctx, d.band, d.person)); },
  'leave-band': (d) => { if (confirm('Are you sure? This can\'t be undone.')) { act(() => leaveBand(ctx, d.band)); ui.bandId = null; render(); } },
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
  reset: () => {
    if (!confirm('Start a new game? Your current save will be erased.')) return;
    localStorage.removeItem(SAVE_KEY);
    ctx = null;
    ui.create.seed = randomSeed();
    ui.tab = 'dashboard';
    render();
  },
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
  if (!ctx || ev.target.matches('input, textarea, select')) return;
  if (ev.key === 'n') advance(1);
  if (ev.key === 'w') advance(7);
});

const saved = load();
if (saved) ctx = makeCtx(saved);
render();

// Exposed for debugging in the console.
window.bandleader = { get state() { return ctx?.state; }, removeMember };
