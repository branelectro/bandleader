// The game loop: new game, daily tick, and inbox action dispatch.
import { emptyState, makeCtx, commit, weekday, news, resolveThread, player, playerBands, createThread } from './state.js';
import { createPlayer } from './people.js';
import { seedScene, weeklySceneTick, processOpeningReplies, refreshOpenings, joinSceneBand } from './scene.js';
import { dailyRecruiting, acceptCandidate, declineCandidate } from './recruiting.js';
import { rollAttendance, resolvePractice, answerReschedule, weeklyMemberChecks, EVENT_PRIORITY } from './schedule.js';
import { resolveGig, weeklyOffers } from './gigs.js';
import { resolveSession, dailyReleases } from './studio.js';
import { dailySocial } from './social.js';
import { checkTierChanges, answerPayRequest, answerFireRequest, weeklyIncome } from './economy.js';
import { npcWeekly, npcDaily } from './npc.js';
import { removeMember } from './recruiting.js';
import { shortName } from './people.js';

export const STARTING_CASH = 350;

export function newGame(seed, playerSpec) {
  const state = emptyState(seed);
  const ctx = makeCtx(state);
  const p = createPlayer(playerSpec);
  state.people[p.id] = p;
  state.cash = STARTING_CASH;
  seedScene(ctx);
  refreshOpenings(ctx);
  createThread(state, {
    kind: 'note',
    title: 'Welcome to the scene',
    text: 'You have a little cash and a lot of ambition. Buy some gear at the shop, then start a band (or answer a band\'s post on the Scene board). Every week is a new chance to get noticed.',
  });
  commit(ctx);
  return state;
}

export function advanceDay(ctx) {
  const { state } = ctx;
  state.day += 1;
  const d = state.day;
  const bands = playerBands(state);

  if (weekday(d) === 0) weekly(ctx);

  // Two days out, members decide whether they can make it.
  for (const band of bands) {
    for (const e of band.events) {
      if (e.status !== 'scheduled' || e.rolled) continue;
      if (e.day - d <= 2) rollAttendance(ctx, band, e);
    }
  }

  // Anything left in the past (shouldn't happen) is marked missed.
  for (const band of bands) for (const e of band.events) if (e.status === 'scheduled' && e.day < d) e.status = 'missed';

  // Today's events across all your bands. You can only be in one place.
  const today = [];
  for (const band of playerBands(state)) {
    for (const e of band.events) if (e.day === d && e.status === 'scheduled') today.push({ band, e });
  }
  today.sort((a, b) => EVENT_PRIORITY[b.e.type] - EVENT_PRIORITY[a.e.type] || (a.band.leaderId === state.playerId ? -1 : 1));
  let playerUsed = false;
  for (const { band, e } of today) {
    const busy = playerUsed;
    if (e.type === 'practice') resolvePractice(ctx, band, e, busy);
    else if (e.type === 'gig') resolveGig(ctx, band, e, busy);
    else if (e.type === 'recording') resolveSession(ctx, band, e, busy);
    if (busy) news(state, `You were double-booked and missed ${band.name}'s ${e.title.toLowerCase()}.`, { bandId: band.id, tone: 'bad' });
    playerUsed = true;
  }

  for (const band of playerBands(state)) {
    dailySocial(ctx, band);
    dailyReleases(ctx, band);
    if (band.npc) npcDaily(ctx, band);
    // Skills fade without practice.
    if (d - band.lastPracticeDay > 7) band.tightness = Math.max(0, band.tightness - 0.8);
    state.stats.peakFollowers = Math.max(state.stats.peakFollowers, band.followers);
  }
  dailyRecruiting(ctx);
  processOpeningReplies(ctx);
  checkTierChanges(ctx);
  expireThreads(ctx);
  commit(ctx);
}

function weekly(ctx) {
  const { state } = ctx;
  weeklyIncome(ctx);
  weeklySceneTick(ctx);
  for (const band of playerBands(state)) {
    if (band.npc) npcWeekly(ctx, band);
    else {
      weeklyOffers(ctx, band);
      weeklyMemberChecks(ctx, band);
    }
    // Clean up old events
    band.events = band.events.filter((e) => e.status === 'scheduled' || state.day - e.day < 42);
  }
}

function expireThreads(ctx) {
  const { state } = ctx;
  for (const t of state.threads) {
    if (t.resolved) continue;
    if (t.kind === 'reschedule') {
      const band = state.bands[t.bandId];
      const e = band?.events.find((x) => x.id === t.data.eventId);
      if (!e || e.status !== 'scheduled' || e.day <= state.day) resolveThread(t, 'Never answered; the original day stood.');
      continue;
    }
    if (t.expires == null || t.expires > state.day) continue;
    if (t.kind === 'audition') {
      const cand = state.people[t.data.personId];
      if (cand?.candidate) delete state.people[cand.id];
      resolveThread(t, 'They joined another band.');
    } else if (t.kind === 'payRequest') {
      const band = state.bands[t.bandId];
      const m = state.people[t.data.personId];
      if (band && m && band.memberIds.includes(m.id)) {
        removeMember(ctx, band, m.id, 'quit (pay request ignored)');
        news(state, `${shortName(m)} quit ${band.name} after you ignored their pay request.`, { bandId: band.id, tone: 'bad' });
      }
      resolveThread(t, 'You never answered. They quit.');
    } else {
      resolveThread(t, 'Expired.');
    }
  }
}

// One entry point for every inbox button.
export function threadAction(ctx, threadId, action) {
  const { state } = ctx;
  const t = state.threads.find((x) => x.id === threadId);
  if (!t || t.resolved) return { ok: false, msg: 'Already handled.' };
  let res;
  switch (t.kind) {
    case 'audition':
      res = action === 'accept' ? acceptCandidate(ctx, t) : declineCandidate(ctx, t);
      break;
    case 'reschedule':
      res = answerReschedule(ctx, t, action);
      break;
    case 'payRequest':
      res = answerPayRequest(ctx, t, action);
      break;
    case 'fire':
      res = answerFireRequest(ctx, t, action);
      break;
    case 'joinOffer':
      if (action === 'accept') {
        const band = joinSceneBand(ctx, t.data.openingId);
        if (band) state.bands[band.id] = band;
        res = band ? { ok: true, msg: `You're in ${band.name}!` } : { ok: false, msg: 'The spot is gone.' };
      } else res = { ok: true, msg: 'Passed.' };
      resolveThread(t, res.msg);
      break;
    default:
      resolveThread(t);
      res = { ok: true };
  }
  commit(ctx);
  return res;
}

export { makeCtx, commit, player };
