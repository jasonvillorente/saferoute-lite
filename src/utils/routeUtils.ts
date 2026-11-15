import { DangerZone, CalculatedRoute, RouteSegment, SafetyLevel, AvoidanceStatus, isZoneResolved } from '../types';
import { isZoneCurrentlyActive, ZONE_COLOR } from './zoneUtils';
import { isInsidePalanan } from '../lib/palananBounds';
import { getApiUrl, isNativeMissingApiBaseUrl, getCachedApiHealth } from '../lib/apiConfig';
import palananFixtures from './fixtures/palananTripFixtures.json';

/**
 * Standard Haversine formula (unmodified).
 */
export function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Projects a point onto a line segment and calculates minimum distance in meters.
 */
export function getMinDistanceToSegmentMeters(
  x1: number, y1: number,
  x2: number, y2: number,
  px: number, py: number
): number {
  const lineDist = getDistanceMeters(x1, y1, x2, y2);
  if (lineDist === 0) return getDistanceMeters(px, py, x1, y1);

  const t = Math.max(0, Math.min(1,
    ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) /
    (Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2) || 1e-9)
  ));

  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  return getDistanceMeters(px, py, projX, projY);
}

/**
 * Densifies coordinates so that the distance between consecutive points is at most maxStepMeters (default 10m).
 * Preserves the exact start and end points and strictly follows the original line segments.
 */
export function densifyCoordinates(coordinates: [number, number][], maxStepMeters: number = 10): [number, number][] {
  if (!coordinates || coordinates.length <= 1) return coordinates ? [...coordinates] : [];

  const densified: [number, number][] = [coordinates[0]];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const segDist = getDistanceMeters(p1[0], p1[1], p2[0], p2[1]);

    if (segDist > maxStepMeters) {
      const steps = Math.ceil(segDist / maxStepMeters);
      for (let s = 1; s < steps; s++) {
        const fraction = s / steps;
        const lat = p1[0] + (p2[0] - p1[0]) * fraction;
        const lng = p1[1] + (p2[1] - p1[1]) * fraction;
        densified.push([lat, lng]);
      }
    }
    densified.push(p2);
  }

  return densified;
}

/**
 * Converts a danger zone circle to a GeoJSON Polygon linear ring (closed loop)
 * with radius + bufferMeters (default 10m) and at least 24 sides (default 32).
 * Note: GeoJSON coordinates are in [longitude, latitude] order.
 */
export function createZoneAvoidPolygon(
  zone: DangerZone,
  bufferMeters: number = 10,
  numSides: number = 32
): [number, number][] {
  const centerLat = zone.location.lat;
  const centerLng = zone.location.lng;
  const effectiveRadius = zone.radius + bufferMeters;
  const latDeg = effectiveRadius / 111000;
  const lngDeg = effectiveRadius / (111000 * Math.cos((centerLat * Math.PI) / 180));

  const ring: [number, number][] = [];
  for (let i = 0; i < numSides; i++) {
    const angle = (i * 2 * Math.PI) / numSides;
    const pLat = centerLat + Math.cos(angle) * latDeg;
    const pLng = centerLng + Math.sin(angle) * lngDeg;
    ring.push([pLng, pLat]); // GeoJSON expects [lng, lat]
  }
  // Explicitly close the ring with exact first point (GeoJSON RFC 7946 requirement)
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/**
 * Checks if two routes are near-duplicates (within about 30m of each other for most of their length).
 */
export function areRoutesNearDuplicates(
  r1Coords: [number, number][],
  r2Coords: [number, number][],
  thresholdMeters = 30
): boolean {
  if (!r1Coords || !r2Coords || r1Coords.length < 2 || r2Coords.length < 2) return false;

  let len1 = 0;
  for (let i = 0; i < r1Coords.length - 1; i++) {
    len1 += getDistanceMeters(r1Coords[i][0], r1Coords[i][1], r1Coords[i + 1][0], r1Coords[i + 1][1]);
  }
  let len2 = 0;
  for (let i = 0; i < r2Coords.length - 1; i++) {
    len2 += getDistanceMeters(r2Coords[i][0], r2Coords[i][1], r2Coords[i + 1][0], r2Coords[i + 1][1]);
  }
  if (Math.abs(len1 - len2) > 100) {
    return false;
  }

  const sampleCount = 20;
  let withinThresholdCount = 0;

  for (let s = 0; s <= sampleCount; s++) {
    const idx = Math.floor((s / sampleCount) * (r1Coords.length - 1));
    const pt = r1Coords[idx];

    let minDistToR2 = Infinity;
    for (let j = 0; j < r2Coords.length - 1; j++) {
      const d = getMinDistanceToSegmentMeters(
        r2Coords[j][0], r2Coords[j][1],
        r2Coords[j + 1][0], r2Coords[j + 1][1],
        pt[0], pt[1]
      );
      if (d < minDistToR2) minDistToR2 = d;
    }

    if (minDistToR2 <= thresholdMeters) {
      withinThresholdCount++;
    }
  }

  return (withinThresholdCount / (sampleCount + 1)) >= 0.80;
}

/**
 * Strict clearance check: A route may be labeled "Avoids" only if EVERY route point
 * is at least radius + 10m from each active zone center, checked by sampling
 * the full geometry at most every 10m (not only vertices).
 */
export function isRouteClearingAllZones(
  coordinates: [number, number][],
  zones: DangerZone[],
  minClearanceMeters = 10,
  isSim = false,
  simHour: number | null = null
): { isClear: boolean; minClearance: number; closestZoneId?: string } {
  const activeNowZones = zones.filter(zone => {
    if (!zone || isZoneResolved(zone) || zone.active === false) return false;
    if (!zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return false;
    return isZoneCurrentlyActive(zone, isSim, simHour);
  });

  if (activeNowZones.length === 0) {
    return { isClear: true, minClearance: Infinity };
  }

  let minClearance = Infinity;
  let closestZoneId: string | undefined;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const segDist = getDistanceMeters(p1[0], p1[1], p2[0], p2[1]);
    const numSubSteps = Math.max(1, Math.ceil(segDist / 10)); // Sample at most every 10 meters

    for (let s = 0; s <= numSubSteps; s++) {
      const frac = s / numSubSteps;
      const sampleLat = p1[0] + frac * (p2[0] - p1[0]);
      const sampleLng = p1[1] + frac * (p2[1] - p1[1]);

      for (const zone of activeNowZones) {
        const d = getDistanceMeters(sampleLat, sampleLng, zone.location.lat, zone.location.lng);
        const clearanceFromEdge = d - zone.radius; // meters from circle edge
        if (clearanceFromEdge < minClearance) {
          minClearance = clearanceFromEdge;
          closestZoneId = zone.id;
        }
      }
    }
  }

  return { isClear: minClearance >= minClearanceMeters, minClearance, closestZoneId };
}

/**
 * Computes safety score, penalties, in-zone exposure metrics, heatmap segments,
 * and base summary text for a single route based on currently active danger zones.
 */
export function computeRouteZoneMetrics(
  coordinates: [number, number][],
  distance: number,
  duration: number,
  zones: DangerZone[],
  isSim: boolean = false,
  simHour: number | null = null
): {
  safety: SafetyLevel;
  safetyScore: number;
  totalCost: number;
  segments: RouteSegment[];
  metersInside: number;
  metersBuffer: number;
  crimeWeightedExposure: number;
  passedZonesCount: number;
  summaryText: string;
} {
  const activeNowZones = zones.filter(zone => {
    if (!zone || isZoneResolved(zone) || zone.active === false) return false;
    if (!zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return false;
    return isZoneCurrentlyActive(zone, isSim, simHour);
  });

  const densifiedCoords = densifyCoordinates(coordinates, 10);

  let metersInside = 0;
  let metersBuffer = 0;
  let crimeWeightedExposure = 0;
  const intersectedZoneIds = new Set<string>();
  const intersectedZones: DangerZone[] = [];

  let routePenalty = 0;
  let hasHighCrimeActiveZone = false;
  let passesAnyActiveZone = false;
  let approachesActiveZone = false;

  activeNowZones.forEach(zone => {
    let minDist = Infinity;
    if (densifiedCoords.length === 1) {
      minDist = getDistanceMeters(densifiedCoords[0][0], densifiedCoords[0][1], zone.location.lat, zone.location.lng);
    } else {
      for (let i = 0; i < densifiedCoords.length - 1; i++) {
        const p1 = densifiedCoords[i];
        const p2 = densifiedCoords[i + 1];
        const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
        if (d < minDist) minDist = d;
      }
    }

    const count = zone.crimeCount || 0;

    if (minDist <= zone.radius) {
      passesAnyActiveZone = true;
      intersectedZoneIds.add(zone.id);
      intersectedZones.push(zone);
      if (count >= 5) {
        hasHighCrimeActiveZone = true;
        routePenalty += 5000;
      } else {
        routePenalty += 2000;
      }
    } else if (minDist <= zone.radius * 1.5) {
      approachesActiveZone = true;
      if (count >= 5) {
        routePenalty += 1000;
      } else {
        routePenalty += 400;
      }
    }
  });

  const crossedActiveZonesCount = intersectedZoneIds.size;
  const totalCost = distance + routePenalty;

  let safety: SafetyLevel = 'safe';
  if (hasHighCrimeActiveZone || crossedActiveZonesCount >= 2) {
    safety = 'danger';
  } else if (passesAnyActiveZone || approachesActiveZone) {
    safety = 'moderate';
  }

  let baseSafetyScore = 98;
  if (hasHighCrimeActiveZone) {
    baseSafetyScore -= 30;
  }
  if (crossedActiveZonesCount >= 2) {
    baseSafetyScore -= Math.min(35, crossedActiveZonesCount * 15);
  } else if (passesAnyActiveZone) {
    baseSafetyScore -= 18;
  } else if (approachesActiveZone) {
    baseSafetyScore -= 8;
  }
  const safetyScore = Math.max(50, Math.min(98, baseSafetyScore));

  const segments: RouteSegment[] = [];
  let currentSegment: RouteSegment | null = null;

  for (let i = 0; i < densifiedCoords.length - 1; i++) {
    const p1 = densifiedCoords[i];
    const p2 = densifiedCoords[i + 1];
    const segDist = getDistanceMeters(p1[0], p1[1], p2[0], p2[1]);

    let segMaxCrime = 0;
    let isSegInside = false;
    let isSegBuffer = false;

    for (const zone of activeNowZones) {
      const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
      if (d <= zone.radius) {
        isSegInside = true;
        const crime = zone.crimeCount || 0;
        if (crime > segMaxCrime) segMaxCrime = crime;
        crimeWeightedExposure += crime * segDist;
      } else if (d <= zone.radius * 1.5) {
        isSegBuffer = true;
      }
    }

    if (isSegInside) {
      metersInside += segDist;
    } else if (isSegBuffer) {
      metersBuffer += segDist;
    }

    let segColor = '#10B981';
    let segWeight = 5;
    let segOpacity = 1.0;

    if (isSegInside) {
      segColor = ZONE_COLOR;
      segWeight = 8;
      segOpacity = 1.0;
    }

    if (!currentSegment) {
      currentSegment = {
        coordinates: [p1, p2],
        color: segColor,
        weight: segWeight,
        opacity: segOpacity,
        inZone: isSegInside,
        crimeCount: segMaxCrime
      };
    } else if (
      currentSegment.color === segColor &&
      currentSegment.inZone === isSegInside &&
      Math.abs((currentSegment.opacity || 1.0) - segOpacity) < 0.05
    ) {
      currentSegment.coordinates.push(p2);
    } else {
      segments.push(currentSegment);
      currentSegment = {
        coordinates: [p1, p2],
        color: segColor,
        weight: segWeight,
        opacity: segOpacity,
        inZone: isSegInside,
        crimeCount: segMaxCrime
      };
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  // Base summary text (without delta comparisons)
  let summaryText = 'No active caution area on this route.';
  if (crossedActiveZonesCount > 0) {
    let totalIncidents = 0;
    const periods = new Set<string>();

    intersectedZones.forEach(z => {
      totalIncidents += z.crimeCount || 0;
      if (z.dataPeriod && z.dataPeriod.trim()) {
        periods.add(z.dataPeriod.trim());
      }
    });

    const periodStr = periods.size > 0 ? Array.from(periods).join(', ') : '';
    const hasCountAndPeriod = totalIncidents > 0 && periodStr.length > 0;
    const countText = hasCountAndPeriod
      ? `, ${totalIncidents} recorded incident${totalIncidents === 1 ? '' : 's'} (${periodStr})`
      : ', no incident count recorded';

    summaryText = `Passes through ${crossedActiveZonesCount} caution area${crossedActiveZonesCount > 1 ? 's' : ''}, ${Math.round(metersInside)} m inside${countText}`;
  }

  return {
    safety,
    safetyScore,
    totalCost,
    segments,
    metersInside: Math.round(metersInside),
    metersBuffer: Math.round(metersBuffer),
    crimeWeightedExposure: Math.round(crimeWeightedExposure),
    passedZonesCount: crossedActiveZonesCount,
    summaryText
  };
}

export interface RawRouteCandidate {
  coordinates: [number, number][];
  distance: number;
  duration: number;
  steps: { instruction: string; distance: number; name: string }[];
  originType?: 'service_direct' | 'service_alternative' | 'waypoint_detour' | 'ors_avoid';
  waypointKey?: string;
}

export interface ProcessPipelineOptions {
  candidates: RawRouteCandidate[];
  start: [number, number];
  end: [number, number];
  zones: DangerZone[];
  isSim?: boolean;
  simHour?: number | null;
  requestsFailedOrTimedOut?: boolean;
  serviceUnreachable?: boolean;
  diagnostics?: any;
}

export interface RouteSuggestionResult {
  routes: CalculatedRoute[];
  warning?: string;
  statusMessage?: string;
  avoidanceStatus: AvoidanceStatus;
  rawCandidates?: RawRouteCandidate[];
  diagnostics: {
    serviceCandidatesReturned: number;
    detourCandidatesGenerated: number;
    detourCandidatesRejected: number;
    rejectionReasons: Record<string, number>;
    finalRoutesCount: number;
    avoidanceWaypointsTried: {
      side: string;
      offset: number;
      routeDistance?: number;
      metersInside?: number;
      metersBuffer?: number;
      minClearance?: number;
      status: string;
      snappedInside?: boolean;
    }[];
    requestsFailedOrTimedOut?: boolean;
    orsFailed?: boolean;
    serviceUnreachable?: boolean;
    totalRequestErrors?: number;
  };
}

/**
 * Runtime Invariant Assertions
 */
export function assertRouteInvariants(routes: CalculatedRoute[], fastestRoute: CalculatedRoute): void {
  for (const r of routes) {
    if (r.name.includes('Avoids') && !r.name.includes('least time')) {
      if ((r.metersInside ?? 0) > 0) {
        throw new Error(`Invariant violation: route labeled '${r.name}' has metersInside=${r.metersInside} > 0`);
      }
      if ((r.minClearance ?? 0) < 10) {
        throw new Error(`Invariant violation: route labeled '${r.name}' has minClearance=${r.minClearance} < 10m`);
      }
    }
    if (r.name === 'Balanced') {
      if (r.duration > fastestRoute.duration && (r.crimeWeightedExposure ?? 0) > (fastestRoute.crimeWeightedExposure ?? 0)) {
        throw new Error(`Invariant violation: Balanced route is both longer and more exposed than Fastest`);
      }
    }
  }
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      if (areRoutesNearDuplicates(routes[i].coordinates, routes[j].coordinates, 30)) {
        throw new Error(`Invariant violation: routes '${routes[i].name}' and '${routes[j].name}' are near-duplicates within 30m`);
      }
    }
  }
}

/**
 * CONSOLIDATED PIPELINE: Verify -> Select -> Label
 * Single source of truth for route scoring, route selection, and status messages.
 * Used identically on initial route calculation and during simulated clock changes.
 */
export function processRoutePipeline(options: ProcessPipelineOptions): RouteSuggestionResult {
  const {
    candidates,
    start,
    end,
    zones,
    isSim = false,
    simHour = null,
    requestsFailedOrTimedOut = false,
    serviceUnreachable = false
  } = options;

  const diagnostics = options.diagnostics || {
    serviceCandidatesReturned: candidates.filter(c => c.originType !== 'waypoint_detour').length,
    detourCandidatesGenerated: candidates.filter(c => c.originType === 'waypoint_detour').length,
    detourCandidatesRejected: 0,
    rejectionReasons: { 'crosses an active zone': 0, 'outside bounds': 0, 'duplicate': 0, 'error': 0 },
    finalRoutesCount: 0,
    avoidanceWaypointsTried: [],
    requestsFailedOrTimedOut,
    serviceUnreachable
  };

  const activeNowZones = zones.filter(zone => {
    if (!zone || isZoneResolved(zone) || zone.active === false) return false;
    if (!zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return false;
    return isZoneCurrentlyActive(zone, isSim, simHour);
  });

  // Check if start or end is inside or near an active zone (within radius + 10m)
  const isOriginOrDestInsideOrNearZone = activeNowZones.some(z => {
    const dStart = getDistanceMeters(start[0], start[1], z.location.lat, z.location.lng);
    const dEnd = getDistanceMeters(end[0], end[1], z.location.lat, z.location.lng);
    return dStart <= z.radius + 10 || dEnd <= z.radius + 10;
  });

  // STEP 1 - VERIFY: Recompute verified metrics from actual geometry sampled at most every 10m
  // and reject candidates whose destination snap exceeds 40m from requested end.
  interface VerifiedCandidate extends RawRouteCandidate {
    safety: SafetyLevel;
    safetyScore: number;
    totalCost: number;
    segments: RouteSegment[];
    metersInside: number;
    metersBuffer: number;
    crimeWeightedExposure: number;
    passedZonesCount: number;
    minClearance: number;
    isClear: boolean;
    baseSummary: string;
    endErrorMeters: number;
  }

  const verifiedCandidates: VerifiedCandidate[] = [];
  for (const c of candidates) {
    if (!c.coordinates || c.coordinates.length < 2) continue;
    const lastPt = c.coordinates[c.coordinates.length - 1];
    const endErrorMeters = getDistanceMeters(lastPt[0], lastPt[1], end[0], end[1]);
    if (endErrorMeters > 40) {
      diagnostics.detourCandidatesRejected = (diagnostics.detourCandidatesRejected || 0) + 1;
      diagnostics.rejectionReasons['end too far (>40m)'] = (diagnostics.rejectionReasons['end too far (>40m)'] || 0) + 1;
      continue;
    }

    const densified = densifyCoordinates(c.coordinates, 10);
    const metrics = computeRouteZoneMetrics(densified, c.distance, c.duration, zones, isSim, simHour);
    const clearance = isRouteClearingAllZones(densified, zones, 10, isSim, simHour);
    verifiedCandidates.push({
      ...c,
      coordinates: densified,
      safety: metrics.safety,
      safetyScore: metrics.safetyScore,
      totalCost: metrics.totalCost,
      segments: metrics.segments,
      metersInside: metrics.metersInside,
      metersBuffer: metrics.metersBuffer,
      crimeWeightedExposure: metrics.crimeWeightedExposure,
      passedZonesCount: metrics.passedZonesCount,
      minClearance: clearance.minClearance,
      isClear: clearance.isClear,
      baseSummary: metrics.summaryText,
      endErrorMeters
    });
  }

  if (verifiedCandidates.length === 0) {
    if (serviceUnreachable && activeNowZones.length > 0) {
      return {
        routes: [],
        warning: "Safer-route service is not reachable. Showing the fastest route only.",
        statusMessage: "Safer-route service is not reachable. Showing the fastest route only.",
        avoidanceStatus: 'service_unreachable',
        rawCandidates: candidates,
        diagnostics
      };
    }
    return {
      routes: [],
      warning: requestsFailedOrTimedOut
        ? "Couldn't finish checking for routes that avoid caution areas. Try again."
        : "No network road path available between selected points.",
      statusMessage: requestsFailedOrTimedOut
        ? "Couldn't finish checking for routes that avoid caution areas. Try again."
        : undefined,
      avoidanceStatus: requestsFailedOrTimedOut ? 'requests_failed' : 'no_avoiding_route_found',
      rawCandidates: candidates,
      diagnostics
    };
  }

  // STEP 2 - SELECT (At most 3 routes)
  // a. Fastest: the shortest-duration candidate. Always first in the displayed list.
  let fastest = verifiedCandidates[0];
  for (let i = 1; i < verifiedCandidates.length; i++) {
    const c = verifiedCandidates[i];
    if (c.duration < fastest.duration || (c.duration === fastest.duration && c.distance < fastest.distance)) {
      fastest = c;
    }
  }

  // b. Avoids caution areas: shortest candidate with metersInside = 0 and minClearance >= 10m.
  const avoidingPool = verifiedCandidates.filter(c => c.metersInside === 0 && c.minClearance >= 10);
  avoidingPool.sort((a, b) => {
    const aZeroBuf = a.metersBuffer === 0 ? 0 : 1;
    const bZeroBuf = b.metersBuffer === 0 ? 0 : 1;
    if (aZeroBuf !== bZeroBuf) return aZeroBuf - bZeroBuf;
    if (a.metersBuffer !== b.metersBuffer) return a.metersBuffer - b.metersBuffer;
    return a.distance - b.distance;
  });

  // Fastest only "avoids" when it itself has 0m inside AND >= 10m clearance.
  const fastestAlreadyAvoids = fastest.metersInside === 0 && fastest.minClearance >= 10;
  let bestAvoidingCandidate: VerifiedCandidate | null = null;

  if (!fastestAlreadyAvoids) {
    for (const cand of avoidingPool) {
      if (!areRoutesNearDuplicates(cand.coordinates, fastest.coordinates, 30)) {
        bestAvoidingCandidate = cand;
        break;
      }
    }
  }

  // c. If no avoiding route exists:
  // First look for a close-pass route (metersInside === 0 with minClearance < 10m) that improves over Fastest;
  // Never label a 0m-inside candidate as "Least time in caution area".
  // Otherwise fall back to "Least time in caution area" (strictly 0 < metersInside < fastest.metersInside).
  let bestClosePassCandidate: VerifiedCandidate | null = null;
  let leastTimeCandidate: VerifiedCandidate | null = null;

  if (!bestAvoidingCandidate && !fastestAlreadyAvoids && activeNowZones.length > 0) {
    const closePassPool = verifiedCandidates.filter(c =>
      c.metersInside === 0 &&
      c.minClearance < 10 &&
      !areRoutesNearDuplicates(c.coordinates, fastest.coordinates, 30) &&
      (fastest.metersInside > 0 || c.minClearance > fastest.minClearance)
    );
    if (closePassPool.length > 0) {
      closePassPool.sort((a, b) => {
        if (b.minClearance !== a.minClearance) return b.minClearance - a.minClearance;
        return a.distance - b.distance;
      });
      bestClosePassCandidate = closePassPool[0];
    } else {
      const lowerInsideCandidates = verifiedCandidates.filter(c =>
        c.metersInside > 0 &&
        c.metersInside < fastest.metersInside &&
        !areRoutesNearDuplicates(c.coordinates, fastest.coordinates, 30)
      );
      if (lowerInsideCandidates.length > 0) {
        lowerInsideCandidates.sort((a, b) => {
          if (a.metersInside !== b.metersInside) return a.metersInside - b.metersInside;
          return a.distance - b.distance;
        });
        leastTimeCandidate = lowerInsideCandidates[0];
      }
    }
  }

  // d. Balanced: only a real compromise
  // longer than Fastest, less metersInside than Fastest, and shorter than Avoids/Close-pass/Least-time
  const secondChoice = bestAvoidingCandidate || bestClosePassCandidate || leastTimeCandidate;
  const balancedCandidates = verifiedCandidates.filter(c => {
    if (areRoutesNearDuplicates(c.coordinates, fastest.coordinates, 30)) return false;
    if (secondChoice && areRoutesNearDuplicates(c.coordinates, secondChoice.coordinates, 30)) return false;
    const isLongerThanFastest = c.duration > fastest.duration || c.distance > fastest.distance;
    const isLessInsideThanFastest = c.metersInside < fastest.metersInside;
    const isShorterThanSecond = secondChoice ? (c.distance < secondChoice.distance && c.duration < secondChoice.duration) : true;
    const isNotMoreExposed = c.crimeWeightedExposure <= fastest.crimeWeightedExposure;
    return isLongerThanFastest && isLessInsideThanFastest && isShorterThanSecond && isNotMoreExposed;
  });

  balancedCandidates.sort((a, b) => {
    if (a.crimeWeightedExposure !== b.crimeWeightedExposure) return a.crimeWeightedExposure - b.crimeWeightedExposure;
    return a.duration - b.duration;
  });
  const bestBalancedCandidate = balancedCandidates.length > 0 ? balancedCandidates[0] : null;

  // Selected routes list (at most 3)
  const selectedCandidates: VerifiedCandidate[] = [];
  selectedCandidates.push(fastest);

  if (bestAvoidingCandidate) {
    selectedCandidates.push(bestAvoidingCandidate);
  } else if (bestClosePassCandidate) {
    selectedCandidates.push(bestClosePassCandidate);
  } else if (leastTimeCandidate) {
    selectedCandidates.push(leastTimeCandidate);
  }

  if (bestBalancedCandidate && selectedCandidates.length < 3) {
    selectedCandidates.push(bestBalancedCandidate);
  }

  // STEP 3 - LABEL: derive labels and summaries strictly from verified metrics
  const fastestDist = fastest.distance;
  const fastestDur = fastest.duration;
  const fastestInside = fastest.metersInside;
  const detourCap = Math.min(1.5 * fastestDist, fastestDist + 500);

  const finalRoutes: CalculatedRoute[] = selectedCandidates.map((c, idx) => {
    let name = 'Route Option';
    let isAvoidanceRoute = false;
    let isOverCap = false;
    let extraDistance = 0;
    let extraDuration = 0;

    const diffDist = Math.max(0, Math.round(c.distance - fastestDist));
    const diffDurMin = Math.max(0, Math.round((c.duration - fastestDur) / 60));
    const insideSaved = Math.round(fastestInside - c.metersInside);
    const edgeMeters = Math.max(0, Math.round(c.minClearance));

    let summaryText = c.baseSummary;

    if (idx === 0) {
      // Fastest
      if (c.metersInside === 0 && c.minClearance >= 10) {
        name = 'Fastest - avoids active caution areas';
        summaryText = 'No active caution area on this route.';
      } else if (activeNowZones.length > 0 && c.metersInside === 0 && c.minClearance < 10) {
        name = `Fastest - Passes close to a caution area (${edgeMeters} m from edge)`;
        summaryText = `Passes close to a caution area (${edgeMeters} m from edge).`;
      } else {
        name = 'Fastest';
      }
    } else if (c === bestAvoidingCandidate) {
      // Avoids caution areas
      isAvoidanceRoute = true;
      extraDistance = diffDist;
      extraDuration = diffDurMin;
      isOverCap = c.distance > detourCap;

      name = isOverCap
        ? `Avoids caution areas (+${diffDist} m, +${diffDurMin} min)`
        : 'Avoids caution areas';

      const insidePart = insideSaved > 0 ? `, -${insideSaved} m inside compared to fastest` : ' compared to fastest';
      summaryText = `No active caution area on this route. +${diffDist} m / +${diffDurMin} min${insidePart}`;
    } else if (c === bestClosePassCandidate) {
      // Close pass (0m inside, < 10m clearance)
      name = `Passes close to a caution area (${edgeMeters} m from edge)`;
      const insidePart = insideSaved > 0 ? `, -${insideSaved} m inside compared to fastest` : ' compared to fastest';
      summaryText = `Passes close to a caution area (${edgeMeters} m from edge). +${diffDist} m / +${diffDurMin} min${insidePart}`;
    } else if (c === leastTimeCandidate) {
      // Least time in caution area (strictly metersInside > 0)
      name = 'Least time in caution area';
      const insidePart = insideSaved > 0 ? `, -${insideSaved} m inside compared to fastest` : ' compared to fastest';
      summaryText = `${c.baseSummary} +${diffDist} m / +${diffDurMin} min${insidePart}`;
    } else if (c === bestBalancedCandidate) {
      // Balanced
      name = 'Balanced';
      const insidePart = insideSaved > 0 ? `, -${insideSaved} m inside compared to fastest` : ' compared to fastest';
      if (activeNowZones.length > 0 && c.metersInside === 0 && c.minClearance < 10) {
        summaryText = `Passes close to a caution area (${edgeMeters} m from edge). +${diffDist} m / +${diffDurMin} min${insidePart}`;
      } else {
        summaryText = `${c.baseSummary} +${diffDist} m / +${diffDurMin} min${insidePart}`;
      }
    }

    const endSnapConnector: [number, number][] | undefined =
      c.endErrorMeters > 5 && c.endErrorMeters <= 40
        ? [c.coordinates[c.coordinates.length - 1], end]
        : undefined;

    return {
      id: `route-${idx}`,
      coordinates: c.coordinates,
      distance: c.distance,
      duration: c.duration,
      steps: c.steps,
      safety: c.safety,
      safetyScore: c.safetyScore,
      totalCost: c.totalCost,
      segments: c.segments,
      metersInside: c.metersInside,
      metersBuffer: c.metersBuffer,
      crimeWeightedExposure: c.crimeWeightedExposure,
      passedZonesCount: c.passedZonesCount,
      minClearance: c.minClearance,
      name,
      summaryText,
      isAvoidanceRoute,
      isOverCap,
      extraDistance,
      extraDuration,
      endSnapConnector,
      endErrorMeters: Math.round(c.endErrorMeters * 10) / 10
    };
  });

  // MESSAGES: exactly one status message at most, chosen in strict priority order
  let statusMessage: string | undefined = undefined;
  let avoidanceStatus: AvoidanceStatus = 'found';

  if (serviceUnreachable && !bestAvoidingCandidate && !fastestAlreadyAvoids && activeNowZones.length > 0) {
    statusMessage = "Safer-route service is not reachable. Showing the fastest route only.";
    avoidanceStatus = 'service_unreachable';
  } else if (requestsFailedOrTimedOut && !bestAvoidingCandidate && !fastestAlreadyAvoids) {
    statusMessage = "Couldn't finish checking for routes that avoid caution areas. Try again.";
    avoidanceStatus = 'requests_failed';
  } else if (isOriginOrDestInsideOrNearZone) {
    statusMessage = "Starts/ends inside or near a caution area. Showing the route with the least time inside.";
    avoidanceStatus = 'inside_zone';
  } else if (activeNowZones.length > 0 && !bestAvoidingCandidate && !fastestAlreadyAvoids) {
    statusMessage = "No route that avoids all caution areas was found.";
    avoidanceStatus = 'no_avoiding_route_found';
  } else if (activeNowZones.length === 0) {
    statusMessage = "No active caution areas right now.";
    avoidanceStatus = 'no_active_zones';
  } else if (finalRoutes.length === 1) {
    statusMessage = "Only one walkable route found.";
    avoidanceStatus = 'found';
  }

  // STEP 4 - RUNTIME INVARIANTS CHECK
  try {
    assertRouteInvariants(finalRoutes, finalRoutes[0]);
  } catch (err: any) {
    console.warn('[Route Invariant Warning]', err.message);
  }

  diagnostics.finalRoutesCount = finalRoutes.length;

  return {
    routes: finalRoutes,
    warning: statusMessage,
    statusMessage,
    avoidanceStatus,
    rawCandidates: candidates,
    diagnostics
  };
}

/**
 * Module-level geometry cache keyed by waypoint coords to avoid redundant network hits.
 */
const waypointGeometryCache = new Map<string, { coordinates: [number, number][]; distance: number; duration: number; steps: any[] }>();

/**
 * Session cache for finished trips: keyed by origin, destination, and active zones.
 */
const sessionTripCache = new Map<string, RouteSuggestionResult>();

export function clearSessionTripCache(): void {
  sessionTripCache.clear();
  waypointGeometryCache.clear();
}

/**
 * Loads saved route geometry for the fixed Palanan demo trip from recorded fixture.
 * Origin [14.55915, 120.99920], Destination [14.55565, 120.99920].
 * Labeled "Demo route (saved)".
 */
export function getDemoTripSavedRoutes(
  zones: DangerZone[],
  isSim: boolean = false,
  simHour: number | null = null
): RouteSuggestionResult {
  const f = palananFixtures as any;
  const directRoute = f.direct?.routes?.[0];
  const avoidingRoute = (f.trip_925m_verified_avoiding || f.wp_right_124 || f.avoiding_925m_candidate)?.routes?.[0];

  const rawCandidates: RawRouteCandidate[] = [];
  if (directRoute) {
    rawCandidates.push({
      coordinates: directRoute.geometry.coordinates.map((c: any) => [c[1], c[0]]),
      distance: directRoute.distance,
      duration: directRoute.duration,
      steps: directRoute.legs?.flatMap((l: any) => l.steps || [])?.map((step: any) => ({
        instruction: step.maneuver?.instruction || 'Continue ahead',
        distance: step.distance || 0,
        name: step.name || 'Street Path'
      })) || [],
      originType: 'service_direct'
    });
  }
  if (avoidingRoute) {
    rawCandidates.push({
      coordinates: avoidingRoute.geometry.coordinates.map((c: any) => [c[1], c[0]]),
      distance: avoidingRoute.distance,
      duration: avoidingRoute.duration,
      steps: avoidingRoute.legs?.flatMap((l: any) => l.steps || [])?.map((step: any) => ({
        instruction: step.maneuver?.instruction || 'Continue ahead',
        distance: step.distance || 0,
        name: step.name || 'Street Path'
      })) || [],
      originType: 'waypoint_detour'
    });
  }

  const result = processRoutePipeline({
    candidates: rawCandidates,
    start: [14.55915, 120.99920],
    end: [14.55565, 120.99920],
    zones,
    isSim,
    simHour
  });

  // Label strictly as "Demo route (saved)"
  result.routes = result.routes.map(r => ({
    ...r,
    name: r.name.startsWith('Avoids')
      ? `${r.name} - Demo route (saved)`
      : `${r.name} - Demo route (saved)`,
    summaryText: `${r.summaryText} (Demo route (saved))`
  }));

  return result;
}

/**
 * Main candidate generator:
 * 1. Service direct route first -> display immediately as "Fastest"
 * 2. ORS avoid-polygons request (skipped on unconfigured native builds)
 * 3. Two-via-point fallback detour search with max 12 detour requests, 16 total requests,
 *    max 2 concurrent, 8s timeout, stop on first 429 or 2 consecutive failures,
 *    300ms pause between batches of 2, 20s global budget, session cache (never caches failures).
 */
export async function generateSuggestedRoutes(
  start: [number, number],
  end: [number, number],
  zones: DangerZone[],
  isSim: boolean = false,
  simHour: number | null = null,
  fetchFn?: (url: string, timeoutMs?: number) => Promise<any | null>,
  onProgress?: (partialResult: RouteSuggestionResult) => void,
  options?: {
    forceRetry?: boolean;
    orsFetchFn?: (endpoint: string, body: any, timeoutMs?: number) => Promise<any | null>;
    orsRawFetchFn?: typeof fetch;
    isCurrentLocation?: boolean;
    isNative?: boolean;
  }
): Promise<RouteSuggestionResult> {
  const diagnostics = {
    serviceCandidatesReturned: 0,
    detourCandidatesGenerated: 0,
    detourCandidatesRejected: 0,
    rejectionReasons: {
      'crosses an active zone': 0,
      'outside bounds': 0,
      'duplicate': 0,
      'error': 0
    } as Record<string, number>,
    finalRoutesCount: 0,
    avoidanceWaypointsTried: [] as any[],
    requestsFailedOrTimedOut: false,
    orsFailed: false,
    serviceUnreachable: false,
    totalRequestErrors: 0
  };

  const activeNowZones = zones.filter(zone => {
    if (!zone || isZoneResolved(zone) || zone.active === false) return false;
    if (!zone.location || typeof zone.location.lat !== 'number' || typeof zone.location.lng !== 'number') return false;
    return isZoneCurrentlyActive(zone, isSim, simHour);
  });

  // 1. Session Cache Check (includes zone lat, lng, radius, and crimeCount)
  const activeZoneKey = activeNowZones
    .map(z => `${z.id}:${z.location.lat.toFixed(5)},${z.location.lng.toFixed(5)}:${z.radius}:${z.crimeCount || 0}`)
    .sort()
    .join(';');
  const startLatKey = options?.isCurrentLocation
    ? (Math.round(start[0] * 10000) / 10000).toFixed(4)
    : start[0].toFixed(5);
  const startLngKey = options?.isCurrentLocation
    ? (Math.round(start[1] * 10000) / 10000).toFixed(4)
    : start[1].toFixed(5);
  const tripCacheKey = `${startLatKey},${startLngKey}_${end[0].toFixed(5)},${end[1].toFixed(5)}_${activeZoneKey}_${isSim}_${simHour}`;

  if (options?.forceRetry) {
    sessionTripCache.delete(tripCacheKey);
  } else if (sessionTripCache.has(tripCacheKey)) {
    const cached = sessionTripCache.get(tripCacheKey)!;
    if (onProgress) onProgress(cached);
    return cached;
  }

  // 20s Hard global budget
  const globalController = new AbortController();
  const budgetTimer = setTimeout(() => {
    globalController.abort();
  }, 20000);

  let totalHttpAttempts = 0; // max 16 total
  let detourHttpAttempts = 0; // max 12 for detours
  let hit429 = false;
  let consecutiveDetourFailures = 0; // stop after 2 consecutive failures
  let searchStopped = false;
  let orsFailed = false;
  let serviceUnreachable = false;

  const rawCandidates: RawRouteCandidate[] = [];

  // 2. Fetch direct route first
  const directCoordsStr = `${start[1]},${start[0]};${end[1]},${end[0]}`;
  let directJson: any = null;

  if (fetchFn) {
    directJson = await fetchFn(
      `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${directCoordsStr}?overview=full&geometries=geojson&steps=true`,
      8000
    );
  } else {
    // Primary router attempt
    if (totalHttpAttempts < 16 && !globalController.signal.aborted) {
      totalHttpAttempts++;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const onAbort = () => controller.abort();
        globalController.signal.addEventListener('abort', onAbort, { once: true });

        const res = await fetch(
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${directCoordsStr}?overview=full&geometries=geojson&steps=true&alternatives=true`,
          { signal: controller.signal }
        );
        clearTimeout(t);
        globalController.signal.removeEventListener('abort', onAbort);

        if (res.status === 429) {
          hit429 = true;
        } else if (res.ok) {
          const json = await res.json();
          if (json && json.code === 'Ok') directJson = json;
        }
      } catch {
        // Primary failed
      }
    }

    // Fallback router attempt for direct route if primary failed (and not 429)
    if (!directJson && !hit429 && totalHttpAttempts < 16 && !globalController.signal.aborted) {
      totalHttpAttempts++;
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8000);
        const onAbort = () => controller.abort();
        globalController.signal.addEventListener('abort', onAbort, { once: true });

        const res = await fetch(
          `https://router.project-osrm.org/route/v1/foot/${directCoordsStr}?overview=full&geometries=geojson&steps=true&alternatives=true`,
          { signal: controller.signal }
        );
        clearTimeout(t);
        globalController.signal.removeEventListener('abort', onAbort);

        if (res.status === 429) {
          hit429 = true;
        } else if (res.ok) {
          const json = await res.json();
          if (json && json.code === 'Ok') directJson = json;
        }
      } catch {
        // Fallback failed
      }
    }
  }

  // 3. Process direct route candidates
  if (directJson && directJson.routes && directJson.routes.length > 0) {
    directJson.routes.forEach((r: any, idx: number) => {
      diagnostics.serviceCandidatesReturned++;
      rawCandidates.push({
        coordinates: r.geometry.coordinates.map((c: any) => [c[1], c[0]]),
        distance: r.distance,
        duration: r.duration,
        steps: r.legs?.flatMap((l: any) => l.steps || [])?.map((step: any) => ({
          instruction: step.maneuver?.instruction || 'Continue ahead',
          distance: step.distance || 0,
          name: step.name || 'Street Path'
        })) || [],
        originType: idx === 0 ? 'service_direct' : 'service_alternative'
      });
    });

    // Display Fastest (raw path) immediately
    const initialDirectPipeline = processRoutePipeline({
      candidates: [rawCandidates[0]],
      start,
      end,
      zones,
      isSim,
      simHour,
      diagnostics
    });
    if (onProgress) {
      onProgress(initialDirectPipeline);
    }
  } else {
    diagnostics.requestsFailedOrTimedOut = true;
    diagnostics.totalRequestErrors++;

    // Automatic fixture fallback if both routers fail on fixed demo trip
    const isDemoCoords =
      Math.abs(start[0] - 14.55915) < 0.001 &&
      Math.abs(start[1] - 120.99920) < 0.001 &&
      Math.abs(end[0] - 14.55565) < 0.001 &&
      Math.abs(end[1] - 120.99920) < 0.001;

    if (isDemoCoords) {
      clearTimeout(budgetTimer);
      const demoRes = getDemoTripSavedRoutes(zones, isSim, simHour);
      if (onProgress) onProgress(demoRes);
      return demoRes;
    }
  }

  // If direct route failed or no zones active, return immediately
  if (rawCandidates.length === 0 || activeNowZones.length === 0) {
    clearTimeout(budgetTimer);
    const result = processRoutePipeline({
      candidates: rawCandidates,
      start,
      end,
      zones,
      isSim,
      simHour,
      requestsFailedOrTimedOut: diagnostics.requestsFailedOrTimedOut || hit429 || orsFailed,
      serviceUnreachable,
      diagnostics
    });
    if (
      result.routes.length > 0 &&
      !diagnostics.requestsFailedOrTimedOut &&
      !hit429 &&
      !orsFailed &&
      !serviceUnreachable &&
      result.avoidanceStatus !== 'requests_failed' &&
      result.avoidanceStatus !== 'service_unreachable'
    ) {
      sessionTripCache.set(tripCacheKey, result);
    }
    if (onProgress) onProgress(result);
    return result;
  }

  // 4. OpenRouteService Avoid-Polygons Request (Primary avoiding route finder)
  let foundAvoidingRoute = false;

  const activeZonesToAvoid = activeNowZones.filter(z => {
    const dStart = getDistanceMeters(start[0], start[1], z.location.lat, z.location.lng);
    const dEnd = getDistanceMeters(end[0], end[1], z.location.lat, z.location.lng);
    return dStart > z.radius + 10 && dEnd > z.radius + 10;
  });

  if (activeZonesToAvoid.length > 0 && !hit429 && totalHttpAttempts < 16 && !globalController.signal.aborted) {
    const hasCustomOrsFn = Boolean(options?.orsFetchFn || options?.orsRawFetchFn);
    const nativeMissingUrl = isNativeMissingApiBaseUrl({ isNative: options?.isNative });
    const cachedHealth = !hasCustomOrsFn ? getCachedApiHealth() : null;

    if (nativeMissingUrl && !hasCustomOrsFn) {
      // Packaged native app with no configured API base URL: skip ORS and mark service unreachable
      orsFailed = true;
      serviceUnreachable = true;
      diagnostics.requestsFailedOrTimedOut = true;
      diagnostics.orsFailed = true;
      diagnostics.serviceUnreachable = true;
      diagnostics.totalRequestErrors++;
    } else if (!options?.forceRetry && cachedHealth && !cachedHealth.ok && !hasCustomOrsFn) {
      orsFailed = true;
      serviceUnreachable = true;
      diagnostics.requestsFailedOrTimedOut = true;
      diagnostics.orsFailed = true;
      diagnostics.serviceUnreachable = true;
      diagnostics.totalRequestErrors++;
    } else if (hasCustomOrsFn || typeof window !== 'undefined') {
      const avoidPolygons = activeZonesToAvoid.map(z => [createZoneAvoidPolygon(z, 10, 32)]);

      let orsJson: any = null;
      let orsAttempts = 0;
      const maxOrsAttempts = 2; // at most 1 request plus 1 retry
      let currentStart = [...start] as [number, number];
      let currentEnd = [...end] as [number, number];

      while (orsAttempts < maxOrsAttempts && !orsJson && totalHttpAttempts < 16 && !globalController.signal.aborted && !hit429) {
        orsAttempts++;
        totalHttpAttempts++;
        const currentOrsBody = {
          coordinates: [[currentStart[1], currentStart[0]], [currentEnd[1], currentEnd[0]]],
          avoidPolygons
        };

        try {
          let resData: any = null;
          let resStatus = 200;

          if (options?.orsFetchFn) {
            const res = await options.orsFetchFn('/api/directions/ors', currentOrsBody, 8000);
            if (!res) {
              orsFailed = true;
              serviceUnreachable = true;
              break;
            }
            if (res.redirected || res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || (typeof res.url === 'string' && res.url.includes('__cookie_check'))) {
              orsFailed = true;
              serviceUnreachable = true;
              break;
            }
            if (res.isHtml) {
              orsFailed = true;
              serviceUnreachable = true;
              break;
            }
            resStatus = res.status || (res.features || res.routes ? 200 : 400);
            resData = res;
          } else if (options?.orsRawFetchFn || typeof window !== 'undefined') {
            const rawFetch = options?.orsRawFetchFn || fetch;
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 8000);
            const onAbort = () => controller.abort();
            globalController.signal.addEventListener('abort', onAbort, { once: true });

            const res = await rawFetch(getApiUrl('/api/directions/ors', { isNative: options?.isNative }), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(currentOrsBody),
              redirect: 'manual',
              signal: controller.signal
            });
            clearTimeout(t);
            globalController.signal.removeEventListener('abort', onAbort);

            if (
              res.type === 'opaqueredirect' ||
              (res.status >= 300 && res.status < 400) ||
              res.redirected ||
              (typeof res.url === 'string' && res.url.includes('__cookie_check'))
            ) {
              orsFailed = true;
              serviceUnreachable = true;
              break;
            }

            resStatus = res.status;

            if (resStatus === 401 || resStatus === 403) {
              orsFailed = true;
              serviceUnreachable = true;
              break;
            }

            if (resStatus === 429) {
              hit429 = true;
              orsFailed = true;
              break;
            }

            const contentType = res.headers?.get?.('content-type') || '';
            const rawText = typeof res.text === 'function'
              ? await res.text()
              : JSON.stringify(await res.json());
            const trimmed = (rawText || '').trim();
            const looksLikeHtml = trimmed.startsWith('<') || contentType.toLowerCase().includes('text/html');

            if (looksLikeHtml || (res.ok && contentType && !contentType.toLowerCase().includes('json'))) {
              orsFailed = true;
              serviceUnreachable = true;
              break;
            }

            if (trimmed) {
              try {
                resData = JSON.parse(trimmed);
              } catch {
                orsFailed = true;
                serviceUnreachable = true;
                break;
              }
            } else if (resStatus >= 500 || !res.ok) {
              orsFailed = true;
              serviceUnreachable = resStatus >= 500;
              break;
            }
          }

          if (resStatus === 429) {
            hit429 = true;
            orsFailed = true;
            break;
          }
          if (resStatus === 401 || resStatus === 403) {
            orsFailed = true;
            serviceUnreachable = true;
            break;
          }
          if (resStatus >= 500 || resData?.disabled) {
            orsFailed = true;
            break;
          }

          if (resData && (resData.features || resData.routes)) {
            orsFailed = false;
            orsJson = resData;
            break;
          }

          // Handle ORS error 2010: point cannot be snapped, or lies inside the avoid polygon
          const errorCode = resData?.code || resData?.orsError?.code;
          const errorMessage = resData?.error || resData?.orsError?.message || '';
          const is2010 = errorCode === 2010 || (typeof errorMessage === 'string' && (errorMessage.includes('2010') || errorMessage.includes('routable point')));

          if (is2010) {
            if (orsAttempts < maxOrsAttempts) {
              let moved = false;
              for (const z of activeZonesToAvoid) {
                const dS = getDistanceMeters(currentStart[0], currentStart[1], z.location.lat, z.location.lng);
                if (dS <= z.radius + 15) {
                  const targetD = z.radius + 25;
                  const ratio = dS > 0.1 ? targetD / dS : 1;
                  currentStart = [
                    z.location.lat + (currentStart[0] - z.location.lat) * ratio,
                    z.location.lng + (currentStart[1] - z.location.lng) * ratio
                  ];
                  moved = true;
                }
                const dE = getDistanceMeters(currentEnd[0], currentEnd[1], z.location.lat, z.location.lng);
                if (dE <= z.radius + 15) {
                  const targetD = z.radius + 25;
                  const ratio = dE > 0.1 ? targetD / dE : 1;
                  currentEnd = [
                    z.location.lat + (currentEnd[0] - z.location.lat) * ratio,
                    z.location.lng + (currentEnd[1] - z.location.lng) * ratio
                  ];
                  moved = true;
                }
              }
              if (moved) {
                continue;
              }
            }
            break;
          }

          // Any other non-2010 HTTP error (400/404/etc.) or malformed payload counts as ORS failure
          if (resStatus >= 400 || !resData) {
            orsFailed = true;
            break;
          }
        } catch (err: any) {
          orsFailed = true;
          if (err instanceof TypeError || err?.name === 'TypeError') {
            serviceUnreachable = true;
          }
          // AbortError (timeout) or TypeError (CORS / network) - loop may attempt 1 retry
        }
      }

      if (orsFailed) {
        diagnostics.requestsFailedOrTimedOut = true;
        diagnostics.orsFailed = true;
        diagnostics.serviceUnreachable = serviceUnreachable;
        diagnostics.totalRequestErrors++;
      }

      if (orsJson) {
        const feature = orsJson.features?.[0];
        const orsRoute = orsJson.routes?.[0];
        let coordinates: [number, number][] = [];
        let distance = 0;
        let duration = 0;
        let steps: any[] = [];

        if (feature && feature.geometry && Array.isArray(feature.geometry.coordinates)) {
          coordinates = feature.geometry.coordinates.map((c: any) => [c[1], c[0]]);
          distance = feature.properties?.summary?.distance || feature.properties?.segments?.[0]?.distance || 0;
          duration = feature.properties?.summary?.duration || feature.properties?.segments?.[0]?.duration || 0;
          steps = feature.properties?.segments?.flatMap((s: any) => s.steps || [])?.map((step: any) => ({
            instruction: step.instruction || 'Continue ahead',
            distance: step.distance || 0,
            name: step.name || 'Street Path'
          })) || [];
        } else if (orsRoute && orsRoute.geometry && Array.isArray(orsRoute.geometry.coordinates)) {
          coordinates = orsRoute.geometry.coordinates.map((c: any) => [c[1], c[0]]);
          distance = orsRoute.distance || 0;
          duration = orsRoute.duration || 0;
          steps = orsRoute.legs?.flatMap((l: any) => l.steps || [])?.map((step: any) => ({
            instruction: step.maneuver?.instruction || step.instruction || 'Continue ahead',
            distance: step.distance || 0,
            name: step.name || 'Street Path'
          })) || [];
        }

        if (coordinates.length >= 2) {
          const densifiedOrs = densifyCoordinates(coordinates, 10);
          const clr = isRouteClearingAllZones(densifiedOrs, zones, 10, isSim, simHour);
          const metrics = computeRouteZoneMetrics(densifiedOrs, distance, duration, zones, isSim, simHour);
          const endPt = densifiedOrs[densifiedOrs.length - 1];
          const endErr = getDistanceMeters(endPt[0], endPt[1], end[0], end[1]);

          if (metrics.metersInside === 0 && clr.isClear && clr.minClearance >= 10 && endErr <= 40) {
            rawCandidates.push({
              coordinates: densifiedOrs,
              distance,
              duration,
              steps,
              originType: 'ors_avoid'
            });
            foundAvoidingRoute = true;
            searchStopped = true;

            if (onProgress) {
              const progressiveResult = processRoutePipeline({
                candidates: rawCandidates,
                start,
                end,
                zones,
                isSim,
                simHour,
                requestsFailedOrTimedOut: diagnostics.requestsFailedOrTimedOut || orsFailed,
                serviceUnreachable,
                diagnostics
              });
              onProgress(progressiveResult);
            }
          }
        }
      }
    }
  }

  // 5. Fallback two-via-point detour search around active zones within 1.5x radius
  // Places before & after via-points on the same side (nearest cross streets outside the zone)
  // across offsets [r + 40, r + 80, r + 120] on both sides.
  const zonesToAvoid = activeNowZones.filter(z => {
    const d = getMinDistanceToSegmentMeters(start[0], start[1], end[0], end[1], z.location.lat, z.location.lng);
    return d <= z.radius * 1.5;
  });

  const waypointQueue: {
    side: string;
    offset: number;
    wps: [number, number][];
    key: string;
  }[] = [];

  const midLat = (start[0] + end[0]) / 2;
  const tripCosLat = Math.cos((midLat * Math.PI) / 180);
  const dxMeters = (end[1] - start[1]) * 111000 * tripCosLat;
  const dyMeters = (end[0] - start[0]) * 111000;
  const tripLenMeters = Math.hypot(dxMeters, dyMeters) || 1;
  const tanX = dxMeters / tripLenMeters;
  const tanY = dyMeters / tripLenMeters;
  const normX = -tanY;
  const normY = tanX;

  const latDeg = 1 / 111000;

  // Offsets [r+40, r+80, r+120] on both sides with paired (before, after) via-points
  if (!foundAvoidingRoute) {
    zonesToAvoid.forEach(zone => {
      const cosLat = Math.cos((zone.location.lat * Math.PI) / 180);
      const lngDeg = 1 / (111000 * cosLat);
      const offsets = [zone.radius + 40, zone.radius + 80, zone.radius + 120];

      // Longitudinal bracket distance before and after zone center
      const sToZ_x = (zone.location.lng - start[1]) * 111000 * cosLat;
      const sToZ_y = (zone.location.lat - start[0]) * 111000;
      const projAlong = sToZ_x * tanX + sToZ_y * tanY;
      const distBefore = Math.max(0, projAlong);
      const distAfter = Math.max(0, tripLenMeters - projAlong);
      const beforeAlong = distBefore > zone.radius + 35
        ? zone.radius + 25
        : Math.max(30, Math.min(zone.radius + 20, distBefore * 0.85 || zone.radius * 0.75));
      const afterAlong = distAfter > zone.radius + 35
        ? zone.radius + 25
        : Math.max(30, Math.min(zone.radius + 20, distAfter * 0.85 || zone.radius * 0.75));

      offsets.forEach(offset => {
        [
          { side: 'Beside Left', sign: 1 },
          { side: 'Beside Right', sign: -1 }
        ].forEach(({ side, sign }) => {
          const wpBefore: [number, number] = [
            zone.location.lat + (normY * sign * offset - tanY * beforeAlong) * latDeg,
            zone.location.lng + (normX * sign * offset - tanX * beforeAlong) * lngDeg
          ];
          const wpAfter: [number, number] = [
            zone.location.lat + (normY * sign * offset + tanY * afterAlong) * latDeg,
            zone.location.lng + (normX * sign * offset + tanX * afterAlong) * lngDeg
          ];

          if (isInsidePalanan(wpBefore[0], wpBefore[1]) && isInsidePalanan(wpAfter[0], wpAfter[1])) {
            const key = `${start[0].toFixed(5)},${start[1].toFixed(5)}_${wpBefore[0].toFixed(5)},${wpBefore[1].toFixed(5)}_${wpAfter[0].toFixed(5)},${wpAfter[1].toFixed(5)}_${end[0].toFixed(5)},${end[1].toFixed(5)}`;
            waypointQueue.push({ side, offset, wps: [wpBefore, wpAfter], key });
          } else {
            diagnostics.rejectionReasons['outside bounds']++;
          }
        });
      });
    });

    // Chained waypoints if 2 or more zones
    if (zonesToAvoid.length >= 2) {
      const z1 = zonesToAvoid[0];
      const z2 = zonesToAvoid[1];
      const off1 = z1.radius + 60;
      const off2 = z2.radius + 60;
      const wp1: [number, number] = [
        z1.location.lat + normY * off1 * latDeg,
        z1.location.lng + normX * off1 * (1 / (111000 * Math.cos((z1.location.lat * Math.PI) / 180)))
      ];
      const wp2: [number, number] = [
        z2.location.lat + normY * off2 * latDeg,
        z2.location.lng + normX * off2 * (1 / (111000 * Math.cos((z2.location.lat * Math.PI) / 180)))
      ];
      if (isInsidePalanan(wp1[0], wp1[1]) && isInsidePalanan(wp2[0], wp2[1])) {
        const chainedKey = `chained_${start[0].toFixed(4)}_${wp1[0].toFixed(4)}_${wp2[0].toFixed(4)}_${end[0].toFixed(4)}`;
        waypointQueue.push({ side: 'Chained Dual Zone', offset: off1, wps: [wp1, wp2], key: chainedKey });
      }
    }
  }

  // 6. Worker loop with max 2 concurrent requests, 300ms pause between batches, cap of 12 detour attempts / 16 total
  let extraOffsetsLeft = 4;

  for (let i = 0; i < waypointQueue.length && !searchStopped; i += 2) {
    if (globalController.signal.aborted || hit429 || consecutiveDetourFailures >= 2 || detourHttpAttempts >= 12 || totalHttpAttempts >= 16) {
      break;
    }

    const batch = waypointQueue.slice(i, i + 2);
    const batchPromises = batch.map(async item => {
      if (searchStopped || hit429 || consecutiveDetourFailures >= 2 || detourHttpAttempts >= 12 || totalHttpAttempts >= 16 || globalController.signal.aborted) {
        return;
      }

      diagnostics.detourCandidatesGenerated++;

      // Check cached geometry by waypoint key
      if (waypointGeometryCache.has(item.key)) {
        const cached = waypointGeometryCache.get(item.key)!;
        rawCandidates.push({
          coordinates: cached.coordinates,
          distance: cached.distance,
          duration: cached.duration,
          steps: cached.steps,
          originType: 'waypoint_detour',
          waypointKey: item.key
        });
        const clr = isRouteClearingAllZones(cached.coordinates, zones, 10, isSim, simHour);
        const lastPt = cached.coordinates[cached.coordinates.length - 1];
        const endErr = getDistanceMeters(lastPt[0], lastPt[1], end[0], end[1]);
        if (clr.isClear && endErr <= 40) foundAvoidingRoute = true;
        return;
      }

      const coordsStr = [
        `${start[1]},${start[0]}`,
        ...item.wps.map(wp => `${wp[1]},${wp[0]}`),
        `${end[1]},${end[0]}`
      ].join(';');
      let json: any = null;

      if (fetchFn) {
        json = await fetchFn(
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordsStr}?overview=full&geometries=geojson&steps=true`,
          8000
        );
      } else {
        detourHttpAttempts++;
        totalHttpAttempts++;
        try {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 8000);
          const onAbort = () => controller.abort();
          globalController.signal.addEventListener('abort', onAbort, { once: true });

          const res = await fetch(
            `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordsStr}?overview=full&geometries=geojson&steps=true&alternatives=true`,
            { signal: controller.signal }
          );
          clearTimeout(t);
          globalController.signal.removeEventListener('abort', onAbort);

          if (res.status === 429) {
            hit429 = true;
            consecutiveDetourFailures++;
            searchStopped = true;
            return;
          }

          if (res.ok) {
            const resJson = await res.json();
            if (resJson && resJson.code === 'Ok') {
              json = resJson;
              consecutiveDetourFailures = 0;
            }
          } else {
            consecutiveDetourFailures++;
          }
        } catch {
          consecutiveDetourFailures++;
        }

        // Single fallback attempt if primary failed (and not 429, failures < 2, limits permit)
        if (!json && !hit429 && consecutiveDetourFailures < 2 && detourHttpAttempts < 12 && totalHttpAttempts < 16 && !globalController.signal.aborted) {
          detourHttpAttempts++;
          totalHttpAttempts++;
          try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 8000);
            const onAbort = () => controller.abort();
            globalController.signal.addEventListener('abort', onAbort, { once: true });

            const res = await fetch(
              `https://router.project-osrm.org/route/v1/foot/${coordsStr}?overview=full&geometries=geojson&steps=true&alternatives=true`,
              { signal: controller.signal }
            );
            clearTimeout(t);
            globalController.signal.removeEventListener('abort', onAbort);

            if (res.status === 429) {
              hit429 = true;
              consecutiveDetourFailures++;
              searchStopped = true;
              return;
            }

            if (res.ok) {
              const resJson = await res.json();
              if (resJson && resJson.code === 'Ok') {
                json = resJson;
                consecutiveDetourFailures = 0;
              }
            } else {
              consecutiveDetourFailures++;
            }
          } catch {
            consecutiveDetourFailures++;
          }
        }

        if (consecutiveDetourFailures >= 2) {
          searchStopped = true;
        }
      }

      if (json && json.code === 'Ok' && json.routes && json.routes[0]) {
        const r = json.routes[0];
        const coordinates: [number, number][] = r.geometry.coordinates.map((c: any) => [c[1], c[0]]);
        const steps = r.legs?.flatMap((l: any) => l.steps || [])?.map((step: any) => ({
          instruction: step.maneuver?.instruction || 'Continue ahead',
          distance: step.distance || 0,
          name: step.name || 'Street Path'
        })) || [];

        const densified = densifyCoordinates(coordinates, 10);
        const clr = isRouteClearingAllZones(densified, zones, 10, isSim, simHour);
        const metrics = computeRouteZoneMetrics(densified, r.distance, r.duration, zones, isSim, simHour);
        const lastPt = coordinates[coordinates.length - 1];
        const endErr = lastPt ? getDistanceMeters(lastPt[0], lastPt[1], end[0], end[1]) : Infinity;

        diagnostics.avoidanceWaypointsTried.push({
          side: item.side,
          offset: item.offset,
          routeDistance: Math.round(r.distance),
          metersInside: metrics.metersInside,
          metersBuffer: metrics.metersBuffer,
          minClearance: Math.round(clr.minClearance),
          status: endErr > 40 ? 'end_too_far' : (clr.isClear && metrics.metersInside === 0 ? 'verified_clear' : (metrics.metersInside > 0 ? 'crosses_zone' : 'close_pass'))
        });

        if (endErr <= 40) {
          waypointGeometryCache.set(item.key, {
            coordinates,
            distance: r.distance,
            duration: r.duration,
            steps
          });

          rawCandidates.push({
            coordinates,
            distance: r.distance,
            duration: r.duration,
            steps,
            originType: 'waypoint_detour',
            waypointKey: item.key
          });

          if (clr.isClear && metrics.metersInside === 0) {
            foundAvoidingRoute = true;
          }
        }
      } else {
        diagnostics.rejectionReasons['error']++;
        diagnostics.avoidanceWaypointsTried.push({
          side: item.side,
          offset: item.offset,
          status: 'request_failed'
        });
      }
    });

    await Promise.all(batchPromises);

    // Progressive update after each batch (keeps direct route, adds newly verified routes)
    if (onProgress && rawCandidates.length > 0) {
      const progressiveResult = processRoutePipeline({
        candidates: rawCandidates,
        start,
        end,
        zones,
        isSim,
        simHour,
        requestsFailedOrTimedOut: diagnostics.requestsFailedOrTimedOut || orsFailed,
        serviceUnreachable,
        diagnostics
      });
      onProgress(progressiveResult);
    }

    if (foundAvoidingRoute) {
      extraOffsetsLeft -= batch.length;
      if (extraOffsetsLeft <= 0) {
        searchStopped = true;
        break;
      }
    }

    if (searchStopped) break;

    // 300 ms pause between batches of 2
    if (i + 2 < waypointQueue.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  clearTimeout(budgetTimer);

  // 7. Final pipeline consolidation
  const anyFailure = Boolean(diagnostics.requestsFailedOrTimedOut || hit429 || consecutiveDetourFailures >= 2 || orsFailed);
  diagnostics.requestsFailedOrTimedOut = anyFailure;
  diagnostics.orsFailed = orsFailed;
  diagnostics.serviceUnreachable = serviceUnreachable;

  const finalResult = processRoutePipeline({
    candidates: rawCandidates,
    start,
    end,
    zones,
    isSim,
    simHour,
    requestsFailedOrTimedOut: anyFailure,
    serviceUnreachable,
    diagnostics
  });

  if (
    finalResult.routes.length > 0 &&
    !anyFailure &&
    !orsFailed &&
    !serviceUnreachable &&
    finalResult.avoidanceStatus !== 'requests_failed' &&
    finalResult.avoidanceStatus !== 'service_unreachable'
  ) {
    sessionTripCache.set(tripCacheKey, finalResult);
  }

  if (onProgress) {
    onProgress(finalResult);
  }

  return finalResult;
}

export interface InZonePolylineSegment {
  coordinates: [number, number][];
  crimeCount: number;
  zoneId: string;
}

/**
 * Computes in-zone segments at render time directly from displayed route coordinates
 * (densified to 10m) and the currently active zones.
 * Merges consecutive in-zone points into a single polyline per zone entry.
 */
export function computeInZonePolylinesAtRenderTime(
  coords: [number, number][],
  activeZones: DangerZone[]
): InZonePolylineSegment[] {
  if (!coords || coords.length < 2 || !activeZones || activeZones.length === 0) return [];
  const densified = densifyCoordinates(coords, 10);
  const polylines: InZonePolylineSegment[] = [];
  let currentGroup: { points: [number, number][]; maxCrime: number; zoneId: string } | null = null;

  for (let i = 0; i < densified.length; i++) {
    const pt = densified[i];
    let insideZone: DangerZone | null = null;
    for (const z of activeZones) {
      if (!z.location || typeof z.location.lat !== 'number' || typeof z.location.lng !== 'number') continue;
      const d = getDistanceMeters(pt[0], pt[1], z.location.lat, z.location.lng);
      if (d <= z.radius) {
        if (!insideZone || (z.crimeCount || 0) > (insideZone.crimeCount || 0)) {
          insideZone = z;
        }
      }
    }

    if (insideZone) {
      if (!currentGroup) {
        currentGroup = {
          points: i > 0 ? [densified[i - 1], pt] : [pt],
          maxCrime: insideZone.crimeCount || 0,
          zoneId: insideZone.id || 'zone'
        };
      } else {
        currentGroup.points.push(pt);
        if ((insideZone.crimeCount || 0) > currentGroup.maxCrime) {
          currentGroup.maxCrime = insideZone.crimeCount || 0;
        }
      }
    } else {
      if (currentGroup) {
        currentGroup.points.push(pt);
        if (currentGroup.points.length >= 2) {
          polylines.push({
            coordinates: currentGroup.points,
            crimeCount: currentGroup.maxCrime,
            zoneId: currentGroup.zoneId
          });
        }
        currentGroup = null;
      }
    }
  }

  if (currentGroup && currentGroup.points.length >= 2) {
    polylines.push({
      coordinates: currentGroup.points,
      crimeCount: currentGroup.maxCrime,
      zoneId: currentGroup.zoneId
    });
  }

  return polylines;
}

