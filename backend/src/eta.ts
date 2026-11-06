/**
 * ETA model: predicts how many seconds a vehicle needs to reach an intersection. A linear regression over hand-made
 * features, trained offline by `scripts/train-eta.ts`. The same `etaFeatures` runs at training and at runtime, so the
 * model never sees a differently shaped input.
 */

/** One speed reading: `t` in ms, `v` in m/s. */
export interface SpeedSample {
  t: number;
  v: number;
}

/** How far back the speed history goes. */
export const ETA_WINDOW_MS = 10_000;
/** Floor for speeds used as divisors (≈ 7 km/h), so a stopped vehicle gives a large but finite time. */
const MIN_V = 2;
/** Upper bound of every time-like feature and of the prediction. */
const MAX_S = 600;
/** m/s²; roughly what a heavy vehicle can brake or accelerate. */
const MAX_ACCEL = 5;

export const ETA_FEATURES = ['bias', 'distance/speedNow', 'distance/speedAvg10s', 'distanceKm', 'accel'] as const;

export function etaFeatures(distanceM: number, samples: readonly SpeedSample[], now: number): number[] {
  const recent = samples.filter((s) => now - s.t <= ETA_WINDOW_MS);
  const first = recent[0];
  const v = recent.at(-1)?.v ?? 0;
  const vAvg = recent.length > 0 ? recent.reduce((sum, s) => sum + s.v, 0) / recent.length : 0;
  const dtS = first ? (now - first.t) / 1000 : 0;
  // Fixes milliseconds apart (or a bad speed reading) would give an absurd acceleration; keep it physical.
  const accel = dtS >= 1 ? Math.min(Math.max((v - first.v) / dtS, -MAX_ACCEL), MAX_ACCEL) : 0;
  return [
    1,
    Math.min(distanceM / Math.max(v, MIN_V), MAX_S),
    Math.min(distanceM / Math.max(vAvg, MIN_V), MAX_S),
    distanceM / 1000,
    accel,
  ];
}

export function predictEtaS(weights: readonly number[], features: readonly number[]): number {
  const y = weights.reduce((sum, w, i) => sum + w * features[i], 0);
  return Math.min(Math.max(y, 0), MAX_S);
}

/** Ridge regression (least squares + `lambda`·‖w‖², bias not penalised) solved with Gaussian elimination. */
export function fitRidge(X: readonly number[][], y: readonly number[], lambda: number): number[] {
  const n = X[0].length;
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (j === i && i > 0 ? lambda : 0)),
  );
  X.forEach((row, k) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j];
      A[i][n] += row[i] * y[k];
    }
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) throw new Error('fitRidge: singular system');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}
