// Calendar events, attendance, rescheduling threads, and practices.
import { EXCUSES, DAY_NAMES_LONG, GENRES } from './data.js';
import {
  availabilityChance, adjustReliability, grantXp, shortName, displayName, extraEffect,
} from './people.js';
import { membersOf, coordinationDrag, bandEffect, practiceRoomCost, payroll } from './band.js';
import { uid, weekday, dayLabel, createThread, addMessage, resolveThread, news, player } from './state.js';
import { clamp } from './rng.js';
import { removeMember } from './recruiting.js';

export const EVENT_PRIORITY = { gig: 3, recording: 2, practice: 1 };

export function createEvent(state, band, { type, day, title, data = {} }) {
  const e = {
    id: uid(state, 'e'),
    bandId: band.id,
    type, day, title, data,
    status: 'scheduled',
    rolls: {},
    notice: [],
    rolled: false,
    result: null,
  };
  band.events.push(e);
  band.events.sort((a, b) => a.day - b.day);
  return e;
}

export function eventsOn(state, day, { playerOnly = true } = {}) {
  const out = [];
  for (const b of Object.values(state.bands)) {
    if (playerOnly && !b.memberIds.includes(state.playerId)) continue;
    for (const e of b.events) if (e.day === day && e.status === 'scheduled') out.push(e);
  }
  return out;
}

export function playerConflicts(state, day, exceptEventId = null) {
  return eventsOn(state, day).filter((e) => e.id !== exceptEventId);
}

export function schedulePractice(ctx, bandId, day) {
  const { state } = ctx;
  const band = state.bands[bandId];
  if (!band) return { ok: false, msg: 'No such band.' };
  if (band.leaderId !== state.playerId) return { ok: false, msg: 'Only the band leader can edit the schedule.' };
  if (day <= state.day) return { ok: false, msg: 'Pick a future day.' };
  if (band.events.some((e) => e.day === day && e.status === 'scheduled')) return { ok: false, msg: 'Something is already scheduled that day.' };
  if (band.memberIds.length < 2) return { ok: false, msg: 'You need at least one other member to practice.' };
  createEvent(state, band, { type: 'practice', day, title: 'Practice' });
  const clash = playerConflicts(state, day).filter((e) => e.bandId !== bandId);
  return { ok: true, msg: clash.length ? `Scheduled, but you're also booked with another band on ${dayLabel(day)}!` : `Practice set for ${dayLabel(day, true)}.` };
}

export function cancelEvent(ctx, bandId, eventId) {
  const { state } = ctx;
  const band = state.bands[bandId];
  const e = band?.events.find((x) => x.id === eventId);
  if (!e || e.status !== 'scheduled') return { ok: false, msg: 'Nothing to cancel.' };
  if (band.leaderId !== state.playerId) return { ok: false, msg: 'Only the band leader can edit the schedule.' };
  e.status = 'cancelled';
  if (e.type === 'gig') {
    band.followers = Math.max(0, Math.round(band.followers * 0.97));
    band.engagement = Math.max(0, band.engagement - 8);
    news(state, `${band.name} dropped off a show. The promoter won't forget that.`, { bandId, tone: 'bad' });
    band.promoterGrudge = (band.promoterGrudge || 0) + 1;
  }
  return { ok: true, msg: `${e.title} cancelled.` };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
// Two days out, every member privately decides whether they can make it. The
// reliable ones speak up and ask to reschedule; the flaky ones just won't show.
export function rollAttendance(ctx, band, e) {
  const { state, rng } = ctx;
  const kind = e.type === 'recording' && e.data.overnight ? 'overnight' : e.type;
  const wd = weekday(e.day);
  for (const m of membersOf(state, band)) {
    if (m.isPlayer) { e.rolls[m.id] = 'ok'; continue; }
    let chance = availabilityChance(m, wd, kind);
    if (kind === 'gig') chance += bandEffect([m], 'gigReliability') + bandEffect(membersOf(state, band), 'gigReliability') * 0.5;
    if (rng.chance(clamp(chance, 0, 0.995))) { e.rolls[m.id] = 'ok'; continue; }
    const speaksUp = rng.chance(0.15 + m.attrs.reliability * 0.085);
    e.rolls[m.id] = speaksUp ? 'notice' : 'noshow';
  }
  e.rolled = true;
  const askers = Object.entries(e.rolls).filter(([, v]) => v === 'notice').map(([id]) => state.people[id]);
  if (!askers.length) return;
  if (e.type === 'practice' || e.type === 'recording') {
    openRescheduleThread(ctx, band, e, askers[0], askers.slice(1));
  } else {
    // Gigs don't move. They just warn.
    for (const a of askers) {
      createThread(state, {
        kind: 'bandChat', bandId: band.id, title: `${band.name}: ${shortName(a)} can't make the show`,
        from: a.id, text: `I'm so sorry, ${rng.pick(EXCUSES)}. I can't make ${e.title} on ${dayLabel(e.day)}.`,
      });
    }
  }
}

function openRescheduleThread(ctx, band, e, asker, alsoOut) {
  const { state, rng } = ctx;
  const proposed = proposeDay(state, band, e, asker);
  const lines = [];
  const t = createThread(state, {
    kind: 'reschedule',
    bandId: band.id,
    title: `${band.name}: move ${e.title.toLowerCase()} on ${dayLabel(e.day)}?`,
    from: asker.id,
    text: `Hey all, ${rng.pick(EXCUSES)}. Any chance we can move ${e.title.toLowerCase()} ${proposed != null ? `to ${DAY_NAMES_LONG[weekday(proposed)]}` : 'to later in the week'}?`,
    actions: [],
    data: { eventId: e.id, askerId: asker.id, proposed },
  });
  for (const other of alsoOut) addMessage(t, other.id, `Honestly I can't make the original day either.`, state.day);
  if (proposed != null) {
    const wd = weekday(proposed);
    for (const m of membersOf(state, band)) {
      if (m.id === asker.id || m.isPlayer) continue;
      const canDo = availabilityChance(m, wd, e.type) > 0.5;
      addMessage(t, m.id, canDo ? rng.pick([`${DAY_NAMES_LONG[wd]} works for me.`, 'I can do that.', 'Fine by me 👍']) : rng.pick([`I can't do ${DAY_NAMES_LONG[wd]}, I work.`, `${DAY_NAMES_LONG[wd]} is bad for me.`, 'Ugh, no, that day is rough for me.']), state.day);
      t.data[`can_${m.id}`] = canDo;
    }
  }
  const leaderIsPlayer = band.leaderId === state.playerId;
  if (leaderIsPlayer) {
    t.actions = [
      ...(proposed != null ? [{ id: 'move', label: `Move to ${dayLabel(proposed)}` }] : []),
      { id: 'keep', label: `Keep ${dayLabel(e.day)} (${shortName(asker)} misses it)` },
      { id: 'cancel', label: 'Cancel it' },
    ];
    t.resolved = false;
    lines.push('');
  } else {
    // NPC leader decides: move if most people can, otherwise keep.
    const leader = state.people[band.leaderId];
    const votes = membersOf(state, band).filter((m) => !m.isPlayer && m.id !== asker.id);
    const yes = votes.filter((m) => t.data[`can_${m.id}`]).length;
    const playerFree = proposed != null && !playerConflicts(state, proposed).length;
    if (proposed != null && yes >= votes.length / 2 && playerFree && !band.events.some((x) => x.day === proposed && x.status === 'scheduled')) {
      applyMove(ctx, band, e, t);
      addMessage(t, leader.id, `OK, moving it to ${dayLabel(proposed)}.`, state.day);
    } else {
      addMessage(t, leader.id, `Sorry ${shortName(asker)}, we're keeping it. Catch up next time.`, state.day);
    }
    resolveThread(t);
  }
}

function proposeDay(state, band, e, asker) {
  for (let d = e.day + 1; d <= e.day + 5; d++) {
    if (d <= state.day) continue;
    if (asker.busy.includes(weekday(d))) continue;
    if (band.events.some((x) => x.day === d && x.status === 'scheduled')) continue;
    return d;
  }
  return null;
}

function applyMove(ctx, band, e, t) {
  e.day = t.data.proposed;
  e.rolls = {};
  e.rolled = false;
  e.moved = true;
  // The requester promised they can make the new day.
  e.forceOk = [t.data.askerId];
  // People who said they can't do the new day are excused.
  e.notice = Object.keys(t.data).filter((k) => k.startsWith('can_') && !t.data[k]).map((k) => k.slice(4));
  band.events.sort((a, b) => a.day - b.day);
}

export function answerReschedule(ctx, thread, action) {
  const { state } = ctx;
  const band = state.bands[thread.bandId];
  const e = band?.events.find((x) => x.id === thread.data.eventId);
  const asker = state.people[thread.data.askerId];
  if (!e || e.status !== 'scheduled') { resolveThread(thread, 'Event no longer scheduled.'); return { ok: false, msg: 'That event is gone.' }; }
  if (action === 'move') {
    if (band.events.some((x) => x.id !== e.id && x.day === thread.data.proposed && x.status === 'scheduled')) return { ok: false, msg: 'Something else is on that day now.' };
    applyMove(ctx, band, e, thread);
    addMessage(thread, state.playerId, `Moved to ${dayLabel(e.day)}.`, state.day);
    resolveThread(thread, `Moved to ${dayLabel(e.day)}.`);
    if (asker) asker.loyalty = Math.min(100, asker.loyalty + 3);
    return { ok: true, msg: `${e.title} moved to ${dayLabel(e.day, true)}.` };
  }
  if (action === 'keep') {
    addMessage(thread, state.playerId, `We're keeping ${dayLabel(e.day)}. Sorry ${asker ? shortName(asker) : ''}.`, state.day);
    resolveThread(thread, 'Kept the original day.');
    if (asker) asker.loyalty = Math.max(0, asker.loyalty - 2);
    return { ok: true, msg: 'Kept the original day.' };
  }
  if (action === 'cancel') {
    e.status = 'cancelled';
    addMessage(thread, state.playerId, 'Let\'s just skip this one.', state.day);
    resolveThread(thread, 'Cancelled.');
    return { ok: true, msg: `${e.title} cancelled.` };
  }
  return { ok: false };
}

// Resolve who actually shows up today. Returns { present, absentNotice, noShow }.
export function resolveAttendance(ctx, band, e, playerBusy) {
  const { state } = ctx;
  if (!e.rolled) rollAttendance(ctx, band, e);
  const present = [];
  const absentNotice = [];
  const noShow = [];
  for (const m of membersOf(state, band)) {
    if (m.isPlayer) {
      (playerBusy ? noShow : present).push(m);
      continue;
    }
    if (e.forceOk?.includes(m.id)) { present.push(m); continue; }
    if (e.notice?.includes(m.id)) { absentNotice.push(m); continue; }
    const r = e.rolls[m.id];
    if (r === 'ok' || r === undefined) present.push(m);
    else if (r === 'notice') absentNotice.push(m);
    else noShow.push(m);
  }
  for (const m of present) { adjustReliability(m, 3); m.missedRecent = Math.max(0, (m.missedRecent || 0) - 0.25); }
  for (const m of absentNotice) { adjustReliability(m, -4); }
  for (const m of noShow) {
    const drop = adjustReliability(m, -40);
    m.missedRecent = (m.missedRecent || 0) + 1;
    if (!m.isPlayer) m.loyalty = Math.max(0, m.loyalty - 2);
    if (drop < 0 && !m.isPlayer) news(state, `${shortName(m)}'s reliability dropped after no-showing ${band.name}'s ${e.title.toLowerCase()}.`, { bandId: band.id, tone: 'bad' });
    if (m.isPlayer && drop < 0) news(state, `You missed ${band.name}'s ${e.title.toLowerCase()} without notice. Your reliability dropped.`, { bandId: band.id, tone: 'bad' });
  }
  return { present, absentNotice, noShow };
}

// Pay paid members for an event. Unpaid wages hurt.
export function payWages(ctx, band, present) {
  const { state } = ctx;
  let paid = 0;
  for (const m of present) {
    const rate = band.pay[m.id];
    if (!rate) continue;
    if (band.cash >= rate) {
      band.cash -= rate; paid += rate;
      band.missedPay[m.id] = 0;
    } else {
      band.missedPay[m.id] = (band.missedPay[m.id] || 0) + 1;
      m.loyalty = Math.max(0, m.loyalty - 15);
      createThread(state, {
        kind: 'dm', bandId: band.id, title: `${shortName(m)}: where's my money?`, from: m.id,
        text: band.missedPay[m.id] >= 2 ? `That's twice now I haven't been paid. I'm out unless that changes immediately.` : `Hey, the band fund couldn't cover my $${rate} today. I need that sorted.`,
      });
    }
  }
  // Player's own pay in NPC bands that pay hired members.
  if (band.playerPay && present.some((m) => m.isPlayer)) {
    state.cash += band.playerPay;
  }
  return paid;
}

// ---------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------
export function resolvePractice(ctx, band, e, playerBusy) {
  const { state } = ctx;
  const genre = GENRES[band.genre];
  const { present, absentNotice, noShow } = resolveAttendance(ctx, band, e, playerBusy);
  const total = band.memberIds.length;
  const frac = present.length / total;
  const drag = coordinationDrag(band);
  const ms = membersOf(state, band);
  const xpMult = 1 + bandEffect(ms, 'bandXp');

  // Room cost: band fund, then the leader's wallet, else a cramped apartment.
  const room = practiceRoomCost(state, band);
  let cramped = false;
  if (room > 0 && band.cash >= room) band.cash -= room;
  else if (room > 0 && band.leaderId === state.playerId && state.cash >= room) state.cash -= room;
  else if (room > 0) cramped = true;
  if (present.length < 2) {
    e.status = 'done';
    e.result = { summary: 'Practice was a bust: almost nobody showed.', present: present.map((m) => m.id), absent: [...absentNotice, ...noShow].map((m) => m.id) };
    band.morale = Math.max(0, band.morale - 4);
    return e.result;
  }
  payWages(ctx, band, present);

  const quality = cramped ? 0.5 : 1;
  const tightGain = 6.5 * genre.learnRate * frac * frac / drag * (1 - band.tightness / 105) * quality;
  band.tightness = clamp(band.tightness + tightGain, 0, 100);

  // Songwriting
  // Each new song is harder to write than the last (fresh ideas run out).
  const songRate = 0.32 / (1 + band.songs / 10) * genre.learnRate * (1 + bandEffect(ms, 'songRate')) * frac / drag * quality;
  band.songProgress += songRate;
  let newSong = false;
  if (band.songProgress >= 1) {
    band.songProgress -= 1;
    band.songs += 1;
    newSong = true;
    for (const m of present) band.known[m.id] = (band.known[m.id] || 0) + 1;
  }
  // Teaching: present members catch up on songs they don't know yet.
  const teach = 1.6 * genre.learnRate / drag * quality;
  for (const m of present) band.known[m.id] = Math.min(band.songs, (band.known[m.id] || 0) + teach);

  const raised = [];
  for (const m of present) {
    const r = grantXp(m, { skill: 3, experience: 1.5, charisma: 0.5 }, xpMult);
    if (r.length) raised.push([m, r]);
    if (!m.isPlayer) m.loyalty = Math.min(100, m.loyalty + 1);
  }
  band.lastPracticeDay = state.day;
  band.morale = clamp(band.morale + (frac === 1 ? 2 : frac < 0.7 ? -3 : 0), 0, 100);
  state.stats.practices += present.some((m) => m.isPlayer) ? 1 : 0;

  const bits = [`${present.length}/${total} showed.`];
  if (absentNotice.length) bits.push(`Excused: ${absentNotice.map(shortName).join(', ')}.`);
  if (noShow.length) bits.push(`No-show: ${noShow.map(shortName).join(', ')}.`);
  if (cramped) bits.push('No money for the room, so you crammed into an apartment.');
  if (newSong) bits.push(`New song finished! (${band.songs} total)`);
  for (const [m, r] of raised) bits.push(`${shortName(m)} improved ${r.join(', ')}.`);
  e.status = 'done';
  e.result = { summary: bits.join(' '), present: present.map((m) => m.id), absent: [...absentNotice, ...noShow].map((m) => m.id), tightGain: Math.round(tightGain * 10) / 10 };
  return e.result;
}

// ---------------------------------------------------------------------------
// Fire / quit threads
// ---------------------------------------------------------------------------
export function weeklyMemberChecks(ctx, band) {
  const { state, rng } = ctx;
  if (band.leaderId !== state.playerId) return;
  const ms = membersOf(state, band).filter((m) => !m.isPlayer);
  for (const m of ms) {
    const open = state.threads.some((t) => !t.resolved && t.data?.targetId === m.id && t.bandId === band.id);
    if (open) continue;
    if (m.attrs.reliability <= 3 && (m.missedRecent || 0) >= 3) {
      const accuser = rng.pick(ms.filter((x) => x.id !== m.id));
      if (!accuser) continue;
      createThread(state, {
        kind: 'fire', bandId: band.id,
        title: `${band.name}: "We need to talk about ${shortName(m)}"`,
        from: accuser.id,
        text: `Not trying to start drama but ${shortName(m)} has bailed on us ${Math.round(m.missedRecent)} times without saying anything. We're falling behind. Can we find someone else?`,
        actions: [{ id: 'fire', label: `Fire ${shortName(m)}` }, { id: 'keep', label: 'Give them another chance' }],
        data: { targetId: m.id, accuserId: accuser.id },
      });
    } else if (m.loyalty <= 12) {
      quitBand(ctx, band, m, 'I don\'t think this is working for me anymore. I\'m out. Good luck.');
    }
  }
}

export function quitBand(ctx, band, m, text) {
  const { state } = ctx;
  createThread(state, { kind: 'dm', bandId: band.id, title: `${shortName(m)} quit ${band.name}`, from: m.id, text });
  removeMember(ctx, band, m.id, 'quit');
  news(state, `${displayName(m)} quit ${band.name}.`, { bandId: band.id, tone: 'bad' });
}

export function playerName(state) { return player(state).first; }
export { extraEffect, payroll };
