// Money, gear, pay requests and personal actions.
import { GEAR_BY_ID } from './data.js';
import { tierFor, marketRate, shortName, displayName, TIER_LABELS, grantXp, cred } from './people.js';
import { membersOf } from './band.js';
import { player, createThread, resolveThread, news, addMessage, playerBands } from './state.js';
import { removeMember } from './recruiting.js';

export const WEEKLY_JOB_PAY = 70;
export const SELL_BACK = 0.5;

export function buyGear(ctx, catalogId) {
  const { state } = ctx;
  const item = GEAR_BY_ID[catalogId];
  if (!item) return { ok: false, msg: 'Unknown item.' };
  if (state.cash < item.price) return { ok: false, msg: `You need $${item.price}; you have $${Math.round(state.cash)}.` };
  state.cash -= item.price;
  player(state).gear.push(item.id);
  return { ok: true, msg: `Bought ${item.name}.` };
}

export function sellGear(ctx, index) {
  const { state } = ctx;
  const p = player(state);
  const id = p.gear[index];
  const item = GEAR_BY_ID[id];
  if (!item) return { ok: false, msg: 'Nothing there.' };
  p.gear.splice(index, 1);
  const value = Math.round(item.price * SELL_BACK);
  state.cash += value;
  return { ok: true, msg: `Sold ${item.name} for $${value}.` };
}

export function fundBand(ctx, bandId, amount) {
  const { state } = ctx;
  const band = state.bands[bandId];
  amount = Math.floor(amount);
  if (!band || amount <= 0) return { ok: false, msg: 'Enter an amount.' };
  if (state.cash < amount) return { ok: false, msg: 'You don\'t have that much.' };
  state.cash -= amount;
  band.cash += amount;
  return { ok: true, msg: `Put $${amount} into ${band.name}'s fund.` };
}

// Split money from the band fund among unpaid members (paid members already
// get their rate). The player's share goes to their wallet.
export function payout(ctx, bandId, amount) {
  const { state } = ctx;
  const band = state.bands[bandId];
  amount = Math.floor(amount);
  if (!band || band.leaderId !== state.playerId) return { ok: false, msg: 'Only the leader can pay out.' };
  if (amount <= 0 || amount > band.cash) return { ok: false, msg: 'Not enough in the band fund.' };
  const shareholders = membersOf(state, band).filter((m) => !band.pay[m.id]);
  const share = Math.floor(amount / shareholders.length);
  band.cash -= share * shareholders.length;
  for (const m of shareholders) {
    if (m.isPlayer) state.cash += share;
    else m.loyalty = Math.min(100, m.loyalty + Math.min(15, share / 10));
  }
  band.morale = Math.min(100, band.morale + Math.min(10, share / 15));
  return { ok: true, msg: `Paid out $${share} each to ${shareholders.length} members. You pocketed $${share}.` };
}

export function woodshed(ctx) {
  const { state } = ctx;
  if (state.flags.woodshedDay === state.day) return { ok: false, msg: 'You already practiced alone today. Your fingers hurt.' };
  state.flags.woodshedDay = state.day;
  const raised = grantXp(player(state), { skill: 2.5 });
  return { ok: true, msg: raised.length ? `Hours of scales paid off: skill is now ${player(state).attrs.skill}!` : 'You practiced alone for a few hours. (+skill XP)' };
}

// ---------------------------------------------------------------------------
// Tier changes -> pay requests
// ---------------------------------------------------------------------------
const PAY_REASONS = [
  'Another band offered to pay me to fill in, and honestly I need the money.',
  'I\'ve gotten a lot better and I\'m getting calls for paid session work now.',
  'My rent went up and I can\'t keep doing this for free.',
  'I\'m putting in a ton of hours and gear money. I think I\'ve earned a rate.',
  'A wedding band wants me on weekends. I\'d rather stay, but I need to get paid.',
];

export function checkTierChanges(ctx) {
  const { state, rng } = ctx;
  for (const p of Object.values(state.people)) {
    if (p.candidate) continue;
    const t = tierFor(p);
    if (t === p.tier) continue;
    const rising = ['amateur', 'semipro', 'pro'].indexOf(t) > ['amateur', 'semipro', 'pro'].indexOf(p.tier);
    p.tier = t;
    p.rate = marketRate(p);
    if (p.isPlayer) {
      if (rising) news(state, `You're now ${TIER_LABELS[t]}! Better bands will take your applications, and you can ask for pay.`, { tone: 'good' });
      continue;
    }
    if (!rising) continue;
    for (const bandId of p.bandIds) {
      const band = state.bands[bandId];
      if (!band || band.leaderId !== state.playerId) continue;
      if ((band.pay[p.id] || 0) >= p.rate) continue;
      createThread(state, {
        kind: 'payRequest', bandId,
        title: `${shortName(p)} wants to get paid`,
        from: p.id,
        text: `Hey, can we talk? ${rng.pick(PAY_REASONS)} I'm ${TIER_LABELS[t].toLowerCase()} now. I need $${p.rate} per practice/gig to keep playing with ${band.name}.`,
        actions: [
          { id: 'pay', label: `Pay $${p.rate}/event` },
          { id: 'counter', label: `Counter at $${Math.round(p.rate / 2)}` },
          { id: 'release', label: 'Let them go' },
        ],
        data: { personId: p.id, rate: p.rate, targetId: p.id },
        expires: state.day + 7,
      });
    }
  }
}

export function answerPayRequest(ctx, thread, action) {
  const { state, rng } = ctx;
  const band = state.bands[thread.bandId];
  const m = state.people[thread.data.personId];
  if (!band || !m || !band.memberIds.includes(m.id)) { resolveThread(thread); return { ok: false, msg: 'They\'re no longer in the band.' }; }
  if (action === 'pay') {
    band.pay[m.id] = thread.data.rate;
    m.loyalty = Math.min(100, m.loyalty + 10);
    addMessage(thread, state.playerId, `Deal. $${thread.data.rate} per event.`, state.day);
    resolveThread(thread, `Now paying ${shortName(m)} $${thread.data.rate}/event.`);
    return { ok: true, msg: `${shortName(m)} is now on the payroll.` };
  }
  if (action === 'counter') {
    const half = Math.round(thread.data.rate / 2);
    const accept = rng.chance(0.15 + m.loyalty / 130);
    if (accept) {
      band.pay[m.id] = half;
      m.loyalty = Math.max(0, m.loyalty - 5);
      addMessage(thread, m.id, `...fine. $${half}. But I'm not doing this forever.`, state.day);
      resolveThread(thread, `${shortName(m)} took $${half}/event.`);
      return { ok: true, msg: `${shortName(m)} grudgingly accepted $${half}.` };
    }
    addMessage(thread, m.id, `Sorry, I can't do it for that. Good luck with everything.`, state.day);
    removeMember(ctx, band, m.id, 'left over pay');
    resolveThread(thread, `${shortName(m)} left.`);
    return { ok: true, msg: `${shortName(m)} left the band. You'll need a replacement.` };
  }
  if (action === 'release') {
    addMessage(thread, state.playerId, 'I get it. We can\'t afford that right now. Thanks for everything.', state.day);
    removeMember(ctx, band, m.id, 'left to get paid elsewhere');
    resolveThread(thread, `${shortName(m)} left.`);
    return { ok: true, msg: `${shortName(m)} moved on.` };
  }
  return { ok: false };
}

export function answerFireRequest(ctx, thread, action) {
  const { state } = ctx;
  const band = state.bands[thread.bandId];
  const m = state.people[thread.data.targetId];
  if (!band || !m || !band.memberIds.includes(m.id)) { resolveThread(thread); return { ok: false, msg: 'Already gone.' }; }
  if (action === 'fire') {
    removeMember(ctx, band, m.id, 'was fired');
    for (const o of membersOf(state, band)) if (!o.isPlayer) o.loyalty = Math.min(100, o.loyalty + 4);
    addMessage(thread, state.playerId, `You're right. I'll talk to ${shortName(m)}.`, state.day);
    resolveThread(thread, `${shortName(m)} was fired.`);
    news(state, `You fired ${displayName(m)} from ${band.name}.`, { bandId: band.id });
    return { ok: true, msg: `${shortName(m)} is out. Post for a replacement.` };
  }
  m.missedRecent = 0;
  band.morale = Math.max(0, band.morale - 8);
  for (const o of membersOf(state, band)) if (!o.isPlayer && o.id !== m.id) o.loyalty = Math.max(0, o.loyalty - 4);
  addMessage(thread, state.playerId, `Let's give ${shortName(m)} one more shot.`, state.day);
  resolveThread(thread, 'Kept them. The band isn\'t thrilled.');
  return { ok: true, msg: 'The band grumbles, but goes along with it.' };
}

export function fireMember(ctx, bandId, personId) {
  const { state } = ctx;
  const band = state.bands[bandId];
  if (!band || band.leaderId !== state.playerId || personId === state.playerId) return { ok: false, msg: 'Can\'t do that.' };
  const m = state.people[personId];
  removeMember(ctx, band, personId, 'was fired');
  band.morale = Math.max(0, band.morale - 5);
  return { ok: true, msg: `${m ? shortName(m) : 'They'} got the boot.` };
}

export function leaveBand(ctx, bandId) {
  const { state } = ctx;
  const band = state.bands[bandId];
  if (!band) return { ok: false };
  if (band.leaderId === state.playerId) {
    // Disbanding a band you lead.
    for (const id of band.memberIds) {
      const p = state.people[id];
      if (p) p.bandIds = p.bandIds.filter((b) => b !== bandId);
    }
    delete state.bands[bandId];
    news(state, `${band.name} broke up.`, { tone: 'bad' });
    return { ok: true, msg: `${band.name} is no more.` };
  }
  removeMember(ctx, band, state.playerId, 'left');
  // NPC band continues without you: fold it back into the scene.
  const sb = state.scene.find((s) => s.id === band.sceneId);
  if (sb) { sb.joined = false; sb.followers = band.followers; }
  delete state.bands[bandId];
  return { ok: true, msg: `You left ${band.name}.` };
}

export function weeklyIncome(ctx) {
  const { state } = ctx;
  // Fewer shifts the more bands you're in.
  const bands = playerBands(state).length;
  const pay = Math.round(WEEKLY_JOB_PAY * Math.max(0.5, 1 - 0.15 * Math.max(0, bands - 1)));
  state.cash += pay;
  return pay;
}

export { cred };
