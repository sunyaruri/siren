import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGps } from './contract.ts';

test('parseGps accepts a full valid payload', () => {
  const body = { vehicleId: 'AMB-01', type: 'ambulance', lat: -8.17, lng: 113.69, speed: 60, heading: 45 };
  assert.deepEqual(parseGps(body), { ok: true, value: body });
});

test('parseGps accepts a payload without optional speed/heading', () => {
  const body = { vehicleId: 'FIRE_2', type: 'firetruck', lat: -8.17, lng: 113.69 };
  assert.deepEqual(parseGps(body), { ok: true, value: body });
});

test('parseGps lists every invalid field', () => {
  const body = { vehicleId: 'bad/id', type: 'taxi', lat: 91, lng: 'x', speed: -1, heading: 360 };
  assert.deepEqual(parseGps(body), { ok: false, fields: ['vehicleId', 'type', 'lat', 'lng', 'speed', 'heading'] });
});

test('parseGps rejects a non-object body', () => {
  assert.deepEqual(parseGps(null), { ok: false, fields: ['vehicleId', 'type', 'lat', 'lng'] });
});
