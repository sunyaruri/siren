import type { CmdPayload, GpsInput, Intersection, NextIntersection, Phase, VehicleType } from './contract.ts';
import { etaModel } from './eta-model.ts';
import { ETA_WINDOW_MS, etaFeatures, predictEtaS, type SpeedSample } from './eta.ts';
import { bearingDeg, haversineM, type LatLng } from './geo.ts';

export interface EngineOptions {
  radiusM: number;
  passM: number;
  passHysteresisM: number;
  ttlS: number;
  staleS: number;
  /**
   * Predictive trigger: a closing vehicle inside the radius gets green only once its predicted ETA is at most this many
   * seconds. 0 or unset = radius only.
   */
  etaLeadS?: number;
}

export interface Command {
  intersectionId: string;
  cmd: CmdPayload;
}

type IntersectionState =
  | { mode: 'NORMAL' }
  | {
      mode: 'PRIORITY';
      phase: Phase;
      vehicleId: string;
      vehicleType: VehicleType;
      minDistanceM: number;
      /** ETA when the model triggered it; unset for a radius-only trigger. */
      etaS?: number;
    };

interface VehicleMemory {
  lastSeen: number;
  distances: Map<string, number>;
  /**
   * Every intersection passed on this trip; never cleared while the vehicle keeps reporting. Blocks re-triggers from GPS
   * jitter and from a route that bends back toward a passed intersection, and keeps the HUD from pointing back at one.
   * ponytail: a trip ends when the vehicle goes stale (new mission); a same-trip return pass needs a new mission.
   */
  visited: Set<string>;
  /** Speed history (m/s) over the last ETA_WINDOW_MS, the ETA model's input. */
  speeds: SpeedSample[];
  last?: { t: number; pos: LatLng };
}

/** Phase A when the vehicle comes along the main road (within 45° of axisA, either direction), else B. */
export function phaseFor(axisA: number, bearingFromIntersection: number): Phase {
  const diff = Math.abs(bearingFromIntersection - axisA) % 180;
  return Math.min(diff, 180 - diff) < 45 ? 'A' : 'B';
}

/**
 * Decides intersection states from vehicle GPS fixes. Pure: no I/O, time is passed in.
 * ponytail: first-come per intersection; multi-vehicle priority rules are Final-stage scope.
 */
export class PriorityEngine {
  readonly #intersections: Intersection[];
  readonly #opts: EngineOptions;
  readonly #states = new Map<string, IntersectionState>();
  readonly #vehicles = new Map<string, VehicleMemory>();
  readonly #etaWeights: readonly number[];

  constructor(intersections: Intersection[], opts: EngineOptions, etaWeights: readonly number[] = etaModel.weights) {
    this.#intersections = intersections;
    this.#opts = opts;
    this.#etaWeights = etaWeights;
    for (const it of intersections) this.#states.set(it.id, { mode: 'NORMAL' });
  }

  update(gps: GpsInput, now: number): { commands: Command[]; next: NextIntersection | null } {
    const { radiusM, passM, passHysteresisM, etaLeadS } = this.#opts;
    let vehicle = this.#vehicles.get(gps.vehicleId);
    if (!vehicle) {
      vehicle = { lastSeen: now, distances: new Map(), visited: new Set(), speeds: [] };
      this.#vehicles.set(gps.vehicleId, vehicle);
    }
    vehicle.lastSeen = now;
    this.#recordSpeed(vehicle, gps, now);

    const commands: Command[] = [];
    let next: NextIntersection | null = null;

    for (const it of this.#intersections) {
      const d = haversineM(gps, it);
      const prev = vehicle.distances.get(it.id);
      vehicle.distances.set(it.id, d);
      const etaS = predictEtaS(this.#etaWeights, etaFeatures(d, vehicle.speeds, now));

      const state = this.#state(it.id);
      if (state.mode === 'NORMAL') {
        const approaching = prev !== undefined && d < prev;
        const due = !etaLeadS || etaS <= etaLeadS;
        if (d <= radiusM && approaching && due && !vehicle.visited.has(it.id)) {
          const phase = phaseFor(it.axisA, bearingDeg(it, gps));
          const held: IntersectionState = { mode: 'PRIORITY', phase, vehicleId: gps.vehicleId, vehicleType: gps.type, minDistanceM: d };
          if (etaLeadS) held.etaS = Math.round(etaS);
          commands.push(this.#set(it.id, held, now));
        }
      } else if (state.vehicleId === gps.vehicleId) {
        state.minDistanceM = Math.min(state.minDistanceM, d);
        const passedNow = state.minDistanceM <= passM && d > state.minDistanceM + passHysteresisM;
        if (passedNow) vehicle.visited.add(it.id);
        if (passedNow || d > radiusM) commands.push(this.#set(it.id, { mode: 'NORMAL' }, now));
      }

      const after = this.#state(it.id); // state after this fix was applied
      const heldByMe = after.mode === 'PRIORITY' && after.vehicleId === gps.vehicleId;
      const closing = prev === undefined || d <= prev;
      if ((heldByMe || (closing && !vehicle.visited.has(it.id))) && (next === null || d < next.distanceM)) {
        // `mode` is from this vehicle's point of view: PRIORITY only when the green is held for it, not for another.
        const mode = heldByMe ? 'PRIORITY' : 'NORMAL';
        next = { id: it.id, name: it.name, distanceM: Math.round(d), mode, etaS: Math.round(etaS) };
      }
    }
    return { commands, next };
  }

  /** Re-sends held PRIORITY commands (keeps the ESP32 ttl alive) and releases intersections of stale vehicles. */
  tick(now: number): Command[] {
    for (const [id, vehicle] of this.#vehicles) {
      if (now - vehicle.lastSeen > this.#opts.staleS * 1000) this.#vehicles.delete(id);
    }
    const commands: Command[] = [];
    for (const it of this.#intersections) {
      const state = this.#state(it.id);
      if (state.mode !== 'PRIORITY') continue;
      commands.push(this.#vehicles.has(state.vehicleId) ? this.#command(it.id, state, now) : this.#set(it.id, { mode: 'NORMAL' }, now));
    }
    return commands;
  }

  /** Drops one vehicle right away (mission ended, demo vehicle stopped) and releases what it held. */
  forget(vehicleId: string, now: number): Command[] {
    this.#vehicles.delete(vehicleId);
    return this.#intersections
      .filter((it) => {
        const state = this.#state(it.id);
        return state.mode === 'PRIORITY' && state.vehicleId === vehicleId;
      })
      .map((it) => this.#set(it.id, { mode: 'NORMAL' }, now));
  }

  /** Drops every vehicle and returns all intersections to NORMAL (demo panel reset). */
  reset(now: number): Command[] {
    this.#vehicles.clear();
    return this.#intersections.map((it) => this.#set(it.id, { mode: 'NORMAL' }, now));
  }

  /** Uses the reported speed (km/h) when present, else the distance from the previous fix. */
  #recordSpeed(vehicle: VehicleMemory, gps: GpsInput, now: number): void {
    const { last } = vehicle;
    const dtS = last ? (now - last.t) / 1000 : 0;
    const v = gps.speed !== undefined ? gps.speed / 3.6 : last && dtS > 0 ? haversineM(last.pos, gps) / dtS : 0;
    vehicle.speeds.push({ t: now, v });
    vehicle.speeds = vehicle.speeds.filter((s) => now - s.t <= ETA_WINDOW_MS);
    vehicle.last = { t: now, pos: { lat: gps.lat, lng: gps.lng } };
  }

  #state(id: string): IntersectionState {
    const state = this.#states.get(id);
    if (!state) throw new Error(`unknown intersection ${id}`);
    return state;
  }

  #set(id: string, state: IntersectionState, now: number): Command {
    this.#states.set(id, state);
    return this.#command(id, state, now);
  }

  #command(id: string, state: IntersectionState, now: number): Command {
    const cmd: CmdPayload =
      state.mode === 'NORMAL'
        ? { mode: 'NORMAL', ts: now }
        : {
            mode: 'PRIORITY',
            phase: state.phase,
            vehicleId: state.vehicleId,
            vehicleType: state.vehicleType,
            ttl: this.#opts.ttlS,
            ts: now,
            ...(state.etaS !== undefined && { etaS: state.etaS }),
          };
    return { intersectionId: id, cmd };
  }
}
