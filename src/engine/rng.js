// Seeded, serializable RNG. The whole game state stores `rngState`, so a save
// file reproduces the exact same future and two different seeds diverge.

export function createRng(seed) {
  let s = (typeof seed === 'number' ? seed : hashString(String(seed))) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  const rng = {
    get state() { return s; },
    set state(v) { s = v >>> 0; },
    next() {
      // mulberry32
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    float(min = 0, max = 1) { return min + rng.next() * (max - min); },
    int(min, max) { return Math.floor(rng.float(min, max + 1)); },
    chance(p) { return rng.next() < p; },
    pick(arr) { return arr[Math.floor(rng.next() * arr.length)]; },
    pickWeighted(items, weightFn) {
      const weights = items.map(weightFn);
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return items[0];
      let r = rng.next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i];
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    // Roughly normal, clamped.
    gauss(mean, sd, min = -Infinity, max = Infinity) {
      const u = 1 - rng.next();
      const v = rng.next();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.min(max, Math.max(min, mean + z * sd));
    },
  };
  return rng;
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
