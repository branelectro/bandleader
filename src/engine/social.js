// Band social accounts: posting keeps engagement up; silence lets it rot.
import { POST_TYPES } from './data.js?v=4';
import { membersOf, bandEffect } from './band.js?v=4';
import { news } from './state.js?v=4';
import { clamp } from './rng.js?v=4';

export function postsToday(band, day) {
  return band.postsByDay[day] || 0;
}

export function socialPost(ctx, bandId, type, { auto = false } = {}) {
  const { state, rng } = ctx;
  const band = state.bands[bandId];
  const pt = POST_TYPES[type];
  if (!band || !pt) return { ok: false, msg: 'Bad post.' };
  if (!auto && band.leaderId !== state.playerId) return { ok: false, msg: 'The leader runs the band account.' };
  const n = postsToday(band, state.day);
  if (n >= 3) return { ok: false, msg: 'Three posts today is already too many.' };
  const mult = [1, 0.45, -0.4][n];
  const ms = membersOf(state, band);
  const boost = 1 + bandEffect(ms, 'postBoost');

  let factor = 1;
  let note = '';
  if (type === 'flyer') {
    const soon = band.events.some((e) => e.type === 'gig' && e.status === 'scheduled' && e.day - state.day <= 10 && e.day >= state.day);
    factor = soon ? 1.8 : 0.4;
    note = soon ? 'People are saving the date.' : 'A flyer with no show on it confused people.';
  } else if (type === 'bts') {
    factor = 0.5 + band.tightness / 100;
    note = band.tightness > 50 ? 'The clip actually sounds good.' : 'The clip is... rough.';
  } else if (type === 'meme') {
    factor = clamp(rng.gauss(1, 0.9), -0.6, 3.5);
    note = factor > 2.4 ? 'It went viral (locally)!' : factor < 0.2 ? 'It flopped. Someone commented "cringe".' : 'Got some laughs.';
  } else if (type === 'teaser') {
    const pending = band.recordings.some((r) => !r.released);
    factor = pending ? 1 : 0.3;
    if (pending) {
      band.hype = clamp(band.hype + pt.hype * (1 + bandEffect(ms, 'hypeBoost')) * (n === 0 ? 1 : 0.4), 0, 1.5);
      note = `Hype is building (${Math.round(band.hype * 100)}%).`;
    } else note = 'Teasing a release that doesn\'t exist is not a great look.';
  }

  const engGain = pt.engagement * mult * factor * boost;
  band.engagement = clamp(band.engagement + engGain, 0, 100);
  // Posts mostly keep existing fans engaged; reach grows slowly (sqrt), so
  // socials alone can't replace playing shows.
  let gained = Math.round((Math.sqrt(band.followers) * pt.followers * 4 * factor * boost * (band.engagement / 60) + (rng.chance(0.4) ? 1 : 0)) * Math.max(0, mult));
  if (type === 'meme' && factor > 2.4) gained += rng.int(15, 70);
  band.followers += Math.max(0, gained);
  band.growth.posts += Math.max(0, gained);
  band.postsByDay = { [state.day]: n + 1 }; // only today's count matters
  band.lastPostDay = state.day;
  if (n === 2) note = 'Followers are muting you for spamming.';
  if (!auto) news(state, `${band.name} posted a ${pt.label.toLowerCase()}. ${note} ${gained > 0 ? `+${gained} followers.` : ''}`, { bandId });
  return { ok: true, msg: `${note} ${gained > 0 ? `+${gained} followers.` : ''} Engagement ${Math.round(band.engagement)}%.` };
}

export function dailySocial(ctx, band) {
  const { state, rng } = ctx;
  const since = state.day - band.lastPostDay;
  if (band.followers < 5) return; // nobody to disappoint yet
  if (since > 2) band.engagement = clamp(band.engagement - (1 + since * 0.15), 0, 100);
  // Bands with dead accounts slowly lose followers.
  if (band.engagement < 12 && band.followers > 20 && rng.chance(0.3)) band.followers -= 1;
  band.hype = Math.max(0, band.hype - 0.01);
}
