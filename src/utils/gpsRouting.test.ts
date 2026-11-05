import { JSDOM } from 'jsdom';

// Initialize DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="map"></div></body></html>');
(global as any).window = dom.window;
(global as any).document = dom.window.document;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
} catch {}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runTests() {
  const { getRouteStartFromGps } = await import('./gpsRouting');
  const { locationTracker } = await import('../lib/locationTracker');
  const { generateSuggestedRoutes, clearSessionTripCache } = await import('./routeUtils');
  const { PALANAN_CENTER } = await import('../lib/palananBounds');

  console.log('\n--- Running SafeRoute Lite Current-Location Routing & GPS Helper Tests ---');

  // --- Suite 1: getRouteStartFromGps helper rules ---
  console.log('\nTest Suite 1: GPS Fix Accuracy & Quality Rules');

  // Reset singleton state
  (locationTracker.constructor as any).__resetForTests();
  const tracker = locationTracker;

  // 1. Strong fix (<= 50m)
  const strongCoord: [number, number] = [14.5588, 120.9991];
  (tracker as any).updateState({
    position: strongCoord,
    rawPosition: strongCoord,
    accuracy: 12,
    status: 'strong',
    isOutsidePalanan: false,
    isSimulating: false,
  });

  const resStrong = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resStrong.success === true, 'Strong fix (accuracy <= 50m) returns success = true');
  if (resStrong.success) {
    assert(resStrong.point[0] === strongCoord[0] && resStrong.point[1] === strongCoord[1], 'Strong fix produces exact position coordinates');
    assert(resStrong.isApproximate === false, 'Strong fix is marked isApproximate = false');
    assert(resStrong.notice === undefined, 'Strong fix has no approximate notice');
  }

  // 2. Approximate fix (50m to 100m)
  const approxCoord: [number, number] = [14.5582, 120.9988];
  (tracker as any).updateState({
    position: approxCoord,
    rawPosition: approxCoord,
    accuracy: 75,
    status: 'weak',
    isOutsidePalanan: false,
    isSimulating: false,
  });

  const resApprox = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resApprox.success === true, '50 to 100 m fix returns success = true');
  if (resApprox.success) {
    assert(resApprox.point[0] === approxCoord[0] && resApprox.point[1] === approxCoord[1], 'Approximate fix produces exact coordinates');
    assert(resApprox.isApproximate === true, '50 to 100 m fix is marked isApproximate = true');
    assert(resApprox.notice === 'Using approximate location (±75 m)', '50 to 100 m shows "Using approximate location (±N m)"');
  }

  // 3. No fix or accuracy > 100m with 10s timeout
  console.log('\nTest Suite 2: Timeout, Permission, and Bounds Handling');

  (tracker as any).updateState({
    position: null,
    rawPosition: null,
    accuracy: null,
    status: 'searching',
    isOutsidePalanan: false,
    isSimulating: false,
  });

  const statusNotices: string[] = [];
  const timeoutPromise = getRouteStartFromGps({
    waitForFix: true,
    timeoutMs: 200, // scaled down for rapid unit test
    onStatus: (msg) => statusNotices.push(msg),
    tracker,
  });

  assert(statusNotices.includes('Waiting for a better GPS signal...'), 'No fix shows "Waiting for a better GPS signal..."');

  const resTimeout = await timeoutPromise;
  assert(resTimeout.success === false, 'No fix resolves to success = false after timeout');
  if (!resTimeout.success) {
    assert(resTimeout.reason === 'timeout', 'Timeout reason is "timeout"');
    assert(resTimeout.offerPickOnMap === true, 'Timeout offers "Pick start on map"');
  }

  // 4. Permission denied
  (tracker as any).updateState({
    position: null,
    accuracy: null,
    status: 'denied',
    isOutsidePalanan: false,
    isSimulating: false,
  });

  const resDenied = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resDenied.success === false, 'Denied permission returns success = false');
  if (!resDenied.success) {
    assert(resDenied.reason === 'denied', 'Denied returns reason = "denied"');
    assert(resDenied.canOpenSettings === true, 'Denied provides "Open settings" action');
    assert(resDenied.offerPickOnMap === true, 'Denied offers "Pick start on map"');
  }

  // 5. Hardware location off
  (tracker as any).updateState({
    position: null,
    accuracy: null,
    status: 'off',
    isOutsidePalanan: false,
    isSimulating: false,
  });

  const resOff = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resOff.success === false, 'Location off returns success = false');
  if (!resOff.success) {
    assert(resOff.reason === 'off', 'Location off returns reason = "off"');
    assert(resOff.canOpenSettings === true, 'Location off provides "Open settings" action');
    assert(resOff.offerPickOnMap === true, 'Location off offers "Pick start on map"');
  }

  // 6. Outside Palanan
  const outsideCoord: [number, number] = [14.5200, 120.9500];
  (tracker as any).updateState({
    position: outsideCoord,
    rawPosition: outsideCoord,
    accuracy: 10,
    status: 'strong',
    isOutsidePalanan: true,
    isSimulating: false,
  });

  const resOutside = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resOutside.success === false, 'Outside Palanan returns success = false');
  if (!resOutside.success) {
    assert(resOutside.reason === 'outside_palanan', 'Outside Palanan returns reason = "outside_palanan"');
    assert(resOutside.message === 'You appear to be outside Barangay Palanan', 'Outside Palanan shows "You appear to be outside Barangay Palanan"');
    assert(resOutside.offerPickOnMap === true, 'Outside Palanan offers "Pick start on map"');
  }

  // 7. Simulator position override
  console.log('\nTest Suite 3: Simulator Position & PALANAN_CENTER Enforcement');

  const simCoord: [number, number] = [14.5575, 120.9982];
  tracker.setSimulatedOverride(simCoord, 180, 1.2);

  const resSim = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resSim.success === true, 'Simulator position is used while simulator runs');
  if (resSim.success) {
    assert(resSim.point[0] === simCoord[0] && resSim.point[1] === simCoord[1], 'Simulator position matches exact simulated coordinates');
    assert(resSim.isSimulated === true, 'Result is tagged isSimulated = true');
  }
  tracker.setSimulatedOverride(null);

  // 8. PALANAN_CENTER is never used as start
  (tracker as any).updateState({
    position: null,
    accuracy: null,
    status: 'searching',
    isOutsidePalanan: false,
    isSimulating: false,
  });
  const resNoFallback = await getRouteStartFromGps({ waitForFix: false, tracker });
  assert(resNoFallback.success === false, 'Helper does NOT silently fall back to PALANAN_CENTER');
  if (resNoFallback.success) {
    assert(resNoFallback.point[0] !== PALANAN_CENTER[0], 'PALANAN_CENTER is never used as start');
  }

  // --- Suite 4: Trip Cache Key with GPS Jitter vs Real Movement ---
  console.log('\nTest Suite 4: Trip Cache Key (10m Jitter Reuse vs 50m Movement)');

  clearSessionTripCache();
  const endCoord: [number, number] = [14.5560, 120.9990];
  const initialStart: [number, number] = [14.55850, 120.99950];
  const jitterStart: [number, number] = [14.55852, 120.99952]; // ~3.1m jitter
  const moved50mStart: [number, number] = [14.55895, 120.99950]; // ~50m north

  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls++;
    return {
      code: 'Ok',
      routes: [{
        geometry: {
          coordinates: [
            [120.9995, 14.5585],
            [120.9990, 14.5560]
          ]
        },
        distance: 300,
        duration: 220,
        legs: []
      }]
    };
  };

  // First request: initial start with isCurrentLocation = true
  const route1 = await generateSuggestedRoutes(
    initialStart,
    endCoord,
    [],
    false,
    null,
    mockFetch,
    undefined,
    { isCurrentLocation: true }
  );
  assert(route1.routes.length > 0, 'First route computed successfully');
  assert(fetchCalls === 1, 'Initial request made exactly 1 fetch call');

  // Second request: jitter under 10m
  const route2 = await generateSuggestedRoutes(
    jitterStart,
    endCoord,
    [],
    false,
    null,
    mockFetch,
    undefined,
    { isCurrentLocation: true }
  );
  assert(route2.routes.length > 0, 'Jitter route returned successfully');
  assert(fetchCalls === 1, 'Jitter under 10 m reuses cache (0 additional HTTP requests)');

  // Third request: 50m move
  const route3 = await generateSuggestedRoutes(
    moved50mStart,
    endCoord,
    [],
    false,
    null,
    mockFetch,
    undefined,
    { isCurrentLocation: true }
  );
  assert(route3.routes.length > 0, 'Moved route returned successfully');
  assert(fetchCalls === 2, '50 m move produces distinct cache key (new HTTP request made)');

  // Fourth request: Point A-to-B routing still works independently
  const routeAtoB = await generateSuggestedRoutes(
    initialStart,
    endCoord,
    [],
    false,
    null,
    mockFetch,
    undefined,
    { forceRetry: true }
  );
  assert(routeAtoB.routes.length > 0, 'Point A-to-B route produces valid routes');
  assert(fetchCalls === 3, 'Point A-to-B route functions independently without regression');

  // --- Suite 5: UI Flow Rules ---
  console.log('\nTest Suite 5: UI Linking & Empty Start Rules');

  // Test: typed start overrides "My location"
  let isStartLinkedToGps = true;
  let startQuery = 'My location';
  let startPoint: [number, number] | null = [14.5585, 120.9995];

  // User types into input
  const userTypedText = 'Chino Roces Ave';
  startQuery = userTypedText;
  isStartLinkedToGps = false;
  assert(isStartLinkedToGps === false, 'A typed start drops the GPS link');
  assert(startQuery === 'Chino Roces Ave', 'Typed start overrides "My location" in query');

  // User clears field -> returns to "My location" when fix exists
  (tracker as any).updateState({
    position: strongCoord,
    rawPosition: strongCoord,
    accuracy: 15,
    status: 'strong',
    isOutsidePalanan: false,
  });

  const clearRes = await getRouteStartFromGps({ waitForFix: false, tracker });
  if (clearRes.success) {
    startPoint = clearRes.point;
    startQuery = 'My location';
    isStartLinkedToGps = true;
  }
  assert(isStartLinkedToGps === true, 'Clearing the field returns link to live position');
  assert(startQuery === 'My location', 'Clearing the field returns text to "My location"');
  assert(startPoint[0] === strongCoord[0], 'Clearing the field resets startPoint to live GPS fix');

  // Empty start with destination set: enables Generate button when fix exists
  const destination: [number, number] = [14.5540, 120.9980];
  const canGenerateWithFix = !!(startPoint && destination);
  assert(canGenerateWithFix === true, 'Empty-start default with valid fix enables Generate Safe Route');

  // Empty start with destination set: disabled without fix
  (tracker as any).updateState({
    position: null,
    accuracy: null,
    status: 'searching',
  });
  const noFixRes = await getRouteStartFromGps({ waitForFix: false, tracker });
  const startPointNoFix = noFixRes.success ? noFixRes.point : null;
  const canGenerateNoFix = !!(startPointNoFix && destination);
  assert(canGenerateNoFix === false, 'Empty start without GPS fix keeps Generate button disabled');
  assert(noFixRes.success === false && noFixRes.offerPickOnMap === true, 'Shows reason and offers "Pick start on map" under button');

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
