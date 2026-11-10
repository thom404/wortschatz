/**
 * Seeded RNG for board generation (splitmix64). `generateBoard(seed, …)` is
 * a pure function: same 64-bit seed, same board (ADR-0003 §10).
 *
 * Streams 64-bit state through the splitmix64 finalizer and exposes
 * uniform [0,1) floats plus unit-range integers, so every consumer draws
 * from one deterministic stream per attempt loop.
 */
const MASK64 = 0xffffffffffffffffn;
const GOLDEN = 0x9e3779b97f4a7c15n;
const MASK53 = (1n << 53n) - 1n;

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound). */
  range(bound: number): number;
}

export function makeRng(seed: bigint): Rng {
  let state = seed & MASK64;
  const next64 = (): bigint => {
    state = (state + GOLDEN) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    z = (z ^ (z >> 31n)) & MASK64;
    return z;
  };
  return {
    next(): number {
      return Number((next64() >> 11n) & MASK53) / 2 ** 53;
    },
    range(bound: number): number {
      if (bound <= 1) return 0;
      return Math.floor(this.next() * bound);
    },
  };
}
