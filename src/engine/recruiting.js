// Recruiting: the leader posts on social media, auditions trickle into the inbox.
import { INSTRUMENTS, VOCAL_LABELS, EXTRAS_BY_ID, GENRES } from './data.js?v=4';
import { generatePerson, cred, marketRate, displayName, roleLabel, extraEffect, shortName } from './people.js?v=4';
import { createBand, membersOf, bandEffect } from './band.js?v=4';
import { uid, player, createThread, resolveThread, news } from './state.js?v=4';

// Minimum band fund to credibly offer pay at a tier: ~8 events of wages.
export function payGate(state, band, level) {
  if (level === 'none') return { ok: true };
  const rate = level === 'pro' ? 180 : 45;
  const needCash = rate * 8;
  if (band.cash < needCash) return { ok: false, needCash, msg: `Offering ${level === 'pro' ? 'pro' : 'semi-pro'} pay needs about $${needCash} in the band fund (you have $${Math.round(band.cash)}).` };
  if (level === 'pro') {
    const p = player(state);
    if (band.standing < 2 && cred(p) < 45) return { ok: false, msg: 'Pros won\'t audition for a band below club level unless the leader has serious cred (45+).' };
  }
  return { ok: true };
}

export function startBand(ctx, { name, genre }) {
  const { state } = ctx;
  const band = createBand({ id: uid(state, 'b'), name, genre, leaderId: state.playerId, day: state.day });
  state.bands[band.id] = band;
  player(state).bandIds.push(band.id);
  news(state, `You started ${name} (${GENRES[genre].label}). Time to find some members.`, { bandId: band.id, tone: 'good' });
  return band;
}

/**
 * roles: [{ instrument, vocals }]
 * payLevel: 'none' | 'semipro' | 'pro'
 */
export function postRecruitment(ctx, bandId, { roles, payLevel = 'none', note = '' }) {
  const { state } = ctx;
  const band = state.bands[bandId];
  if (!band || band.leaderId !== state.playerId) return { ok: false, msg: 'Only the leader can recruit.' };
  if (!roles.length) return { ok: false, msg: 'Pick at least one role.' };
  const gate = payGate(state, band, payLevel);
  if (!gate.ok) return gate;
  band.recruiting = {
    roles: roles.map((r) => ({ ...r, filled: false })),
    payLevel,
    note,
    day: state.day,
    until: state.day + 10,
  };
  news(state, `${band.name} posted: "Looking for ${roles.map((r) => INSTRUMENTS[r.instrument].noun + (r.vocals !== 'none' && r.instrument !== 'vocals' ? ` (${VOCAL_LABELS[r.vocals].toLowerCase()})` : '')).join(', ')}."`, { bandId });
  return { ok: true, msg: 'Posted! Auditions will show up in your inbox over the next week or so.' };
}

// How attractive the band is to recruits (drives number/quality of auditions).
export function bandAppeal(state, band) {
  const p = player(state);
  return 1 + band.followers / 150 + band.standing * 0.4 + cred(p) / 60;
}

export function dailyRecruiting(ctx) {
  const { state, rng } = ctx;
  for (const band of Object.values(state.bands)) {
    const r = band.recruiting;
    if (!r || band.leaderId !== state.playerId) continue;
    if (state.day > r.until) {
      band.recruiting = null;
      news(state, `${band.name}'s recruiting post went quiet.`, { bandId: band.id });
      continue;
    }
    const open = r.roles.filter((x) => !x.filled);
    if (!open.length) { band.recruiting = null; continue; }
    const appeal = bandAppeal(state, band);
    for (const role of open) {
      // ~0.25/day per role baseline, more with appeal; genre scenes differ.
      const p = Math.min(0.75, 0.32 * appeal * (0.7 + GENRES[band.genre].diyScene * 0.3));
      if (!rng.chance(p)) continue;
      const tier = pickCandidateTier(rng, r.payLevel, band, state);
      const vocals = role.instrument === 'vocals' ? 'lead' : role.vocals !== 'none' ? role.vocals : undefined;
      const cand = generatePerson(rng, { tier, instrument: role.instrument, vocals, id: uid(state, 'p') });
      // Requested vocals are a hard requirement; otherwise allow surprises.
      if (role.vocals !== 'none' && cand.vocals === 'none') cand.vocals = role.vocals;
      cand.candidate = true;
      state.people[cand.id] = cand;
      const rate = tier === 'amateur' ? 0 : cand.rate;
      const t = createThread(state, {
        kind: 'audition',
        bandId: band.id,
        title: `Audition: ${displayName(cand)} (${roleLabel(cand)})`,
        from: cand.id,
        text: auditionPitch(rng, cand, band),
        actions: [{ id: 'accept', label: rate ? `Hire ($${rate}/event)` : 'Add to band' }, { id: 'decline', label: 'Pass' }],
        data: { personId: cand.id, roleIndex: r.roles.indexOf(role), rate },
        expires: state.day + 7,
      });
      t.data.candidate = true;
    }
  }
}

function pickCandidateTier(rng, payLevel, band, state) {
  if (payLevel === 'pro') return rng.chance(0.6) ? 'pro' : 'semipro';
  if (payLevel === 'semipro') return rng.chance(0.7) ? 'semipro' : 'amateur';
  return 'amateur';
}

function auditionPitch(rng, cand, band) {
  const lines = [];
  const opener = rng.pick([
    `Saw your post! I've been looking for a ${GENRES[band.genre].label.toLowerCase()} project.`,
    `Hey! Is the spot still open?`,
    `Yo. I can play. When can I come by?`,
    `Hi, a friend sent me your post. I'd love to try out.`,
  ]);
  lines.push(opener);
  if (cand.standout === 'skill') lines.push('I\'ve been shredding in my bedroom for years, finally want to play out.');
  if (cand.standout === 'gear') lines.push('My rig is honestly nicer than it should be.');
  if (cand.standout === 'reliable') lines.push('My schedule is wide open and I never miss stuff.');
  if (cand.standout === 'charisma') lines.push('I\'m told I\'m fun to watch on stage.');
  for (const e of cand.extras) lines.push(extraLine(e));
  if (cand.tier !== 'amateur') lines.push(`I do this professionally, so my rate is $${cand.rate} per practice or gig.`);
  if (cand.busy.length >= 3) lines.push(`Heads up: I work as a ${cand.job}, so my evenings are tight.`);
  return lines.join(' ');
}

function extraLine(id) {
  return {
    pa: 'I have a PA we can use.',
    van: 'I\'ve got a van, so hauling gear is no problem.',
    space: 'I have a practice space in my garage, totally free.',
    venueRelative: 'My uncle owns a bar and books bands sometimes.',
    studioRelative: 'My cousin runs a recording studio. Could get us a deal.',
    engineerFriend: 'My roommate is in audio school and needs projects to record.',
    promoter: 'I know a couple of promoters around town.',
    influencer: 'I have a decent following online, I could hype stuff.',
    designer: 'I do graphic design, so flyers and merch are covered.',
    mentor: 'My sister tours with her band, she gives great advice.',
    songwriter: 'I have like forty riffs saved on my phone.',
    cash: 'I have some savings and can chip in for band stuff.',
  }[id] || EXTRAS_BY_ID[id]?.detail || '';
}

export function acceptCandidate(ctx, thread) {
  const { state, rng } = ctx;
  const band = state.bands[thread.bandId];
  const cand = state.people[thread.data.personId];
  if (!band || !cand) return { ok: false, msg: 'They\'re gone.' };
  const rate = thread.data.rate || 0;
  if (rate && band.cash < rate * 2) return { ok: false, msg: `The band fund can't cover ${shortName(cand)}'s rate right now.` };
  addMember(ctx, band, cand, rate);
  const role = band.recruiting?.roles[thread.data.roleIndex];
  if (role) role.filled = true;
  resolveThread(thread, `${shortName(cand)} joined ${band.name}.`);
  // Other pending auditions for the same role are now moot (but stay readable).
  return { ok: true, msg: `${displayName(cand)} joined ${band.name}!` };
}

export function addMember(ctx, band, person, rate = 0) {
  const { state } = ctx;
  person.candidate = false;
  band.memberIds.push(person.id);
  band.known[person.id] = 0;
  if (rate) band.pay[person.id] = rate;
  person.bandIds.push(band.id);
  const f = extraEffect(person, 'followers');
  if (f) { band.followers += f; band.growth.recruits += f; }
  const c = extraEffect(person, 'bandCash');
  if (c) band.cash += c;
  // A new face resets some of the band's lock-in. Bigger bands feel it more.
  band.tightness = Math.max(0, band.tightness * (0.82 - 0.02 * Math.max(0, band.memberIds.length - 3)));
  band.log.push({ day: state.day, text: `${shortName(person)} joined (${roleLabel(person)}).` });
  news(state, `${displayName(person)} joined ${band.name}.`, { bandId: band.id, tone: 'good' });
}

export function declineCandidate(ctx, thread) {
  const cand = ctx.state.people[thread.data.personId];
  resolveThread(thread, 'Passed.');
  if (cand && cand.candidate) delete ctx.state.people[cand.id];
  return { ok: true };
}

export function removeMember(ctx, band, personId, reason = 'left') {
  const { state } = ctx;
  const p = state.people[personId];
  band.memberIds = band.memberIds.filter((id) => id !== personId);
  delete band.pay[personId];
  delete band.known[personId];
  delete band.missedPay[personId];
  if (p) p.bandIds = p.bandIds.filter((id) => id !== band.id);
  // Remove from future events
  for (const e of band.events) if (e.status === 'scheduled') e.notice = (e.notice || []).filter((x) => x !== personId);
  band.tightness *= 0.9;
  band.log.push({ day: state.day, text: `${p ? shortName(p) : 'A member'} ${reason}.` });
}

export function bandStrengthSummary(state, band) {
  const ms = membersOf(state, band);
  return {
    hasPA: ms.some((m) => m.gear.some((g) => g.startsWith('pa-'))),
    freePractice: bandEffect(ms, 'freePractice'),
  };
}
