import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/engine/rng.js';
import { createPlayer, generatePerson, cred, attrTotal } from '../src/engine/people.js';
import { createBand, lineupCheck } from '../src/engine/band.js';
import { newGame, advanceDay, makeCtx } from '../src/engine/sim.js';
import { commit } from '../src/engine/state.js';
import { applyToOpening } from '../src/engine/scene.js';
import { threadAction } from '../src/engine/sim.js';
import { playBot } from './bot.mjs';

const spec = { first: 'T', last: 'Est', instrument: 'guitar', vocals: 'lead', attrs: { skill: 3, experience: 2, charisma: 3, reliability: 2 } };

test('rng is deterministic per seed', () => {
  const a = createRng('x'); const b = createRng('x'); const c = createRng('y');
  const sa = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(sa, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, () => c.next()));
});

test('amateur players are capped at 10 attribute points', () => {
  assert.throws(() => createPlayer({ ...spec, attrs: { skill: 5, experience: 2, charisma: 3, reliability: 2 } }));
  const p = createPlayer(spec);
  assert.equal(attrTotal(p), 10);
});

test('singing on top of an instrument raises cred', () => {
  const plain = createPlayer({ ...spec, vocals: 'none' });
  const backing = createPlayer({ ...spec, vocals: 'backing' });
  const lead = createPlayer(spec);
  assert.ok(cred(lead) > cred(backing) && cred(backing) > cred(plain));
});

test('generated amateurs stay low but pros are strong', () => {
  const rng = createRng(1);
  for (let i = 0; i < 50; i++) {
    const am = generatePerson(rng, { tier: 'amateur' });
    const pro = generatePerson(rng, { tier: 'pro' });
    assert.ok(cred(pro) > cred(am));
    assert.equal(am.rate, 0);
    assert.ok(pro.rate > 100);
  }
});

function mk(instrument, vocals = 'none') {
  return { ...createPlayer({ ...spec, instrument, vocals }), id: instrument + vocals + Math.random() };
}

test('genre lineup rules', () => {
  const punk = createBand({ id: 'b', name: 'x', genre: 'punk', leaderId: 'p', day: 0 });
  assert.ok(lineupCheck(punk, [mk('guitar', 'lead'), mk('drums')]).ok, 'punk duo with singing guitarist');
  assert.ok(!lineupCheck(punk, [mk('guitar'), mk('drums')]).ok, 'someone must sing');
  assert.ok(lineupCheck(punk, [mk('bass', 'backing'), mk('drums')]).ok, 'bass + drums works');

  const thrash = createBand({ id: 'b', name: 'x', genre: 'thrash', leaderId: 'p', day: 0 });
  assert.ok(!lineupCheck(thrash, [mk('guitar', 'lead'), mk('drums'), mk('bass')]).ok, 'thrash needs 4');
  assert.ok(lineupCheck(thrash, [mk('guitar', 'lead'), mk('drums'), mk('bass'), mk('guitar')]).ok);

  const prog = createBand({ id: 'b', name: 'x', genre: 'prog', leaderId: 'p', day: 0 });
  assert.ok(!lineupCheck(prog, [mk('guitar'), mk('drums'), mk('bass'), mk('vocals'), mk('bass')]).ok, 'prog needs an extra instrument');
  assert.ok(lineupCheck(prog, [mk('guitar'), mk('drums'), mk('bass'), mk('vocals'), mk('keys')]).ok);
});

test('save/load round trip continues identically', () => {
  const s = newGame('roundtrip', spec);
  const ctx = makeCtx(s);
  for (let i = 0; i < 20; i++) advanceDay(ctx);
  commit(ctx);
  const copy = makeCtx(JSON.parse(JSON.stringify(ctx.state)));
  for (let i = 0; i < 30; i++) { advanceDay(ctx); advanceDay(copy); }
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.state)), JSON.parse(JSON.stringify(copy.state)));
});

test('different seeds produce different scenes', () => {
  const a = newGame('a', spec); const b = newGame('b', spec);
  assert.notDeepEqual(a.scene.map((x) => x.name), b.scene.map((x) => x.name));
});

for (const genre of ['punk', 'metalcore', 'prog']) {
  test(`a year of play as a ${genre} band runs and grows`, () => {
    const { band, state } = playBot({ seed: `t-${genre}`, genre, days: 365 });
    assert.ok(band, 'band survives');
    assert.ok(state.stats.gigs > 5, `played gigs (${state.stats.gigs})`);
    assert.ok(band.followers > 50 && band.followers < 20000, `followers sane (${band.followers})`);
    assert.ok(band.standing >= 1, 'climbed past basements');
  });
}

test('joining another band and playing in it', () => {
  const s = newGame('joiner', { ...spec, attrs: { skill: 4, experience: 2, charisma: 2, reliability: 2 } });
  const ctx = makeCtx(s);
  s.cash = 5000;
  // make an easy opening for the player's instrument
  const o = s.openings[0];
  o.instrument = 'guitar'; o.minCred = 0;
  applyToOpening(ctx, o.id);
  let joined = null;
  for (let i = 0; i < 10 && !joined; i++) {
    advanceDay(ctx);
    const t = s.threads.find((x) => x.kind === 'joinOffer' && !x.resolved);
    if (t) { threadAction(ctx, t.id, 'accept'); joined = Object.values(s.bands)[0]; }
  }
  assert.ok(joined, 'got an offer and joined');
  assert.notEqual(joined.leaderId, 'player');
  assert.ok(lineupCheck(joined, joined.memberIds.map((id) => s.people[id])).ok, 'NPC band has a valid lineup');
  for (let i = 0; i < 90; i++) advanceDay(ctx);
  assert.ok(joined.events.some((e) => e.status === 'done'), 'NPC leader ran events');
});

test('you can vote on reschedules in a band someone else leads', () => {
  const s = newGame('voter', { ...spec, attrs: { skill: 4, experience: 2, charisma: 2, reliability: 2 } });
  const ctx = makeCtx(s);
  const o = s.openings[0];
  o.instrument = 'guitar'; o.minCred = 0;
  applyToOpening(ctx, o.id);
  for (let i = 0; i < 10; i++) {
    advanceDay(ctx);
    const t = s.threads.find((x) => x.kind === 'joinOffer' && !x.resolved);
    if (t) { threadAction(ctx, t.id, 'accept'); break; }
  }
  let answered = 0;
  for (let i = 0; i < 120; i++) {
    advanceDay(ctx);
    for (const t of s.threads.filter((x) => x.kind === 'reschedule' && !x.resolved)) {
      assert.ok(t.data.npcLeader, 'reschedule in NPC band is open to the player');
      assert.deepEqual(t.actions.map((a) => a.id), ['canDo', 'cantDo']);
      const r = threadAction(ctx, t.id, answered % 2 ? 'cantDo' : 'canDo');
      assert.ok(r.ok);
      assert.ok(t.resolved, 'leader decides once you answer');
      answered++;
    }
  }
  assert.ok(answered > 0, 'at least one reschedule request came up');
});

test('leader proposes moving or skipping a practice; band weighs in', async () => {
  const { startBand, addMember } = await import('../src/engine/recruiting.js');
  const { schedulePractice, requestReschedule } = await import('../src/engine/schedule.js');
  const s = newGame('leader-resched', spec);
  const ctx = makeCtx(s);
  const band = startBand(ctx, { name: 'Test', genre: 'punk' });
  for (const inst of ['drums', 'bass']) {
    const m = generatePerson(ctx.rng, { tier: 'amateur', instrument: inst, id: 'm' + inst });
    s.people[m.id] = m;
    addMember(ctx, band, m);
  }
  schedulePractice(ctx, band.id, 3);
  const e = band.events[0];
  const r = requestReschedule(ctx, band.id, e.id, { day: 5 });
  assert.ok(r.ok, r.msg);
  const t = s.threads.find((x) => x.id === r.threadId);
  assert.equal(t.messages.length, 3, 'you + two bandmates replied');
  assert.deepEqual(t.actions.map((a) => a.id), ['move', 'keep', 'cancel']);
  assert.ok(!requestReschedule(ctx, band.id, e.id, { day: 6 }).ok, 'only one open request per event');
  threadAction(ctx, t.id, 'move');
  assert.equal(e.day, 5);
  const r2 = requestReschedule(ctx, band.id, e.id, { cancel: true });
  threadAction(ctx, r2.threadId, 'cancel');
  assert.equal(e.status, 'cancelled');
});

test('member of an NPC band can ask to move a practice; leader decides next day', async () => {
  const { requestReschedule } = await import('../src/engine/schedule.js');
  const s = newGame('member-resched', { ...spec, attrs: { skill: 4, experience: 2, charisma: 2, reliability: 2 } });
  const ctx = makeCtx(s);
  const o = s.openings[0];
  o.instrument = 'guitar'; o.minCred = 0;
  applyToOpening(ctx, o.id);
  let band;
  for (let i = 0; i < 10 && !band; i++) {
    advanceDay(ctx);
    const t = s.threads.find((x) => x.kind === 'joinOffer' && !x.resolved);
    if (t) { threadAction(ctx, t.id, 'accept'); band = Object.values(s.bands)[0]; }
  }
  let e;
  for (let i = 0; i < 14 && !e; i++) {
    advanceDay(ctx);
    e = band.events.find((x) => x.type === 'practice' && x.status === 'scheduled' && x.day > s.day + 1);
  }
  assert.ok(e, 'NPC leader scheduled a practice');
  let target = s.day + 1;
  while (band.events.some((x) => x.day === target && x.status === 'scheduled')) target++;
  const r = requestReschedule(ctx, band.id, e.id, { day: target });
  assert.ok(r.ok, r.msg);
  const t = s.threads.find((x) => x.id === r.threadId);
  assert.equal(t.actions.length, 0, 'nothing for you to click; the leader decides');
  assert.ok(!t.resolved);
  advanceDay(ctx);
  assert.ok(t.resolved, 'leader decided');
  assert.ok(t.messages.at(-1).from === band.leaderId);
});

test('in a joined band you can say you cannot make a show; it counts as excused', async () => {
  const { giveNotice, withdrawNotice } = await import('../src/engine/schedule.js');
  const s = newGame('notice', { ...spec, attrs: { skill: 4, experience: 2, charisma: 2, reliability: 2 } });
  const ctx = makeCtx(s);
  for (const o of s.openings) { o.instrument = 'guitar'; o.minCred = 0; }
  applyToOpening(ctx, s.openings[0].id);
  let band;
  for (let i = 0; i < 10 && !band; i++) {
    advanceDay(ctx);
    const t = s.threads.find((x) => x.kind === 'joinOffer' && !x.resolved);
    if (t) { threadAction(ctx, t.id, 'accept'); band = Object.values(s.bands)[0]; }
  }
  assert.ok(band);
  let e;
  for (let i = 0; i < 40 && !e; i++) { advanceDay(ctx); e = band.events.find((x) => x.status === 'scheduled' && x.day > s.day + 1); }
  assert.ok(e, 'band scheduled something');
  assert.ok(giveNotice(ctx, band.id, e.id).ok);
  assert.ok(withdrawNotice(ctx, band.id, e.id).ok);
  assert.ok(giveNotice(ctx, band.id, e.id).ok);
  const me = s.people.player;
  me.missedRecent = 0;
  while (s.day < e.day) advanceDay(ctx);
  assert.equal(e.status, 'done');
  assert.ok(!e.result.present.includes('player'), 'you were not there');
  assert.equal(me.missedRecent || 0, 0, 'not counted as a no-show');
});

test('cancelling a studio session still lets the recording finish', async () => {
  const { startBand, addMember } = await import('../src/engine/recruiting.js');
  const { bookRecording } = await import('../src/engine/studio.js');
  const { cancelEvent } = await import('../src/engine/schedule.js');
  const s = newGame('rec-cancel', spec);
  const ctx = makeCtx(s);
  const band = startBand(ctx, { name: 'R', genre: 'punk' });
  const m = generatePerson(ctx.rng, { tier: 'amateur', instrument: 'drums', id: 'mdrums' });
  s.people[m.id] = m; addMember(ctx, band, m);
  s.people.player.gear.push('guitar-1-dented-strat-alike', 'guitarAmp-1-15w-practice-amp', 'mic-1-mystery-dynamic-mic');
  band.songs = 3;
  assert.ok(bookRecording(ctx, band.id, { type: 'basement', sessions: 3, songs: 2 }).ok);
  const sessions = band.events.filter((e) => e.type === 'recording');
  cancelEvent(ctx, band.id, sessions[2].id);
  assert.equal(band.recordings[0].sessions, 2);
  for (let i = 0; i < 6; i++) advanceDay(ctx);
  assert.ok(band.recordings[0].done, 'recording finished after the remaining sessions');
});

test('old saves with a cancelled session still counted get repaired', async () => {
  const { startBand, addMember } = await import('../src/engine/recruiting.js');
  const { bookRecording } = await import('../src/engine/studio.js');
  const { repairSave } = await import('../src/engine/sim.js');
  const s = newGame('old-save', spec);
  const ctx = makeCtx(s);
  const band = startBand(ctx, { name: 'R', genre: 'punk' });
  const m = generatePerson(ctx.rng, { tier: 'amateur', instrument: 'drums', id: 'mdrums' });
  s.people[m.id] = m; addMember(ctx, band, m);
  s.people.player.gear.push('guitar-1-dented-strat-alike', 'guitarAmp-1-15w-practice-amp', 'mic-1-mystery-dynamic-mic');
  band.songs = 3;
  bookRecording(ctx, band.id, { type: 'basement', sessions: 3, songs: 2 });
  // Simulate the old bug: last session cancelled without updating the recording.
  band.events.filter((e) => e.type === 'recording')[2].status = 'cancelled';
  for (let i = 0; i < 6; i++) advanceDay(ctx);
  const rec = band.recordings[0];
  assert.ok(rec.done, 'finishes during play');
  // And straight from a stuck save on load:
  rec.done = false; rec.sessions = 3;
  const fixed = repairSave(makeCtx(JSON.parse(JSON.stringify(s))));
  assert.equal(fixed.length, 1);
});

test('bands you joined ask before booking a show', () => {
  const s = newGame('gig-approval', { ...spec, attrs: { skill: 4, experience: 2, charisma: 2, reliability: 2 } });
  const ctx = makeCtx(s);
  for (const o of s.openings) { o.instrument = 'guitar'; o.minCred = 0; }
  applyToOpening(ctx, s.openings[0].id);
  let band;
  for (let i = 0; i < 10 && !band; i++) {
    advanceDay(ctx);
    const t = s.threads.find((x) => x.kind === 'joinOffer' && !x.resolved);
    if (t) { threadAction(ctx, t.id, 'accept'); band = Object.values(s.bands)[0]; }
  }
  assert.ok(band);
  const known = new Set(band.events.filter((e) => e.type === 'gig').map((e) => e.id));
  const newGigs = () => band.events.filter((e) => e.type === 'gig' && !known.has(e.id));
  const outcomes = { in: 0, out: 0, ignored: 0 };
  let n = 0;
  for (let i = 0; i < 200; i++) {
    advanceDay(ctx);
    assert.equal(newGigs().length, 0, 'no show appears without your answer');
    const t = s.threads.find((x) => x.kind === 'gigProposal' && !x.resolved && !x.seen);
    if (!t) continue;
    t.seen = true;
    const choice = ['in', 'out', 'ignored'][n++ % 3];
    if (choice === 'ignored') { outcomes.ignored++; continue; }
    threadAction(ctx, t.id, choice);
    assert.equal(newGigs().length, choice === 'in' ? 1 : 0, `answering "${choice}"`);
    for (const e of newGigs()) known.add(e.id);
    outcomes[choice]++;
  }
  assert.ok(outcomes.in && outcomes.out && outcomes.ignored, `saw all three outcomes ${JSON.stringify(outcomes)}`);
  const expired = s.threads.filter((x) => x.kind === 'gigProposal' && x.outcome === 'No answer, so they passed.');
  assert.ok(expired.length >= 1, 'ignored proposals expire without booking');
});
