// Leaders of bands the player joined: they run the calendar, book shows
// (after asking you), record and post. The player can't edit their schedule.
import { membersOf, bestRecording } from './band.js?v=4';
import { availabilityChance, shortName, cred, marketRate } from './people.js?v=4';
import { createEvent, eventsOn, cancelScheduled } from './schedule.js?v=4';
import { weeklyOffers, bookingCheck } from './gigs.js?v=4';
import { bookRecording, releaseRecording } from './studio.js?v=4';
import { socialPost } from './social.js?v=4';
import { weekday, news, dayLabel, createThread, addMessage, resolveThread } from './state.js?v=4';
import { VENUE_TIERS } from './data.js?v=4';

export function npcWeekly(ctx, band) {
  planPractices(ctx, band);
  npcBookAndRecord(ctx, band);
}

// Practices: two evenings a week that suit the most members, planned two
// weeks ahead so members can see them coming (and ask to move them).
// Days a band is holding open: shows waiting on your answer, and practice
// days still being discussed.
function heldDays(state, band) {
  const open = state.threads.filter((t) => !t.resolved && t.bandId === band.id);
  return [
    ...open.filter((t) => t.kind === 'gigProposal').map((t) => t.data.offer.day),
    ...open.filter((t) => t.kind === 'practiceProposal').flatMap((t) => t.data.days.filter((x) => x.status === 'pending').map((x) => x.day)),
  ];
}

function dayFree(state, band, d, extraBlocked = []) {
  return d > state.day && !band.events.some((e) => e.day === d && e.status === 'scheduled') && !heldDays(state, band).includes(d) && !extraBlocked.includes(d);
}

function dayFit(state, band, d) {
  return membersOf(state, band).reduce((s, m) => s + availabilityChance(m, weekday(d)), 0);
}

// Two evenings a week that suit the most members (your work nights count
// against a day), proposed to you two weeks ahead. Nothing is booked until you
// answer, or the deadline passes with no answer.
export function planPractices(ctx, band) {
  const { state, rng } = ctx;
  const picks = [];
  // Calendar weeks: the rest of this week, and next week (Mon-Sun).
  const endOfWeek = state.day + (6 - weekday(state.day));
  for (const [from, to] of [[state.day + 1, endOfWeek], [endOfWeek + 1, endOfWeek + 7]]) {
    const inWindow = (d) => d >= from && d <= to;
    const have = band.events.filter((e) => e.type === 'practice' && e.status === 'scheduled' && inWindow(e.day)).length
      + heldDays(state, band).filter(inWindow).length;
    if (have >= 2) continue;
    const scores = [];
    for (let d = from; d <= to; d++) {
      if (!dayFree(state, band, d, picks)) continue;
      scores.push({ d, fit: dayFit(state, band, d) + rng.float(0, 0.4) });
    }
    scores.sort((a, b) => b.fit - a.fit);
    picks.push(...scores.slice(0, 2 - have).map((x) => x.d));
  }
  if (picks.length) proposePractices(ctx, band, picks.sort((a, b) => a - b));
}

function practiceActions(t) {
  const pending = t.data.days.filter((x) => x.status === 'pending');
  if (!pending.length) return [];
  return [
    { id: 'all', label: pending.length > 1 ? 'All good, book them' : `${dayLabel(pending[0].day)} works` },
    ...pending.map((x) => ({ id: `no:${x.day}`, label: `Can't do ${dayLabel(x.day)}` })),
  ];
}

function dayWarnings(state, band, d) {
  const out = [];
  const clash = eventsOn(state, d).filter((e) => e.bandId !== band.id);
  if (clash.length) out.push(`you're booked with ${clash.map((e) => state.bands[e.bandId]?.name).join(', ')}`);
  if ((state.people[state.playerId].busy || []).includes(weekday(d))) out.push('it\'s one of your work nights');
  return out.length ? `⚠ ${dayLabel(d)}: ${out.join(' and ')}.` : null;
}

export function proposePractices(ctx, band, days) {
  const { state, rng } = ctx;
  const leader = state.people[band.leaderId];
  const t = createThread(state, {
    kind: 'practiceProposal',
    bandId: band.id,
    title: `${band.name}: practice ${days.map((d) => dayLabel(d)).join(' & ')}?`,
    from: leader.id,
    text: `Thinking practice on ${days.map((d) => dayLabel(d, true)).join(' and ')}. Everyone good?`,
    data: { days: days.map((day) => ({ day, status: 'pending' })), declined: [] },
    // Answer before the first one, or within a few days.
    expires: Math.max(state.day + 1, Math.min(state.day + 3, days[0] - 1)),
  });
  const others = membersOf(state, band).filter((m) => !m.isPlayer && m.id !== leader.id);
  for (const m of rng.shuffle(others).slice(0, 2)) addMessage(t, m.id, rng.pick(['Works for me.', 'I\'m in 👍', 'Should be fine.', 'Yep.']), state.day);
  for (const d of days) { const w = dayWarnings(state, band, d); if (w) addMessage(t, null, w, state.day); }
  t.actions = practiceActions(t);
  t.resolved = false;
  return t;
}

function bookPending(state, band, t) {
  const booked = [];
  const lost = [];
  for (const x of t.data.days.filter((y) => y.status === 'pending')) {
    if (x.day > state.day && !band.events.some((e) => e.day === x.day && e.status === 'scheduled')) {
      createEvent(state, band, { type: 'practice', day: x.day, title: 'Practice' });
      x.status = 'booked';
      booked.push(x.day);
    } else { x.status = 'lost'; lost.push(x.day); }
  }
  return { booked, lost };
}

export function answerPracticeProposal(ctx, t, action) {
  const { state } = ctx;
  const band = state.bands[t.bandId];
  if (!band) { resolveThread(t); return { ok: false, msg: 'You\'re not in that band anymore.' }; }
  const leader = state.people[band.leaderId];
  if (action === 'all') {
    addMessage(t, state.playerId, 'Works for me!', state.day);
    const { booked, lost } = bookPending(state, band, t);
    addMessage(t, leader.id, booked.length ? `Booked: ${booked.map((d) => dayLabel(d)).join(', ')}.${lost.length ? ` (${lost.map((d) => dayLabel(d)).join(', ')} got taken.)` : ''}` : 'Ah, those days got taken. I\'ll try again next week.', state.day);
    t.actions = [];
    resolveThread(t, booked.length ? `Booked ${booked.map((d) => dayLabel(d)).join(', ')}.` : 'Nothing booked.');
    return { ok: true, msg: booked.length ? `${band.name}: practice booked for ${booked.map((d) => dayLabel(d, true)).join(' and ')}.` : 'Those days got taken.' };
  }
  if (action.startsWith('no:')) {
    const day = Number(action.slice(3));
    const x = t.data.days.find((y) => y.day === day && y.status === 'pending');
    if (!x) return { ok: false, msg: 'Already settled.' };
    x.status = 'declined';
    t.data.declined.push(day);
    addMessage(t, state.playerId, `I can't do ${dayLabel(day)}, sorry.`, state.day);
    // Offer the best nearby evening that works for you and isn't taken.
    const me = state.people[state.playerId];
    const options = [];
    for (let d = day - 2; d <= day + 4; d++) {
      if (d === day || t.data.declined.includes(d) || (me.busy || []).includes(weekday(d))) continue;
      if (t.data.days.some((y) => y.day === d && y.status === 'pending')) continue;
      if (!dayFree(state, band, d) || eventsOn(state, d).length) continue;
      options.push({ d, fit: dayFit(state, band, d) });
    }
    options.sort((a, b) => b.fit - a.fit);
    if (options[0]) {
      t.data.days.push({ day: options[0].d, status: 'pending' });
      t.data.days.sort((a, b) => a.day - b.day);
      addMessage(t, leader.id, `No problem. How about ${dayLabel(options[0].d, true)} instead?`, state.day);
    } else {
      addMessage(t, leader.id, `OK, we'll skip that one.`, state.day);
    }
    t.actions = practiceActions(t);
    if (!t.actions.length) {
      const booked = t.data.days.filter((y) => y.status === 'booked');
      resolveThread(t, booked.length ? `Booked ${booked.map((y) => dayLabel(y.day)).join(', ')}.` : 'No practices booked.');
    }
    return { ok: true, msg: options[0] ? `${shortName(leader)} suggested ${dayLabel(options[0].d, true)} instead.` : 'They\'ll skip that one.' };
  }
  return { ok: false };
}

// No answer by the deadline: silence counts as a yes.
export function expirePracticeProposal(ctx, t) {
  const { state } = ctx;
  const band = state.bands[t.bandId];
  if (!band) { resolveThread(t); return; }
  const { booked } = bookPending(state, band, t);
  addMessage(t, band.leaderId, booked.length ? `Didn't hear from you, so we're going ahead: ${booked.map((d) => dayLabel(d)).join(', ')}.` : 'Never mind, those days got taken.', state.day);
  t.actions = [];
  resolveThread(t, booked.length ? `No answer, so they booked ${booked.map((d) => dayLabel(d)).join(', ')}.` : 'Nothing booked.');
}

function npcBookAndRecord(ctx, band) {
  const { state, rng } = ctx;
  // Shows: take the best offer the band qualifies for.
  weeklyOffers(ctx, band);
  const ok = band.offers.filter((o) => o.expires > state.day && o.day > state.day && bookingCheck(band, o.tier).ok && !band.events.some((e) => e.day === o.day && e.status === 'scheduled') && !heldDays(state, band).includes(o.day));
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
  if ((state.people[state.playerId].busy || []).includes(weekday(o.day))) addMessage(t, null, '⚠ That\'s one of your work nights. Playing means skipping that shift\'s pay.', state.day);
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

// ---------------------------------------------------------------------------
// Asking your band leader for a raise. They weigh what you bring (cred vs.
// the rest of the band), whether you show up, what you're asking for, and
// whether the band can afford it.
// ---------------------------------------------------------------------------
export const RAISE_COOLDOWN = 21;

export function raiseOutlook(state, band) {
  const p = state.people[state.playerId];
  const others = membersOf(state, band).filter((m) => !m.isPlayer);
  const bandAvg = others.reduce((s, m) => s + cred(m), 0) / Math.max(1, others.length);
  return {
    current: band.playerPay || 0,
    market: marketRate(p),
    worth: cred(p) / Math.max(1, bandAvg),
    nextAskDay: band.raiseAskDay != null ? band.raiseAskDay + RAISE_COOLDOWN : null,
  };
}

export function askForRaise(ctx, bandId, amount) {
  const { state, rng } = ctx;
  const band = state.bands[bandId];
  if (!band || band.leaderId === state.playerId || !band.memberIds.includes(state.playerId)) return { ok: false, msg: 'You can only ask in a band someone else leads.' };
  const p = state.people[state.playerId];
  const leader = state.people[band.leaderId];
  const o = raiseOutlook(state, band);
  amount = Math.round(Number(amount) || 0);
  if (amount <= o.current) return { ok: false, msg: `Ask for more than your current $${o.current}.` };
  if (o.nextAskDay != null && state.day < o.nextAskDay) return { ok: false, msg: `You asked recently. Give it until ${dayLabel(o.nextAskDay, true)}.` };
  band.raiseAskDay = state.day;

  const missed = p.missedRecent || 0;
  const affordable = band.cash >= amount * 6 || band.standing >= 2;
  const fair = Math.max(o.market, o.current, 15);
  const greed = Math.max(0, (amount - fair) / Math.max(o.market, 20));
  let score = 0.35 + (o.worth - 1) * 1.5 + (p.attrs.reliability - 5) * 0.05 - missed * 0.15 - greed * 0.6 + (affordable ? 0.1 : -0.35);
  if (o.market === 0 && o.current === 0) score -= 0.25; // amateur bands rarely pay anyone
  score += rng.float(-0.1, 0.1);

  const good = [];
  const bad = [];
  if (o.worth > 1.15) good.push('you\'re honestly carrying a lot of the set');
  if (p.attrs.reliability >= 7 && missed < 1) good.push('you always show up');
  if (missed >= 2) bad.push(`you've missed ${Math.round(missed)} things lately`);
  if (!affordable) bad.push('money\'s really tight right now');
  if (greed > 0.6) bad.push(`$${amount} is way more than the going rate`);
  if (o.market === 0 && o.current === 0) bad.push('none of us really get paid yet');
  if (o.worth < 0.85) bad.push('you\'re still catching up to the rest of us');

  const t = createThread(state, {
    kind: 'raiseAsk', bandId: band.id,
    title: `${band.name}: you asked for a raise`,
    from: state.playerId,
    text: `Hey ${shortName(leader)}, can we talk about pay? I'd like $${amount} per practice/gig${o.current ? ` (up from $${o.current})` : ''}.`,
  });
  t.unread = false;
  if (score >= 0.6) {
    band.playerPay = amount;
    addMessage(t, leader.id, `Yeah, that's fair${good.length ? `, ${good[0]}` : ''}. $${amount} it is.`, state.day);
    resolveThread(t, `Raise approved: $${amount}/event.`);
    news(state, `${band.name} now pays you $${amount} per practice/gig.`, { bandId: band.id, tone: 'good' });
    return { ok: true, msg: `✓ ${shortName(leader)} said yes: $${amount} per practice/gig.` };
  }
  if (score >= 0.25) {
    const counter = Math.max(o.current + 5, Math.round((o.current + (amount - o.current) / 2) / 5) * 5);
    addMessage(t, leader.id, `I can't do $${amount}${bad.length ? `, ${bad[0]}` : ''}. Could do $${counter} though?`, state.day);
    t.data = { counter };
    t.actions = [{ id: 'accept', label: `Take $${counter}` }, { id: 'decline', label: 'No thanks' }];
    t.resolved = false;
    t.expires = state.day + 3;
    return { ok: true, msg: `${shortName(leader)} counter-offered $${counter}. Check your inbox.` };
  }
  addMessage(t, leader.id, `Sorry, I can't right now${bad.length ? `: ${bad.join(', and ')}` : ''}. Ask me again in a few weeks.`, state.day);
  resolveThread(t, 'They said no.');
  return { ok: true, msg: `${shortName(leader)} said no for now.` };
}

export function answerRaiseAsk(ctx, t, action) {
  const { state } = ctx;
  const band = state.bands[t.bandId];
  if (!band) { resolveThread(t); return { ok: false, msg: 'You\'re not in that band anymore.' }; }
  if (action === 'accept') {
    band.playerPay = t.data.counter;
    addMessage(t, state.playerId, `Deal, $${t.data.counter} works.`, state.day);
    resolveThread(t, `Now paid $${t.data.counter}/event.`);
    return { ok: true, msg: `✓ ${band.name} now pays you $${t.data.counter} per practice/gig.` };
  }
  addMessage(t, state.playerId, 'I\'ll pass for now. Thanks anyway.', state.day);
  resolveThread(t, 'You turned down the counter-offer.');
  return { ok: true, msg: 'Kept your current pay.' };
}
