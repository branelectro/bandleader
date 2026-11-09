// A simple scripted player used by tests and the balance report.
import { newGame, advanceDay, threadAction, makeCtx } from '../src/engine/sim.js';
import { startBand, postRecruitment } from '../src/engine/recruiting.js';
import { buyGear, payout } from '../src/engine/economy.js';
import { schedulePractice } from '../src/engine/schedule.js';
import { bookGig, bookingCheck } from '../src/engine/gigs.js';
import { bookRecording, releaseRecording } from '../src/engine/studio.js';
import { socialPost } from '../src/engine/social.js';
import { orderMerch } from '../src/engine/merch.js';
import { lineupCheck, membersOf } from '../src/engine/band.js';
import { GEAR_CATALOG, GENRES } from '../src/engine/data.js';
import { cred } from '../src/engine/people.js';

const ROLE_PLAN = {
  core: [{ instrument: 'drums', vocals: 'none' }],
  four: [{ instrument: 'drums', vocals: 'none' }, { instrument: 'bass', vocals: 'none' }, { instrument: 'vocals', vocals: 'lead' }],
  prog: [{ instrument: 'drums', vocals: 'none' }, { instrument: 'bass', vocals: 'none' }, { instrument: 'keys', vocals: 'none' }, { instrument: 'vocals', vocals: 'lead' }],
};

export function playBot({ seed, genre = 'punk', days = 365, extraMembers = 0, merch = false }) {
  const state = newGame(seed, { first: 'Bot', last: 'McBot', instrument: 'guitar', vocals: 'lead', attrs: { skill: 3, experience: 2, charisma: 3, reliability: 2 } });
  const ctx = makeCtx(state);
  for (const slot of ['guitar', 'guitarAmp', 'mic']) buyGear(ctx, GEAR_CATALOG.find((g) => g.slot === slot && g.tier === 1).id);
  const band = startBand(ctx, { name: 'Bot Band', genre });
  const roles = [...ROLE_PLAN[GENRES[genre].rule]];
  for (let i = 0; i < extraMembers; i++) roles.push({ instrument: i % 2 ? 'keys' : 'guitar', vocals: 'none' });
  postRecruitment(ctx, band.id, { roles });
  const log = [];
  for (let i = 0; i < days; i++) {
    // Inbox
    for (const t of state.threads.filter((x) => !x.resolved)) {
      if (t.kind === 'audition') {
        const c = state.people[t.data.personId];
        const role = band.recruiting?.roles[t.data.roleIndex];
        threadAction(ctx, t.id, role && !role.filled && c ? 'accept' : 'decline');
      } else if (t.kind === 'reschedule') threadAction(ctx, t.id, t.actions[0].id);
      else if (t.kind === 'payRequest') threadAction(ctx, t.id, band.cash > t.data.rate * 6 ? 'pay' : 'counter');
      else if (t.kind === 'fire') threadAction(ctx, t.id, 'fire');
    }
    const b = state.bands[band.id];
    if (!b) break;
    const ms = membersOf(state, b);
    const lc = lineupCheck(b, ms);
    if (!lc.ok && !b.recruiting) {
      const have = ms.map((m) => m.instrument);
      const missing = roles.filter((r) => !have.includes(r.instrument));
      if (missing.length) postRecruitment(ctx, b.id, { roles: missing });
    }
    if (lc.ok) {
      // two practices a week
      const upcoming = b.events.filter((e) => e.status === 'scheduled' && e.day > state.day && e.day <= state.day + 7 && e.type === 'practice').length;
      if (upcoming < 2) schedulePractice(ctx, b.id, state.day + 2 + (upcoming ? 2 : 0));
      // book the best eligible gig
      const eligible = b.offers.filter((o) => o.expires > state.day && (bookingCheck(b, o.tier).ok || o.connection)).sort((x, y) => y.tier - x.tier);
      const gigs = b.events.filter((e) => e.type === 'gig' && e.status === 'scheduled').length;
      if (eligible[0] && gigs < 2) bookGig(ctx, b.id, eligible[0].id);
      // record when it makes sense
      if (b.songs >= 4 && !b.recordings.some((r) => !r.done)) {
        const best = Math.max(0, ...b.recordings.filter((r) => r.done).map((r) => r.quality));
        const want = b.standing >= 1 ? 55 : 30;
        if (best < want) {
          const type = b.cash > 900 ? 'cheap' : b.standing >= 1 ? 'student' : 'basement';
          const sessions = type === 'cheap' ? 4 : type === 'student' ? 5 : 6;
          bookRecording(ctx, b.id, { type, sessions, songs: Math.min(b.songs, 4), startDay: state.day + 2 });
        }
      }
      const unrel = b.recordings.find((r) => r.done && !r.released);
      if (unrel) { if (b.hype > 0.5) releaseRecording(ctx, b.id, unrel.id); else socialPost(ctx, b.id, 'teaser'); }
      else if (state.day % 2 === 0) socialPost(ctx, b.id, b.events.some((e) => e.type === 'gig' && e.status === 'scheduled') ? 'flyer' : 'bts');
      if (merch) {
        const stock = (k) => (b.merch?.[k]?.qty || 0) + (b.merchOrders || []).filter((o) => o.key === k).reduce((s, o) => s + o.qty, 0);
        if (stock('stickers') < 30 && b.cash > 150) orderMerch(ctx, b.id, 'stickers', 1);
        if (stock('tshirts') < 8 && b.cash > 450) orderMerch(ctx, b.id, 'tshirts', 1);
        const rel = b.recordings.filter((r) => r.released).at(-1);
        if (rel && stock('cd:' + rel.id) === 0 && !rel.pressed && b.cash > 1400) { orderMerch(ctx, b.id, 'cd:' + rel.id, 0); rel.pressed = true; }
      }
      if (b.cash > 1500 && state.day % 28 === 0) payout(ctx, b.id, 300);
    }
    advanceDay(ctx);
    if (state.day % 30 === 0) log.push({ day: state.day, followers: b.followers, standing: b.standing, members: b.memberIds.length, songs: b.songs, tight: Math.round(b.tightness), cash: Math.round(b.cash), cred: cred(state.people.player) });
  }
  return { state, band: state.bands[band.id], log };
}
