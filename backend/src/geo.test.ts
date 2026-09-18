import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearingDeg, haversineM } from './geo.ts';

test('haversineM: one degree of latitude is ~111,195 m', () => {
  const d = haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111_195) < 1, `got ${d}`);
});

test('haversineM: same point is 0', () => {
  const p = { lat: -8.166863, lng: 113.704253 };
  assert.equal(haversineM(p, p), 0);
});

test('bearingDeg: cardinal directions', () => {
  const o = { lat: 0, lng: 0 };
  assert.equal(Math.round(bearingDeg(o, { lat: 1, lng: 0 })), 0);
  assert.equal(Math.round(bearingDeg(o, { lat: 0, lng: 1 })), 90);
  assert.equal(Math.round(bearingDeg(o, { lat: -1, lng: 0 })), 180);
  assert.equal(Math.round(bearingDeg(o, { lat: 0, lng: -1 })), 270);
});
