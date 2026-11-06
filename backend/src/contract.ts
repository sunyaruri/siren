export type VehicleType = 'ambulance' | 'firetruck';
export type Phase = 'A' | 'B';
export type Mode = 'NORMAL' | 'PRIORITY';

export interface GpsInput {
  vehicleId: string;
  type: VehicleType;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
}

export interface Intersection {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Bearing (0–180°) of the main road; approaching along it gets phase A. */
  axisA: number;
}

export type CmdPayload =
  | { mode: 'NORMAL'; ts: number }
  | {
      mode: 'PRIORITY';
      phase: Phase;
      vehicleId: string;
      vehicleType: VehicleType;
      ttl: number;
      ts: number;
      /** Present when the ETA model triggered it: the predicted seconds to arrival at that moment. */
      etaS?: number;
    };

export interface NextIntersection {
  id: string;
  name: string;
  distanceM: number;
  /** PRIORITY only when the intersection is held for this vehicle (not when another vehicle holds it). */
  mode: Mode;
  /** Predicted seconds until the vehicle reaches it (ETA model, src/eta.ts). */
  etaS: number;
}

export type GpsParseResult = { ok: true; value: GpsInput } | { ok: false; fields: string[] };

// vehicleId is embedded in MQTT topics, so '/', '+' and '#' must never get through.
export const VEHICLE_ID = /^[A-Za-z0-9_-]{1,32}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates an untrusted POST /api/gps body. */
export function parseGps(body: unknown): GpsParseResult {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const { vehicleId, type, lat, lng, speed, heading } = b;
  const fields: string[] = [];
  if (typeof vehicleId !== 'string' || !VEHICLE_ID.test(vehicleId)) fields.push('vehicleId');
  if (type !== 'ambulance' && type !== 'firetruck') fields.push('type');
  if (!isNum(lat) || Math.abs(lat) > 90) fields.push('lat');
  if (!isNum(lng) || Math.abs(lng) > 180) fields.push('lng');
  if (speed !== undefined && (!isNum(speed) || speed < 0)) fields.push('speed');
  if (heading !== undefined && (!isNum(heading) || heading < 0 || heading >= 360)) fields.push('heading');
  if (fields.length > 0) return { ok: false, fields };

  const value: GpsInput = {
    vehicleId: vehicleId as string,
    type: type as VehicleType,
    lat: lat as number,
    lng: lng as number,
  };
  if (speed !== undefined) value.speed = speed as number;
  if (heading !== undefined) value.heading = heading as number;
  return { ok: true, value };
}
