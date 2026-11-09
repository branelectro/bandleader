// The local scene: other bands that share bills with you, and bands that are
// looking for members (which is how the player joins someone else's band).
import { GENRE_IDS, GENRES, INSTRUMENTS } from './data.js?v=3';
import { generateBandName, createBand, lineupCheck } from './band.js?v=3';
import { generatePerson, cred, tierFor, displayName, roleLabel } from './people.js?v=3';
import { uid, player, news, createThread } from './state.js?v=3';

export function seedScene(ctx, count = 46) {
  const { state, rng } = ctx;
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let name = generateBandName(rng);
    let guard = 10;
    while (used.has(name) && guard--) name = generateBandName(rng);
    used.add(name);
    // Long-tailed followers: most bands are tiny.
    const r = rng.next();
    const followers = Math.round(r < 0.45 ? rng.int(0, 30) : r < 0.75 ? rng.int(30, 120) : r < 0.92 ? rng.int(120, 600) : rng.int(600, 4000));
    state.scene.push({
      id: uid(state, 's'),
      name,
      genre: rng.pick(GENRE_IDS),
      followers,
      tier: followers < 30 ? 0 : followers < 180 ? 1 : followers < 700 ? 2 : followers < 2500 ? 3 : 4,
      growth: rng.float(0.0, 0.035),
    });
  }
}

export function weeklySceneTick(ctx) {
  const { state, rng } = ctx;
  for (const b of state.scene) {
    b.followers = Math.max(0, Math.round(b.followers * (1 + b.growth + rng.float(-0.01, 0.01)) + rng.int(0, 2)));
    b.tier = b.followers < 30 ? 0 : b.followers < 180 ? 1 : b.followers < 700 ? 2 : b.followers < 2500 ? 3 : 4;
  }
  // Occasionally a new band forms, an old one breaks up.
  if (rng.chance(0.4)) {
    state.scene.push({ id: uid(state, 's'), name: generateBandName(rng), genre: rng.pick(GENRE_IDS), followers: rng.int(0, 15), tier: 0, growth: rng.float(0.0, 0.05) });
  }
  if (state.scene.length > 60) state.scene.splice(rng.int(0, state.scene.length - 1), 1);
  refreshOpenings(ctx);
}

// Bills: pick scene bands near a tier for a show.
export function billFor(ctx, tier, n) {
  const { state, rng } = ctx;
  const near = state.scene.filter((b) => Math.abs(b.tier - tier) <= (tier === 0 ? 0 : 1) || (tier === 0 && b.tier === 1 && rng.chance(0.2)));
  const pool = near.length >= n ? near : state.scene;
  return rng.shuffle(pool).slice(0, n).map((b) => ({ sceneId: b.id, name: b.name, genre: b.genre, followers: b.followers }));
}

// ---------------------------------------------------------------------------
// Openings: scene bands looking for a member. The player answers these to join.
// ---------------------------------------------------------------------------
export function refreshOpenings(ctx) {
  const { state, rng } = ctx;
  state.openings = state.openings.filter((o) => o.expires > state.day && !o.taken);
  const want = 6 - state.openings.length;
  const p = player(state);
  for (let i = 0; i < want; i++) {
    const sb = rng.pick(state.scene.filter((b) => !b.joined));
    if (!sb) break;
    // Bias openings toward the player's instrument so the board is useful.
    const instrument = rng.chance(0.55) ? p.instrument : rng.pick(Object.keys(INSTRUMENTS));
    const minCred = Math.round(12 + sb.tier * 14 + rng.int(-4, 6));
    state.openings.push({
      id: uid(state, 'o'),
      sceneId: sb.id,
      instrument,
      vocals: rng.chance(0.25) ? 'backing' : 'none',
      minCred,
      pays: sb.tier >= 2 ? Math.round((20 + sb.tier * 25) / 5) * 5 : 0,
      expires: state.day + rng.int(7, 18),
      taken: false,
      blurb: rng.pick([
        'Our last one moved to Portland.', 'Need someone who actually shows up.', 'Shows lined up, need to fill the spot ASAP.',
        'Looking for someone serious but not too serious.', 'Must be cool with loud.', 'We practice twice a week, no flakes.',
      ]),
    });
  }
}

export function applyToOpening(ctx, openingId) {
  const { state } = ctx;
  const o = state.openings.find((x) => x.id === openingId);
  if (!o || o.taken || o.applied) return { ok: false, msg: 'That opening is gone.' };
  const p = player(state);
  if (p.instrument !== o.instrument && !(o.instrument === 'vocals' && p.vocals !== 'none')) {
    return { ok: false, msg: `They need ${INSTRUMENTS[o.instrument].noun}.` };
  }
  o.applied = true;
  o.replyDay = state.day + ctx.rng.int(1, 3);
  return { ok: true, msg: 'Application sent. Expect a reply in a few days.' };
}

export function processOpeningReplies(ctx) {
  const { state, rng } = ctx;
  const p = player(state);
  for (const o of state.openings) {
    if (!o.applied || o.replied || o.replyDay > state.day) continue;
    o.replied = true;
    const sb = state.scene.find((b) => b.id === o.sceneId);
    if (!sb) continue;
    const c = cred(p);
    const chance = Math.max(0.03, Math.min(0.95, 0.5 + (c - o.minCred) * 0.06));
    if (rng.chance(chance)) {
      createThread(state, {
        kind: 'joinOffer',
        title: `${sb.name} want you in`,
        from: null,
        text: `Hey, it's ${sb.name}. We liked your audition. Want the spot?${o.pays ? ` We pay $${o.pays} per practice/gig.` : ''}`,
        actions: [{ id: 'accept', label: 'Join the band' }, { id: 'decline', label: 'Pass' }],
        data: { openingId: o.id, sceneId: sb.id },
        expires: state.day + 5,
      });
    } else {
      createThread(state, {
        kind: 'note',
        title: `${sb.name} went another way`,
        text: c < o.minCred ? `Thanks for trying out. Honestly we need someone a bit further along (they wanted about ${o.minCred} cred, you're at ${c}).` : 'Thanks for coming by! We went with someone else, but good luck.',
      });
    }
  }
}

// Turn a scene band into a fully simulated band the player belongs to.
export function joinSceneBand(ctx, openingId) {
  const { state, rng } = ctx;
  const o = state.openings.find((x) => x.id === openingId);
  const sb = o && state.scene.find((b) => b.id === o.sceneId);
  if (!sb) return null;
  const p = player(state);
  const genre = GENRES[sb.genre];
  const memberTier = sb.tier >= 3 ? 'pro' : sb.tier >= 2 ? 'semipro' : 'amateur';
  const leader = generatePerson(rng, { tier: memberTier, id: uid(state, 'p') });
  state.people[leader.id] = leader;

  const band = createBand({ id: uid(state, 'b'), name: sb.name, genre: sb.genre, leaderId: leader.id, day: state.day });
  band.npc = true;
  band.followers = sb.followers;
  band.standing = Math.min(sb.tier, 4);
  band.engagement = rng.int(30, 60);
  band.songs = 4 + sb.tier * 2 + rng.int(0, 3);
  band.tightness = 35 + sb.tier * 10 + rng.int(0, 10);
  band.cash = rng.int(20, 120) * (sb.tier + 1);
  band.known[leader.id] = band.songs;
  leader.bandIds.push(band.id);

  // Fill a valid lineup around the player.
  const needed = targetLineup(rng, sb.genre, o.instrument, leader.instrument);
  for (const inst of needed) {
    const m = generatePerson(rng, { tier: memberTier, instrument: inst, id: uid(state, 'p') });
    state.people[m.id] = m;
    band.memberIds.push(m.id);
    band.known[m.id] = band.songs;
    m.bandIds.push(band.id);
  }
  band.memberIds.push(p.id);
  band.known[p.id] = 0;
  p.bandIds.push(band.id);
  if (o.pays) band.playerPay = o.pays;
  // make sure someone sings
  const ms = band.memberIds.map((id) => state.people[id]);
  if (!lineupCheck(band, ms).ok) {
    const singer = ms.find((m) => !m.isPlayer && m.instrument !== 'drums') || ms.find((m) => !m.isPlayer);
    if (singer) singer.vocals = 'lead';
  }
  sb.joined = true;
  o.taken = true;
  band.sceneId = sb.id;
  band.log.push({ day: state.day, text: `${p.first} joined on ${INSTRUMENTS[p.instrument].label.toLowerCase()}.` });
  news(state, `You joined ${band.name} (${genre.label}). ${displayName(leader)} runs the schedule.`, { bandId: band.id, tone: 'good' });
  return band;
}

// Instruments needed (besides leader and player) to make a valid lineup.
function targetLineup(rng, genreId, playerInst, leaderInst) {
  const genre = GENRES[genreId];
  const have = [playerInst, leaderInst];
  const out = [];
  const need = (inst) => { if (!have.includes(inst)) { have.push(inst); out.push(inst); } };
  need('drums');
  if (genre.rule === 'core') { if (!have.includes('guitar') && !have.includes('bass')) need('guitar'); }
  else { need('guitar'); need('bass'); }
  if (genre.rule === 'prog' && !have.some((i) => ['keys', 'violin', 'sax'].includes(i))) { have.push('keys'); out.push('keys'); }
  while (have.length < genre.min) { const i = rng.pick(['guitar', 'bass', 'keys', 'vocals']); have.push(i); out.push(i); }
  if (rng.chance(0.3)) out.push(rng.pick(['guitar', 'vocals', 'keys']));
  return out;
}

export function describeOpening(state, o) {
  const sb = state.scene.find((b) => b.id === o.sceneId);
  return { band: sb, role: INSTRUMENTS[o.instrument].noun };
}

export { tierFor, roleLabel };
