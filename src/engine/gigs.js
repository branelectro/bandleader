// Venues, show offers, booking rules and gig results.
import { VENUE_TIERS, VENUE_NAMES, GENRES, CROWD_REACTIONS } from './data.js?v=4';
import { membersOf, performanceScore, lineupCheck, bandHasPA, bestRecording, bandEffect } from './band.js?v=4';
import { grantXp, shortName } from './people.js?v=4';
import { createEvent, resolveAttendance, payWages, playerConflicts } from './schedule.js?v=4';
import { uid, weekday, dayLabel, news, createThread } from './state.js?v=4';
import { billFor } from './scene.js?v=4';
import { clamp } from './rng.js?v=4';
import { sellAtGig } from './merch.js?v=4';

// Band size changes *why* booking is hard, not whether the band is "better".
export function sizeModifier(n) {
  if (n <= 2) return 1.25;
  if (n === 3) return 1.12;
  if (n === 4) return 1.0;
  if (n <= 6) return 0.82;
  return 0.72;
}

export function bookingCheck(band, tier) {
  const v = VENUE_TIERS[tier];
  const n = band.memberIds.length;
  const reasons = [];
  if (band.songs < v.songs) reasons.push(`needs ${v.songs} songs (you have ${band.songs})`);
  if (tier === 0) return { ok: !reasons.length, reasons };

  const rec = bestRecording(band);
  const recQ = rec ? rec.quality : 0;
  // Clubs and up won't book off a basement demo, however well it's played.
  const studioRecs = band.recordings.filter((r) => r.done && r.type !== 'basement');
  const studioQ = studioRecs.length ? Math.max(...studioRecs.map((r) => r.quality)) : 0;
  let needFollowers = Math.round(v.minFollowers * sizeModifier(n));
  // A strong recording substitutes for some of the following.
  if (recQ >= v.minRecording + 15) needFollowers = Math.round(needFollowers * 0.5);

  if (tier === 1) {
    if (n <= 3 && recQ < v.minRecording) reasons.push(`small bands need a demo (quality ${v.minRecording}+) before bars will book them`);
    if (band.followers < needFollowers && recQ < v.minRecording) reasons.push(`needs ${needFollowers} followers or a decent demo`);
  } else {
    if (band.followers < needFollowers) reasons.push(`needs ${needFollowers} followers`);
    if (studioQ < v.minRecording) {
      reasons.push(studioRecs.length || !rec
        ? `needs a recording of quality ${v.minRecording}+ (your best studio recording is ${studioQ})`
        : `needs a non-basement recording of quality ${v.minRecording}+ (basement demos won't cut it)`);
    }
  }
  if (band.standing < tier - 1) reasons.push('your scene standing is too low');
  return { ok: !reasons.length, reasons, needFollowers };
}

function venueName(rng, tier) {
  const t = VENUE_NAMES[tier];
  return `${rng.pick(t.a)} ${rng.pick(t.b)}`;
}

function showDay(rng, today) {
  // Shows cluster Thu-Sat, 5-20 days out.
  let d = today + rng.int(5, 20);
  const wd = weekday(d);
  if (wd < 3) d += 3 - wd + rng.int(0, 2);
  return d;
}

export function makeOffer(ctx, band, tier, { connection = false } = {}) {
  const { state, rng } = ctx;
  const v = VENUE_TIERS[tier];
  const capacity = rng.int(v.capacity[0], v.capacity[1]);
  const billSize = tier === 0 ? rng.int(1, 3) : rng.int(2, 3);
  const bill = billFor(ctx, tier, billSize);
  const guarantee = tier >= 2 || rng.chance(0.3);
  const day = showDay(rng, state.day);
  const offer = {
    id: uid(state, 'g'),
    tier,
    venue: connection ? `${band.connectionVenue || (band.connectionVenue = venueName(rng, 1))}` : venueName(rng, tier),
    day,
    capacity,
    payType: guarantee ? 'guarantee' : 'door',
    pay: guarantee ? rng.int(v.pay[0], v.pay[1]) : 0,
    ticket: [3, 8, 12, 20, 35][tier],
    bill,
    connection,
    expires: 0,
  };
  // Promoters want an answer well before the show.
  offer.expires = Math.min(state.day + 6, day - 2);
  return offer;
}

export function weeklyOffers(ctx, band) {
  const { state, rng } = ctx;
  band.offers = band.offers.filter((o) => o.expires > state.day);
  const ms = membersOf(state, band);
  const extra = bandEffect(ms, 'extraOffers');
  const grudge = band.promoterGrudge || 0;
  const count = Math.max(1, 2 + extra + (band.memberIds.length >= 5 ? 1 : 0) - grudge + rng.int(0, 1));
  band.promoterGrudge = Math.max(0, grudge - 0.5);
  const maxTier = Math.min(4, band.standing + 1);
  for (let i = 0; i < count; i++) {
    // Mostly at current standing, sometimes a reach, sometimes a step down.
    const r = rng.next();
    let tier = r < 0.55 ? band.standing : r < 0.85 ? maxTier : Math.max(0, band.standing - 1);
    band.offers.push(makeOffer(ctx, band, tier));
  }
  if (bandEffect(ms, 'venueConnection') && rng.chance(0.6)) band.offers.push(makeOffer(ctx, band, 1, { connection: true }));
}

export function bookGig(ctx, bandId, offerId) {
  const { state } = ctx;
  const band = state.bands[bandId];
  const o = band?.offers.find((x) => x.id === offerId);
  if (!o || o.expires <= state.day || o.day <= state.day) return { ok: false, msg: 'That offer is gone.' };
  if (band.leaderId !== state.playerId) return { ok: false, msg: 'Only the band leader books shows.' };
  const ms = membersOf(state, band);
  const lc = lineupCheck(band, ms);
  if (!lc.ok) return { ok: false, msg: `Your lineup isn't ready: ${lc.problems[0]}` };
  const check = bookingCheck(band, o.tier);
  if (!check.ok && !o.connection) return { ok: false, msg: `The booker passed: ${check.reasons.join('; ')}.` };
  if (!o.connection && band.songs < VENUE_TIERS[o.tier].songs) return { ok: false, msg: 'Not enough songs.' };
  if (band.events.some((e) => e.day === o.day && e.status === 'scheduled')) return { ok: false, msg: 'Something is already scheduled that day.' };
  band.offers = band.offers.filter((x) => x.id !== offerId);
  createEvent(state, band, { type: 'gig', day: o.day, title: `Show @ ${o.venue}`, data: { offer: o } });
  const clash = playerConflicts(state, o.day).filter((e) => e.bandId !== bandId);
  return { ok: true, msg: `Booked ${o.venue} on ${dayLabel(o.day, true)}!${clash.length ? ' Heads up: you have another band booked that day.' : ''}` };
}

export function resolveGig(ctx, band, e, playerBusy) {
  const { state, rng } = ctx;
  const o = e.data.offer;
  const v = VENUE_TIERS[o.tier];
  const genre = GENRES[band.genre];
  const { present, absentNotice, noShow } = resolveAttendance(ctx, band, e, playerBusy);
  const lc = lineupCheck(band, present);
  const notes = [];

  if (present.length === 0 || (!lc.ok && present.length < Math.ceil(band.memberIds.length / 2))) {
    e.status = 'done';
    band.followers = Math.max(0, Math.round(band.followers * 0.95));
    band.promoterGrudge = (band.promoterGrudge || 0) + 1;
    e.result = { summary: 'Too many people bailed. You had to cancel at the venue. Ouch.', grade: 'bad', present: present.map((m) => m.id) };
    news(state, `${band.name} no-showed their own gig at ${o.venue}.`, { bandId: band.id, tone: 'bad' });
    return e.result;
  }

  let perf = performanceScore(band, present, { lineupComplete: lc.ok });
  if (!lc.ok) notes.push(`Missing ${[...absentNotice, ...noShow].map(shortName).join(', ')}: the set had holes.`);
  if (v.paRequired && !bandHasPA(present)) {
    if (band.cash >= 50) { band.cash -= 50; notes.push('Nobody brought a PA, so you rented one for $50.'); }
    else { perf *= 0.78; notes.push('No PA. The vocals were inaudible.'); }
  }
  perf = clamp(perf + rng.gauss(0, 7), 0, 100);

  // Crowd: your fans + the other bands' fans + walk-ins.
  const engage = 0.5 + band.engagement / 100;
  const ownDraw = band.followers * [0.35, 0.22, 0.16, 0.12, 0.1][o.tier] * engage;
  const billDraw = o.bill.reduce((s, b) => s + b.followers * [0.3, 0.22, 0.16, 0.12, 0.1][o.tier], 0);
  const walkIns = Math.round(rng.int(...[[12, 35], [5, 20], [15, 50], [40, 120], [100, 300]][o.tier]) * (o.tier === 0 ? genre.diyScene : 1));
  const sizeBuzz = 1 + 0.04 * Math.max(0, band.memberIds.length - 3); // big bands are a spectacle
  const attendance = Math.round(Math.min(o.capacity, (ownDraw + billDraw + walkIns) * sizeBuzz));

  // New people: anyone who isn't already a fan. The basement pool saturates.
  let newPeople = Math.max(0, attendance - ownDraw);
  const pool = Math.round(v.poolBase * genre.diyScene);
  const remaining = Math.max(0, pool - band.reach[o.tier]);
  const saturation = remaining / pool;
  newPeople = Math.min(newPeople * (o.tier === 0 ? saturation : Math.max(0.3, saturation)), remaining);
  band.reach[o.tier] += newPeople;
  if (o.tier === 0 && saturation < 0.35) notes.push('Same crowd as last time. You\'re running out of new basement kids to win over.');

  const convBase = [0.9, 0.5, 0.34, 0.27, 0.22][o.tier];
  const conv = convBase * Math.pow(perf / 100, 1.1) * (0.7 + band.engagement / 200);
  const newFollowers = Math.round(newPeople * conv);
  band.followers += newFollowers;
  band.growth.gigs += newFollowers;

  // Money
  let pay = o.payType === 'guarantee' ? o.pay : Math.round(attendance * o.ticket * 0.6 / (o.bill.length + 1));
  if (o.tier === 0) pay = Math.round(attendance * rng.float(0.3, 1.2)); // donation bucket
  pay = Math.round(pay * (1 + bandEffect(present, 'gigPay')));
  band.cash += pay;
  payWages(ctx, band, present);

  // Growth
  const grade = perf >= 70 ? 'great' : perf >= 50 ? 'good' : perf >= 32 ? 'meh' : 'bad';
  const xpMult = 1 + bandEffect(membersOf(state, band), 'bandXp');
  for (const m of present) grantXp(m, { experience: 5, charisma: 3, skill: 1 }, xpMult);
  band.engagement = clamp(band.engagement + { great: 9, good: 5, meh: 1, bad: -4 }[grade], 0, 100);
  band.morale = clamp(band.morale + { great: 8, good: 4, meh: -1, bad: -6 }[grade], 0, 100);
  band.showsAtTier[o.tier] += 1;
  band.lastGigDay = state.day;
  if (present.some((m) => m.isPlayer)) state.stats.gigs += 1;
  const promoted = updateStanding(ctx, band);

  // Other bands on the bill gain a little too.
  for (const b of o.bill) {
    const sb = state.scene.find((x) => x.id === b.sceneId);
    if (sb) sb.followers += Math.round(rng.int(0, 3) + (perf > 60 ? 1 : 0));
  }

  const merch = sellAtGig(ctx, band, { attendance, fans: Math.min(attendance, ownDraw), grade, tier: o.tier });
  const flavor = rng.pick(CROWD_REACTIONS[grade]);
  const summary = `${attendance} people came. ${flavor} +${newFollowers} followers, ${pay ? `$${pay} for the band` : 'no money'}. ${merch ? `${merch.summary} ` : ''}${notes.join(' ')}${promoted ? ` ${promoted}` : ''}`;
  e.status = 'done';
  e.result = { summary, grade, attendance, newFollowers, pay, merch, perf: Math.round(perf), present: present.map((m) => m.id) };
  createThread(state, { kind: 'result', bandId: band.id, title: `${band.name} @ ${o.venue}: ${grade.toUpperCase()}`, text: summary });
  return e.result;
}

export function standingLabel(tier) {
  return VENUE_TIERS[tier].label;
}

export function updateStanding(ctx, band) {
  const { state } = ctx;
  const next = band.standing + 1;
  if (next > 4) return null;
  const v = VENUE_TIERS[next];
  const need = Math.round(v.minFollowers * sizeModifier(band.memberIds.length));
  if (band.showsAtTier[band.standing] >= 3 && band.followers >= need) {
    band.standing = next;
    const msg = `${band.name} moved up to ${v.label} standing!`;
    news(state, msg, { bandId: band.id, tone: 'good' });
    return msg;
  }
  return null;
}

export function standingProgress(band) {
  const next = band.standing + 1;
  if (next > 4) return null;
  const v = VENUE_TIERS[next];
  return {
    next: v.label,
    shows: Math.min(3, band.showsAtTier[band.standing]),
    showsNeeded: 3,
    followers: band.followers,
    followersNeeded: Math.round(v.minFollowers * sizeModifier(band.memberIds.length)),
  };
}
