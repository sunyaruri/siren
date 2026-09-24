import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GpsInput, Intersection, VehicleType } from './contract.ts';
import { PriorityEngine, phaseFor, type Command } from './priority.ts';

const X: Intersection = { id: 'X', name: 'Test', lat: 0, lng: 0, axisA: 0 };
const OPTS = { radiusM: 1000, passM: 50, passHysteresisM: 20, ttlS: 15, staleS: 15 };
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
  assert.deepEqual(engine.update(fix(at(0, 990), 'FIRE-01', 'firetruck'), 2000).commands, []);
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

test('update reports the next intersection until it is passed', () => {
  const engine = new PriorityEngine([X], OPTS);
  assert.deepEqual(engine.update(fix(at(-1100)), 0).next, { id: 'X', name: 'Test', distanceM: 1100, mode: 'NORMAL' });
  assert.deepEqual(engine.update(fix(at(-990)), 1000).next, { id: 'X', name: 'Test', distanceM: 990, mode: 'PRIORITY' });
  for (const [i, north] of [-30, 10].entries()) engine.update(fix(at(north)), 2000 + i * 1000);
  assert.equal(engine.update(fix(at(35)), 4000).next, null);
});

test('next never points back at an intersection already passed on this trip', () => {
  const engine = new PriorityEngine([X], OPTS);
  // pass X, drive out of the radius, then the road curves back so X gets closer again (still > radius)
  drive(engine, [at(-1100), at(-990), at(-30), at(10), at(35), at(1200)]);
  assert.equal(engine.update(fix(at(1150)), 6000).next, null);
});
