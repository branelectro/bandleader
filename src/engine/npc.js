// Leaders of bands the player joined: they run the calendar, book shows
// (after asking you), record and post. The player can't edit their schedule.
import { membersOf, bestRecording } from './band.js';
import { availabilityChance } from './people.js';
import { createEvent, eventsOn, cancelScheduled } from './schedule.js';
import { weeklyOffers, bookingCheck } from './gigs.js';
import { bookRecording, releaseRecording } from './studio.js';
import { socialPost } from './social.js';
import { weekday, news, dayLabel, createThread, addMessage, resolveThread } from './state.js';
import { VENUE_TIERS } from './data.js';

export function npcWeekly(ctx, band) {
  planPractices(ctx, band);
  npcBookAndRecord(ctx, band);
}

// Practices: two evenings a week that suit the most members, planned two
// weeks ahead so members can see them coming (and ask to move them).
export function planPractices(ctx, band) {
  const { state, rng } = ctx;
  const ms = membersOf(state, band);
  for (const [from, to] of [[state.day + 1, state.day + 6], [state.day + 7, state.day + 13]]) {
    const have = band.events.filter((e) => e.type === 'practice' && e.status === 'scheduled' && e.day >= from && e.day <= to).length;
    if (have >= 2) continue;
    const scores = [];
    const heldForShows = state.threads.filter((t) => !t.resolved && t.kind === 'gigProposal' && t.bandId === band.id).map((t) => t.data.offer.day);
    for (let d = from; d <= to; d++) {
      if (band.events.some((e) => e.day === d && e.status === 'scheduled') || heldForShows.includes(d)) continue;
      const fit = ms.reduce((s, m) => s + availabilityChance(m, weekday(d)), 0);
      scores.push({ d, fit: fit + rng.float(0, 0.4) });
    }
    scores.sort((a, b) => b.fit - a.fit);
    for (const { d } of scores.slice(0, 2 - have)) createEvent(state, band, { type: 'practice', day: d, title: 'Practice' });
  }
}

function npcBookAndRecord(ctx, band) {
  const { state, rng } = ctx;
  // Shows: take the best offer the band qualifies for.
  weeklyOffers(ctx, band);
  const ok = band.offers.filter((o) => o.expires > state.day && o.day > state.day && bookingCheck(band, o.tier).ok && !band.events.some((e) => e.day === o.day && e.status === 'scheduled'));
  ok.sort((a, b) => b.tier - a.tier || b.bill.reduce((s, x) => s + x.followers, 0) - a.bill.reduce((s, x) => s + x.followers, 0));
  const upcomingGigs = band.events.filter((e) => e.type === 'gig' && e.status === 'scheduled').length;
  const pending = state.threads.some((t) => !t.resolved && t.kind === 'gigProposal' && t.bandId === band.id);
  if (ok[0] && upcomingGigs < 2 && !pending && rng.chance(0.75)) {
    const o = ok[0];
    band.offers = band.offers.filter((x) => x.id !== o.id);
    proposeGig(ctx, band, o);
  }

  // Recording: when they've got material and no decent recording yet.
  const best = bestRecording(band);
  const recording = band.recordings.some((r) => !r.done);
  const showPending = state.threads.some((t) => !t.resolved && t.kind === 'gigProposal' && t.bandId === band.id);
  if (!recording && !showPending && band.songs >= 4 && (!best || best.quality < 40 + band.standing * 10) && rng.chance(0.3)) {
    const type = band.cash >= 700 ? 'cheap' : 'student';
    const sessions = type === 'cheap' ? Math.min(3, Math.ceil(band.songs / 2)) : 4;
    bookRecording(ctx, band.id, { type, sessions, songs: Math.min(band.songs, 4), startDay: state.day + 3 });
  }
  const unreleased = band.recordings.find((r) => r.done && !r.released);
  if (unreleased && (band.hype > 0.4 || state.day - unreleased.doneDay > 10)) releaseRecording(ctx, band.id, unreleased.id);

  // Monthly payout to members (the player included).
  if (Math.floor(state.day / 7) % 4 === 0 && band.cash > 150 && !band.playerPay) {
    const pot = Math.floor(band.cash * 0.4);
    const share = Math.floor(pot / band.memberIds.length);
    band.cash -= share * band.memberIds.length;
    state.cash += share;
    if (share > 0) news(state, `${band.name} split the band fund: you got $${share}.`, { bandId: band.id, tone: 'good' });
  }
}

export function npcDaily(ctx, band) {
  const { state, rng } = ctx;
  if (state.day - band.lastPostDay >= 2 && rng.chance(0.6)) {
    const pending = band.recordings.some((r) => r.done && !r.released);
    const gigSoon = band.events.some((e) => e.type === 'gig' && e.status === 'scheduled' && e.day - state.day <= 7);
    socialPost(ctx, band.id, pending ? 'teaser' : gigSoon ? 'flyer' : rng.pick(['bts', 'meme']), { auto: true });
  }
}

// ---------------------------------------------------------------------------
// Show proposals: the leader asks before booking. Nothing is booked until you
// say you're in; a "no" (or silence past the deadline) means they pass.
// ---------------------------------------------------------------------------
export function proposeGig(ctx, band, o) {
  const { state, rng } = ctx;
  const leader = state.people[band.leaderId];
  const v = VENUE_TIERS[o.tier];
  const pay = o.payType === 'guarantee' ? `$${o.pay} guaranteed` : o.tier === 0 ? 'Donation bucket' : `Door split ($${o.ticket} tickets)`;
  const bill = o.bill.map((b) => `${b.name} (${b.followers} followers)`).join(', ');
  const t = createThread(state, {
    kind: 'gigProposal',
    bandId: band.id,
    title: `${band.name}: show at ${o.venue} on ${dayLabel(o.day)}?`,
    from: leader.id,
    text: `We got offered a show: ${o.venue} (${v.label}, capacity ${o.capacity}) on ${dayLabel(o.day, true)}. ${pay}. On the bill: ${bill}. Everyone in?`,
    actions: [{ id: 'in', label: 'I\'m in, book it' }, { id: 'out', label: 'I can\'t make it, pass' }],
    data: { offer: o },
    // A few days to answer, and always at least 2 days before the show.
    expires: Math.max(state.day + 1, Math.min(state.day + 4, o.day - 2)),
  });
  for (const m of membersOf(state, band)) {
    if (m.isPlayer || m.id === leader.id) continue;
    const can = availabilityChance(m, weekday(o.day), 'gig') > 0.5;
    addMessage(t, m.id, can ? rng.pick(['I\'m in!', 'Let\'s do it 🤘', 'Yes please.']) : rng.pick(['That\'s a work night for me, but I\'ll try to get it off.', 'Ugh, I might be working. I\'ll see what I can do.']), state.day);
  }
  const clash = eventsOn(state, o.day).filter((e) => e.bandId !== band.id);
  if (clash.length) addMessage(t, null, `⚠ You're already booked that day: ${clash.map((e) => `${state.bands[e.bandId]?.name}: ${e.title}`).join(', ')}.`, state.day);
  return t;
}

export function answerGigProposal(ctx, t, action) {
  const { state } = ctx;
  const band = state.bands[t.bandId];
  const o = t.data.offer;
  if (!band) { resolveThread(t); return { ok: false, msg: 'You\'re not in that band anymore.' }; }
  const leader = state.people[band.leaderId];
  if (action === 'in') {
    addMessage(t, state.playerId, 'I\'m in!', state.day);
    // A practice that day just gets dropped: the show wins.
    const inTheWay = band.events.filter((e) => e.day === o.day && e.status === 'scheduled');
    if (inTheWay.length && inTheWay.every((e) => e.type === 'practice')) {
      for (const e of inTheWay) cancelScheduled(band, e);
      addMessage(t, leader.id, `I'll drop that day's practice.`, state.day);
    }
    if (o.day <= state.day || band.events.some((e) => e.day === o.day && e.status === 'scheduled')) {
      addMessage(t, leader.id, 'Ah, too late, that date doesn\'t work anymore. Next time!', state.day);
      resolveThread(t, 'Not booked.');
      return { ok: false, msg: 'That date is no longer available.' };
    }
    createEvent(state, band, { type: 'gig', day: o.day, title: `Show @ ${o.venue}`, data: { offer: o } });
    addMessage(t, leader.id, `Booked! See you all at ${o.venue}.`, state.day);
    resolveThread(t, `Booked for ${dayLabel(o.day)}.`);
    news(state, `${band.name} booked ${o.venue} for ${dayLabel(o.day)}.`, { bandId: band.id, tone: 'good' });
    return { ok: true, msg: `${band.name} is playing ${o.venue} on ${dayLabel(o.day, true)}.` };
  }
  addMessage(t, state.playerId, 'I can\'t make that one, sorry.', state.day);
  addMessage(t, leader.id, 'No worries, we\'ll pass on this one.', state.day);
  resolveThread(t, 'Passed.');
  return { ok: true, msg: `${band.name} passed on the show.` };
}

export function expireGigProposal(ctx, t) {
  const band = ctx.state.bands[t.bandId];
  if (band) addMessage(t, band.leaderId, 'Didn\'t hear back in time, so we passed on it.', ctx.state.day);
  resolveThread(t, 'No answer, so they passed.');
}
