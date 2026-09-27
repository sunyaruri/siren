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
  /** Codes a driver must send as `Authorization: Bearer <code>` before their GPS can trigger priority. */
  missionCodes: ReadonlySet<string>;
  dashboardDir: string;
  mobileDir?: string;
}

/** Intersection commands are retained so an ESP32 or dashboard gets the current state on (re)connect. */
export function publishCommands(publish: Publish, topicPrefix: string, commands: Command[]): void {
  for (const { intersectionId, cmd } of commands) publish(`${topicPrefix}/intersection/${intersectionId}/cmd`, cmd, true);
}

// ponytail: open CORS, auth is the mission code header, not the origin; restrict origins before any real deployment.
const cors: RequestHandler = (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
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

export function createApp({
  engine,
  publish,
  publicConfig,
  intersections,
  missionCodes,
  dashboardDir,
  mobileDir,
}: AppDeps): express.Express {
  const app = express();

  const requireMission: RequestHandler = (req, res, next) => {
    const code = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
    if (code === undefined || !missionCodes.has(code)) {
      res.status(401).json({ error: 'invalid mission code' });
      return;
    }
    next();
  };

  app.use(cors);
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/config', (_req, res) => {
    res.json(publicConfig);
  });

  app.get('/api/intersections', (_req, res) => {
    res.json(intersections);
  });

  // Lets the driver app reject a wrong code on the setup form instead of mid-mission.
  app.get('/api/mission', requireMission, (_req, res) => {
    res.sendStatus(204);
  });

  app.post('/api/gps', requireMission, (req, res) => {
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

  if (mobileDir) app.use('/mobile', express.static(mobileDir));
  // express.static hides dotfiles by default; Android TWA verification needs /.well-known/assetlinks.json.
  app.use('/.well-known', express.static(`${dashboardDir}/.well-known`));
  app.use(express.static(dashboardDir));
  app.use(onError);
  return app;
}
