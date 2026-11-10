// Game state container + shared helpers. The engine never touches the DOM, so
// it runs the same in the browser and under `node --test`.
import { createRng, hashString } from './rng.js?v=4';
import { DAY_NAMES, DAY_NAMES_LONG } from './data.js?v=4';

export const SAVE_VERSION = 1;

// A ctx bundles the serializable state with a live RNG. Engine functions take
// ctx; call `commit(ctx)` before saving so the RNG position is stored.
export function makeCtx(state) {
  const rng = createRng(1);
  rng.state = state.rngState;
  return { state, rng };
}

export function commit(ctx) {
  ctx.state.rngState = ctx.rng.state;
  return ctx.state;
}

export function emptyState(seed) {
  const seedNum = typeof seed === 'number' ? seed : hashString(String(seed));
  return {
    version: SAVE_VERSION,
    seed: String(seed),
    rngState: seedNum || 1,
    day: 0,
    nextId: 1,
    playerId: 'player',
    cash: 0,
    people: {},
    bands: {},
    scene: [],
    openings: [],
    threads: [],
    news: [],
    stats: { gigs: 0, practices: 0, releases: 0, peakFollowers: 0 },
    flags: {},
  };
}

export function uid(state, prefix) {
  return `${prefix}${state.nextId++}`;
}

export function player(state) {
  return state.people[state.playerId];
}

export function weekday(day) {
  return ((day % 7) + 7) % 7;
}

export function dayLabel(day, long = false) {
  const week = Math.floor(day / 7) + 1;
  return `${(long ? DAY_NAMES_LONG : DAY_NAMES)[weekday(day)]}, wk ${week}`;
}

export function news(state, text, { bandId = null, tone = 'info' } = {}) {
  state.news.unshift({ day: state.day, text, bandId, tone });
  if (state.news.length > 200) state.news.length = 200;
}

// Threads are the inbox: auditions, DMs, band group chats, results.
export function createThread(state, { kind, bandId = null, title, from = null, text, actions = [], data = {}, expires = null }) {
  const t = {
    id: uid(state, 't'),
    kind, bandId, title,
    day: state.day,
    messages: text ? [{ from, text, day: state.day }] : [],
    actions,
    data,
    resolved: actions.length === 0,
    unread: true,
    expires,
  };
  state.threads.unshift(t);
  if (state.threads.length > 300) {
    // drop old resolved threads first
    const idx = state.threads.findLastIndex((x) => x.resolved);
    if (idx >= 0) state.threads.splice(idx, 1);
  }
  return t;
}

export function addMessage(thread, from, text, day) {
  thread.messages.push({ from, text, day });
  thread.unread = true;
}

export function resolveThread(thread, note) {
  thread.resolved = true;
  thread.actions = [];
  if (note) thread.outcome = note;
}

export function playerBands(state) {
  return Object.values(state.bands).filter((b) => b.memberIds.includes(state.playerId));
}

export function ledBands(state) {
  return playerBands(state).filter((b) => b.leaderId === state.playerId);
}

export function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}
