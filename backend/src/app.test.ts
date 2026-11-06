import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { MAX_PUBLIC_RUNS } from './demo-api.ts';
import { DemoRunner } from './demo.ts';
import type { Publish } from './publish.ts';
import { createRoute } from './route.ts';
import type { Intersection } from './contract.ts';
import { PriorityEngine } from './priority.ts';

const X: Intersection = { id: 'X', name: 'Test', lat: 0, lng: 0, axisA: 0 };
const published: { topic: string; payload: object; retain: boolean }[] = [];
const publish: Publish = (topic, payload, retain) => {
  published.push({ topic, payload, retain });
};
const route = createRoute([
  { lat: -0.01, lng: 0 },
  { lat: 0, lng: 0 },
]);
const engineOpts = { radiusM: 1000, passM: 50, passHysteresisM: 20, ttlS: 15, staleS: 15 };
const app = createApp({
  engine: new PriorityEngine([X], engineOpts),
  publish,
  publicConfig: { topicPrefix: 'test', mqttWsUrl: 'wss://example.invalid/mqtt', radiusM: 1000, staleS: 15, simSpeedKmh: 60, etaLeadS: 40 },
  intersections: [X],
  missionCodes: new Set(['CODE-1']),
  demo: {
    key: 'demo-key',
    runner: new DemoRunner(route),
    route,
    settings: { citizenAlongM: 0, speedKmh: 60 },
    engineOpts,
  },
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
  const { nextIntersection } = (await res.json()) as { nextIntersection: { etaS: number } };
  assert.ok(nextIntersection.etaS > 0 && nextIntersection.etaS < 600, `etaS ${nextIntersection.etaS}`);
  assert.deepEqual(nextIntersection, { id: 'X', name: 'Test', distanceM: 990, mode: 'PRIORITY', etaS: nextIntersection.etaS });
  assert.deepEqual(published[1].payload, {
    vehicleId: 'AMB-01',
    type: 'ambulance',
    lat: lat(-990),
    lng: 0,
    speed: 60,
    nextId: 'X',
    etaS: nextIntersection.etaS,
    ts: (published[1].payload as { ts: number }).ts,
  });
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

test('static files are served with Cache-Control: no-cache', async () => {
  const res = await fetch(`${base}/dashboard/geo.ts`); // dashboardDir is src/ in these tests
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
});

test('GET /api/intersections, /api/config and /api/route', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/intersections`)).json(), [X]);
  assert.deepEqual(await (await fetch(`${base}/api/route`)).json(), [
    [-0.01, 0],
    [0, 0],
  ]);
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
    publicConfig: { topicPrefix: 'test', mqttWsUrl: 'wss://example.invalid/mqtt', radiusM: 1000, staleS: 15, simSpeedKmh: 60, etaLeadS: 40 },
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

const demoApi = (method: string, path: string, body?: object, key = 'demo-key') =>
  fetch(`${base}/api/demo${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-demo-key': key },
    body: body && JSON.stringify(body),
  });

test('Panel Demo API rejects a wrong key', async () => {
  assert.equal((await demoApi('GET', '/', undefined, 'nope')).status, 401);
});

test('PUT /api/demo changes codes and radius live and publishes the retained demo topic', async () => {
  published.length = 0;
  const res = await demoApi('PUT', '/', { codes: ['live-1'], radiusM: 500 });
  assert.equal(res.status, 200);
  const state = (await res.json()) as { codes: string[]; radiusM: number; stops: { id: string; alongM: number }[] };
  assert.deepEqual(state.codes, ['LIVE-1']);
  assert.equal(state.radiusM, 500);
  assert.equal(engineOpts.radiusM, 500);
  assert.deepEqual(state.stops, [{ id: 'X', alongM: 1112 }]);
  assert.deepEqual(
    published.map((p) => [p.topic, p.retain]),
    [['test/demo', true]],
  );

  const gps = JSON.stringify({ vehicleId: 'AMB-01', type: 'ambulance', lat: 0, lng: 0 });
  assert.equal((await postGps(gps, 'CODE-1')).status, 401, 'old code no longer accepted');
  assert.equal((await postGps(gps, 'LIVE-1')).status, 200);
  assert.equal(((await (await fetch(`${base}/api/config`)).json()) as { radiusM: number }).radiusM, 500);

  await demoApi('PUT', '/', { codes: ['CODE-1'], radiusM: 1000 });
});

test('POST /api/demo/run starts a vehicle; reset parks it at its start and publishes gone + NORMAL', async () => {
  const run = (await (await demoApi('POST', '/run', { type: 'firetruck', startM: 100 })).json()) as { runs: { vehicleId: string }[] };
  assert.deepEqual(
    run.runs.map((r) => r.vehicleId),
    ['DMK-SIM1'],
  );
  published.length = 0;
  const reset = (await (await demoApi('POST', '/reset')).json()) as { runs: { alongM: number; paused: boolean }[] };
  assert.deepEqual(reset.runs, [{ vehicleId: 'DMK-SIM1', type: 'firetruck', alongM: 100, speedKmh: 60, paused: true, arrived: false }]);
  assert.deepEqual(
    published.map((p) => p.topic),
    ['test/vehicle/DMK-SIM1', 'test/intersection/X/cmd', 'test/demo'],
  );
  assert.equal((published[0].payload as { gone?: boolean }).gone, true);
});

test('pause and resume toggle the demo vehicles; clear removes them and publishes gone', async () => {
  const paused = (await (await demoApi('POST', '/pause')).json()) as { runs: { paused: boolean }[] };
  assert.ok(paused.runs.every((r) => r.paused));
  const resumed = (await (await demoApi('POST', '/resume')).json()) as { runs: { paused: boolean }[] };
  assert.ok(resumed.runs.every((r) => !r.paused));

  published.length = 0;
  const cleared = (await (await demoApi('POST', '/clear')).json()) as { runs: unknown[] };
  assert.deepEqual(cleared.runs, []);
  assert.deepEqual(
    published.map((p) => [p.topic, (p.payload as { gone?: boolean }).gone]),
    [['test/vehicle/DMK-SIM1', true]],
  );
});

test('POST /api/mission/end releases the vehicle at once and publishes gone', async () => {
  const lat = (northM: number) => northM / 111_195;
  await postGps(JSON.stringify({ vehicleId: 'AMB-END', type: 'ambulance', lat: lat(-900), lng: 0 }));
  await postGps(JSON.stringify({ vehicleId: 'AMB-END', type: 'ambulance', lat: lat(-800), lng: 0 }));
  published.length = 0;
  const end = (body: object, code = 'CODE-1') =>
    fetch(`${base}/api/mission/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${code}` },
      body: JSON.stringify(body),
    });
  assert.equal((await end({ vehicleId: 'AMB-END' }, 'WRONG')).status, 401);
  assert.equal((await end({ vehicleId: 'a/b' })).status, 400);
  assert.equal((await end({ vehicleId: 'AMB-END' })).status, 204);
  assert.deepEqual(
    published.map((p) => {
      const payload = p.payload as { mode?: string; gone?: boolean };
      return [p.topic, payload.mode ?? payload.gone];
    }),
    [
      ['test/intersection/X/cmd', 'NORMAL'],
      ['test/vehicle/AMB-END', true],
    ],
  );
});

test('POST /api/demo/quick-run needs no key, is capped, and the rest of the panel stays locked', async () => {
  await demoApi('POST', '/clear');
  const quick = () => fetch(`${base}/api/demo/quick-run`, { method: 'POST' });
  for (let i = 0; i < MAX_PUBLIC_RUNS; i++) assert.equal((await quick()).status, 201);
  assert.equal((await quick()).status, 429, 'cap reached');
  assert.equal((await fetch(`${base}/api/demo/clear`, { method: 'POST' })).status, 401, 'clear still needs the key');
  await demoApi('POST', '/clear');
  assert.equal((await quick()).status, 201, 'room again after clearing');
  await demoApi('POST', '/clear');
});
