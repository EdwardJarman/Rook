/** Pure statistics for the probe. All randomness is injected so results are reproducible from a seed. */

export type Rng = () => number;

/** Small seedable generator (mulberry32). */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const mean = (values: readonly number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/** Wilson score interval for a proportion (95% by default). */
export function wilson(successes: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export type Interval = { n: number; mean: number; lo: number; hi: number };

/** Percentile bootstrap of the mean of paired differences. */
export function pairedBootstrap(diffs: readonly number[], rng: Rng, iterations = 2000): Interval {
  const n = diffs.length;
  if (n === 0) return { n: 0, mean: 0, lo: 0, hi: 0 };
  const means: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) sum += diffs[Math.floor(rng() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return { n, mean: mean(diffs), lo: means[Math.floor(0.025 * (iterations - 1))], hi: means[Math.ceil(0.975 * (iterations - 1))] };
}

export type Verdict = "kill" | "inconclusive" | "pass" | "insufficient";

/**
 * Decision rule for a variant's success-rate difference against baseline.
 * - insufficient: too few valid pairs, or no baseline-vs-baseline noise estimate.
 * - kill: significantly worse (interval entirely below zero) or worse than the
 *   noise interval's lower edge. Any regression beyond noise kills the variant.
 * - pass: the interval rules out a drop larger than `margin`.
 * - inconclusive: everything else. Cost savings never turn this into a pass.
 */
export function verdictFor(input: { diff: Interval; noise: Interval | undefined; margin: number; minPairs: number }): Verdict {
  const { diff, noise, margin, minPairs } = input;
  if (!noise || diff.n < minPairs || noise.n < minPairs) return "insufficient";
  if (diff.hi < 0 || diff.mean < Math.min(0, noise.lo)) return "kill";
  if (diff.lo >= -margin) return "pass";
  return "inconclusive";
}
