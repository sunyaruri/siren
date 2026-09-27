import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type Publish } from './app.ts';
import type { Intersection } from './contract.ts';
import { PriorityEngine } from './priority.ts';

const X: Intersection = { id: 'X', name: 'Test', lat: 0, lng: 0, axisA: 0 };
const published: { topic: string; payload: object; retain: boolean }[] = [];
const publish: Publish = (topic, payload, retain) => {
  published.push({ topic, payload, retain });
};
const app = createApp({
  engine: new PriorityEngine([X], { radiusM: 1000, passM: 50, passHysteresisM: 20, ttlS: 15, staleS: 15 }),
  publish,
  publicConfig: { topicPrefix: 'test', mqttWsUrl: 'wss://example.invalid/mqtt', radiusM: 1000, staleS: 15 },
  intersections: [X],
  missionCodes: new Set(['CODE-1']),
  dashboardDir: import.meta.dirname,
});

let server: Server;
let base = '';
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const postGps = (body: string, code = 'CODE-1') =>
  fetch(`${base}/api/gps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${code}` },
    body,
  });

test('POST /api/gps rejects a missing or unknown mission code with 401 and publishes nothing', async () => {
  published.length = 0;
  const gps = JSON.stringify({ vehicleId: 'AMB-01', type: 'ambulance', lat: 0, lng: 0 });
  const noCode = await fetch(`${base}/api/gps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: gps });
  assert.equal(noCode.status, 401);
  assert.equal((await postGps(gps, 'WRONG')).status, 401);
  assert.deepEqual(published, []);
});

test('GET /api/mission checks the code', async () => {
  const check = (code: string) => fetch(`${base}/api/mission`, { headers: { authorization: `Bearer ${code}` } });
  assert.equal((await check('CODE-1')).status, 204);
  assert.equal((await check('WRONG')).status, 401);
});

test('POST /api/gps rejects an invalid payload with 400 and the bad fields', async () => {
  const res = await postGps(JSON.stringify({ vehicleId: 'A', type: 'taxi', lat: 0, lng: 0 }));
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid gps payload', fields: ['type'] });
});

test('POST /api/gps rejects malformed JSON with 400', async () => {
  const res = await postGps('{bad');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid json' });
});

test('POST /api/gps publishes vehicle + retained PRIORITY and returns nextIntersection', async () => {
  published.length = 0;
  const lat = (northM: number) => northM / 111_195;
  await postGps(JSON.stringify({ vehicleId: 'AMB-01', type: 'ambulance', lat: lat(-1100), lng: 0 }));
  const res = await postGps(JSON.stringify({ vehicleId: 'AMB-01', type: 'ambulance', lat: lat(-990), lng: 0, speed: 60 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { nextIntersection: { id: 'X', name: 'Test', distanceM: 990, mode: 'PRIORITY' } });
  assert.deepEqual(
    published.map((p) => [p.topic, p.retain]),
    [
      ['test/vehicle/AMB-01', false],
      ['test/vehicle/AMB-01', false],
      ['test/intersection/X/cmd', true],
    ],
  );
  assert.equal((published[2].payload as { mode: string }).mode, 'PRIORITY');
});

test('GET /api/intersections and /api/config', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/intersections`)).json(), [X]);
  const config = (await (await fetch(`${base}/api/config`)).json()) as { topicPrefix: string };
  assert.equal(config.topicPrefix, 'test');
});

test('serves /.well-known/assetlinks.json from the dashboard dir (Android TWA verification)', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'siren-dash-'));
  mkdirSync(join(dir, '.well-known'));
  writeFileSync(join(dir, '.well-known', 'assetlinks.json'), '[]');
  const wellKnownApp = createApp({
    engine: new PriorityEngine([X], { radiusM: 1000, passM: 50, passHysteresisM: 20, ttlS: 15, staleS: 15 }),
    publish,
    publicConfig: { topicPrefix: 'test', mqttWsUrl: 'wss://example.invalid/mqtt', radiusM: 1000, staleS: 15 },
    intersections: [X],
    missionCodes: new Set(),
    dashboardDir: dir,
  });
  const srv = wellKnownApp.listen(0);
  await new Promise((resolve) => srv.once('listening', resolve));
  const res = await fetch(`http://localhost:${(srv.address() as AddressInfo).port}/.well-known/assetlinks.json`);
  srv.close();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});
