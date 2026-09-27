import type { Intersection } from './contract.ts';

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`env ${name} must be a positive number, got "${raw}"`);
  return value;
}

export const config = {
  port: numberEnv('PORT', 3000),
  mqttUrl: process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883',
  mqttWsUrl: process.env.MQTT_WS_URL || 'wss://broker.hivemq.com:8884/mqtt',
  topicPrefix: process.env.TOPIC_PREFIX || 'siren-polnes26',
  // Tuning knobs for real-GPS tests: widen PASS_M if a phone never gets within 50 m of the stop line.
  radiusM: numberEnv('RADIUS_M', 1000),
  passM: numberEnv('PASS_M', 50),
  passHysteresisM: numberEnv('PASS_HYSTERESIS_M', 20),
  ttlS: numberEnv('TTL_S', 15),
  refreshS: numberEnv('REFRESH_S', 5),
  staleS: numberEnv('STALE_S', 15),
  // ponytail: static list of mission codes. Production: per-trip tokens issued by Command Center 112 / the referring
  // hospital, bound to one vehicleId and expiring when the trip ends.
  // Stored uppercase: the driver app uppercases what is typed.
  missionCodes: new Set((process.env.MISSION_CODES || 'DEMO-112').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)),
  // Key for the dashboard's Panel Demo (X-Demo-Key header). Empty = panel disabled.
  demoKey: process.env.DEMO_KEY || '',
};

/** Signalised intersections on the demo route (OSM highway=traffic_signals). axisA = route road axis. */
export const intersections: Intersection[] = [
  { id: 'S1', name: 'Simpang PB Sudirman – Bedadung – Anggrek', lat: -8.166863, lng: 113.704253, axisA: 35 },
  { id: 'S2', name: 'Simpang PB Sudirman – Mastrip – Sroedji', lat: -8.156951, lng: 113.71136, axisA: 35 },
  { id: 'S3', name: 'Simpang Sroedji – Slamet Riyadi – dr. Soebandi', lat: -8.151537, lng: 113.717539, axisA: 54 },
];
