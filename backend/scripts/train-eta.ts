/**
 * Trains the ETA model (src/eta.ts) and writes its weights to src/eta-model.ts.
 *
 * shortcut: the training data is synthetic. Trips are simulated on the demo route with random cruise speeds, congestion,
 * stops and slow corners, plus GPS noise. Upgrade: record real ambulance trips (POST /api/gps logs) and train on those.
 *
 *   node scripts/train-eta.ts [--trips 400] [--seed 112]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { intersections } from '../src/config.ts';
import { ETA_FEATURES, etaFeatures, fitRidge, predictEtaS, type SpeedSample } from '../src/eta.ts';
import { haversineM, type LatLng } from '../src/geo.ts';
import { createRoute } from '../src/route.ts';

const { values } = parseArgs({
  options: {
    trips: { type: 'string', default: '400' },
    seed: { type: 'string', default: '112' },
  },
});
const TRIPS = Number(values.trips);
const RADIUS_M = 1000;
const LAMBDA = 1;

// mulberry32: seeded, so the same command always gives the same model.
let seed = Number(values.seed) >>> 0;
const rand = (): number => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (lo: number, hi: number): number => lo + rand() * (hi - lo);
const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const pairs = JSON.parse(readFileSync(path.join(import.meta.dirname, 'route.json'), 'utf8')) as [number, number][];
const route = createRoute(pairs.map(([lat, lng]) => ({ lat, lng })));
const stops = intersections.map((it) => ({ it, alongM: route.alongM(it) }));

const M_PER_DEG = 111_195;
const jitter = (p: LatLng, sigmaM: number): LatLng => ({
  lat: p.lat + (gauss() * sigmaM) / M_PER_DEG,
  lng: p.lng + (gauss() * sigmaM) / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)),
});

/** Heading change around `alongM`, in degrees; sharp corners make the driver slow down. */
function turnDeg(alongM: number): number {
  const a = route.pointAt(alongM - 25).heading;
  const b = route.pointAt(alongM + 25).heading;
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

interface Fix {
  t: number;
  alongM: number;
  pos: LatLng;
  /** Reported speed in m/s (what the phone sends). */
  v: number;
}

function simulateTrip(): Fix[] {
  const cruise = between(30, 80) / 3.6;
  const jams = Array.from({ length: Math.floor(between(0, 4)) }, () => {
    const from = between(0, route.totalM);
    return { from, to: from + between(100, 500), factor: between(0.15, 0.6) };
  });
  const holds = Array.from({ length: Math.floor(between(0, 3)) }, () => ({
    at: between(0, route.totalM),
    forS: between(5, 30),
    done: false,
  }));

  const fixes: Fix[] = [];
  let alongM = 0;
  let v = 0;
  let holdLeftS = 0;
  for (let t = 0; alongM < route.totalM && t < 3600_000; t += 1000) {
    let target = cruise;
    for (const jam of jams) if (alongM >= jam.from && alongM <= jam.to) target = cruise * jam.factor;
    if (turnDeg(alongM) > 40) target = Math.min(target, 25 / 3.6);
    for (const hold of holds) {
      if (!hold.done && alongM >= hold.at) {
        hold.done = true;
        holdLeftS = hold.forS;
      }
    }
    if (holdLeftS > 0) {
      holdLeftS -= 1;
      target = 0;
    }
    v = target > v ? Math.min(target, v + 2) : Math.max(target, v - 3);
    alongM += v;
    const reported = Math.max(0, v + gauss() * 0.5);
    fixes.push({
      t,
      alongM,
      pos: jitter(route.pointAt(alongM).pos, 4),
      v: reported,
    });
  }
  return fixes;
}

/** One sample per fix and per intersection still ahead within the radius; label = true seconds until it is reached. */
function samplesOf(fixes: Fix[]): { x: number[]; y: number[] }[] {
  const out: { x: number[]; y: number[] }[] = [];
  const history: SpeedSample[] = [];
  for (const fix of fixes) {
    history.push({ t: fix.t, v: fix.v });
    for (const { it, alongM } of stops) {
      if (alongM <= fix.alongM) continue;
      const d = haversineM(fix.pos, it);
      if (d > RADIUS_M) continue;
      const reached = fixes.find((f) => f.alongM >= alongM);
      if (!reached) continue;
      out.push({
        x: etaFeatures(d, history, fix.t),
        y: [(reached.t - fix.t) / 1000],
      });
    }
  }
  return out;
}

const trips = Array.from({ length: TRIPS }, simulateTrip);
const cut = Math.floor(TRIPS * 0.8);
const train = trips.slice(0, cut).flatMap(samplesOf);
const testSet = trips.slice(cut).flatMap(samplesOf);

const weights = fitRidge(
  train.map((s) => s.x),
  train.map((s) => s.y[0]),
  LAMBDA,
);

const mae = (predict: (x: number[]) => number, set: typeof testSet): number =>
  set.reduce((sum, s) => sum + Math.abs(predict(s.x) - s.y[0]), 0) / set.length;
const model = (x: number[]): number => predictEtaS(weights, x);
// Baseline: what a non-learning system would do, current distance / current speed.
const naive = (x: number[]): number => x[1];
const near = testSet.filter((s) => s.y[0] <= 60);

const round = (n: number, digits = 2): number => Number(n.toFixed(digits));
const report = {
  trips: TRIPS,
  trainSamples: train.length,
  testSamples: testSet.length,
  testMaeS: round(mae(model, testSet)),
  baselineMaeS: round(mae(naive, testSet)),
  testMaeNearS: round(mae(model, near)),
  baselineMaeNearS: round(mae(naive, near)),
};
console.table(report);
console.log('weights', Object.fromEntries(ETA_FEATURES.map((f, i) => [f, round(weights[i], 4)])));

const file = `// Generated by scripts/train-eta.ts; do not edit by hand. Re-train: npm run train:eta
// Training data: synthetic trips on the demo route (random speeds, congestion, stops, slow corners, GPS noise).
// MAE on held-out trips (s): model ${report.testMaeS} vs distance/speed ${report.baselineMaeS}; within 60 s of the
// intersection: model ${report.testMaeNearS} vs ${report.baselineMaeNearS}.
export const etaModel = {
  features: ${JSON.stringify(ETA_FEATURES)},
  weights: ${JSON.stringify(weights.map((w) => round(w, 6)))},
  report: ${JSON.stringify(report)},
} as const;
`;
writeFileSync(path.join(import.meta.dirname, '../src/eta-model.ts'), file);
console.log('wrote src/eta-model.ts');
