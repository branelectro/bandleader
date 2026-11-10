// Merch: the band orders stock up front (bigger batches = cheaper per unit),
// sells it at shows and a little online. Physical releases (CDs, vinyl) are
// merch tied to a recording.
import { news, createThread, dayLabel, uid } from './state.js?v=4';
import { clamp } from './rng.js?v=4';

// batches: [quantity, cost per unit]. Bigger runs are cheaper per unit,
// like real print and pressing quotes.
export const MERCH_ITEMS = {
  stickers: { label: 'Stickers', icon: '🏷️', price: 2, batches: [[100, 0.6], [250, 0.4], [500, 0.25]], appeal: 1.3, leadDays: 4 },
  buttons: { label: 'Buttons', icon: '🔘', price: 3, batches: [[100, 0.85], [250, 0.55], [500, 0.4]], appeal: 0.8, leadDays: 4 },
  posters: { label: 'Posters', icon: '🖼️', price: 10, batches: [[25, 3.5], [50, 2.5], [100, 1.8]], appeal: 0.45, leadDays: 5 },
  tshirts: { label: 'T-shirts', icon: '👕', price: 20, batches: [[25, 9], [50, 7], [100, 5.5]], appeal: 1.1, leadDays: 7 },
  totes: { label: 'Tote bags', icon: '👜', price: 15, batches: [[25, 6.5], [50, 5], [100, 4]], appeal: 0.35, leadDays: 7 },
  hoodies: { label: 'Hoodies', icon: '🧥', price: 45, batches: [[12, 26], [25, 22], [50, 19]], appeal: 0.35, leadDays: 10 },
};

export const DISC_FORMATS = {
  cd: { label: 'CDs', icon: '💿', price: 10, batches: [[500, 2.4], [1000, 1.6], [5000, 1.05]], appeal: 0.9, leadDays: 14 },
  vinyl: { label: 'Vinyl', icon: '📀', price: 25, batches: [[300, 9], [500, 7.2], [1000, 5.5]], appeal: 0.45, leadDays: 30 },
};

export function ensureMerch(band) {
  band.merch = band.merch || {};
  band.merchOrders = band.merchOrders || [];
  band.merchStats = band.merchStats || { sold: 0, revenue: 0, cost: 0 };
  return band;
}

// Key is 'tshirts' etc., or 'cd:<recordingId>' / 'vinyl:<recordingId>'.
export function merchSpec(band, key) {
  if (MERCH_ITEMS[key]) return { ...MERCH_ITEMS[key], key };
  const [fmt, recId] = key.split(':');
  const f = DISC_FORMATS[fmt];
  const rec = band.recordings.find((r) => r.id === recId);
  if (!f || !rec) return null;
  return { ...f, key, recId, label: `"${rec.title}" ${f.label}`, rec };
}

export function orderMerch(ctx, bandId, key, batchIndex) {
  const { state } = ctx;
  const band = state.bands[bandId];
  if (!band || band.leaderId !== state.playerId) return { ok: false, msg: 'Only the band leader orders merch.' };
  ensureMerch(band);
  const spec = merchSpec(band, key);
  if (!spec) return { ok: false, msg: 'Unknown item.' };
  if (spec.rec && !spec.rec.done) return { ok: false, msg: 'Finish the recording before pressing it.' };
  const [qty, unit] = spec.batches[batchIndex] || [];
  if (!qty) return { ok: false, msg: 'Pick a batch size.' };
  const cost = Math.round(qty * unit);
  if (band.cash < cost) return { ok: false, needCash: cost, msg: `That run costs $${cost}; the band fund has $${Math.round(band.cash)}.` };
  band.cash -= cost;
  band.merchStats.cost += cost;
  const arriveDay = state.day + spec.leadDays;
  band.merchOrders.push({ id: uid(state, 'm'), key, qty, unitCost: unit, cost, arriveDay });
  news(state, `${band.name} ordered ${qty} ${spec.label} for $${cost}. Arrives ${dayLabel(arriveDay)}.`, { bandId });
  return { ok: true, msg: `✓ Ordered ${qty} ${spec.label} for $${cost} ($${unit.toFixed(2)} each). They arrive ${dayLabel(arriveDay, true)}.` };
}

export function inStock(band) {
  ensureMerch(band);
  return Object.entries(band.merch)
    .filter(([key, m]) => m.qty > 0 && merchSpec(band, key) && (!merchSpec(band, key).rec || merchSpec(band, key).rec.released))
    .map(([key, m]) => ({ key, ...m, spec: merchSpec(band, key) }));
}

function addStock(band, key, qty, unitCost) {
  const cur = band.merch[key] || { qty: 0, unitCost: 0, sold: 0, revenue: 0 };
  const total = cur.qty + qty;
  cur.unitCost = total ? (cur.qty * cur.unitCost + qty * unitCost) / total : unitCost;
  cur.qty = total;
  band.merch[key] = cur;
}

function sell(band, key, n) {
  const m = band.merch[key];
  const spec = merchSpec(band, key);
  const k = Math.min(n, m.qty);
  m.qty -= k;
  m.sold = (m.sold || 0) + k;
  m.revenue = (m.revenue || 0) + k * spec.price;
  band.merchStats.sold += k;
  band.merchStats.revenue += k * spec.price;
  if (spec.rec) spec.rec.discsSold = (spec.rec.discsSold || 0) + k;
  band.cash += k * spec.price;
  return { k, revenue: k * spec.price, cost: k * m.unitCost };
}

// Daily: deliveries arrive, a trickle of online-store sales.
export function dailyMerch(ctx, band) {
  const { state, rng } = ctx;
  ensureMerch(band);
  for (const o of band.merchOrders.filter((x) => x.arriveDay <= state.day)) {
    addStock(band, o.key, o.qty, o.unitCost);
    const spec = merchSpec(band, o.key);
    if (band.leaderId === state.playerId) {
      createThread(state, { kind: 'result', bandId: band.id, title: `${band.name}: ${o.qty} ${spec?.label || 'items'} arrived`, text: `Your order of ${o.qty} ${spec?.label || 'items'} is here. They'll be on the merch table at your next show${spec?.rec && !spec.rec.released ? ' (once the recording is released)' : ''}.` });
    }
  }
  band.merchOrders = band.merchOrders.filter((x) => x.arriveDay > state.day);
  // Online store: engaged followers occasionally order something.
  for (const item of inStock(band)) {
    const expected = band.followers * (band.engagement / 100) * 0.0006 * item.spec.appeal * (item.spec.rec ? item.spec.rec.reaction / 60 : 1);
    const n = Math.floor(expected) + (rng.chance(expected % 1) ? 1 : 0);
    if (n > 0) sell(band, item.key, n);
  }
}

// At a show: fans buy more than strangers, a great set sells, basement kids
// are broke (they go for cheap stuff).
export function sellAtGig(ctx, band, { attendance, fans, grade, tier }) {
  const { rng } = ctx;
  const stock = inStock(band);
  if (!stock.length) return null;
  const gradeMult = { great: 1.5, good: 1.0, meh: 0.55, bad: 0.25 }[grade];
  const strangers = Math.max(0, attendance - fans);
  const engage = 0.6 + band.engagement / 250;
  let buyers = (fans * 0.16 + strangers * 0.055) * gradeMult * engage;
  buyers = Math.floor(buyers) + (rng.chance(buyers % 1) ? 1 : 0);
  const budget = [12, 22, 35, 45, 60][tier];
  const sold = {};
  let revenue = 0;
  let cost = 0;
  for (let i = 0; i < buyers; i++) {
    const avail = inStock(band);
    if (!avail.length) break;
    const pick = rng.pickWeighted(avail, (x) => x.spec.appeal * (x.spec.rec ? x.spec.rec.reaction / 55 : 1) / (1 + x.spec.price / budget));
    const qty = pick.spec.price <= 3 && rng.chance(0.4) ? 2 : 1;
    const r = sell(band, pick.key, qty);
    sold[pick.key] = (sold[pick.key] || 0) + r.k;
    revenue += r.revenue;
    cost += r.cost;
  }
  if (!revenue) return { sold: {}, revenue: 0, cost: 0, summary: 'Nobody bought merch.' };
  const parts = Object.entries(sold).map(([key, n]) => `${n} ${merchSpec(band, key).label}`);
  const profit = revenue - cost;
  return {
    sold, revenue, cost: Math.round(cost),
    summary: `Merch: sold ${parts.join(', ')} for $${Math.round(revenue)} (cost $${Math.round(cost)}, profit $${Math.round(profit)}, ${Math.round(clamp(profit / revenue, 0, 1) * 100)}% margin).`,
  };
}
