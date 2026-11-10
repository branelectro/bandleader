// Recording: basement demos, student class projects, paid studios. And releases.
import { STUDIO_TYPES, SONG_WORDS } from './data.js?v=4';
import { membersOf, performanceScore, lineupCheck, bandEffect } from './band.js?v=4';
import { grantXp, shortName } from './people.js?v=4';
import { createEvent, resolveAttendance, payWages } from './schedule.js?v=4';
import { uid, weekday, dayLabel, news, createThread } from './state.js?v=4';
import { clamp } from './rng.js?v=4';

// How many sessions per song a studio needs before takes are "done right".
const SESSIONS_PER_SONG = { basement: 1.5, student: 1.0, cheap: 1.0, pro: 0.7 };

export function recordingCost(state, band, type, sessions) {
  const s = STUDIO_TYPES[type];
  const disc = bandEffect(membersOf(state, band), 'studioDiscount');
  return Math.round(s.costPerSession * sessions * (1 - Math.min(0.8, disc)));
}

export function titleFor(rng, songs) {
  const t = `${rng.pick(SONG_WORDS.a)} ${rng.pick(SONG_WORDS.b)}`;
  return songs <= 2 ? `${t} (single)` : songs <= 6 ? `${t} EP` : `${t} LP`;
}

export function bookRecording(ctx, bandId, { type, sessions, songs, startDay, title }) {
  const { state, rng } = ctx;
  const band = state.bands[bandId];
  const s = STUDIO_TYPES[type];
  if (!band || !s) return { ok: false, msg: 'Bad request.' };
  if (band.leaderId !== state.playerId && !band.npc) return { ok: false, msg: 'Only the band leader books studio time.' };
  if (songs < 1 || songs > band.songs) return { ok: false, msg: `You only have ${band.songs} songs.` };
  if (!Number.isInteger(sessions) || sessions < s.minSessions) return { ok: false, msg: `${s.label} needs at least ${s.minSessions} session${s.minSessions > 1 ? 's' : ''}.` };
  const lc = lineupCheck(band, membersOf(state, band));
  if (!lc.ok) return { ok: false, msg: `Lineup isn't ready: ${lc.problems[0]}` };
  if (band.recordings.some((r) => !r.done)) return { ok: false, msg: 'Finish the current recording first.' };
  const cost = recordingCost(state, band, type, sessions);
  if (band.cash < cost) return { ok: false, msg: `That costs $${cost}; the band fund has $${Math.round(band.cash)}.` };

  const ms = membersOf(state, band);
  const friend = bandEffect(ms, 'studentBoost');
  const overnight = s.oddHours && !friend;
  // Student slots open up when the school has a gap, and are spread out.
  let day = Math.max(state.day + 1, startDay || state.day + 1);
  if (type === 'student') day = Math.max(day, state.day + rng.int(3, 8));
  const spacing = type === 'student' ? 2 : 1;
  const days = [];
  for (let i = 0; i < sessions; i++) {
    while (band.events.some((e) => e.day === day && e.status === 'scheduled')) day++;
    days.push(day);
    day += spacing;
  }
  band.cash -= cost;
  const rec = {
    id: uid(state, 'r'),
    title: title || titleFor(rng, songs),
    type, songs, sessions, cost,
    takes: [],
    sessionsDone: 0,
    done: false,
    released: false,
    bookedDay: state.day,
  };
  band.recordings.push(rec);
  days.forEach((d, i) => createEvent(state, band, {
    type: 'recording', day: d,
    title: `${s.label.split(' ')[0]} session ${i + 1}/${sessions}${overnight ? ' (overnight)' : ''}`,
    data: { recordingId: rec.id, overnight },
  }));
  return { ok: true, msg: `Booked ${sessions} session(s) starting ${dayLabel(days[0], true)}${cost ? ` for $${cost}` : ''}.` };
}

export function resolveSession(ctx, band, e, playerBusy) {
  const { state } = ctx;
  const rec = band.recordings.find((r) => r.id === e.data.recordingId);
  if (!rec) { e.status = 'done'; return null; }
  const { present, absentNotice, noShow } = resolveAttendance(ctx, band, e, playerBusy);
  const lc = lineupCheck(band, present);
  payWages(ctx, band, present);
  let summary;
  if (present.length < 2) {
    summary = 'Wasted session: not enough people showed up.';
  } else {
    // Missing members get their parts overdubbed later; costs some feel.
    const take = performanceScore(band, present, { lineupComplete: lc.ok || present.length >= band.memberIds.length - 1 });
    rec.takes.push(take);
    for (const m of present) grantXp(m, { skill: 5, experience: 2 }, 1 + bandEffect(present, 'bandXp'));
    summary = `Tracked with ${present.map(shortName).join(', ')}.${absentNotice.length + noShow.length ? ` Missing ${[...absentNotice, ...noShow].map(shortName).join(', ')}.` : ''} Take quality ~${Math.round(take)}.`;
  }
  rec.sessionsDone += 1;
  e.status = 'done';
  e.result = { summary, present: present.map((m) => m.id) };
  if (rec.sessionsDone >= rec.sessions) finishRecording(ctx, band, rec);
  return e.result;
}

export function finishRecording(ctx, band, rec) {
  const { state, rng } = ctx;
  const s = STUDIO_TYPES[rec.type];
  const ms = membersOf(state, band);
  const ratio = rec.takes.length / rec.songs;
  const need = SESSIONS_PER_SONG[rec.type];
  const avgTake = rec.takes.length ? rec.takes.reduce((a, b) => a + b, 0) / rec.takes.length : 15;
  const bestTake = rec.takes.length ? Math.max(...rec.takes) : 15;
  // More time = better takes, but the basement can only sound so good.
  const polish = Math.min(1, ratio / need);
  const extra = Math.max(0, Math.min(1, (ratio - need) / need));
  let performance = (avgTake * 0.6 + bestTake * 0.4) * (0.72 + 0.28 * polish) + extra * 6;

  let production = rng.float(...s.productionRange);
  const flags = [];
  if (rec.type === 'student') {
    production += bandEffect(ms, 'studentBoost');
    production += rng.gauss(0, 8); // students vary a lot
  }
  if ((rec.type === 'cheap' || rec.type === 'pro') && ratio < need) {
    const rush = (need - ratio) / need;
    production -= 25 * rush;
    performance -= 10 * rush;
    if (rush > 0.2) flags.push('rushed');
  }
  if (rec.type === 'basement') production += Math.min(6, (ratio - 1) * 2);
  production = clamp(production, 5, s.productionCap);
  performance = clamp(performance, 5, 100);
  if (flags.includes('rushed') && production < 55) flags.push('sloppy mix');

  const quality = Math.round(performance * 0.6 + production * 0.4);
  const cha = ms.reduce((a, m) => a + m.attrs.charisma, 0) / Math.max(1, ms.length);
  let reaction = performance * 0.55 + production * 0.22 + cha * 2.2 + rng.gauss(0, 8);
  if (production >= 72 && performance < 45) { reaction -= 12; flags.push('polished but lifeless'); }
  if (flags.includes('sloppy mix')) reaction -= 10;
  if (rec.type === 'basement' && performance > 65) { reaction += 5; flags.push('raw and real'); }

  rec.performance = Math.round(performance);
  rec.production = Math.round(production);
  rec.quality = quality;
  rec.reaction = Math.round(clamp(reaction, 0, 100)); // hidden until release
  rec.flags = flags;
  rec.done = true;
  rec.doneDay = state.day;
  const txt = `"${rec.title}" is finished. Performance ${rec.performance}, production ${rec.production} (overall ${quality}).${flags.length ? ` Notes: ${flags.join(', ')}.` : ''} Post teasers to build hype before you release it.`;
  createThread(state, { kind: 'result', bandId: band.id, title: `${band.name}: recording finished`, text: txt });
  news(state, `${band.name} finished recording "${rec.title}".`, { bandId: band.id, tone: 'good' });
}

export function releaseRecording(ctx, bandId, recId) {
  const { state } = ctx;
  const band = state.bands[bandId];
  const rec = band?.recordings.find((r) => r.id === recId);
  if (!rec || !rec.done || rec.released) return { ok: false, msg: 'Nothing to release.' };
  rec.released = true;
  rec.releaseDay = state.day;
  rec.hype = band.hype;
  rec.downloads = 0;
  rec.followersAtRelease = band.followers;
  rec.engagementAtRelease = band.engagement;
  rec.dailyDownloads = [];
  band.hype = 0;
  band.engagement = clamp(band.engagement + 6, 0, 100);
  state.stats.releases += 1;
  news(state, `${band.name} released "${rec.title}"!`, { bandId, tone: 'good' });
  return { ok: true, msg: `"${rec.title}" is out. Watch the downloads roll in over the next few weeks.` };
}

export function dailyReleases(ctx, band) {
  const { state, rng } = ctx;
  for (const rec of band.recordings) {
    if (!rec.released || rec.finished) continue;
    const d = state.day - rec.releaseDay;
    if (d < 0) continue;
    if (d > 28) { rec.finished = true; continue; }
    const reactF = rec.reaction / 60;
    const engageF = 0.12 + (band.engagement / 100) * 0.7;
    const hypeF = 0.6 + rec.hype * 1.4;
    const fanDownloads = band.followers * engageF * hypeF * reactF * 0.3 * Math.pow(0.78, d);
    const discovery = Math.pow(rec.reaction / 100, 3) * [25, 60, 160, 400, 1000][band.standing] * rng.float(0.5, 1.5) * Math.pow(0.88, d);
    const today = Math.max(0, Math.round(fanDownloads + discovery));
    rec.downloads += today;
    rec.dailyDownloads.push(today);
    // Fans downloading isn't growth; discovery (and fans sharing it) is.
    const conv = (discovery * 0.18 + fanDownloads * 0.02) * reactF;
    const gained = Math.floor(conv) + (rng.chance(conv % 1) ? 1 : 0);
    band.followers += gained;
    rec.followersGained = (rec.followersGained || 0) + gained;
    band.growth.releases += gained;
    if (d === 3) {
      const verdict = rec.reaction >= 70 ? 'People love it.' : rec.reaction >= 50 ? 'Decent reception.' : rec.reaction >= 35 ? 'Lukewarm reception.' : 'It\'s not landing.';
      const why = [];
      if (rec.flags.includes('polished but lifeless')) why.push('Comments say it sounds expensive but bored.');
      if (rec.flags.includes('sloppy mix')) why.push('Several comments about the mix being muddy.');
      if (rec.flags.includes('raw and real')) why.push('People love how raw it sounds.');
      if (rec.hype < 0.2) why.push('Nobody knew it was coming, which hurt the first-weekend numbers.');
      if (band.engagement < 25 && band.followers > 100) why.push('Lots of followers, but they\'re not paying attention lately.');
      createThread(state, {
        kind: 'result', bandId: band.id, title: `"${rec.title}": first weekend`,
        text: `${rec.downloads} downloads so far, +${rec.followersGained || 0} followers. ${verdict} ${why.join(' ')}`,
      });
    }
  }
}

export { weekday };
