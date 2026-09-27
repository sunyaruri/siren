import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoute } from './route.ts';

// Straight line due north: 0.01° of latitude ≈ 1112 m per segment.
const route = createRoute([
  { lat: 0, lng: 0 },
  { lat: 0.01, lng: 0 },
  { lat: 0.02, lng: 0 },
]);

test('pointAt interpolates along the route and clamps to both ends', () => {
  assert.ok(Math.abs(route.totalM - 2224) < 1, `got ${route.totalM}`);
  const mid = route.pointAt(route.totalM / 2);
  assert.ok(Math.abs(mid.pos.lat - 0.01) < 1e-9);
  assert.equal(Math.round(mid.heading), 0);
  assert.deepEqual(route.pointAt(-50).pos, { lat: 0, lng: 0 });
  assert.deepEqual(route.pointAt(1e9).pos, { lat: 0.02, lng: 0 });
});

test('alongM returns the distance of the nearest vertex', () => {
  assert.ok(Math.abs(route.alongM({ lat: 0.0101, lng: 0.0001 }) - route.totalM / 2) < 1e-6);
  assert.equal(route.alongM({ lat: 0.03, lng: 0 }), route.totalM);
});
