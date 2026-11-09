import { playBot } from './bot.mjs';
const configs = [
  ['punk', 0], ['emo', 1], ['folk', 0], ['metalcore', 0], ['death', 1], ['prog', 0], ['prog', 2],
];
for (const [genre, extra] of configs) {
  const rows = [];
  for (let s = 1; s <= 5; s++) {
    const { band, state } = playBot({ seed: `bal-${genre}-${s}`, genre, extraMembers: extra, days: 365 });
    rows.push(band ? { f: band.followers, st: band.standing, n: band.memberIds.length, songs: band.songs, gigs: state.stats.gigs, cash: Math.round(band.cash) } : null);
  }
  const ok = rows.filter(Boolean);
  const avg = (k) => Math.round(ok.reduce((a, r) => a + r[k], 0) / ok.length);
  console.log(`${genre.padEnd(10)} +${extra}  members~${avg('n')} followers~${avg('f')} standing~${(ok.reduce((a, r) => a + r.st, 0) / ok.length).toFixed(1)} songs~${avg('songs')} gigs~${avg('gigs')} cash~${avg('cash')}  [${ok.map((r) => r.f + '/' + r.st).join(' ')}]`);
}
if (process.argv[2] === 'detail') {
  const { band, log, state } = playBot({ seed: 'detail-1', genre: process.argv[3] || 'punk', days: 365 });
  console.table(log);
  console.log(band.growth, band.recordings.map((r) => ({ t: r.type, q: r.quality, perf: r.performance, prod: r.production, react: r.reaction, dl: r.downloads, f: r.followersGained })));
  console.log(band.showsAtTier, band.reach);
}
