import type { GpsInput, NextIntersection } from './contract.ts';
import type { Command, PriorityEngine } from './priority.ts';

export type Publish = (topic: string, payload: object, retain: boolean) => void;

/** Intersection commands are retained so an ESP32 or dashboard gets the current state on (re)connect. */
export function publishCommands(publish: Publish, topicPrefix: string, commands: Command[]): void {
  for (const { intersectionId, cmd } of commands) publish(`${topicPrefix}/intersection/${intersectionId}/cmd`, cmd, true);
}

/** Shared by POST /api/gps and the server-side demo vehicles. */
export function ingestGps(
  publish: Publish,
  engine: PriorityEngine,
  topicPrefix: string,
  gps: GpsInput,
  now: number,
): NextIntersection | null {
  publish(`${topicPrefix}/vehicle/${gps.vehicleId}`, { ...gps, ts: now }, false);
  const { commands, next } = engine.update(gps, now);
  publishCommands(publish, topicPrefix, commands);
  return next;
}

/**
 * Ends a vehicle's trip now instead of waiting `staleS`: releases its intersections and tells the dashboard and the
 * Citizen HUDs to drop it (`gone`), so its marker and alert do not linger.
 */
export function removeVehicle(publish: Publish, engine: PriorityEngine, topicPrefix: string, vehicleId: string, now: number): void {
  publishCommands(publish, topicPrefix, engine.forget(vehicleId, now));
  publish(`${topicPrefix}/vehicle/${vehicleId}`, { vehicleId, gone: true, ts: now }, false);
}
