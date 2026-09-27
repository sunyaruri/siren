import type { CmdPayload, GpsInput, Intersection, NextIntersection, Phase, VehicleType } from './contract.ts';
import { bearingDeg, haversineM } from './geo.ts';

export interface EngineOptions {
  radiusM: number;
  passM: number;
  passHysteresisM: number;
  ttlS: number;
  staleS: number;
}

export interface Command {
  intersectionId: string;
  cmd: CmdPayload;
}

type IntersectionState =
  | { mode: 'NORMAL' }
  | { mode: 'PRIORITY'; phase: Phase; vehicleId: string; vehicleType: VehicleType; minDistanceM: number };

interface VehicleMemory {
  lastSeen: number;
  distances: Map<string, number>;
  /**
   * Every intersection passed on this trip; never cleared while the vehicle keeps reporting. Blocks re-triggers from GPS
   * jitter and from a route that bends back toward a passed intersection, and keeps the HUD from pointing back at one.
   * ponytail: a trip ends when the vehicle goes stale (new mission); a same-trip return pass needs a new mission.
   */
  visited: Set<string>;
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

  constructor(intersections: Intersection[], opts: EngineOptions) {
    this.#intersections = intersections;
    this.#opts = opts;
    for (const it of intersections) this.#states.set(it.id, { mode: 'NORMAL' });
  }

  update(gps: GpsInput, now: number): { commands: Command[]; next: NextIntersection | null } {
    const { radiusM, passM, passHysteresisM } = this.#opts;
    let vehicle = this.#vehicles.get(gps.vehicleId);
    if (!vehicle) {
      vehicle = { lastSeen: now, distances: new Map(), visited: new Set() };
      this.#vehicles.set(gps.vehicleId, vehicle);
    }
    vehicle.lastSeen = now;

    const commands: Command[] = [];
    let next: NextIntersection | null = null;

    for (const it of this.#intersections) {
      const d = haversineM(gps, it);
      const prev = vehicle.distances.get(it.id);
      vehicle.distances.set(it.id, d);

      const state = this.#state(it.id);
      if (state.mode === 'NORMAL') {
        const approaching = prev !== undefined && d < prev;
        if (d <= radiusM && approaching && !vehicle.visited.has(it.id)) {
          const phase = phaseFor(it.axisA, bearingDeg(it, gps));
          const held: IntersectionState = { mode: 'PRIORITY', phase, vehicleId: gps.vehicleId, vehicleType: gps.type, minDistanceM: d };
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
        next = { id: it.id, name: it.name, distanceM: Math.round(d), mode: after.mode };
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

  /** Drops every vehicle and returns all intersections to NORMAL (demo panel reset). */
  reset(now: number): Command[] {
    this.#vehicles.clear();
    return this.#intersections.map((it) => this.#set(it.id, { mode: 'NORMAL' }, now));
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
        : { mode: 'PRIORITY', phase: state.phase, vehicleId: state.vehicleId, vehicleType: state.vehicleType, ttl: this.#opts.ttlS, ts: now };
    return { intersectionId: id, cmd };
  }
}
