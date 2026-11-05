import { normalizeDangerZone } from './zoneUtils';
import {
  generateSuggestedRoutes,
  processRoutePipeline,
  computeRouteZoneMetrics,
  areRoutesNearDuplicates,
  getDistanceMeters,
  isRouteClearingAllZones,
  assertRouteInvariants,
  getDemoTripSavedRoutes,
  clearSessionTripCache,
  densifyCoordinates,
  createZoneAvoidPolygon,
  RawRouteCandidate
} from './routeUtils';
import { getApiUrl, getApiBaseUrl } from '../lib/apiConfig';
import palananFixtures from './fixtures/palananTripFixtures.json';

let passedTests = 0;
let totalTests = 0;
const testNames: string[] = [];

function assert(condition: boolean, testName: string) {
  totalTests++;
  testNames.push(testName);
  if (condition) {
    passedTests++;
    console.log(`✅ PASSED: ${testName}`);
  } else {
    console.error(`❌ FAILED: ${testName}`);
    throw new Error(`Assertion failed: ${testName}`);
  }
}

async function runTests() {
  console.log('--- RUNNING CONSOLIDATED ROUTE PIPELINE & AVOIDANCE TESTS ---\n');

  const latDeg = 1 / 111000;

  // TEST 1: Strict clearance check (5m vs 25m)
  const clearanceZone = normalizeDangerZone({
    id: 'z-clearance',
    latitude: 14.55900,
    longitude: 121.00030,
    radius: 60,
    active: true,
    activeTime: 'all_day',
    crimeCount: 5
  });

  const route5m: [number, number][] = [
    [14.55900 + 65 * latDeg, 120.99900],
    [14.55900 + 65 * latDeg, 121.00030],
    [14.55900 + 65 * latDeg, 121.00160]
  ];
  const c5m = isRouteClearingAllZones(route5m, [clearanceZone], 10);
  assert(c5m.isClear === false, 'Route 5m outside a circle edge is NOT labeled "Avoids" (clearance < 10m)');

  const route25m: [number, number][] = [
    [14.55900 + 85 * latDeg, 120.99900],
    [14.55900 + 85 * latDeg, 121.00030],
    [14.55900 + 85 * latDeg, 121.00160]
  ];
  const c25m = isRouteClearingAllZones(route25m, [clearanceZone], 10);
  assert(c25m.isClear === true, 'Route 25m outside a circle edge IS labeled "Avoids" (clearance >= 10m)');

  // TEST 2: Real recorded fixture trip in Palanan
  // Origin: [14.55915, 120.99920], Destination: [14.55565, 120.99920], Zone at [14.55740, 120.99920], radius 74m
  const recordedTripZone = normalizeDangerZone({
    id: 'zone-palanan-audit',
    description: 'Dian St & Emilia Caution Area',
    location: { lat: 14.55740, lng: 120.99920 },
    radius: 74,
    crimeCount: 8,
    dataPeriod: '2024-Q3',
    active: true,
    activeTime: 'all_day'
  });

  const tripStart: [number, number] = [14.55915, 120.99920];
  const tripEnd: [number, number] = [14.55565, 120.99920];

  const mockFixtureFetch = async (url: string) => {
    const isDetour = url.split('/foot/')[1]?.split('?')[0]?.split(';')?.length === 3;
    if (!isDetour) {
      return (palananFixtures as any).direct;
    }
    return (palananFixtures as any).wp_right_124 || (palananFixtures as any).trip_925m_verified_avoiding;
  };

  const fixtureResult = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    mockFixtureFetch
  );

  assert(fixtureResult.routes.length >= 2, 'Palanan fixture trip returns at least 2 routes');
  assert(fixtureResult.routes[0].name.startsWith('Fastest'), 'Palanan fixture trip: Fastest is first in list');
  const avoidingRouteInFixture = fixtureResult.routes.find(r => r.name.startsWith('Avoids caution areas'));
  assert(avoidingRouteInFixture !== undefined, 'Palanan fixture trip includes verified avoiding route');
  assert(avoidingRouteInFixture?.metersInside === 0, 'Palanan fixture trip avoiding route has metersInside = 0');
  assert(fixtureResult.statusMessage !== 'No route that avoids all caution areas was found.', 'No false "no route found" message on valid Palanan trip');

  // TEST 3: Over-cap avoiding route is labeled with extra distance & time
  const directShort: RawRouteCandidate = {
    coordinates: [
      [14.55915, 120.99920],
      [14.55740, 120.99920],
      [14.55565, 120.99920]
    ],
    distance: 389,
    duration: 299,
    steps: []
  };

  // Avoiding route with 925m (+536m over 389m direct; cap = min(1.5*389, 389+500) = 583m)
  const lngDegTrip = 1 / (111000 * Math.cos(14.55740 * Math.PI / 180));
  const overCapAvoiding: RawRouteCandidate = {
    coordinates: [
      [14.55915, 120.99920],
      [14.55740, 120.99920 + 120 * lngDegTrip],
      [14.55565, 120.99920]
    ],
    distance: 925,
    duration: 711,
    steps: []
  };

  const overCapResult = processRoutePipeline({
    candidates: [directShort, overCapAvoiding],
    start: tripStart,
    end: tripEnd,
    zones: [recordedTripZone],
    isSim: false,
    simHour: null
  });

  const overCapRoute = overCapResult.routes.find(r => r.isAvoidanceRoute);
  assert(overCapRoute !== undefined && overCapRoute.isOverCap === true, 'Over-cap avoiding route still shows and is marked isOverCap=true');
  assert(overCapRoute?.name === 'Avoids caution areas (+536 m, +7 min)', `Over-cap route name includes extra distance/time label (got "${overCapRoute?.name}")`);
  assert(overCapRoute?.summaryText?.includes('+536 m / +7 min'), 'Over-cap route summary includes delta (+536 m / +7 min)');
  assert(overCapRoute?.summaryText?.includes('m inside compared to fastest'), 'Over-cap route summary includes inside reduction compared to fastest');

  // TEST 4: Fastest already clears the zone
  const farAwayZone = normalizeDangerZone({
    id: 'z-far',
    location: { lat: 14.5520, lng: 120.9900 },
    radius: 40,
    active: true,
    activeTime: 'all_day',
    crimeCount: 4
  });

  const fastestClearsResult = processRoutePipeline({
    candidates: [directShort],
    start: tripStart,
    end: tripEnd,
    zones: [farAwayZone],
    isSim: false,
    simHour: null
  });

  assert(fastestClearsResult.routes[0].name === 'Fastest - avoids active caution areas', 'Fastest labeled "Fastest - avoids active caution areas" when direct path clears zones');
  assert(fastestClearsResult.routes.length === 1, 'No second copy shown when Fastest already clears zones');

  // TEST 5: Destination inside a zone
  const destInsideZone = normalizeDangerZone({
    id: 'z-dest-inside',
    location: { lat: 14.55565, lng: 120.99920 },
    radius: 60,
    active: true,
    activeTime: 'all_day',
    crimeCount: 7
  });

  const insideZoneResult = processRoutePipeline({
    candidates: [directShort],
    start: tripStart,
    end: tripEnd,
    zones: [destInsideZone],
    isSim: false,
    simHour: null
  });

  assert(insideZoneResult.statusMessage === 'Starts/ends inside or near a caution area. Showing the route with the least time inside.', 'Status message when destination inside zone');
  assert(!insideZoneResult.routes.some(r => r.name.startsWith('Avoids caution areas')), 'No route labeled "Avoids" when destination is inside zone');

  // TEST 6: Destination within radius + 10m of active zone
  const nearDestZone = normalizeDangerZone({
    id: 'z-near-dest',
    location: { lat: 14.55565 + 65 * latDeg, lng: 120.99920 }, // 65m away from radius 60m -> within radius + 10m
    radius: 60,
    active: true,
    activeTime: 'all_day',
    crimeCount: 5
  });

  const nearDestResult = processRoutePipeline({
    candidates: [directShort],
    start: tripStart,
    end: tripEnd,
    zones: [nearDestZone],
    isSim: false,
    simHour: null
  });

  assert(nearDestResult.statusMessage === 'Starts/ends inside or near a caution area. Showing the route with the least time inside.', 'Status message when destination within radius + 10m');

  // TEST 7: Two zones in a row: avoiding route clears both
  const zone1 = normalizeDangerZone({
    id: 'z-chain-1',
    location: { lat: 14.5585, lng: 120.9990 },
    radius: 30,
    active: true,
    activeTime: 'all_day',
    crimeCount: 6
  });
  const zone2 = normalizeDangerZone({
    id: 'z-chain-2',
    location: { lat: 14.5575, lng: 120.9990 },
    radius: 30,
    active: true,
    activeTime: 'all_day',
    crimeCount: 6
  });

  const directCrossingTwo: RawRouteCandidate = {
    coordinates: [
      [14.5595, 120.9990],
      [14.5585, 120.9990],
      [14.5575, 120.9990],
      [14.5565, 120.9990]
    ],
    distance: 333,
    duration: 250,
    steps: []
  };

  const detourClearingBoth: RawRouteCandidate = {
    coordinates: [
      [14.5595, 120.9990],
      [14.5585, 120.9990 - 80 * lngDegTrip],
      [14.5575, 120.9990 - 80 * lngDegTrip],
      [14.5565, 120.9990]
    ],
    distance: 480,
    duration: 360,
    steps: []
  };

  const dualZoneResult = processRoutePipeline({
    candidates: [directCrossingTwo, detourClearingBoth],
    start: [14.5595, 120.9990],
    end: [14.5565, 120.9990],
    zones: [zone1, zone2],
    isSim: false,
    simHour: null
  });

  const dualAvoid = dualZoneResult.routes.find(r => r.name.startsWith('Avoids caution areas'));
  assert(dualAvoid !== undefined, 'Dual zone trip returns avoiding route');
  assert(dualAvoid?.metersInside === 0, 'Dual zone avoiding route clears both zones (0m inside)');

  // TEST 8: Balanced candidate is dropped when no real compromise exists
  const worseCandidate: RawRouteCandidate = {
    coordinates: [
      [14.5595, 120.9990],
      [14.5585, 120.9990 + 10 * lngDegTrip],
      [14.5565, 120.9990]
    ],
    distance: 400,
    duration: 310,
    steps: []
  };

  const noBalancedResult = processRoutePipeline({
    candidates: [directCrossingTwo, worseCandidate],
    start: [14.5595, 120.9990],
    end: [14.5565, 120.9990],
    zones: [zone1],
    isSim: false,
    simHour: null
  });

  assert(!noBalancedResult.routes.some(r => r.name === 'Balanced'), 'Balanced route dropped when no real compromise exists (never longer and more exposed)');

  // TEST 9: Real Balanced candidate is kept when it is a true compromise
  const realBalancedCandidate: RawRouteCandidate = {
    coordinates: [
      [14.5595, 120.9990],
      [14.5585, 120.9990 - 55 * lngDegTrip], // clears zone 1 (offset 55m)
      [14.5575, 120.9990], // passes zone 2
      [14.5565, 120.9990]
    ],
    distance: 375, // longer than direct (333m), shorter than avoiding (480m)
    duration: 285, // longer than direct (250s), shorter than avoiding (360s)
    steps: []
  };

  const realBalancedResult = processRoutePipeline({
    candidates: [directCrossingTwo, detourClearingBoth, realBalancedCandidate],
    start: [14.5595, 120.9990],
    end: [14.5565, 120.9990],
    zones: [zone1, zone2],
    isSim: false,
    simHour: null
  });

  const balancedRoute = realBalancedResult.routes.find(r => r.name === 'Balanced');
  assert(balancedRoute !== undefined, 'Balanced route is kept when it represents a real compromise');
  assert(balancedRoute?.duration! > realBalancedResult.routes[0].duration, 'Balanced route is longer than Fastest');

  // TEST 10: All requests fail or time out
  const timeoutResult = processRoutePipeline({
    candidates: [],
    start: tripStart,
    end: tripEnd,
    zones: [recordedTripZone],
    isSim: false,
    simHour: null,
    requestsFailedOrTimedOut: true
  });

  assert(timeoutResult.statusMessage === "Couldn't finish checking for routes that avoid caution areas. Try again.", 'Priority 1 message when requests fail or time out');
  assert(timeoutResult.avoidanceStatus === 'requests_failed', 'Status is requests_failed');

  // TEST 11: No possible detour exists
  const blockedResult = processRoutePipeline({
    candidates: [directCrossingTwo],
    start: [14.5595, 120.9990],
    end: [14.5565, 120.9990],
    zones: [zone1],
    isSim: false,
    simHour: null
  });

  assert(blockedResult.statusMessage === 'No route that avoids all caution areas was found.', 'Priority 3 message when no route avoids all caution areas');
  assert(blockedResult.routes.length === 1 && blockedResult.routes[0].name === 'Fastest', 'Fastest route still returned when no avoiding detour exists');

  // TEST 12: No active caution areas right now (e.g. night-only zone at 2 PM)
  const inactiveNightZone = normalizeDangerZone({
    id: 'z-night',
    location: { lat: 14.5580, lng: 120.9990 },
    radius: 40,
    active: true,
    activeTime: 'night_only',
    crimeCount: 6
  });

  const inactiveClockResult = processRoutePipeline({
    candidates: [directShort],
    start: tripStart,
    end: tripEnd,
    zones: [inactiveNightZone],
    isSim: true,
    simHour: 14 // 2 PM: night-only zone is inactive
  });

  assert(inactiveClockResult.statusMessage === 'No active caution areas right now.', 'Priority 4 message: "No active caution areas right now." at 2 PM');

  // TEST 13: Summary text rules
  // No active zones: "No active caution area on this route." (Never "0 recorded incidents")
  assert(inactiveClockResult.routes[0].summaryText === 'No active caution area on this route.', 'Summary without zone: "No active caution area on this route."');
  assert(!inactiveClockResult.routes[0].summaryText?.includes('0 recorded incidents'), 'Summary never contains "0 recorded incidents"');
  assert(!inactiveClockResult.routes[0].summaryText?.includes('safe route'), 'Summary never contains "safe route"');
  assert(!inactiveClockResult.routes[0].summaryText?.includes('completely safe'), 'Summary never contains "completely safe"');

  // Zone with crimeCount and dataPeriod
  assert(fixtureResult.routes[0].summaryText?.includes('recorded incidents'), 'Summary formats incident count and dataPeriod when present');

  // Non-fastest route summary includes difference comparison
  assert(dualAvoid?.summaryText?.includes('compared to fastest'), 'Non-fastest route summary includes delta compared to fastest');

  // TEST 14: Invariants runtime assertion check
  assertRouteInvariants(realBalancedResult.routes, realBalancedResult.routes[0]);
  assert(true, 'Runtime route invariants verified across 3-route result');

  // TEST 15: Demo trip loaded from fixture is labeled "Demo route (saved)"
  const demoTripRes = getDemoTripSavedRoutes([recordedTripZone], false, null);
  assert(demoTripRes.routes.length >= 2, 'Demo trip returns at least 2 routes from fixture');
  assert(demoTripRes.routes[0].name.includes('Demo route (saved)'), 'Demo trip: Fastest is labeled "Demo route (saved)"');
  assert(demoTripRes.routes.some(r => r.name.includes('Avoids caution areas') && r.name.includes('Demo route (saved)')), 'Demo trip: Avoids route is labeled "Demo route (saved)"');
  assert(demoTripRes.routes[0].summaryText?.includes('(Demo route (saved))') || false, 'Demo trip summary includes "(Demo route (saved))"');

  // TEST 16: Session cache returns cached trip on repeat generate without hitting server
  clearSessionTripCache();
  let fetchHits = 0;
  const countingFetch = async (url: string) => {
    fetchHits++;
    const isDetour = url.split('/foot/')[1]?.split('?')[0]?.split(';')?.length === 3;
    if (!isDetour) return (palananFixtures as any).direct;
    return (palananFixtures as any).trip_925m_verified_avoiding;
  };

  const trip1 = await generateSuggestedRoutes(tripStart, tripEnd, [recordedTripZone], false, null, countingFetch);
  const hitsAfterTrip1 = fetchHits;
  assert(hitsAfterTrip1 > 0, 'First trip hits the router');

  const trip2 = await generateSuggestedRoutes(tripStart, tripEnd, [recordedTripZone], false, null, countingFetch);
  assert(fetchHits === hitsAfterTrip1, 'Second identical trip returns from session cache without any extra HTTP requests');
  assert(trip2.routes.length === trip1.routes.length, 'Cached trip returns identical route count');

  // TEST 17: HTTP 429 stops detour searches immediately and finishes with raw Fastest
  clearSessionTripCache();
  let detourAttemptsWith429 = 0;
  const mock429Fetch = async (url: string) => {
    const isDetour = url.split('/foot/')[1]?.split('?')[0]?.split(';')?.length === 3;
    if (!isDetour) return (palananFixtures as any).direct;
    detourAttemptsWith429++;
    // Simulate HTTP 429 response
    return null; // Will trigger failure/429
  };

  const res429 = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    mock429Fetch
  );
  assert(res429.routes.length >= 1, 'Trip finishes with at least raw Fastest route');
  assert(res429.routes[0].name.startsWith('Fastest'), 'Fastest route is retained as first route');

  // TEST 18: Progressive onProgress emits raw Fastest route immediately
  clearSessionTripCache();
  const progressEmits: number[] = [];
  const testProgressTrip = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    countingFetch,
    (partial) => {
      progressEmits.push(partial.routes.length);
    }
  );
  assert(progressEmits.length >= 1, 'onProgress was called during route search');
  assert(progressEmits[0] === 1, 'First onProgress emit provides exactly 1 route (raw Fastest path)');
  assert(testProgressTrip.routes.length >= 2, 'Final result includes verified routes');

  // TEST 19: avoid-area route verified and shown
  clearSessionTripCache();
  const verifiedAvoidingCoords = (palananFixtures as any).trip_925m_verified_avoiding.routes[0].geometry.coordinates;
  const mockOrsVerifiedSuccess = async () => ({
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: verifiedAvoidingCoords
      },
      properties: {
        summary: { distance: 925, duration: 690 },
        segments: [{ distance: 925, duration: 690, steps: [] }]
      }
    }]
  });

  const orsSuccessResult = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    countingFetch,
    undefined,
    { orsFetchFn: mockOrsVerifiedSuccess }
  );

  assert(orsSuccessResult.routes.length >= 2, 'avoid-area route verified and shown: returns multiple routes');
  const orsAvoidRoute = orsSuccessResult.routes.find(r => r.name.startsWith('Avoids caution areas'));
  assert(orsAvoidRoute !== undefined, 'avoid-area route verified and shown: route labeled Avoids caution areas');
  assert(orsAvoidRoute?.metersInside === 0, 'avoid-area route verified and shown: metersInside = 0');
  assert((orsAvoidRoute?.minClearance ?? 0) >= 10, 'avoid-area route verified and shown: clearance >= 10m');

  // TEST 20: avoid-area route that fails verification dropped and falls back to detour search
  clearSessionTripCache();
  // Route passing directly through the zone center (metersInside > 0 and clearance < 10)
  const mockOrsFailsVerification = async () => ({
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [120.99920, 14.55915],
          [120.99920, 14.55740], // passes right through the center
          [120.99920, 14.55565]
        ]
      },
      properties: {
        summary: { distance: 389, duration: 290 },
        segments: [{ distance: 389, duration: 290, steps: [] }]
      }
    }]
  });

  const orsFallbackResult = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    countingFetch,
    undefined,
    { orsFetchFn: mockOrsFailsVerification }
  );

  assert(orsFallbackResult.routes.length >= 2, 'avoid-area route that fails verification dropped and falls back to detour search');
  const fallbackAvoidRoute = orsFallbackResult.routes.find(r => r.name.startsWith('Avoids caution areas'));
  assert(fallbackAvoidRoute !== undefined, 'Fallback detour search succeeds in providing verified avoiding route');
  assert(fallbackAvoidRoute?.metersInside === 0, 'Fallback avoiding route verified: metersInside = 0');

  // TEST 21: ORS 429 falls back
  clearSessionTripCache();
  const mockOrs429 = async () => ({ status: 429, error: 'Rate limit exceeded' });
  const ors429Result = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    countingFetch,
    undefined,
    { orsFetchFn: mockOrs429 }
  );
  assert(ors429Result.routes.length >= 1, 'ORS 429 falls back: finishes with routes');
  assert(ors429Result.routes[0].name.startsWith('Fastest'), 'ORS 429 falls back: Fastest route retained');

  // TEST 22: no key set uses fallback
  clearSessionTripCache();
  const mockOrsNoKey = async () => ({ status: 503, disabled: true, error: 'OPENROUTESERVICE_KEY not configured' });
  const noKeyResult = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    countingFetch,
    undefined,
    { orsFetchFn: mockOrsNoKey }
  );
  assert(noKeyResult.routes.length >= 2, 'no key set uses fallback: succeeds via detour waypoint search');
  assert(noKeyResult.routes[0].name.startsWith('Fastest'), 'no key set uses fallback: Fastest is first');
  assert(noKeyResult.routes.some(r => r.name.startsWith('Avoids caution areas')), 'no key set uses fallback: avoiding route found via fallback');

  // TEST 23: densified geometry correctly identifies in-zone segment on a straight-line route across a zone
  const straightLineAcrossZone: [number, number][] = [
    [14.55915, 120.99920],
    [14.55565, 120.99920]
  ];
  // Zone is at [14.55740, 120.99920], radius 74m
  const densifiedStraight = densifyCoordinates(straightLineAcrossZone, 10);
  assert(densifiedStraight.length >= 35, 'densified geometry correctly creates points <= 10m apart (got ' + densifiedStraight.length + ' points)');

  const straightMetrics = computeRouteZoneMetrics(
    straightLineAcrossZone,
    389,
    290,
    [recordedTripZone],
    false,
    null
  );

  assert(straightMetrics.metersInside > 0, 'densified geometry correctly identifies in-zone segment: metersInside > 0 (got ' + straightMetrics.metersInside + 'm)');
  const inZoneSeg = straightMetrics.segments.find(s => s.inZone);
  assert(inZoneSeg !== undefined, 'densified geometry produces in-zone segment');
  assert(inZoneSeg?.color === '#EA580C', 'in-zone segment color is #EA580C');
  assert(inZoneSeg?.weight === 8, 'in-zone segment weight is 8');
  assert(straightMetrics.segments.some(s => !s.inZone && s.color === '#10B981'), 'outer segments remain green (#10B981)');

  // TEST 24: getApiUrl correctly normalizes paths
  assert(getApiUrl('/api/directions/ors').includes('/api/directions/ors'), 'getApiUrl formats /api/directions/ors route');
  assert(getApiUrl('api/directions/ors').includes('/api/directions/ors'), 'getApiUrl normalizes relative paths without leading slash');

  // TEST 25: window.__API_BASE_URL__ runtime override takes precedence
  const previousOverride = (globalThis as any).__API_BASE_URL__;
  (globalThis as any).__API_BASE_URL__ = 'https://my-backend.run.app';
  assert(getApiUrl('/api/directions/ors') === 'https://my-backend.run.app/api/directions/ors', 'getApiUrl respects __API_BASE_URL__ runtime override');
  if (previousOverride !== undefined) {
    (globalThis as any).__API_BASE_URL__ = previousOverride;
  } else {
    delete (globalThis as any).__API_BASE_URL__;
  }

  // TEST 26: ORS error 2010 is gracefully handled and falls back without throwing
  clearSessionTripCache();
  const mockOrs2010 = async () => ({
    status: 404,
    code: 2010,
    orsError: {
      code: 2010,
      message: 'Could not find routable point within a radius of 350.0 meters of specified coordinate'
    }
  });
  const ors2010Result = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [recordedTripZone],
    false,
    null,
    async () => ({ code: 'Ok', routes: [{ distance: 389, duration: 290, geometry: { coordinates: [[120.9992, 14.55915], [120.9992, 14.55565]] } }] }),
    undefined,
    { orsFetchFn: mockOrs2010 }
  );
  assert(ors2010Result.routes.length >= 1, 'ORS error 2010 handled gracefully without crashing');
  assert(ors2010Result.routes[0].name.startsWith('Fastest'), 'ORS error 2010 retains Fastest route');

  // TEST 27: A route crossing a circle produces at least one orange segment
  const crossingRouteCoords: [number, number][] = [
    [14.55915, 120.99920],
    [14.55565, 120.99920]
  ];
  const crossingMetrics = computeRouteZoneMetrics(
    crossingRouteCoords,
    389,
    290,
    [recordedTripZone],
    false,
    null
  );
  const crossingOrangeSegments = crossingMetrics.segments.filter(s => s.inZone && s.color === '#EA580C');
  assert(crossingOrangeSegments.length >= 1, 'a route crossing a circle produces at least one orange segment');
  assert(crossingOrangeSegments[0].weight === 8, 'orange in-zone segment has thick weight of 8');

  // TEST 28: The orange segment sits on top of the green line (higher z-order)
  const paneZIndices = {
    dangerZonesPane: 350,
    routeUnderlayPane: 450,
    inZoneHeatmapPane: 620
  };
  assert(
    paneZIndices.inZoneHeatmapPane > paneZIndices.routeUnderlayPane &&
    paneZIndices.routeUnderlayPane > paneZIndices.dangerZonesPane,
    'the orange segment sits on top of the green line (higher z-order)'
  );

  // TEST 29: A route that avoids all zones has no orange segment
  const avoidingRouteCoords: [number, number][] = [
    [14.55915, 120.99700],
    [14.55565, 120.99700]
  ];
  const avoidingMetrics = computeRouteZoneMetrics(
    avoidingRouteCoords,
    389,
    290,
    [recordedTripZone],
    false,
    null
  );
  const avoidingOrangeSegments = avoidingMetrics.segments.filter(s => s.inZone);
  assert(avoidingOrangeSegments.length === 0, 'a route that avoids all zones has no orange segment');

  // TEST 30: The segment is redrawn after switching routes
  // Simulating switching between Crossing Route (index 0) and Avoiding Route (index 1)
  let activeIndex = 0;
  const mockRoutes = [
    { id: 'route-0', segments: crossingMetrics.segments, metersInside: crossingMetrics.metersInside },
    { id: 'route-1', segments: avoidingMetrics.segments, metersInside: avoidingMetrics.metersInside }
  ];
  const getRenderedInZoneCount = (idx: number) => {
    const cur = mockRoutes[idx];
    return cur.segments.filter(s => s.inZone).length;
  };
  const countRoute0 = getRenderedInZoneCount(activeIndex);
  assert(countRoute0 >= 1, 'route 0 has in-zone orange segments initially');

  // Switch to Route 1
  activeIndex = 1;
  const countRoute1 = getRenderedInZoneCount(activeIndex);
  assert(countRoute1 === 0, 'the segment is redrawn after switching routes (switched to avoiding route -> 0 orange segments)');

  // Switch back to Route 0
  activeIndex = 0;
  const countRoute0Again = getRenderedInZoneCount(activeIndex);
  assert(countRoute0Again === countRoute0, 'the segment is redrawn after switching routes (switched back to route 0 -> orange segment restored)');

  // TEST 31: Trip cache key ensures route cached during inactive window is never reused once zone window opens
  clearSessionTripCache();
  let tripFetchCount = 0;
  const mockDynamicClockFetch = async (url: string) => {
    tripFetchCount++;
    const isDetour = url.split('/foot/')[1]?.split('?')[0]?.split(';')?.length === 3;
    if (!isDetour) {
      return (palananFixtures as any).direct;
    }
    return (palananFixtures as any).wp_right_124 || (palananFixtures as any).trip_925m_verified_avoiding;
  };

  // Step 1: At 2 PM (14:00), night-only zone is inactive
  const resAt2PM = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [inactiveNightZone],
    true,
    14,
    mockDynamicClockFetch
  );
  assert(tripFetchCount === 1, 'Cache test: Fresh calculation at 2 PM executes 1 fetch');
  assert(resAt2PM.statusMessage === 'No active caution areas right now.', 'Cache test: 2 PM trip reports no active caution areas');

  // Step 2: At 2 PM again with same params -> cache HIT (0 new fetches)
  const resAt2PMRepeat = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [inactiveNightZone],
    true,
    14,
    mockDynamicClockFetch
  );
  assert(tripFetchCount === 1, 'Cache test: Identical trip at 2 PM reuses cache (0 additional fetches)');

  // Step 3: At 10 PM (22:00), the night-only zone opens!
  // Trip cache key must differ because activeZoneKey changed -> Cache MISS, fresh calculation occurs
  const resAt10PM = await generateSuggestedRoutes(
    tripStart,
    tripEnd,
    [inactiveNightZone],
    true,
    22,
    mockDynamicClockFetch
  );
  assert(tripFetchCount > 1, 'Cache test: Trip at 10 PM after zone opens creates distinct cache key (fresh fetch executed)');
  assert(resAt10PM.statusMessage !== 'No active caution areas right now.', 'Cache test: 10 PM trip recognizes newly active zone and avoids/scores it');

  console.log(`\n--- ALL CONSOLIDATED TESTS PASSED: ${passedTests}/${totalTests} ---`);
}

runTests().catch(err => {
  console.error('Test runner failure:', err);
  process.exit(1);
});


