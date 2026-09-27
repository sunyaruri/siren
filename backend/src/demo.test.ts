import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoRunner, parseDemoPatch, parseRun } from './demo.ts';
import { createRoute } from './route.ts';

// Straight line due north, ≈ 2224 m long.
const route = createRoute([
  { lat: 0, lng: 0 },
  { lat: 0.02, lng: 0 },
]);

test('parseDemoPatch accepts partial settings and uppercases codes', () => {
  assert.deepEqual(parseDemoPatch({ radiusM: 500, codes: [' amb-07 ', 'DEMO-112'] }), {
    ok: true,
    value: { radiusM: 500, codes: ['AMB-07', 'DEMO-112'] },
  });
  assert.deepEqual(parseDemoPatch({}), { ok: true, value: {} });
});

test('parseDemoPatch rejects out-of-range numbers and bad codes', () => {
  assert.deepEqual(parseDemoPatch({ radiusM: 10, speedKmh: 'fast', codes: ['has space'] }), {
    ok: false,
    fields: ['radiusM', 'speedKmh', 'codes'],
  });
});

test('parseRun needs a known type and a start distance', () => {
  assert.deepEqual(parseRun({ type: 'firetruck', startM: 0 }), { ok: true, value: { type: 'firetruck', startM: 0 } });
  assert.deepEqual(parseRun({ type: 'taxi' }), { ok: false, fields: ['type', 'startM'] });
});

test('DemoRunner moves at the set speed and drops the run after the route end', () => {
  const runner = new DemoRunner(route);
  const id = runner.start('ambulance', 1000, 36, 0); // 36 km/h = 10 m/s
  assert.equal(id, 'AMB-SIM1');
  assert.deepEqual(runner.list(10_000), [{ vehicleId: 'AMB-SIM1', type: 'ambulance', alongM: 1100, speedKmh: 36 }]);

  const [fix] = runner.tick(10_000);
  assert.equal(fix.vehicleId, 'AMB-SIM1');
  assert.equal(Math.round(fix.heading ?? -1), 0);

  assert.equal(runner.tick(1_000_000).length, 1, 'last fix sits at the route end');
  assert.deepEqual(runner.tick(1_001_000), []);
});
