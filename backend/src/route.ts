import { bearingDeg, haversineM, type LatLng } from './geo.ts';

export interface Route {
  points: LatLng[];
  totalM: number;
  /** Position and heading after travelling `distanceM` along the route (linear interpolation per segment). */
  pointAt(distanceM: number): { pos: LatLng; heading: number };
  /** Distance along the route of the route vertex nearest to `p`. */
  alongM(p: LatLng): number;
}

export function createRoute(points: LatLng[]): Route {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + haversineM(points[i - 1], points[i]));
  const totalM = cumulative[cumulative.length - 1];

  return {
    points,
    totalM,
    pointAt(distanceM) {
      const d = Math.min(Math.max(distanceM, 0), totalM);
      let i = 1;
      while (i < points.length - 1 && cumulative[i] < d) i++;
      const a = points[i - 1];
      const b = points[i];
      const segmentM = cumulative[i] - cumulative[i - 1];
      const t = segmentM > 0 ? (d - cumulative[i - 1]) / segmentM : 1;
      return { pos: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, heading: bearingDeg(a, b) };
    },
    alongM(p) {
      let best = 0;
      for (let i = 1; i < points.length; i++) if (haversineM(points[i], p) < haversineM(points[best], p)) best = i;
      return cumulative[best];
    },
  };
}
