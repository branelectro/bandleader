// Leaders of bands the player joined: they run the calendar, book shows,
// record and post. The player can't edit their schedule.
import { membersOf, bestRecording } from './band.js';
import { availabilityChance } from './people.js';
import { createEvent, playerConflicts } from './schedule.js';
import { weeklyOffers, bookingCheck } from './gigs.js';
import { bookRecording, releaseRecording } from './studio.js';
import { socialPost } from './social.js';
import { weekday, news } from './state.js';

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
    for (let d = from; d <= to; d++) {
      if (band.events.some((e) => e.day === d && e.status === 'scheduled')) continue;
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
  if (ok[0] && upcomingGigs < 2 && rng.chance(0.75)) {
    const o = ok[0];
    band.offers = band.offers.filter((x) => x.id !== o.id);
    createEvent(state, band, { type: 'gig', day: o.day, title: `Show @ ${o.venue}`, data: { offer: o } });
    const clash = playerConflicts(state, o.day).filter((e) => e.bandId !== band.id);
    news(state, `${band.name} booked ${o.venue} for day ${o.day}.${clash.length ? ' That clashes with another of your bands!' : ''}`, { bandId: band.id, tone: clash.length ? 'bad' : 'info' });
  }

  // Recording: when they've got material and no decent recording yet.
  const best = bestRecording(band);
  const recording = band.recordings.some((r) => !r.done);
  if (!recording && band.songs >= 4 && (!best || best.quality < 40 + band.standing * 10) && rng.chance(0.3)) {
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
