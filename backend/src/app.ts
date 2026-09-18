import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { parseGps, type Intersection } from './contract.ts';
import type { Command, PriorityEngine } from './priority.ts';

export type Publish = (topic: string, payload: object, retain: boolean) => void;

/** Values the dashboard needs, so prefix/radius are not hardcoded twice. */
export interface PublicConfig {
  topicPrefix: string;
  mqttWsUrl: string;
  radiusM: number;
  staleS: number;
}

export interface AppDeps {
  engine: PriorityEngine;
  publish: Publish;
  publicConfig: PublicConfig;
  intersections: Intersection[];
  dashboardDir: string;
}

/** Intersection commands are retained so an ESP32 or dashboard gets the current state on (re)connect. */
export function publishCommands(publish: Publish, topicPrefix: string, commands: Command[]): void {
  for (const { intersectionId, cmd } of commands) publish(`${topicPrefix}/intersection/${intersectionId}/cmd`, cmd, true);
}

// ponytail: open CORS, the prototype API has no auth; restrict origins before any real deployment.
const cors: RequestHandler = (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
};

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid json' });
    return;
  }
  console.error('[http] request failed:', err);
  res.status(typeof err?.status === 'number' ? err.status : 500).json({ error: 'request failed' });
};

export function createApp({ engine, publish, publicConfig, intersections, dashboardDir }: AppDeps): express.Express {
  const app = express();
  app.use(cors);
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/config', (_req, res) => {
    res.json(publicConfig);
  });

  app.get('/api/intersections', (_req, res) => {
    res.json(intersections);
  });

  app.post('/api/gps', (req, res) => {
    const parsed = parseGps(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'invalid gps payload', fields: parsed.fields });
      return;
    }
    const gps = parsed.value;
    const now = Date.now();
    publish(`${publicConfig.topicPrefix}/vehicle/${gps.vehicleId}`, { ...gps, ts: now }, false);
    const { commands, next } = engine.update(gps, now);
    publishCommands(publish, publicConfig.topicPrefix, commands);
    res.json({ nextIntersection: next });
  });

  app.use(express.static(dashboardDir));
  app.use(onError);
  return app;
}
