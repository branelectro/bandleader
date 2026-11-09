import { GENRES, INSTRUMENTS, INSTRUMENT_IDS, VOCAL_LABELS, VENUE_TIERS, STUDIO_TYPES, POST_TYPES, DAY_NAMES } from '../engine/data.js';
import { shortName, availabilityChance, cred } from '../engine/people.js';
import { player, playerBands, dayLabel, weekday } from '../engine/state.js';
import {
  membersOf, lineupCheck, bandCred, practiceRoomCost, payroll, bestRecording, coordinationDrag, bandHasPA,
} from '../engine/band.js';
import { bookingCheck, standingLabel, standingProgress } from '../engine/gigs.js';
import { recordingCost } from '../engine/studio.js';
import { payGate } from '../engine/recruiting.js';
import { postsToday } from '../engine/social.js';
import { eventsOn } from '../engine/schedule.js';
import { esc, money, bar, stat, memberCard } from './util.js';
import { eventDetail, genreRuleText } from './views.js';

const SECTIONS = [
  ['overview', 'Overview'], ['members', 'Members'], ['schedule', 'Practice'], ['shows', 'Shows'],
  ['studio', 'Studio'], ['social', 'Socials'], ['money', 'Money'], ['recruit', 'Recruit'],
];

export function bandView(state, ui) {
  const bands = playerBands(state);
  if (!bands.length) return '<div class="panel"><p>You\'re not in a band yet.</p><button class="btn primary" data-action="tab" data-tab="scene">Go to the Scene</button></div>';
  const band = bands.find((b) => b.id === ui.bandId) || bands[0];
  ui.bandId = band.id;
  const lead = band.leaderId === state.playerId;
  const sec = ui.bandSection || 'overview';
  const sections = lead ? SECTIONS : SECTIONS.filter(([k]) => ['overview', 'members', 'schedule', 'shows', 'studio', 'social'].includes(k));
  const content = {
    overview, members, schedule, shows, studio, social, money: moneyView, recruit,
  }[sec] || overview;
  return `${bands.length > 1 ? `<div class="subnav">${bands.map((b) => `<button class="chip ${b.id === band.id ? 'active' : ''}" data-action="open-band" data-band="${b.id}">${esc(b.name)}</button>`).join('')}</div>` : ''}
    <div class="row between" style="margin-bottom:.5rem">
      <div><h2 style="margin:0">${esc(band.name)}</h2><div class="muted small">${GENRES[band.genre].label} · ${band.memberIds.length} members · ${esc(standingLabel(band.standing))} standing${lead ? ' · you lead' : ` · led by ${esc(shortName(state.people[band.leaderId]))}`}</div></div>
    </div>
    <div class="subnav">${sections.map(([k, l]) => `<button class="chip ${sec === k ? 'active' : ''}" data-action="band-section" data-section="${k}">${l}</button>`).join('')}</div>
    ${content(state, ui, band, lead)}`;
}

function notLeader(state, band) {
  return `<p class="muted small">${esc(shortName(state.people[band.leaderId]))} leads ${esc(band.name)} and runs the schedule, bookings and socials. You just have to show up (and keep your calendar clear).</p>`;
}

// ---------------------------------------------------------------------------
function overview(state, ui, band, lead) {
  const ms = membersOf(state, band);
  const lc = lineupCheck(band, ms);
  const prog = standingProgress(band);
  const best = bestRecording(band);
  const upcoming = band.events.filter((e) => e.status === 'scheduled').slice(0, 6);
  return `<div class="grid two">
    <div class="panel stack">
      <div class="stats">
        ${stat('Followers', band.followers.toLocaleString(), `${band.growth.gigs} from shows · ${band.growth.posts} posts · ${band.growth.releases} releases`)}
        ${stat('Engagement', `${Math.round(band.engagement)}%`, band.engagement < 25 ? '<span class="bad">post more!</span>' : '')}
        ${stat('Band fund', money(band.cash), lead ? `payroll ${money(payroll(state, band))}/event` : '')}
        ${stat('Band cred', bandCred(state, band), 'avg of members')}
        ${stat('Songs', band.songs, `next ${Math.round(band.songProgress * 100)}%`)}
        ${stat('Tightness', Math.round(band.tightness), bar(band.tightness, 100, 'info'))}
        ${stat('Morale', Math.round(band.morale), bar(band.morale, 100, 'good'))}
        ${stat('Best recording', best ? best.quality : '—', best ? esc(STUDIO_TYPES[best.type].label) : 'none yet')}
      </div>
      ${lc.ok ? '<p class="good small">Lineup is complete. You can book shows and record.</p>' : `<div class="item bad"><b>Lineup not ready</b><ul class="small">${lc.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><p class="small muted">${genreRuleText(band.genre)}</p>${lead ? '<button class="btn small" data-action="band-section" data-section="recruit">Recruit</button>' : ''}</div>`}
      ${prog ? `<div><h4>Next standing: ${esc(prog.next)}</h4>
        <div class="attr"><span>Shows here</span>${bar(prog.shows, prog.showsNeeded)}<span class="num">${prog.shows}/${prog.showsNeeded}</span></div>
        <div class="attr"><span>Followers</span>${bar(prog.followers, prog.followersNeeded)}<span class="num">${Math.min(100, Math.round(prog.followers / prog.followersNeeded * 100))}%</span></div>
        <p class="small muted">${prog.followers}/${prog.followersNeeded} followers. ${band.memberIds.length <= 3 ? 'Small bands need more followers to impress bookers.' : band.memberIds.length >= 5 ? 'Bookers love a big lineup: lower bar for you.' : ''}</p></div>` : '<p class="good">Top of the local scene!</p>'}
      ${band.standing === 0 ? `<p class="small muted">Basement crowd won over: ${Math.round(band.reach[0])} of ~${Math.round(VENUE_TIERS[0].poolBase * GENRES[band.genre].diyScene)} local DIY regulars have seen you.</p>` : ''}
    </div>
    <div class="panel">
      <h3>Coming up</h3>
      <div class="list">${upcoming.map((e) => `<div class="item ${e.type}"><div class="row between"><b>${esc(e.title)}</b><span class="small muted">${dayLabel(e.day)}</span></div></div>`).join('') || '<p class="muted small">Nothing scheduled.</p>'}</div>
      <h3 style="margin-top:1rem">Recent</h3>
      <div class="list">${band.events.filter((e) => e.status === 'done').slice(-5).reverse().map((e) => `<div class="item ${e.type}"><div class="row between"><b>${esc(e.title)}</b><span class="small muted">${dayLabel(e.day)}</span></div><div class="small">${esc(e.result?.summary || '')}</div></div>`).join('') || '<p class="muted small">No history yet.</p>'}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function members(state, ui, band, lead) {
  const ms = membersOf(state, band);
  const drag = coordinationDrag(band);
  return `<p class="small muted">Bigger bands learn songs ${Math.round((drag - 1) * 100)}% slower${drag > 1 ? '' : ' (no penalty at this size)'}. A member who doesn't know the songs drags the whole show down. ${bandHasPA(ms) ? '<span class="good">Someone owns a PA.</span>' : '<span class="warn">Nobody owns a PA: basement shows will cost you a rental.</span>'}</p>
  <div class="grid three">${ms.map((m) => memberCard(m, {
    band,
    extra: lead && !m.isPlayer ? `<div class="row" style="margin-top:.5rem"><span class="small muted">Loyalty ${Math.round(m.loyalty)}</span><span class="spacer"></span><button class="btn small danger" data-action="fire" data-band="${band.id}" data-person="${m.id}">Fire</button></div>` : '',
  })).join('')}</div>
  <div class="row" style="margin-top:1rem"><button class="btn small danger" data-action="leave-band" data-band="${band.id}">${lead ? 'Break up the band' : 'Leave the band'}</button></div>`;
}

// ---------------------------------------------------------------------------
function schedule(state, ui, band, lead) {
  const ms = membersOf(state, band);
  const days = Array.from({ length: 14 }, (_, i) => state.day + 1 + i);
  const pad = weekday(days[0]);
  const upcoming = band.events.filter((e) => e.status === 'scheduled');
  const sel = ui.eventId && band.events.find((e) => e.id === ui.eventId);
  return `<div class="grid two">
    <div class="panel">
      <h3>${lead ? 'Schedule a practice' : 'Practice schedule'}</h3>
      ${lead ? `<p class="small muted">Number = how many of ${ms.length} members are usually free that evening. Room rental: ${money(practiceRoomCost(state, band))}${practiceRoomCost(state, band) ? '' : ' (free space!)'}.${payroll(state, band) ? ` Paid members cost ${money(payroll(state, band))} per practice.` : ''}</p>
      <div class="daypick">${DAY_NAMES.map((d) => `<div class="small muted" style="text-align:center">${d}</div>`).join('')}
        ${Array.from({ length: pad }, () => '<div></div>').join('')}
        ${days.map((d) => {
          const wd = weekday(d);
          const free = ms.filter((m) => availabilityChance(m, wd) > 0.5).length;
          const taken = band.events.some((e) => e.day === d && e.status === 'scheduled');
          const other = eventsOn(state, d).some((e) => e.bandId !== band.id);
          const cls = free === ms.length ? 'full' : free >= ms.length * 0.66 ? 'part' : 'low';
          return `<button data-action="schedule" data-band="${band.id}" data-day="${d}" ${taken ? 'disabled' : ''} title="${dayLabel(d, true)}${other ? ' · you have another band that day' : ''}">
            <span class="avail ${cls}">${taken ? '■' : `${free}/${ms.length}`}</span>${dayLabel(d).split(',')[0]} ${Math.floor(d / 7) + 1}${other ? ' ⚠' : ''}</button>`;
        }).join('')}
      </div>
      <p class="small muted">⚠ = you're booked with another band that day. You can only be in one place.</p>` : notLeader(state, band)}
    </div>
    <div class="panel">
      <h3>Upcoming</h3>
      <div class="list">${upcoming.map((e) => `<div class="item ${e.type}"><div class="row between"><b>${esc(e.title)}</b><span class="small muted">${dayLabel(e.day)}</span></div>
        <div class="row" style="margin-top:.25rem"><button class="btn small ghost" data-action="open-event" data-event="${e.id}" data-stay="1">Details</button>${lead ? `<button class="btn small ghost" data-action="cancel-event" data-band="${band.id}" data-event="${e.id}">Cancel</button>` : ''}</div></div>`).join('') || '<p class="muted small">Nothing yet.</p>'}</div>
      ${sel ? `<div style="margin-top:1rem">${eventDetail(state, band, sel)}</div>` : ''}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function shows(state, ui, band, lead) {
  const ms = membersOf(state, band);
  const lc = lineupCheck(band, ms);
  const offers = band.offers.filter((o) => o.expires > state.day && o.day > state.day).sort((a, b) => a.day - b.day);
  const tiers = VENUE_TIERS.map((v) => ({ v, chk: bookingCheck(band, v.tier) }));
  return `<div class="grid two">
    <div class="panel">
      <h3>Show offers</h3>
      ${lead ? '<p class="small muted">New offers arrive every Monday. Look at who else is on the bill: bands with a following bring new ears. Early on any show is a good show, but no-name bills won\'t move you up fast.</p>' : notLeader(state, band)}
      ${!lc.ok ? '<p class="warn small">Your lineup isn\'t complete, so you can\'t book shows yet.</p>' : ''}
      <div class="list">${offers.map((o) => {
        const chk = bookingCheck(band, o.tier);
        const draw = o.bill.reduce((s, b) => s + b.followers, 0);
        const clash = eventsOn(state, o.day).length;
        return `<div class="item gig">
          <div class="row between"><b>${esc(o.venue)}</b><span class="tag">${esc(VENUE_TIERS[o.tier].label)}</span></div>
          <div class="small">${dayLabel(o.day, true)} · capacity ${o.capacity} · ${o.payType === 'guarantee' ? `${money(o.pay)} guarantee` : o.tier === 0 ? 'donation bucket' : `door split (${money(o.ticket)} tickets)`}${o.connection ? ' · <span class="good">family connection</span>' : ''}</div>
          <div class="bill">${o.bill.map((b) => `<span class="${b.followers >= 50 ? 'draw' : ''}">${esc(b.name)} · ${b.followers}</span>`).join('')}</div>
          <div class="small muted">Bill draws ~${draw} followers total.${draw < 50 && o.tier >= 1 ? ' <span class="warn">Nobody on this bill has a real following.</span>' : ''}</div>
          ${!chk.ok && !o.connection ? `<div class="small bad">Booker won't take you: ${esc(chk.reasons.join('; '))}</div>` : ''}
          ${clash ? '<div class="small warn">You already have something that day.</div>' : ''}
          ${lead ? `<div class="row" style="margin-top:.35rem"><button class="btn small primary" data-action="book" data-band="${band.id}" data-offer="${o.id}" ${(!chk.ok && !o.connection) || !lc.ok ? 'disabled' : ''}>Book it</button><span class="small muted">answer by ${dayLabel(o.expires)}</span></div>` : ''}
        </div>`;
      }).join('') || '<p class="muted small">No offers right now. New ones come in on Monday.</p>'}</div>
    </div>
    <div class="panel">
      <h3>Venue ladder</h3>
      <table class="simple"><tr><th>Level</th><th>Needs</th><th></th></tr>
      ${tiers.map(({ v, chk }) => `<tr><td>${esc(v.label)}${band.standing === v.tier ? ' <span class="tag good">you</span>' : ''}</td>
        <td class="small">${v.songs} songs${v.tier ? `, ~${chk.needFollowers ?? v.minFollowers} followers${v.tier === 1 ? ' or a demo' : ''}, recording ${v.minRecording}+` : ', a PA'}</td>
        <td>${chk.ok ? '<span class="good">✓</span>' : '<span class="muted">✗</span>'}</td></tr>`).join('')}
      </table>
      <p class="small muted" style="margin-top:.5rem">${band.memberIds.length <= 3 ? 'Small bands: bars won\'t book you without a demo, and each member\'s cred matters more on stage.' : band.memberIds.length >= 5 ? 'Big bands: venues are more interested, but every show costs more and needs everyone to show up.' : ''} A strong recording can cut the follower requirement in half.</p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function studio(state, ui, band, lead) {
  const st = ui.studio;
  const s = STUDIO_TYPES[st.type];
  st.sessions = Math.max(s.minSessions, Math.min(s.maxSessions, st.sessions));
  st.songs = Math.max(1, Math.min(Math.max(1, band.songs), st.songs));
  const cost = recordingCost(state, band, st.type, st.sessions);
  const inProgress = band.recordings.find((r) => !r.done);
  const perSong = st.sessions / st.songs;
  return `<div class="grid two">
    <div class="panel stack">
      <h3>Book a recording</h3>
      ${lead ? '' : notLeader(state, band)}
      ${lead ? `<div class="list">${Object.entries(STUDIO_TYPES).map(([k, t]) => `<label class="item" style="cursor:pointer;${st.type === k ? 'border-left-color:var(--recording)' : ''}">
        <div class="row"><input type="radio" name="studio" data-change="studio-type" value="${k}" ${st.type === k ? 'checked' : ''}><b>${esc(t.label)}</b><span class="spacer"></span><span class="small">${t.costPerSession ? `${money(t.costPerSession)}/session` : 'free'}</span></div>
        <div class="small muted">${esc(t.blurb)}</div></label>`).join('')}</div>
      <div class="row">
        <label class="field">Songs<input type="number" id="st-songs" data-change="studio-num" min="1" max="${band.songs}" value="${st.songs}" style="width:6rem"></label>
        <label class="field">Sessions<input type="number" id="st-sessions" data-change="studio-num" min="${s.minSessions}" max="${s.maxSessions}" value="${st.sessions}" style="width:6rem"></label>
        <div><div class="small muted">Cost</div><b>${money(cost)}</b> <span class="small muted">(fund ${money(band.cash)})</span></div>
      </div>
      <p class="small ${perSong < 1 && st.type !== 'basement' ? 'warn' : 'muted'}">${perSong.toFixed(1)} sessions per song. ${perSong < 1 && (st.type === 'cheap' || st.type === 'pro') ? 'That\'s rushed: expect a sloppier mix and shakier takes.' : st.type === 'basement' ? 'Take as long as you want; it will still sound like a basement (production caps at 40).' : st.type === 'student' ? 'Sessions are overnight (unless someone has an audio-student roommate). Expect people to bail on 2am sessions.' : 'Plenty of time.'}</p>
      <button class="btn primary" data-action="record" data-band="${band.id}" ${inProgress || band.songs < 1 || cost > band.cash ? 'disabled' : ''}>Book sessions</button>
      ${inProgress ? '<p class="small warn">A recording is already in progress.</p>' : ''}` : ''}
      <p class="small muted">Polish isn't everything: a slick mix of a weak performance can sound lifeless, and a raw basement demo of a great band can connect. But bigger venues won't book off a basement demo.</p>
    </div>
    <div class="panel">
      <h3>Recordings</h3>
      <div class="list">${band.recordings.slice().reverse().map((r) => `<div class="item recording">
        <div class="row between"><b>${esc(r.title)}</b><span class="tag">${esc(STUDIO_TYPES[r.type].label)}</span></div>
        ${r.done ? `<div class="small">${r.songs} songs · performance ${r.performance} · production ${r.production} · <b>quality ${r.quality}</b>${r.flags.length ? ` · <span class="warn">${esc(r.flags.join(', '))}</span>` : ''}</div>` : `<div class="small muted">In progress: ${r.sessionsDone}/${r.sessions} sessions</div>`}
        ${r.released ? `<div class="small">Released ${dayLabel(r.releaseDay)} · <b>${r.downloads.toLocaleString()}</b> downloads · +${r.followersGained || 0} followers · hype was ${Math.round(r.hype * 100)}%</div>` : ''}
        ${r.done && !r.released && lead ? `<div class="row" style="margin-top:.35rem"><button class="btn small primary" data-action="release" data-band="${band.id}" data-rec="${r.id}">Release now</button><span class="small muted">Hype ${Math.round(band.hype * 100)}%. Post teasers first for a bigger launch.</span></div>` : ''}
      </div>`).join('') || '<p class="muted small">Nothing recorded yet.</p>'}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function social(state, ui, band, lead) {
  const n = postsToday(band, state.day);
  const since = state.day - band.lastPostDay;
  return `<div class="grid two">
    <div class="panel stack">
      <div class="stats">
        ${stat('Followers', band.followers.toLocaleString())}
        ${stat('Engagement', `${Math.round(band.engagement)}%`, bar(band.engagement))}
        ${stat('Release hype', `${Math.round(band.hype * 100)}%`)}
        ${stat('Last post', since <= 0 ? 'today' : `${since}d ago`, since > 2 ? '<span class="bad">engagement decaying</span>' : '')}
      </div>
      <p class="small muted">Followers who aren't engaged don't come to shows or download releases. Post every couple of days. More than one post a day has diminishing returns, three is spam.</p>
    </div>
    <div class="panel">
      <h3>Post to the band account</h3>
      ${lead ? `<div class="list">${Object.entries(POST_TYPES).map(([k, p]) => `<div class="item"><div class="row between"><div><b>${esc(p.label)}</b><div class="small muted">${esc(p.blurb)}</div></div>
        <button class="btn small ${n === 0 ? 'primary' : ''}" data-action="post" data-band="${band.id}" data-type="${k}" ${n >= 3 ? 'disabled' : ''}>Post</button></div></div>`).join('')}</div>
        <p class="small muted">${n} post(s) today.</p>` : notLeader(state, band)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function moneyView(state, ui, band) {
  const unpaid = membersOf(state, band).filter((m) => !band.pay[m.id]).length;
  return `<div class="grid two">
    <div class="panel stack">
      <div class="stats">${stat('Band fund', money(band.cash))}${stat('Your cash', money(state.cash))}${stat('Payroll', `${money(payroll(state, band))}/event`)}${stat('Practice room', money(practiceRoomCost(state, band)))}</div>
      <h3>Put money in</h3>
      <p class="small muted">The fund pays for practice rooms, studio time, PA rentals, and paid members. Hiring semi-pros or pros needs a healthy fund.</p>
      <div class="row"><input type="number" id="fund-amt" min="1" value="50" style="width:8rem"><button class="btn" data-action="fund" data-band="${band.id}">Add to fund</button></div>
    </div>
    <div class="panel stack">
      <h3>Pay out</h3>
      <p class="small muted">Split money among the ${unpaid} unpaid members (you included). Everyone gets an equal share, which keeps morale and loyalty up. This is how you pay yourself.</p>
      <div class="row"><input type="number" id="payout-amt" min="1" value="${Math.max(0, Math.floor(band.cash / 2))}" style="width:8rem"><button class="btn primary" data-action="payout" data-band="${band.id}" ${band.cash < unpaid ? 'disabled' : ''}>Pay out</button></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
function recruit(state, ui, band) {
  const r = ui.recruit;
  const ms = membersOf(state, band);
  const lc = lineupCheck(band, ms);
  const active = band.recruiting;
  const gates = ['none', 'semipro', 'pro'].map((lvl) => ({ lvl, g: payGate(state, band, lvl) }));
  return `<div class="grid two">
    <div class="panel stack">
      <h3>Recruiting post</h3>
      ${active ? `<div class="item good"><b>Your post is live</b> until ${dayLabel(active.until)}.<div class="small">Looking for: ${active.roles.map((x) => `${INSTRUMENTS[x.instrument].noun}${x.filled ? ' ✓' : ''}`).join(', ')}</div><div class="small muted">Auditions land in your inbox.</div><button class="btn small" data-action="recruit-stop" data-band="${band.id}">Take post down</button></div>` : ''}
      <p class="small muted">${esc(genreRuleText(band.genre))} ${lc.ok ? '<span class="good">Your lineup already meets the minimum, so extra members are optional.</span>' : `<span class="warn">Still need: ${esc(lc.problems.join(' '))}</span>`}</p>
      <div class="list">${r.roles.map((x, i) => `<div class="row">
        <select data-change="recruit-role" data-index="${i}" data-field="instrument">${INSTRUMENT_IDS.map((k) => `<option value="${k}" ${x.instrument === k ? 'selected' : ''}>${INSTRUMENTS[k].label}</option>`).join('')}</select>
        <select data-change="recruit-role" data-index="${i}" data-field="vocals" ${x.instrument === 'vocals' ? 'disabled' : ''}>${Object.entries(VOCAL_LABELS).map(([k, v]) => `<option value="${k}" ${x.vocals === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn small ghost" data-action="recruit-del" data-index="${i}">✕</button></div>`).join('')}</div>
      <div class="row"><button class="btn small" data-action="recruit-add">+ Add role</button></div>
      <label class="field">Offering pay?
        <select id="rc-pay" data-change="recruit-pay">${gates.map(({ lvl, g }) => `<option value="${lvl}" ${r.payLevel === lvl ? 'selected' : ''} ${g.ok ? '' : 'disabled'}>${{ none: 'No pay (amateurs)', semipro: 'Semi-pro rates (~$30-60/event)', pro: 'Pro rates ($150+/event)' }[lvl]}${g.ok ? '' : ' (locked)'}</option>`).join('')}</select></label>
      ${gates.filter((x) => !x.g.ok).map((x) => `<p class="small muted">🔒 ${esc(x.g.msg)}</p>`).join('')}
      <button class="btn primary" data-action="recruit-post" data-band="${band.id}" ${active || !r.roles.length ? 'disabled' : ''}>Post it</button>
    </div>
    <div class="panel">
      <h3>What makes a good pick?</h3>
      <ul class="small">
        <li><b>Free amateurs</b> are rough but usually have one standout: real skill, good gear, or a connection (a PA, a van, a relative with a venue or studio).</li>
        <li><b>Gear matters less early</b> if they're skilled and reliable. Skills grow, flakiness mostly doesn't.</li>
        <li><b>Check their evenings.</b> If nobody's free on the same nights, practices will be a mess.</li>
        <li><b>Paid members</b> treat it like a job and almost always show up, but cost money every practice and gig.</li>
        <li>When an amateur levels up to semi-pro, they'll ask to be paid.</li>
      </ul>
      <p class="small muted">Your cred (${cred(player(state))}) and the band's following affect who answers.</p>
    </div>
  </div>`;
}
