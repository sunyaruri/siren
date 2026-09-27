// Pretends to be the driver mobile app: drives along route.json and POSTs /api/gps every interval.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import type { NextIntersection } from '../src/contract.ts';
import { createRoute } from '../src/route.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    id: { type: 'string', default: 'AMB-01' },
    type: { type: 'string', default: 'ambulance' },
    speed: { type: 'string', default: '60' }, // km/h
    interval: { type: 'string', default: '1000' }, // ms between fixes
    code: { type: 'string', default: 'DEMO-112' }, // mission code, must be in the server's MISSION_CODES
  },
});
const speedKmh = Number(values.speed);
const intervalMs = Number(values.interval);
if (!(speedKmh > 0) || !(intervalMs > 0)) throw new Error('--speed and --interval must be positive numbers');

const raw = JSON.parse(readFileSync(new URL('./route.json', import.meta.url), 'utf8')) as [number, number][];
const route = createRoute(raw.map(([lat, lng]) => ({ lat, lng })));
const totalM = route.totalM;

const stepM = (speedKmh / 3.6) * (intervalMs / 1000);
console.log(`[sim] ${values.id} (${values.type}) ${(totalM / 1000).toFixed(2)} km @ ${speedKmh} km/h -> ${values.url}`);

for (let travelled = 0; ; travelled += stepM) {
  const { pos, heading } = route.pointAt(travelled);
  const res = await fetch(`${values.url}/api/gps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${values.code}` },
    body: JSON.stringify({ vehicleId: values.id, type: values.type, lat: pos.lat, lng: pos.lng, speed: speedKmh, heading }),
  });
  const body = (await res.json()) as { nextIntersection?: NextIntersection | null };
  if (!res.ok) throw new Error(`POST /api/gps -> ${res.status} ${JSON.stringify(body)}`);
  const next = body.nextIntersection;
  const km = (Math.min(travelled, totalM) / 1000).toFixed(2);
  console.log(`[sim] ${km} km | next: ${next ? `${next.id} ${next.distanceM} m ${next.mode}` : '-'}`);
  if (travelled >= totalM) break;
  await sleep(intervalMs);
}
console.log('[sim] arrived at destination');
