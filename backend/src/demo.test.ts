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
  assert.deepEqual(runner.list(10_000), [
    { vehicleId: 'AMB-SIM1', type: 'ambulance', alongM: 1100, speedKmh: 36, paused: false, arrived: false },
  ]);

  const [fix] = runner.tick(10_000).fixes;
  assert.equal(fix.vehicleId, 'AMB-SIM1');
  assert.equal(Math.round(fix.heading ?? -1), 0);

  runner.start('firetruck', 0, 36, 0);
  assert.deepEqual(runner.removeAll(), ['AMB-SIM1', 'DMK-SIM2']);
  assert.deepEqual(runner.list(0), []);
});

test('DemoRunner pause freezes the vehicle in place, resume continues, rewind parks it at its start', () => {
  const runner = new DemoRunner(route);
  runner.start('ambulance', 100, 36, 0); // 10 m/s
  runner.pauseAll(10_000);
  const frozen = runner.tick(60_000).fixes[0];
  assert.equal(frozen.speed, 0, 'a paused vehicle reports speed 0');
  assert.deepEqual(runner.list(60_000)[0], {
    vehicleId: 'AMB-SIM1',
    type: 'ambulance',
    alongM: 200,
    speedKmh: 36,
    paused: true,
    arrived: false,
  });

  runner.resumeAll(60_000);
  assert.equal(runner.list(70_000)[0].alongM, 300);

  assert.deepEqual(runner.rewindAll(60_000), ['AMB-SIM1']);
  assert.deepEqual(runner.list(99_000)[0], {
    vehicleId: 'AMB-SIM1',
    type: 'ambulance',
    alongM: 100,
    speedKmh: 36,
    paused: true,
    arrived: false,
  });
});

test('DemoRunner: arriving ends the trip once, keeps the run parked, and Reset can replay it', () => {
  const runner = new DemoRunner(route);
  runner.start('ambulance', 2000, 36, 0); // 10 m/s, ~224 m before the end
  assert.deepEqual(runner.tick(10_000).arrived, []);
  const atEnd = runner.tick(30_000);
  assert.equal(atEnd.fixes.length, 1, 'last fix sits at the route end');
  assert.deepEqual(atEnd.arrived, ['AMB-SIM1']);
  assert.deepEqual(runner.tick(31_000), { fixes: [], arrived: [] }, 'an arrived vehicle stops reporting');
  assert.equal(runner.list(31_000)[0].arrived, true);

  runner.resumeAll(32_000);
  assert.deepEqual(runner.tick(33_000).fixes, [], 'resume does not wake an arrived vehicle');

  runner.rewindAll(39_000);
  runner.resumeAll(40_000);
  assert.equal(runner.tick(40_000).fixes.length, 1, 'after Reset it drives again from its start');
  assert.equal(runner.list(40_000)[0].alongM, 2000);
});

test('DemoRunner.pruneIdle removes runs paused for longer than idleMs, never moving ones', () => {
  const route = createRoute([
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.05 },
  ]);
  const runner = new DemoRunner(route);
  runner.start('ambulance', 0, 60, 0);
  assert.deepEqual(runner.pruneIdle(600_000, 300_000), [], 'driving: kept');
  runner.pauseAll(10_000);
  assert.deepEqual(runner.pruneIdle(309_999, 300_000), [], 'paused 299.999 s: kept');
  assert.deepEqual(runner.pruneIdle(310_000, 300_000), ['AMB-SIM1'], 'paused 5 min: removed');
  assert.deepEqual(runner.list(310_000), []);
});
