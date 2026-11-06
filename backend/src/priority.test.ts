import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GpsInput, Intersection, VehicleType } from './contract.ts';
import { PriorityEngine, phaseFor, type Command } from './priority.ts';

const X: Intersection = { id: 'X', name: 'Test', lat: 0, lng: 0, axisA: 0 };
const OPTS = { radiusM: 1000, passM: 50, passHysteresisM: 20, ttlS: 15, staleS: 15 };
/** ln ETA = ln distance − ln current speed: ETA = distance / speed, so the expected ETAs are easy to compute by hand. */
const ETA_IS_D_OVER_V = [0, 1, -1, 0, 0];
const M_PER_DEG = 111_195;
const at = (northM: number, eastM = 0) => ({ lat: northM / M_PER_DEG, lng: eastM / M_PER_DEG });
const fix = (p: { lat: number; lng: number }, vehicleId = 'AMB-01', type: VehicleType = 'ambulance'): GpsInput => ({
  vehicleId,
  type,
  ...p,
});
const priority = (ts: number, phase: 'A' | 'B' = 'A', vehicleId = 'AMB-01', vehicleType: VehicleType = 'ambulance'): Command[] => [
  { intersectionId: 'X', cmd: { mode: 'PRIORITY', phase, vehicleId, vehicleType, ttl: 15, ts } },
];
const normal = (ts: number): Command[] => [{ intersectionId: 'X', cmd: { mode: 'NORMAL', ts } }];

/** Feeds fixes 1 s apart starting at t=0; returns the commands of every step. */
function drive(engine: PriorityEngine, points: { lat: number; lng: number }[], vehicleId?: string, type?: VehicleType) {
  return points.map((p, i) => engine.update(fix(p, vehicleId, type), i * 1000).commands);
}

test('phaseFor: along the axis is A, across it is B, direction does not matter', () => {
  assert.equal(phaseFor(35, 215), 'A');
  assert.equal(phaseFor(35, 35), 'A');
  assert.equal(phaseFor(35, 125), 'B');
  assert.equal(phaseFor(0, 350), 'A');
  assert.equal(phaseFor(0, 270), 'B');
});

test('no trigger outside the radius, nor on the first fix inside it', () => {
  const engine = new PriorityEngine([X], OPTS);
  assert.deepEqual(engine.update(fix(at(-1200)), 0).commands, []);
  assert.deepEqual(new PriorityEngine([X], OPTS).update(fix(at(-900)), 0).commands, []);
});

test('approaching along the main road inside the radius triggers PRIORITY phase A once', () => {
  const engine = new PriorityEngine([X], OPTS);
  assert.deepEqual(drive(engine, [at(-1100), at(-990), at(-800)]), [[], priority(1000), []]);
});

test('approaching on the cross road gets phase B', () => {
  const engine = new PriorityEngine([X], OPTS);
  assert.deepEqual(drive(engine, [at(0, -1100), at(0, -990)]), [[], priority(1000, 'B')]);
});

test('returns to NORMAL after passing, and GPS jitter does not re-trigger', () => {
  const engine = new PriorityEngine([X], OPTS);
  const steps = drive(engine, [at(-1100), at(-990), at(-500), at(-30), at(10), at(25), at(35), at(34)]);
  assert.deepEqual(steps, [[], priority(1000), [], [], [], [], normal(6000), []]);
});

test('returns to NORMAL when the vehicle turns away and leaves the radius', () => {
  const engine = new PriorityEngine([X], OPTS);
  assert.deepEqual(drive(engine, [at(-1100), at(-990), at(-1010)]), [[], priority(1000), normal(2000)]);
});

test('first-come: a second vehicle waits until the intersection is released', () => {
  const engine = new PriorityEngine([X], OPTS);
  engine.update(fix(at(-1100)), 0);
  assert.deepEqual(engine.update(fix(at(-990)), 1000).commands, priority(1000));
  engine.update(fix(at(0, 1100), 'FIRE-01', 'firetruck'), 1000);
  const waiting = engine.update(fix(at(0, 990), 'FIRE-01', 'firetruck'), 2000);
  assert.deepEqual(waiting.commands, []);
  assert.equal(waiting.next?.mode, 'NORMAL', 'held for AMB-01, so not green for FIRE-01');
  for (const [i, north] of [-30, 10, 35].entries()) engine.update(fix(at(north)), 3000 + i * 1000);
  assert.deepEqual(
    engine.update(fix(at(0, 900), 'FIRE-01', 'firetruck'), 6000).commands,
    priority(6000, 'B', 'FIRE-01', 'firetruck'),
  );
});

test('tick refreshes a held PRIORITY with a new timestamp', () => {
  const engine = new PriorityEngine([X], OPTS);
  drive(engine, [at(-1100), at(-990)]);
  assert.deepEqual(engine.tick(6000), priority(6000));
});

test('tick releases the intersection when its vehicle goes stale', () => {
  const engine = new PriorityEngine([X], OPTS);
  drive(engine, [at(-1100), at(-990)]);
  assert.deepEqual(engine.tick(1000 + 15_001), normal(16_001));
  assert.deepEqual(engine.tick(20_000), []);
});

test('update reports the next intersection, with its ETA, until it is passed', () => {
  const engine = new PriorityEngine([X], OPTS, ETA_IS_D_OVER_V);
  // First fix: no speed known yet, so the speed floor (4 m/s) caps the ETA at 1100 / 4 = 275 s.
  assert.deepEqual(engine.update(fix(at(-1100)), 0).next, { id: 'X', name: 'Test', distanceM: 1100, mode: 'NORMAL', etaS: 275 });
  // No `speed` sent: 110 m in 1 s from the previous fix, so 990 / 110 = 9 s.
  assert.deepEqual(engine.update(fix(at(-990)), 1000).next, { id: 'X', name: 'Test', distanceM: 990, mode: 'PRIORITY', etaS: 9 });
  for (const [i, north] of [-30, 10].entries()) engine.update(fix(at(north)), 2000 + i * 1000);
  assert.equal(engine.update(fix(at(35)), 4000).next, null);
});

test('next never points back at an intersection already passed on this trip', () => {
  const engine = new PriorityEngine([X], OPTS);
  // pass X, drive out of the radius, then the road curves back so X gets closer again (still > radius)
  drive(engine, [at(-1100), at(-990), at(-30), at(10), at(35), at(1200)]);
  assert.equal(engine.update(fix(at(1150)), 6000).next, null);
});

test('forget releases only what that vehicle held', () => {
  const engine = new PriorityEngine([X], OPTS);
  drive(engine, [at(-900), at(-800)]);
  assert.deepEqual(engine.forget('OTHER', 5000), []);
  assert.deepEqual(engine.forget('AMB-01', 5000), normal(5000));
  assert.deepEqual(engine.tick(6000), []);
});

test('reset releases held intersections and forgets vehicles', () => {
  const engine = new PriorityEngine([X], OPTS);
  drive(engine, [at(-900), at(-800)]);
  assert.deepEqual(engine.reset(5000), normal(5000));
  // A forgotten vehicle needs two closing fixes again before it can trigger.
  assert.deepEqual(engine.update(fix(at(-700)), 6000).commands, []);
  assert.deepEqual(engine.update(fix(at(-600)), 7000).commands, priority(7000));
});

test('an intersection passed on this trip does not re-trigger when the route bends back toward it', () => {
  // Real case: after S3 the demo route turns back toward S2, which it passed earlier (radius 850 m).
  const engine = new PriorityEngine([X], OPTS);
  const out = drive(engine, [at(-900), at(-800), at(-30), at(30), at(80), at(600), at(1100), at(900), at(700), at(500)]);
  assert.deepEqual(out.slice(0, 5).flat(), [...priority(1000), ...normal(4000)]);
  assert.deepEqual(out.slice(5).flat(), []);
});

test('stopReleaseS: a vehicle stopped for 3 minutes releases its green; moving again resets the clock', () => {
  const engine = new PriorityEngine([X], { ...OPTS, stopReleaseS: 180 });
  const moving = (northM: number) => ({ ...fix(at(northM)), speed: 36 });
  const parked = { ...fix(at(-500)), speed: 0 };
  engine.update(moving(-1100), 0);
  assert.deepEqual(engine.update(moving(-990), 1000).commands, priority(1000));
  engine.update(moving(-500), 2000);
  for (let t = 3000; t < 3000 + 100_000; t += 5000) assert.deepEqual(engine.update(parked, t).commands, []);
  engine.update(moving(-490), 103_000); // drives a few meters: the stop clock restarts
  for (let t = 104_000; t < 104_000 + 180_000; t += 5000) assert.deepEqual(engine.update(parked, t).commands, []);
  assert.deepEqual(engine.update(parked, 284_000).commands, normal(284_000), '180 s stopped: released');
  assert.deepEqual(engine.update(parked, 289_000).commands, [], 'still parked: no re-trigger');
});

test('etaLeadS: inside the radius, green waits until the predicted ETA is short enough', () => {
  const engine = new PriorityEngine([X], { ...OPTS, etaLeadS: 20 }, ETA_IS_D_OVER_V);
  const at10ms = (northM: number) => ({ ...fix(at(northM)), speed: 36 });
  assert.deepEqual(engine.update(at10ms(-900), 0).commands, []);
  assert.deepEqual(engine.update(at10ms(-890), 1000).commands, [], 'ETA 89 s > 20 s: not yet');
  assert.deepEqual(engine.update(at10ms(-210), 2000).commands, [], 'ETA 21 s');
  const [cmd] = engine.update(at10ms(-200), 3000).commands;
  assert.deepEqual(cmd, { intersectionId: 'X', cmd: { ...priority(3000)[0].cmd, etaS: 20 } }, 'ETA 20 s: green');
  assert.equal((engine.tick(8000)[0].cmd as { etaS?: number }).etaS, 20, 'refresh keeps the triggering ETA');
});

test('etaLeadS: a fast vehicle gets green as soon as it is inside the radius', () => {
  const engine = new PriorityEngine([X], { ...OPTS, etaLeadS: 20 }, ETA_IS_D_OVER_V);
  const fast = (northM: number) => ({ ...fix(at(northM)), speed: 216 }); // 60 m/s
  assert.deepEqual(engine.update(fast(-1050), 0).commands, []);
  assert.deepEqual(engine.update(fast(-990), 1000).commands, [
    // 989.9993 m / 60 m/s = 16.49999 s: predictEtaS keeps 1 ms (16.5), the command rounds that to 17
    { intersectionId: 'X', cmd: { ...priority(1000)[0].cmd, etaS: 17 } },
  ]);
});
