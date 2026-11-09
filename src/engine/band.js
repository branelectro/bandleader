// Band model and band-level metrics.
import { GENRES, BAND_NAME_PARTS, INSTRUMENTS } from './data.js';
import { cred, gearScore, sings, hasPA, extraEffect, missingGear, shortName } from './people.js';
import { clamp } from './rng.js';

export function generateBandName(rng) {
  if (rng.chance(0.3)) return rng.pick(BAND_NAME_PARTS.single);
  const name = `${rng.pick(BAND_NAME_PARTS.a)} ${rng.pick(BAND_NAME_PARTS.b)}`;
  return rng.chance(0.25) ? `The ${name}` : name;
}

export function createBand({ id, name, genre, leaderId, day }) {
  return {
    id, name, genre, leaderId,
    memberIds: [leaderId],
    pay: {}, // memberId -> agreed rate per practice/gig
    missedPay: {},
    known: { [leaderId]: 0 }, // songs each member knows
    cash: 0,
    followers: 0,
    engagement: 30,
    hype: 0,
    standing: 0,
    showsAtTier: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
    reach: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
    tightness: 0,
    songs: 0,
    songProgress: 0,
    morale: 70,
    recordings: [],
    events: [],
    offers: [],
    lastPracticeDay: day,
    lastPostDay: day - 3,
    postsByDay: {},
    formedDay: day,
    recruiting: null,
    log: [],
    npc: false,
    growth: { gigs: 0, posts: 0, releases: 0, recruits: 0 },
  };
}

export function membersOf(state, band) {
  return band.memberIds.map((id) => state.people[id]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Lineup rules
// ---------------------------------------------------------------------------
export function lineupCheck(band, members) {
  const genre = GENRES[band.genre];
  const problems = [];
  const count = (inst) => members.filter((m) => m.instrument === inst).length;
  const hasDrums = count('drums') > 0;
  const hasGuitar = count('guitar') > 0;
  const hasBass = count('bass') > 0;
  const someoneSings = members.some(sings);

  if (members.length < genre.min) problems.push(`${genre.label} needs at least ${genre.min} members (you have ${members.length}).`);
  if (!hasDrums) problems.push('Needs a drummer.');
  if (genre.rule === 'core') {
    if (!hasGuitar && !hasBass) problems.push('Needs a guitarist or bassist.');
  } else {
    if (!hasGuitar) problems.push('Needs a guitarist.');
    if (!hasBass) problems.push('Needs a bassist.');
  }
  if (!someoneSings) problems.push('Somebody has to sing.');
  if (genre.rule === 'prog') {
    const extraInst = count('keys') + count('violin') + count('sax') + Math.max(0, count('guitar') - 1);
    if (extraInst < 1) problems.push('Prog needs something beyond guitar/bass/drums: keys, a second guitar, or another instrument.');
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
export function sizeFactor(band) {
  return Math.max(0, band.memberIds.length - 2);
}

// How hard it is to teach / coordinate a band of this size.
export function coordinationDrag(band) {
  return 1 + 0.12 * sizeFactor(band);
}

export function knowledge(band, memberId) {
  if (band.songs <= 0) return 1;
  return clamp((band.known[memberId] || 0) / band.songs, 0, 1);
}

export function bandHasPA(members) {
  return members.some(hasPA);
}

export function bandEffect(members, key) {
  let v = 0;
  for (const m of members) {
    const e = extraEffect(m, key);
    v = typeof e === 'boolean' ? (e || v) : v + e;
  }
  return v;
}

// Performance score 0..100 for whoever is actually present.
export function performanceScore(band, present, { lineupComplete = true } = {}) {
  const genre = GENRES[band.genre];
  const w = genre.weights;
  if (!present.length) return 0;
  let total = 0;
  for (const m of present) {
    const a = m.attrs;
    const musician = (a.skill * w.skill + a.charisma * w.charisma + a.experience * 0.8) / (w.skill + w.charisma + 0.8);
    const gear = gearScore(m) / 3;
    const missing = missingGear(m).length ? 0.55 : 1; // borrowed / no gear
    const learned = 0.45 + 0.55 * knowledge(band, m.id);
    const memberScore = (musician * 10) * (1 - 0.25 * w.gear) + gear * 100 * 0.25 * w.gear;
    total += memberScore * learned * missing;
  }
  const avg = total / present.length;
  const tight = band.tightness;
  let score = (avg * 1.0 + tight * 0.45 * w.tight) / (1 + 0.45 * w.tight);
  if (!lineupComplete) score *= 0.6;
  return clamp(score, 0, 100);
}

export function bandCred(state, band) {
  const ms = membersOf(state, band);
  if (!ms.length) return 0;
  return Math.round(ms.reduce((s, m) => s + cred(m), 0) / ms.length);
}

export function bestRecording(band) {
  const released = band.recordings.filter((r) => r.done);
  if (!released.length) return null;
  return released.reduce((a, b) => (b.quality > a.quality ? b : a));
}

export function bestProduction(band) {
  const r = band.recordings.filter((x) => x.done);
  return r.length ? Math.max(...r.map((x) => x.production)) : 0;
}

// Per-event cost of paid members.
export function payroll(state, band) {
  return band.memberIds.reduce((s, id) => s + (band.pay[id] || 0), 0);
}

export function practiceRoomCost(state, band) {
  const ms = membersOf(state, band);
  if (bandEffect(ms, 'freePractice')) return 0;
  return 15 + 5 * band.memberIds.length;
}

export function lineupSummary(state, band) {
  return membersOf(state, band).map((m) => `${shortName(m)} (${INSTRUMENTS[m.instrument].label})`).join(', ');
}
