import { getMinDistanceToSegmentMeters } from './routeUtils';

/**
 * Calculates the shortest distance in meters from a user location to a polyline route.
 */
export function getDistanceToRouteMeters(
  userPos: [number, number],
  routeCoords: [number, number][]
): number {
  if (!userPos || !routeCoords || routeCoords.length < 2) return Infinity;

  const [px, py] = userPos;
  let minDistance = Infinity;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const p1 = routeCoords[i];
    const p2 = routeCoords[i + 1];
    const dist = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], px, py);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }

  return minDistance;
}
