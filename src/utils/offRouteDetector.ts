import { getDistanceMeters, getMinDistanceToSegmentMeters } from './routeUtils';

export const OFF_ROUTE_IMMEDIATE_METERS = 100;
export const OFF_ROUTE_TRIGGER_METERS = 40;
export const OFF_ROUTE_CLEAR_METERS = 25;
export const OFF_ROUTE_HOLD_MS = 10000;
export const RECALCULATE_START_MIN_METERS = 50;

export interface OffRouteEvalResult {
  isOffRoute: boolean;
  showRecalculateFromHere: boolean;
  distToRoute: number;
  distToStart: number;
  timerStartMs: number | null;
}

/**
 * Calculates the shortest perpendicular (point-to-segment) distance in meters
 * from a user location to a polyline route.
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

/**
 * Evaluates off-route state and separate "Recalculate from here" eligibility.
 *
 * Off-route banner rules (point-to-segment distance only):
 * - Immediate when > 100 m from route line
 * - After >= 10 s when > 40 m from route line
 * - Clears when <= 25 m from route line (hysteresis holds between 25 m and 40 m)
 *
 * Separate "Recalculate from here" prompt:
 * - True when user is > 40 m from the route line AND > 50 m from the route's start
 */
export function evaluateOffRouteState(
  userPos: [number, number] | null,
  routeCoords: [number, number][] | null | undefined,
  prevIsOffRoute: boolean,
  prevTimerStartMs: number | null,
  nowMs: number = Date.now()
): OffRouteEvalResult {
  if (!userPos || !routeCoords || routeCoords.length < 2) {
    return {
      isOffRoute: false,
      showRecalculateFromHere: false,
      distToRoute: 0,
      distToStart: 0,
      timerStartMs: null,
    };
  }

  const distToRoute = getDistanceToRouteMeters(userPos, routeCoords);
  const distToStart = getDistanceMeters(
    userPos[0],
    userPos[1],
    routeCoords[0][0],
    routeCoords[0][1]
  );

  let isOffRoute = prevIsOffRoute;
  let timerStartMs = prevTimerStartMs;

  if (distToRoute > OFF_ROUTE_IMMEDIATE_METERS) {
    isOffRoute = true;
    timerStartMs = prevTimerStartMs ?? nowMs;
  } else if (distToRoute > OFF_ROUTE_TRIGGER_METERS) {
    const start = prevTimerStartMs ?? nowMs;
    timerStartMs = start;
    if (nowMs - start >= OFF_ROUTE_HOLD_MS) {
      isOffRoute = true;
    }
  } else if (distToRoute <= OFF_ROUTE_CLEAR_METERS) {
    isOffRoute = false;
    timerStartMs = null;
  } else {
    // Hysteresis zone (25m < dist <= 40m): reset trigger countdown, preserve existing off-route state until <= 25m
    timerStartMs = null;
  }

  const showRecalculateFromHere =
    distToRoute > OFF_ROUTE_TRIGGER_METERS && distToStart > RECALCULATE_START_MIN_METERS;

  return {
    isOffRoute,
    showRecalculateFromHere,
    distToRoute,
    distToStart,
    timerStartMs,
  };
}
