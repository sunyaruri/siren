import type { GpsInput, VehicleType } from './contract.ts';
import type { Route } from './route.ts';

/** Knobs the dashboard's Panel Demo can change at runtime. */
export interface DemoSettings {
  /** Where the Citizen HUD's "Posisi simulasi" sits, in meters along the demo route. */
  citizenAlongM: number;
  /** Speed of server-side demo vehicles and of the driver PWA's route simulator. */
  speedKmh: number;
}

export interface DemoPatch {
  radiusM?: number;
  citizenAlongM?: number;
  speedKmh?: number;
  codes?: string[];
}

export interface RunStatus {
  vehicleId: string;
  type: VehicleType;
  alongM: number;
  speedKmh: number;
  paused: boolean;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: string[] };

const MISSION_CODE = /^[A-Z0-9_-]{1,64}$/;
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Validates an untrusted PUT /api/demo body. Codes are uppercased like the driver app does. */
export function parseDemoPatch(body: unknown): Parsed<DemoPatch> {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const fields: string[] = [];
  const value: DemoPatch = {};
  if (b.radiusM !== undefined) {
    if (inRange(b.radiusM, 100, 5000)) value.radiusM = b.radiusM;
    else fields.push('radiusM');
  }
  if (b.citizenAlongM !== undefined) {
    if (inRange(b.citizenAlongM, 0, 100_000)) value.citizenAlongM = b.citizenAlongM;
    else fields.push('citizenAlongM');
  }
  if (b.speedKmh !== undefined) {
    if (inRange(b.speedKmh, 5, 300)) value.speedKmh = b.speedKmh;
    else fields.push('speedKmh');
  }
  if (b.codes !== undefined) {
    const codes = Array.isArray(b.codes) ? b.codes.map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : '')) : null;
    if (codes && codes.length <= 20 && codes.every((c) => MISSION_CODE.test(c))) value.codes = codes;
    else fields.push('codes');
  }
  return fields.length ? { ok: false, fields } : { ok: true, value };
}

/** Validates an untrusted POST /api/demo/run body. */
export function parseRun(body: unknown): Parsed<{ type: VehicleType; startM: number }> {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const fields: string[] = [];
  if (b.type !== 'ambulance' && b.type !== 'firetruck') fields.push('type');
  if (!inRange(b.startM, 0, 100_000)) fields.push('startM');
  return fields.length ? { ok: false, fields } : { ok: true, value: { type: b.type as VehicleType, startM: b.startM as number } };
}

interface Run {
  type: VehicleType;
  startM: number;
  speedKmh: number;
  /** Distance along the route at `movingSince` (or where it is parked while paused). */
  alongM: number;
  /** null = paused. */
  movingSince: number | null;
}

/**
 * Server-side demo vehicles driving the route. Pure: time is passed in, server.ts owns the timer.
 * A paused vehicle keeps reporting the same position, so it stays on the map, keeps its green light and the Citizen HUD
 * alert freezes at its distance instead of disappearing.
 */
export class DemoRunner {
  readonly #route: Route;
  readonly #runs = new Map<string, Run>();
  #count = 0;

  constructor(route: Route) {
    this.#route = route;
  }

  start(type: VehicleType, startM: number, speedKmh: number, now: number): string {
    this.#count += 1;
    const vehicleId = `${type === 'ambulance' ? 'AMB' : 'DMK'}-SIM${this.#count}`;
    this.#runs.set(vehicleId, { type, startM, speedKmh, alongM: startM, movingSince: now });
    return vehicleId;
  }

  pauseAll(now: number): void {
    for (const run of this.#runs.values()) {
      run.alongM = this.#alongM(run, now);
      run.movingSince = null;
    }
  }

  resumeAll(now: number): void {
    for (const run of this.#runs.values()) run.movingSince ??= now;
  }

  /** Puts every vehicle back at its start point, paused. Returns their ids (their trip has to be forgotten). */
  rewindAll(): string[] {
    for (const run of this.#runs.values()) {
      run.alongM = run.startM;
      run.movingSince = null;
    }
    return [...this.#runs.keys()];
  }

  /** Removes every vehicle and returns the ids that were running. */
  removeAll(): string[] {
    const ids = [...this.#runs.keys()];
    this.#runs.clear();
    return ids;
  }

  /** One GPS fix per vehicle. A run is dropped right after its fix at the end of the route. */
  tick(now: number): GpsInput[] {
    const fixes: GpsInput[] = [];
    for (const [vehicleId, run] of this.#runs) {
      const alongM = this.#alongM(run, now);
      const { pos, heading } = this.#route.pointAt(alongM);
      const speed = run.movingSince === null ? 0 : run.speedKmh;
      fixes.push({ vehicleId, type: run.type, lat: pos.lat, lng: pos.lng, speed, heading });
      if (alongM >= this.#route.totalM) this.#runs.delete(vehicleId);
    }
    return fixes;
  }

  list(now: number): RunStatus[] {
    return [...this.#runs].map(([vehicleId, run]) => ({
      vehicleId,
      type: run.type,
      alongM: Math.round(Math.min(this.#alongM(run, now), this.#route.totalM)),
      speedKmh: run.speedKmh,
      paused: run.movingSince === null,
    }));
  }

  #alongM(run: Run, now: number): number {
    if (run.movingSince === null) return run.alongM;
    return run.alongM + (run.speedKmh / 3.6) * ((now - run.movingSince) / 1000);
  }
}
