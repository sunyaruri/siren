import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import type { Intersection } from './contract.ts';
import { parseDemoPatch, parseRun, type DemoRunner, type DemoSettings } from './demo.ts';
import type { PriorityEngine } from './priority.ts';
import type { Route } from './route.ts';
import type { PublicConfig } from './app.ts';
import { publishCommands, type Publish } from './publish.ts';

export interface DemoDeps {
  /** Expected X-Demo-Key header. Empty = panel disabled. */
  key: string;
  runner: DemoRunner;
  route: Route;
  settings: DemoSettings;
  /** Shared with the PriorityEngine, so a radius change applies from the next GPS fix. */
  engineOpts: { radiusM: number };
}

interface RouterDeps {
  demo: DemoDeps;
  engine: PriorityEngine;
  publish: Publish;
  publicConfig: PublicConfig;
  intersections: Intersection[];
  missionCodes: Set<string>;
}

/** Retained `demo` topic: lets Citizen HUDs in "Posisi simulasi" mode and the dashboard follow the panel live. */
export function publishDemo(publish: Publish, publicConfig: PublicConfig, demo: DemoDeps, now: number): void {
  const { pos, heading } = demo.route.pointAt(demo.settings.citizenAlongM);
  const payload = {
    citizen: { lat: pos.lat, lng: pos.lng, heading: Math.round(heading) },
    radiusM: publicConfig.radiusM,
    simSpeedKmh: publicConfig.simSpeedKmh,
    ts: now,
  };
  publish(`${publicConfig.topicPrefix}/demo`, payload, true);
}

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

export function demoRouter({ demo, engine, publish, publicConfig, intersections, missionCodes }: RouterDeps): express.Router {
  const router = express.Router();

  // The deployment is public, so the panel is locked; hashing first gives timingSafeEqual equal-length inputs.
  const requireKey: RequestHandler = (req, res, next) => {
    if (!demo.key) {
      res.status(403).json({ error: 'demo panel disabled' });
      return;
    }
    if (!timingSafeEqual(digest(req.get('x-demo-key') ?? ''), digest(demo.key))) {
      res.status(401).json({ error: 'invalid demo key' });
      return;
    }
    next();
  };
  router.use(requireKey);

  const state = (now: number) => ({
    codes: [...missionCodes],
    radiusM: demo.engineOpts.radiusM,
    citizenAlongM: demo.settings.citizenAlongM,
    speedKmh: demo.settings.speedKmh,
    routeLengthM: Math.round(demo.route.totalM),
    stops: intersections.map((it) => ({ id: it.id, alongM: Math.round(demo.route.alongM(it)) })),
    runs: demo.runner.list(now),
  });

  router.get('/', (_req, res) => {
    res.json(state(Date.now()));
  });

  router.put('/', (req, res) => {
    const parsed = parseDemoPatch(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'invalid demo settings', fields: parsed.fields });
      return;
    }
    const { radiusM, citizenAlongM, speedKmh, codes } = parsed.value;
    if (radiusM !== undefined) demo.engineOpts.radiusM = publicConfig.radiusM = radiusM;
    if (citizenAlongM !== undefined) demo.settings.citizenAlongM = Math.min(citizenAlongM, demo.route.totalM);
    if (speedKmh !== undefined) demo.settings.speedKmh = publicConfig.simSpeedKmh = speedKmh;
    if (codes !== undefined) {
      missionCodes.clear();
      for (const code of codes) missionCodes.add(code);
    }
    const now = Date.now();
    publishDemo(publish, publicConfig, demo, now);
    res.json(state(now));
  });

  router.post('/run', (req, res) => {
    const parsed = parseRun(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'invalid run', fields: parsed.fields });
      return;
    }
    const now = Date.now();
    const startM = Math.min(parsed.value.startM, demo.route.totalM);
    demo.runner.start(parsed.value.type, startM, demo.settings.speedKmh, now);
    res.json(state(now));
  });

  router.post('/stop', (_req, res) => {
    demo.runner.stopAll();
    res.json(state(Date.now()));
  });

  router.post('/reset', (_req, res) => {
    const now = Date.now();
    demo.runner.stopAll();
    publishCommands(publish, publicConfig.topicPrefix, engine.reset(now));
    publishDemo(publish, publicConfig, demo, now);
    res.json(state(now));
  });

  return router;
}
