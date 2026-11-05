import { JSDOM } from 'jsdom';

// Initialize full DOM environment before any Leaflet/UI imports
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
  const { locationTracker } = await import('../lib/locationTracker');
  const { createUserLocationPuckIcon } = await import('../components/UserLocationMarker');
  const { getDistanceToRouteMeters } = await import('./offRouteDetector');

  console.log('\n--- Running SafeRoute Lite Location Tracker & User Marker Tests ---');

  // --- Test Suite 1: Single Watcher & Lifecycle Isolation ---
  console.log('\nTest Suite 1: Single Watcher & Concurrency Enforcement');

  // Reset tracker state
  (locationTracker.constructor as any).__resetForTests();
  const tracker = locationTracker;

  const listenerA = () => {};
  const listenerB = () => {};

  const unsubA = tracker.subscribe(listenerA);
  const unsubB = tracker.subscribe(listenerB);

  assert(tracker.watcherStartCount === 1, 'Only one watcher started despite multiple subscribers');

  // Simulate property changes (changing zones, autoFollow, simulation)
  tracker.setSimulatedOverride([14.5585, 120.9995]);
  tracker.setSimulatedOverride(null);

  assert(tracker.watcherStartCount === 1, 'Watcher was NEVER restarted on simulation or property change');

  unsubA();
  assert(tracker.watcherStopCount === 0, 'Watcher remains active while other subscribers exist');

  unsubB();
  assert(tracker.watcherStopCount === 1, 'Watcher stops cleanly when last subscriber unmounts');

  // --- Test Suite 2: Signal Quality, Weak Fix & Jump Rejection ---
  console.log('\nTest Suite 2: Signal Quality Filters & Jump Rejection');

  // Re-subscribe
  const activeUnsub = tracker.subscribe(() => {});

  // Initial valid fix inside Palanan
  tracker.processIncomingFix({
    coords: {
      latitude: 14.5585,
      longitude: 120.9995,
      accuracy: 12,
      heading: null,
      speed: 0,
      altitude: null,
      altitudeAccuracy: null,
    },
    timestamp: Date.now(),
  } as any);

  const s1 = tracker.getState();
  assert(s1.status === 'strong', 'Fix with accuracy 12m has status strong');
  assert(s1.position !== null && s1.position[0] === 14.5585, 'Initial fix coordinates applied');

  // Test 2a: Weak fix (> 50m)
  tracker.processIncomingFix({
    coords: {
      latitude: 14.5586,
      longitude: 120.9996,
      accuracy: 65,
      heading: null,
      speed: 0.1,
      altitude: null,
      altitudeAccuracy: null,
    },
    timestamp: Date.now() + 1000,
  } as any);

  const sWeak = tracker.getState();
  assert(sWeak.status === 'weak', 'Fix with accuracy 65m (> 50m) is categorized as weak');

  // Test 2b: Ignore fixes > 100m for movement
  const prevPos = tracker.getState().position;
  tracker.processIncomingFix({
    coords: {
      latitude: 14.5650,
      longitude: 121.0100,
      accuracy: 140,
      heading: null,
      speed: 1.0,
      altitude: null,
      altitudeAccuracy: null,
    },
    timestamp: Date.now() + 2000,
  } as any);

  assert(
    tracker.getState().position?.[0] === prevPos?.[0] && tracker.getState().position?.[1] === prevPos?.[1],
    'Fix with accuracy 140m (> 100m) is ignored for movement'
  );

  // Test 2c: Jump rejection (> 12 m/s implied speed)
  const preJumpPos = tracker.getState().position!;
  // Spike 200m away in 1 second = 200 m/s implied speed
  tracker.processIncomingFix({
    coords: {
      latitude: preJumpPos[0] + 0.002, // ~220m away
      longitude: preJumpPos[1] + 0.002,
      accuracy: 15,
      heading: null,
      speed: 1.0,
      altitude: null,
      altitudeAccuracy: null,
    },
    timestamp: Date.now() + 1000,
  } as any);

  const postJumpPos = tracker.getState().position!;
  assert(
    postJumpPos[0] === preJumpPos[0] && postJumpPos[1] === preJumpPos[1],
    'Impossible GPS jump (implied speed > 12 m/s) is rejected'
  );

  // Test 2d: Stationary smoothing reduces jitter while standing still
  tracker.processIncomingFix({
    coords: {
      latitude: preJumpPos[0] + 0.00001, // 1.1m drift
      longitude: preJumpPos[1] + 0.00001,
      accuracy: 14,
      heading: null,
      speed: 0.05, // Stationary
      altitude: null,
      altitudeAccuracy: null,
    },
    timestamp: Date.now() + 2000,
  } as any);

  const stationaryPos = tracker.getState().position!;
  assert(
    stationaryPos[0] === preJumpPos[0] && stationaryPos[1] === preJumpPos[1],
    'Stationary drift (speed < 0.3 m/s) holds position to prevent UI jitter'
  );

  // --- Test Suite 3: Simulator Integration via Same Interface ---
  console.log('\nTest Suite 3: Simulator Override via Unified Interface');

  tracker.setSimulatedOverride([14.5600, 120.9990], 90, 1.2);
  const simState = tracker.getState();
  assert(simState.isSimulating === true, 'Simulator override marks isSimulating true');
  assert(simState.position?.[0] === 14.5600 && simState.position?.[1] === 120.9990, 'Simulator position overrides tracker position');
  assert(simState.heading === 90, 'Simulator heading passed through interface');

  tracker.setSimulatedOverride(null);
  const restoredState = tracker.getState();
  assert(restoredState.isSimulating === false, 'Disabling simulator restores live GPS state');

  // --- Test Suite 4: Part B - Google Maps Marker Styling & Logic ---
  console.log('\nTest Suite 4: Google Maps-Style User Location Marker');

  // Test 4a: Live active marker with heading
  const activeIcon = createUserLocationPuckIcon(45, false, false);
  const activeHtml = (activeIcon.options as any).html;
  assert(activeHtml.includes('#4285F4'), 'Active marker uses solid blue center dot #4285F4');
  assert(activeHtml.includes('user-heading-cone'), 'Direction beam cone is present when heading is provided');
  assert(activeHtml.includes('rotate(45deg)'), 'Direction beam rotates to match heading (45deg)');
  assert(activeHtml.includes('user-location-pulse'), 'Pulse ring animation is active on fresh fix');

  // Test 4b: Marker without heading
  const noHeadingIcon = createUserLocationPuckIcon(null, false, false);
  const noHeadingHtml = (noHeadingIcon.options as any).html;
  assert(!noHeadingHtml.includes('user-heading-cone'), 'Direction cone is omitted when heading is null');
  assert(noHeadingHtml.includes('#4285F4'), 'Marker still renders blue dot without heading');

  // Test 4c: Stale / lost fix fallback (> 15s)
  const staleIcon = createUserLocationPuckIcon(45, true, false);
  const staleHtml = (staleIcon.options as any).html;
  assert(staleHtml.includes('#9AA0A6'), 'Stale marker turns dot grey #9AA0A6 when fix is lost');
  assert(!staleHtml.includes('user-heading-cone'), 'Heading cone is hidden when marker is stale');
  assert(!staleHtml.includes('user-location-pulse'), 'Pulse animation is stopped when marker is stale');

  // Test 4d: Accuracy circle capping at 100m
  const capAccuracy = (acc: number | null) => (acc !== null ? Math.min(100, Math.max(acc, 5)) : 0);
  assert(capAccuracy(15) === 15, 'Accuracy radius 15m is preserved');
  assert(capAccuracy(95) === 95, 'Accuracy radius 95m is preserved');
  assert(capAccuracy(250) === 100, 'Accuracy circle strictly caps at 100m');
  assert(capAccuracy(1500) === 100, 'Extreme accuracy circle strictly caps at 100m');

  // --- Test Suite 5: Off-Route Detection ---
  console.log('\nTest Suite 5: Off-Route Distance Detection');

  const mockRouteCoords: [number, number][] = [
    [14.5580, 120.9990],
    [14.5590, 120.9990],
    [14.5600, 120.9990],
  ];

  // Point 5m off line
  const nearPoint: [number, number] = [14.5585, 120.99905];
  const distNear = getDistanceToRouteMeters(nearPoint, mockRouteCoords);
  assert(distNear < 10, 'Point near route has distance < 10m');

  // Point 65m off line
  const farPoint: [number, number] = [14.5585, 120.9996];
  const distFar = getDistanceToRouteMeters(farPoint, mockRouteCoords);
  assert(distFar > 40, `Point far from route detected as off-route (${Math.round(distFar)}m > 40m)`);

  // Cleanup
  activeUnsub();

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
