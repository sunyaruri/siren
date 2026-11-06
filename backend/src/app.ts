import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { parseGps, VEHICLE_ID, type Intersection } from './contract.ts';
import { demoRouter, type DemoDeps } from './demo-api.ts';
import type { PriorityEngine } from './priority.ts';
import { ingestGps, removeVehicle, type Publish } from './publish.ts';

/** Values the dashboard needs, so prefix/radius are not hardcoded twice. */
export interface PublicConfig {
  topicPrefix: string;
  mqttWsUrl: string;
  radiusM: number;
  staleS: number;
  /** Speed of the driver PWA's route simulator; set from the Panel Demo. */
  simSpeedKmh: number;
  /** Predictive trigger threshold (s); 0 = radius only. Lets the dashboard explain when green opens. */
  etaLeadS: number;
  /** A held green is released after the vehicle has stopped this long (s); 0 = never. */
  stopReleaseS: number;
}

export interface AppDeps {
  engine: PriorityEngine;
  publish: Publish;
  publicConfig: PublicConfig;
  intersections: Intersection[];
  /** Codes a driver must send as `Authorization: Bearer <code>` before their GPS can trigger priority. */
  missionCodes: Set<string>;
  /** Panel Demo backend; omitted in tests that do not need it. */
  demo?: DemoDeps;
  dashboardDir: string;
  mobileDir?: string;
  /** Public landing page served at `/`; the dashboard then lives at `/dashboard/`. */
  landingDir?: string;
}

// ponytail: open CORS, auth is the mission code header, not the origin; restrict origins before any real deployment.
const cors: RequestHandler = (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-demo-key',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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
  demo,
  dashboardDir,
  mobileDir,
  landingDir,
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

  // Demo route as [lat, lng] pairs, for the dashboard's route line and start/end markers.
  app.get('/api/route', (_req, res) => {
    res.json(demo ? demo.route.points.map((p) => [p.lat, p.lng]) : []);
  });

  // Lets the driver app reject a wrong code on the setup form instead of mid-mission.
  app.get('/api/mission', requireMission, (_req, res) => {
    res.sendStatus(204);
  });

  // Driver pressed "Selesai Misi". Only the vehicleId is needed; it is validated like in POST /api/gps.
  app.post('/api/mission/end', requireMission, (req, res) => {
    const vehicleId: unknown = req.body?.vehicleId;
    if (typeof vehicleId !== 'string' || !VEHICLE_ID.test(vehicleId)) {
      res.status(400).json({ error: 'invalid vehicleId' });
      return;
    }
    removeVehicle(publish, engine, publicConfig.topicPrefix, vehicleId, Date.now());
    res.sendStatus(204);
  });

  app.post('/api/gps', requireMission, (req, res) => {
    const parsed = parseGps(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'invalid gps payload', fields: parsed.fields });
      return;
    }
    const next = ingestGps(publish, engine, publicConfig.topicPrefix, parsed.value, Date.now());
    res.json({ nextIntersection: next });
  });

  if (demo) app.use('/api/demo', demoRouter({ demo, engine, publish, publicConfig, intersections, missionCodes }));

  // Revalidate on every load (cheap: ETag + 304). The CDN in front otherwise lets browsers keep a stale app.js for hours
  // after a deploy, which mixes a new index.html with old modules.
  const fresh = { setHeaders: (res: express.Response) => res.set('Cache-Control', 'no-cache') };
  if (mobileDir) app.use('/mobile', express.static(mobileDir, fresh));
  // express.static hides dotfiles by default; Android TWA verification needs /.well-known/assetlinks.json.
  app.use('/.well-known', express.static(`${dashboardDir}/.well-known`, fresh));
  app.use('/dashboard', express.static(dashboardDir, fresh));
  if (landingDir) app.use(express.static(landingDir, fresh));
  app.use(onError);
  return app;
}
