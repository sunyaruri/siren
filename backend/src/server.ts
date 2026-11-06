import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connect } from 'mqtt';
import { createApp, type PublicConfig } from './app.ts';
import { config, intersections } from './config.ts';
import { publishDemo, restoreDemoDefaults, type DemoDefaults, type DemoDeps } from './demo-api.ts';
import { DemoRunner } from './demo.ts';
import { PriorityEngine, type Command } from './priority.ts';
import { ingestGps, publishCommands, removeVehicle, type Publish } from './publish.ts';
import { createRoute } from './route.ts';

const client = connect(config.mqttUrl, {
  clientId: `siren-backend-${Math.random().toString(16).slice(2, 10)}`,
  reconnectPeriod: 2000,
});
client.on('connect', () => console.log(`[mqtt] connected to ${config.mqttUrl}`));
client.on('reconnect', () => console.warn('[mqtt] connection lost, reconnecting...'));
client.on('error', (err) => console.error(`[mqtt] ${err.message}`));

// QoS 0 messages published while offline are queued by mqtt.js and flushed on reconnect.
const publish: Publish = (topic, payload, retain) => {
  client.publish(topic, JSON.stringify(payload), { qos: 0, retain });
};

// `config` doubles as the engine options, so the Panel Demo's radius change is seen by the engine directly.
const engine = new PriorityEngine(intersections, config);

const routePairs = JSON.parse(readFileSync(path.join(import.meta.dirname, '../scripts/route.json'), 'utf8')) as [number, number][];
const route = createRoute(routePairs.map(([lat, lng]) => ({ lat, lng })));
const demo: DemoDeps = {
  key: config.demoKey,
  runner: new DemoRunner(route),
  route,
  // 2350 m along the route = Jl. PB Sudirman between S1 and S2, the Citizen HUD's old fixed demo point.
  settings: { citizenAlongM: 2350, speedKmh: 60 },
  engineOpts: config,
  lastAdminAt: 0,
};
// The shared demo cleans up after itself so every visitor (e.g. a judge) finds it as the server started.
const demoDefaults: DemoDefaults = { codes: [...config.missionCodes], radiusM: config.radiusM, settings: { ...demo.settings } };
const DEMO_IDLE_MS = 5 * 60_000; // paused/arrived demo vehicles are removed after this
const DEMO_SETTINGS_RESET_MS = 30 * 60_000; // Panel Demo settings revert after this long without operator activity
const publicConfig: PublicConfig = {
  topicPrefix: config.topicPrefix,
  mqttWsUrl: config.mqttWsUrl,
  radiusM: config.radiusM,
  staleS: config.staleS,
  simSpeedKmh: demo.settings.speedKmh,
  etaLeadS: config.etaLeadS,
};

// Overwrite any retained PRIORITY left over from a previous run, and any demo settings from another server.
const reset = intersections.map((it): Command => ({ intersectionId: it.id, cmd: { mode: 'NORMAL', ts: Date.now() } }));
publishCommands(publish, config.topicPrefix, reset);
publishDemo(publish, publicConfig, demo, Date.now());

setInterval(() => publishCommands(publish, config.topicPrefix, engine.tick(Date.now())), config.refreshS * 1000);
setInterval(() => {
  const now = Date.now();
  const { fixes, arrived } = demo.runner.tick(now);
  for (const gps of fixes) ingestGps(publish, engine, config.topicPrefix, gps, now);
  for (const id of arrived) removeVehicle(publish, engine, config.topicPrefix, id, now);
  for (const id of demo.runner.pruneIdle(now, DEMO_IDLE_MS)) removeVehicle(publish, engine, config.topicPrefix, id, now);
  if (demo.lastAdminAt && now - demo.lastAdminAt > DEMO_SETTINGS_RESET_MS) {
    restoreDemoDefaults({ demo, publicConfig, missionCodes: config.missionCodes, publish }, demoDefaults, now);
    demo.lastAdminAt = 0;
  }
}, 1000);

const app = createApp({
  engine,
  publish,
  intersections,
  missionCodes: config.missionCodes,
  demo,
  publicConfig,
  dashboardDir: path.join(import.meta.dirname, '../../dashboard'),
  mobileDir: path.join(import.meta.dirname, '../../mobile'),
  landingDir: path.join(import.meta.dirname, '../../landing'),
});

app.listen(config.port, (err) => {
  if (err) throw err;
  console.log(`[http] SIREN backend on http://localhost:${config.port}${config.demoKey ? '' : ' (Panel Demo off: set DEMO_KEY)'}`);
});
