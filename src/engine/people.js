// People: the player and every NPC musician share one shape.
import {
  ATTRS, INSTRUMENTS, INSTRUMENT_IDS, GEAR_CATALOG, GEAR_BY_ID, FIRST_NAMES, LAST_NAMES, NICKNAMES,
  DAY_JOBS, EXTRAS, EXTRAS_BY_ID, AMATEUR_POINT_CAP,
} from './data.js';
import { clamp } from './rng.js';

export const TIERS = ['amateur', 'semipro', 'pro'];
export const TIER_LABELS = { amateur: 'Amateur', semipro: 'Semi-pro', pro: 'Professional' };

// Attribute total thresholds for tiers.
export const SEMIPRO_AT = 20;
export const PRO_AT = 30;

export function attrTotal(p) {
  return ATTRS.reduce((s, a) => s + p.attrs[a], 0);
}

export function tierFor(p) {
  const t = attrTotal(p);
  if (t >= PRO_AT) return 'pro';
  if (t >= SEMIPRO_AT) return 'semipro';
  return 'amateur';
}

export function gearOf(p) {
  return p.gear.map((id) => GEAR_BY_ID[id]).filter(Boolean);
}

export function bestInSlot(p, slot) {
  let best = 0;
  for (const item of gearOf(p)) if (item.slot === slot && item.tier > best) best = item.tier;
  return best;
}

// Required slots for this person's role (+ mic if they sing over an instrument).
export function requiredSlots(p) {
  const slots = [...INSTRUMENTS[p.instrument].gearSlots];
  if (p.vocals !== 'none' && !slots.includes('mic')) slots.push('mic');
  return slots;
}

export function missingGear(p) {
  return requiredSlots(p).filter((s) => bestInSlot(p, s) === 0);
}

// 0..3: the average tier of the gear this person needs to perform.
export function gearScore(p) {
  const slots = requiredSlots(p);
  return slots.reduce((s, slot) => s + bestInSlot(p, slot), 0) / slots.length;
}

export function hasPA(p) {
  return bestInSlot(p, 'pa') > 0;
}

// "Cred": the member's overall worth. Roughly 20 for a fresh amateur, 100 for
// a fully kitted pro.
export function cred(p) {
  const breakdown = credBreakdown(p);
  return Math.round(breakdown.reduce((s, b) => s + b.value, 0));
}

export function credBreakdown(p) {
  const parts = [{ label: 'Attributes', value: attrTotal(p) * 2 }];
  if (p.instrument !== 'vocals') {
    if (p.vocals === 'lead') parts.push({ label: 'Plays + sings lead', value: 4 });
    if (p.vocals === 'backing') parts.push({ label: 'Plays + sings backing', value: 2 });
  }
  const gs = gearScore(p);
  parts.push({ label: 'Gear', value: Math.round(gs * 4 * 10) / 10 });
  const pa = bestInSlot(p, 'pa');
  if (pa) parts.push({ label: 'Owns a PA', value: 3 + pa });
  const extras = p.extras.filter((e) => e !== 'pa').length;
  if (extras) parts.push({ label: 'Extras', value: extras * 2 });
  return parts;
}

export function displayName(p) {
  return p.nickname ? `${p.first} "${p.nickname}" ${p.last}` : `${p.first} ${p.last}`;
}
export function shortName(p) {
  return p.nickname || p.first;
}

export function roleLabel(p) {
  const inst = INSTRUMENTS[p.instrument];
  if (p.instrument === 'vocals') return 'Vocalist';
  const base = inst.noun[0].toUpperCase() + inst.noun.slice(1);
  if (p.vocals === 'lead') return `${base} + lead vox`;
  if (p.vocals === 'backing') return `${base} + backing vox`;
  return base;
}

export function sings(p) {
  return p.instrument === 'vocals' || p.vocals !== 'none';
}

// XP needed to raise an attribute from `level` to `level + 1`.
export function xpToNext(level) {
  return 12 + level * 7;
}

// Grants XP and levels attributes up. Returns list of attributes that rose.
export function grantXp(p, gains, mult = 1) {
  const raised = [];
  for (const [attr, amount] of Object.entries(gains)) {
    if (attr === 'reliability') continue;
    if (p.attrs[attr] >= 10) continue;
    p.xp[attr] = (p.xp[attr] || 0) + amount * mult;
    while (p.attrs[attr] < 10 && p.xp[attr] >= xpToNext(p.attrs[attr])) {
      p.xp[attr] -= xpToNext(p.attrs[attr]);
      p.attrs[attr] += 1;
      raised.push(attr);
    }
  }
  return raised;
}

export function adjustReliability(p, delta) {
  // Reliability moves through a hidden 0..100 meter so single events nudge it.
  p.relMeter = clamp((p.relMeter ?? 50) + delta, 0, 100);
  if (p.relMeter >= 100 && p.attrs.reliability < 10) { p.attrs.reliability += 1; p.relMeter = 40; return 1; }
  if (p.relMeter <= 0 && p.attrs.reliability > 1) { p.attrs.reliability -= 1; p.relMeter = 60; return -1; }
  return 0;
}

// Chance this person can make an evening commitment on the given weekday.
export function availabilityChance(p, weekday, kind = 'practice') {
  if (p.isPlayer) return 1;
  const rel = p.attrs.reliability;
  if (p.tier === 'pro') return kind === 'overnight' ? 0.92 : 0.98;
  let base = p.busy.includes(weekday) ? 0.18 : 0.93;
  if (p.tier === 'semipro') base = p.busy.includes(weekday) ? 0.45 : 0.96;
  if (kind === 'gig') base += 0.05;
  if (kind === 'overnight') base -= 0.18;
  base += (rel - 5) * 0.015;
  return clamp(base, 0.05, 0.99);
}

// Suggested per-event rate for a person's tier & cred.
export function marketRate(p) {
  const c = cred(p);
  if (p.tier === 'pro') return Math.round((90 + c * 2.2) / 5) * 5;
  if (p.tier === 'semipro') return Math.round((15 + c * 0.6) / 5) * 5;
  return 0;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function cheapestGear(slot, tier) {
  const opts = GEAR_CATALOG.filter((x) => x.slot === slot && x.tier === tier);
  return opts[0];
}

export function pickGearFor(rng, slot, tier) {
  const opts = GEAR_CATALOG.filter((x) => x.slot === slot && x.tier === tier);
  return (opts.length ? rng.pick(opts) : cheapestGear(slot, 1)).id;
}

function distribute(rng, total, mins = 1, maxEach = 10) {
  const attrs = Object.fromEntries(ATTRS.map((a) => [a, mins]));
  let left = total - mins * ATTRS.length;
  let guard = 200;
  while (left > 0 && guard-- > 0) {
    const a = rng.pick(ATTRS);
    if (attrs[a] < maxEach) { attrs[a] += 1; left -= 1; }
  }
  return attrs;
}

/**
 * Generate an NPC musician.
 * opts: { tier, instrument, vocals, id, standout }
 */
export function generatePerson(rng, opts = {}) {
  const tier = opts.tier || 'amateur';
  const instrument = opts.instrument || rng.pickWeighted(INSTRUMENT_IDS, (i) => ({ guitar: 5, bass: 3, drums: 3, keys: 2, violin: 1, sax: 1, vocals: 2 }[i]));
  let vocals = opts.vocals;
  if (!vocals) {
    if (instrument === 'vocals') vocals = 'lead';
    else vocals = rng.pickWeighted(['none', 'backing', 'lead'], (v) => ({ none: 5, backing: 3, lead: 2 }[v]));
  }

  let total;
  if (tier === 'amateur') total = rng.int(6, AMATEUR_POINT_CAP);
  else if (tier === 'semipro') total = rng.int(SEMIPRO_AT, PRO_AT - 2);
  else total = rng.int(PRO_AT, 37);
  const attrs = distribute(rng, total);
  if (tier === 'pro') attrs.reliability = Math.max(attrs.reliability, rng.int(7, 9));
  if (tier === 'semipro') attrs.reliability = Math.max(attrs.reliability, rng.int(4, 7));

  const job = rng.pick(DAY_JOBS);
  const p = {
    id: opts.id || `p${Math.floor(rng.next() * 1e9).toString(36)}`,
    first: rng.pick(FIRST_NAMES),
    last: rng.pick(LAST_NAMES),
    nickname: rng.chance(0.12) ? rng.pick(NICKNAMES) : null,
    isPlayer: false,
    instrument,
    vocals: instrument === 'vocals' ? 'lead' : vocals,
    attrs,
    xp: { skill: 0, experience: 0, charisma: 0 },
    relMeter: 50,
    tier,
    job: tier === 'pro' ? 'full-time session musician' : job.job,
    busy: tier === 'pro' ? [] : tier === 'semipro' ? job.busy.slice(0, 1) : job.busy.slice(),
    gear: [],
    extras: [],
    rate: 0,
    loyalty: rng.int(40, 70),
    bandIds: [],
    standout: null,
  };

  // Gear: tier-appropriate for each required slot.
  const gearTier = tier === 'pro' ? 3 : tier === 'semipro' ? rng.pick([2, 2, 3]) : 1;
  for (const slot of requiredSlots(p)) {
    if (tier === 'amateur' && rng.chance(0.08)) continue; // some amateurs are missing a piece
    p.gear.push(pickGearFor(rng, slot, gearTier));
  }

  // The amateur "standout": one reason to say yes.
  if (tier === 'amateur') {
    const standout = opts.standout || rng.pickWeighted(['skill', 'gear', 'extra', 'extra', 'charisma', 'reliable', 'none'], (s) => (s === 'none' ? 0.6 : 1));
    p.standout = standout;
    if (standout === 'skill') { p.attrs.skill = rng.int(5, 7); }
    else if (standout === 'charisma') { p.attrs.charisma = rng.int(5, 7); }
    else if (standout === 'reliable') { p.attrs.reliability = rng.int(6, 8); p.busy = p.busy.slice(0, 1); }
    else if (standout === 'gear') {
      p.gear = requiredSlots(p).map((slot) => pickGearFor(rng, slot, 2));
    } else if (standout === 'extra') {
      const extra = rng.pickWeighted(EXTRAS, (e) => e.weight);
      addExtra(rng, p, extra.id);
    }
    // a second, rarer extra
    if (rng.chance(0.08)) addExtra(rng, p, rng.pickWeighted(EXTRAS, (e) => e.weight).id);
  } else if (rng.chance(tier === 'pro' ? 0.5 : 0.3)) {
    addExtra(rng, p, rng.pickWeighted(EXTRAS, (e) => e.weight).id);
  }
  if (sings(p) && tier !== 'amateur' && rng.chance(0.3) && !hasPA(p)) p.gear.push(pickGearFor(rng, 'pa', gearTier));

  p.rate = marketRate(p);
  return p;
}

export function addExtra(rng, p, extraId) {
  if (p.extras.includes(extraId)) return;
  p.extras.push(extraId);
  const ex = EXTRAS_BY_ID[extraId];
  if (ex.grantsGear) p.gear.push(pickGearFor(rng, ex.grantsGear, p.tier === 'pro' ? 3 : p.tier === 'semipro' ? 2 : 1));
}

export function extraEffect(p, key) {
  let v = 0;
  for (const id of p.extras) {
    const e = EXTRAS_BY_ID[id];
    if (e?.effect && key in e.effect) {
      const val = e.effect[key];
      v = typeof val === 'boolean' ? (val || v) : v + val;
    }
  }
  return v;
}

export function createPlayer({ first, last, instrument, vocals, attrs }) {
  const total = ATTRS.reduce((s, a) => s + attrs[a], 0);
  if (total > AMATEUR_POINT_CAP) throw new Error(`Starting attributes exceed ${AMATEUR_POINT_CAP} points`);
  for (const a of ATTRS) if (attrs[a] < 1 || attrs[a] > 10) throw new Error('Attributes must be 1-10');
  return {
    id: 'player',
    first, last, nickname: null,
    isPlayer: true,
    instrument,
    vocals: instrument === 'vocals' ? 'lead' : vocals,
    attrs: { ...attrs },
    xp: { skill: 0, experience: 0, charisma: 0 },
    relMeter: 50,
    tier: 'amateur',
    job: 'part-time job',
    busy: [],
    gear: [],
    extras: [],
    rate: 0,
    loyalty: 100,
    bandIds: [],
    standout: null,
  };
}
