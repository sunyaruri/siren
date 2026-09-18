import path from 'node:path';
import { connect } from 'mqtt';
import { createApp, publishCommands, type Publish } from './app.ts';
import { config, intersections } from './config.ts';
import { PriorityEngine, type Command } from './priority.ts';

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

const engine = new PriorityEngine(intersections, config);

// Overwrite any retained PRIORITY left over from a previous run.
const reset = intersections.map((it): Command => ({ intersectionId: it.id, cmd: { mode: 'NORMAL', ts: Date.now() } }));
publishCommands(publish, config.topicPrefix, reset);

setInterval(() => publishCommands(publish, config.topicPrefix, engine.tick(Date.now())), config.refreshS * 1000);

const app = createApp({
  engine,
  publish,
  intersections,
  publicConfig: {
    topicPrefix: config.topicPrefix,
    mqttWsUrl: config.mqttWsUrl,
    radiusM: config.radiusM,
    staleS: config.staleS,
  },
  dashboardDir: path.join(import.meta.dirname, '../../dashboard'),
});

app.listen(config.port, (err) => {
  if (err) throw err;
  console.log(`[http] SIREN backend on http://localhost:${config.port}`);
});
