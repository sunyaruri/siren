import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaFeatures, fitRidge, predictEtaS } from './eta.ts';

test('fitRidge recovers the weights of an exact linear relation', () => {
  const X = [
    [1, 0, 2],
    [1, 1, 0],
    [1, 2, 5],
    [1, 3, 1],
    [1, 4, 3],
  ];
  const y = X.map(([b, a, c]) => 4 * b + 2 * a - 3 * c);
  fitRidge(X, y, 0).forEach((w, i) => assert.ok(Math.abs(w - [4, 2, -3][i]) < 1e-9));
});

test('etaFeatures: constant speed gives distance/speed twice and zero accel', () => {
  const samples = [0, 1000, 2000].map((t) => ({ t, v: 10 }));
  assert.deepEqual(etaFeatures(500, samples, 2000), [1, 50, 50, 0.5, 0]);
});

test('etaFeatures: stopped vehicle stays finite, old samples are ignored', () => {
  const [, now, avg, , accel] = etaFeatures(
    400,
    [
      { t: 0, v: 20 },
      { t: 20_000, v: 0 },
    ],
    20_000,
  );
  assert.equal(now, 200);
  assert.equal(avg, 200);
  assert.equal(accel, 0);
});

test('predictEtaS clamps to 0..600 s', () => {
  assert.equal(predictEtaS([-50], [1]), 0);
  assert.equal(predictEtaS([5000], [1]), 600);
  assert.equal(predictEtaS([1, 2], [1, 3]), 7);
});

test('etaFeatures: accel needs at least 1 s of history and stays within ±5 m/s²', () => {
  assert.equal(etaFeatures(500, [{ t: 0, v: 0 }, { t: 5, v: 17 }], 5)[4], 0);
  assert.equal(etaFeatures(500, [{ t: 0, v: 0 }, { t: 1000, v: 17 }], 1000)[4], 5);
});
