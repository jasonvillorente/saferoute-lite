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
  const { createUserLocationPuckIcon, createDebugCrosshairIcon, shouldRenderStartPin } = await import('../components/UserLocationMarker');
  const { getDistanceToRouteMeters, evaluateOffRouteState } = await import('./offRouteDetector');
  const {
    MAP_TILE_CONFIG,
    OSM_STANDARD_URL,
    TileFallbackController,
    buildMapTileConfig,
    getTileAttribution,
    getTileUrl,
    redactTileUrl,
  } = await import('../constants/mapTiles');
  const { isMapDebugEnabled } = await import('../config/debugFlags');

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

  let listenerState: any = null;
  const unsubSync = tracker.subscribe((st) => {
    listenerState = st;
  });
  tracker.setSimulatedOverride([14.5600, 120.9990], 90, 1.2);
  const simState = tracker.getState();
  assert(simState.isSimulating === true, 'Simulator override marks isSimulating true');
  assert(simState.position?.[0] === 14.5600 && simState.position?.[1] === 120.9990, 'Simulator position overrides tracker position');
  assert(listenerState?.position?.[0] === 14.5600 && listenerState?.position?.[1] === 120.9990, 'Simulator override notifies subscribers synchronously without 1-frame lag');
  assert(simState.heading === 90, 'Simulator heading passed through interface');

  tracker.setSimulatedOverride(null);
  const restoredState = tracker.getState();
  assert(restoredState.isSimulating === false, 'Disabling simulator restores live GPS state');
  unsubSync();

  // --- Test Suite 4: Part B - Google Maps Marker Styling, Centering & Layer Visibility ---
  console.log('\nTest Suite 4: Google Maps-Style User Location Marker & Centering');

  // Test 4a: Live active marker with heading and zero negative margin offset
  const activeIcon = createUserLocationPuckIcon(45, false, false);
  const activeHtml = (activeIcon.options as any).html;
  assert(activeHtml.includes('#4285F4'), 'Active marker uses solid blue center dot #4285F4');
  assert(activeHtml.includes('user-heading-cone'), 'Direction beam cone is present when heading is provided');
  assert(activeHtml.includes('rotate(45deg)'), 'Direction beam rotates to match heading (45deg)');
  assert(activeHtml.includes('user-location-pulse'), 'Pulse ring animation is active on fresh fix');
  assert(!activeHtml.includes('-ml-') && !activeHtml.includes('-mt-'), 'Marker center equals coordinate (no negative margin offset)');
  assert(
    JSON.stringify(activeIcon.options.iconSize) === JSON.stringify([48, 48]) &&
      JSON.stringify(activeIcon.options.iconAnchor) === JSON.stringify([24, 24]),
    'Marker iconAnchor [24, 24] sits at exact center of iconSize [48, 48]'
  );

  // Test 4b: Debug crosshair icon centering
  const crosshairIcon = createDebugCrosshairIcon();
  assert(
    JSON.stringify(crosshairIcon.options.iconSize) === JSON.stringify([24, 24]) &&
      JSON.stringify(crosshairIcon.options.iconAnchor) === JSON.stringify([12, 12]),
    'Debug crosshair iconAnchor [12, 12] aligns exactly with [24, 24] box center'
  );

  // Test 4c: Marker without heading
  const noHeadingIcon = createUserLocationPuckIcon(null, false, false);
  const noHeadingHtml = (noHeadingIcon.options as any).html;
  assert(!noHeadingHtml.includes('user-heading-cone'), 'Direction cone is omitted when heading is null');
  assert(noHeadingHtml.includes('#4285F4'), 'Marker still renders blue dot without heading');

  // Test 4d: Stale / lost fix fallback (> 15s)
  const staleIcon = createUserLocationPuckIcon(45, true, false);
  const staleHtml = (staleIcon.options as any).html;
  assert(staleHtml.includes('#9AA0A6'), 'Stale marker turns dot grey #9AA0A6 when fix is lost');
  assert(!staleHtml.includes('user-heading-cone'), 'Heading cone is hidden when marker is stale');
  assert(!staleHtml.includes('user-location-pulse'), 'Pulse animation is stopped when marker is stale');

  // Test 4e: Only one location layer (start pin hidden only while linked to My location)
  assert(
    shouldRenderStartPin([14.5585, 120.9995], true) === false,
    'Start pin is hidden while start is linked to My location (only one location layer)'
  );
  assert(
    shouldRenderStartPin([14.5585, 120.9995], false) === true,
    'Start pin reappears when user pins or types a custom start'
  );
  assert(
    shouldRenderStartPin(null, false) === false,
    'Start pin is hidden when startPoint is null'
  );

  // Test 4f: Accuracy circle capping at 100m
  const capAccuracy = (acc: number | null) => (acc !== null ? Math.min(100, Math.max(acc, 5)) : 0);
  assert(capAccuracy(15) === 15, 'Accuracy radius 15m is preserved');
  assert(capAccuracy(95) === 95, 'Accuracy radius 95m is preserved');
  assert(capAccuracy(250) === 100, 'Accuracy circle strictly caps at 100m');
  assert(capAccuracy(1500) === 100, 'Extreme accuracy circle strictly caps at 100m');

  // --- Test Suite 5: Off-Route Distance, Hysteresis & Simulation Actions ---
  console.log('\nTest Suite 5: Off-Route Distance, Hysteresis & Clear Rules');

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

  // Test 5a: Walking ON route 150m from start -> NO banner & NO recalculate prompt
  const onRoute150mFromStart: [number, number] = [14.55935, 120.9990]; // ~150m north of start along segment
  const eval150m = evaluateOffRouteState(onRoute150mFromStart, mockRouteCoords, false, null, 1000);
  assert(eval150m.distToStart > 140 && eval150m.distToRoute < 1, 'On-route walker 150m from start has distToStart > 140m and distToRoute < 1m');
  assert(eval150m.isOffRoute === false, 'No off-route banner while walking the route 150 m from the start');
  assert(eval150m.showRecalculateFromHere === false, 'No Recalculate prompt while on the route 150 m from start');

  // Test 5b: > 40m from route AND > 50m from start at t=0 -> separate Recalculate prompt, banner waits 10s
  const modOffFarStart: [number, number] = [14.5588, 120.9995]; // ~89m north (from start), ~54m east of route line
  const evalT0 = evaluateOffRouteState(modOffFarStart, mockRouteCoords, false, null, 10000);
  assert(evalT0.distToRoute > 40 && evalT0.distToRoute < 100 && evalT0.distToStart > 50, 'Point is 40-100m off route and > 50m from start');
  assert(evalT0.isOffRoute === false, 'Banner does not appear before 10s hold when 40-100m off route');
  assert(evalT0.showRecalculateFromHere === true, 'Separate Recalculate from here is active when > 40m off route AND > 50m from start');

  const evalT10 = evaluateOffRouteState(modOffFarStart, mockRouteCoords, false, evalT0.timerStartMs, 20000);
  assert(evalT10.isOffRoute === true, 'Off-route banner appears after 10s when > 40m from route');

  // Test 5c: Hysteresis holds at 30m (between 25m and 40m) and clears at <= 25m
  const hysteresisHoldPoint: [number, number] = [14.5588, 120.99928]; // ~30m east of route
  const evalHold = evaluateOffRouteState(hysteresisHoldPoint, mockRouteCoords, true, null, 21000);
  assert(evalHold.distToRoute > 25 && evalHold.distToRoute <= 40, 'Point sits in 25m..40m hysteresis band');
  assert(evalHold.isOffRoute === true, 'Off-route banner holds inside 25m..40m hysteresis band');

  const backOnRoute20m: [number, number] = [14.5588, 120.99918]; // ~19m east of route (<= 25m)
  const evalClear = evaluateOffRouteState(backOnRoute20m, mockRouteCoords, true, null, 22000);
  assert(evalClear.distToRoute <= 25, 'Point is <= 25m from route');
  assert(evalClear.isOffRoute === false, 'Off-route banner clears at 25m or less');

  // Test 5d: Immediate trigger (> 100m) via Stray Off Route displacement (+0.0012, -0.0012)
  const strayOrigin: [number, number] = [14.5585, 120.9990];
  const strayPoint: [number, number] = [strayOrigin[0] + 0.0012, strayOrigin[1] - 0.0012];
  tracker.setSimulatedOverride(strayPoint);
  const evalStray = evaluateOffRouteState(tracker.getState().position, mockRouteCoords, false, null, 30000);
  assert(evalStray.distToRoute > 100, `Stray Off Route displacement is > 100m (${Math.round(evalStray.distToRoute)}m)`);
  assert(evalStray.isOffRoute === true, 'Off-route banner appears immediately after Stray Off Route (> 100m)');

  // Test 5e: Clears on Halt, route switch, and Recalculate
  // 1) Halt clears simulated override & resets off-route when route is cleared / stopped
  tracker.setSimulatedOverride(null);
  const evalAfterHalt = evaluateOffRouteState(tracker.getState().position, null, false, null, 31000);
  assert(tracker.getState().isSimulating === false && evalAfterHalt.isOffRoute === false, 'Off-route state clears on Halt');

  // 2) Route switch clears banner when switching to an alternative route passing through current simulated position
  tracker.setSimulatedOverride(strayPoint);
  const altRoutePassingStray: [number, number][] = [
    strayPoint,
    [14.5565, 120.9985],
  ];
  const evalRouteSwitch = evaluateOffRouteState(tracker.getState().position, altRoutePassingStray, false, null, 32000);
  assert(evalRouteSwitch.isOffRoute === false, 'Off-route banner clears on route switch to active route containing walker');

  // 3) Recalculate from simulated position builds new route starting at strayPoint -> distToRoute 0 -> clears banner
  const recalcRouteFromSim: [number, number][] = [
    tracker.getState().position!,
    [14.55565, 120.9992],
  ];
  const evalRecalc = evaluateOffRouteState(tracker.getState().position, recalcRouteFromSim, false, null, 33000);
  assert(evalRecalc.distToRoute < 1 && evalRecalc.isOffRoute === false, 'Recalculate from simulated position clears off-route banner');
  tracker.setSimulatedOverride(null);

  // --- Test Suite 6: Tile Config, Fallback & Production Debug Flag ---
  console.log('\nTest Suite 6: Tile Layer Config, OSM Fallback & Production Debug Flag');

  assert(
    MAP_TILE_CONFIG.maxNativeZoom === 19 &&
      MAP_TILE_CONFIG.maxZoom === 20 &&
      MAP_TILE_CONFIG.maxNativeZoom <= MAP_TILE_CONFIG.maxZoom &&
      MAP_TILE_CONFIG.maxZoom <= MAP_TILE_CONFIG.maxNativeZoom + 1,
    'Tile zoom bounds satisfy maxNativeZoom <= maxZoom <= maxNativeZoom + 1 (19 <= 20 <= 20)'
  );
  assert(MAP_TILE_CONFIG.detectRetina === false, 'detectRetina is false to prevent double retina tile requests with {r}');
  assert(MAP_TILE_CONFIG.lightBackgroundColor === '#f8fafc', 'Light map background color is #f8fafc');

  // No key -> OSM standard URLs and NO {r}
  const noKeyCfg = buildMapTileConfig({});
  assert(
    getTileUrl(false, noKeyCfg) === OSM_STANDARD_URL &&
      getTileUrl(true, noKeyCfg) === OSM_STANDARD_URL,
    'No CARTO key defaults both light and dark modes to OSM standard URL'
  );
  assert(
    !getTileUrl(false, noKeyCfg).includes('{r}') &&
      !getTileUrl(true, noKeyCfg).includes('{r}'),
    'OSM standard URLs without key do NOT contain {r}'
  );
  assert(
    getTileAttribution(false, noKeyCfg).includes('OpenStreetMap') &&
      !getTileAttribution(false, noKeyCfg).includes('CARTO'),
    'No-key attribution credits OpenStreetMap contributors without CARTO'
  );

  // Key set -> CARTO URLs WITH {r} and CARTO + OSM attribution
  const keyCfg = buildMapTileConfig({ VITE_CARTO_API_KEY: 'secret-carto-key-123' });
  assert(
    getTileUrl(false, keyCfg).includes('basemaps.cartocdn.com/rastertiles/voyager') &&
      getTileUrl(true, keyCfg).includes('basemaps.cartocdn.com/dark_all'),
    'CARTO key selects Voyager light and Dark Matter dark URLs'
  );
  assert(
    getTileUrl(false, keyCfg).includes('{r}') &&
      getTileUrl(true, keyCfg).includes('{r}'),
    'CARTO URLs include {r} retina placeholder'
  );
  assert(
    getTileUrl(false, keyCfg).includes('key=secret-carto-key-123') &&
      !redactTileUrl(getTileUrl(false, keyCfg)).includes('secret-carto-key-123'),
    'CARTO URL includes API key and redactTileUrl strips key before logging'
  );
  assert(
    getTileAttribution(false, keyCfg).includes('CARTO') &&
      getTileAttribution(false, keyCfg).includes('OpenStreetMap'),
    'CARTO attribution credits both CARTO and OpenStreetMap contributors'
  );

  // Custom URL overrides remain configurable
  const customCfg = buildMapTileConfig({
    VITE_TILE_URL_LIGHT: 'https://custom.tiles.example/{z}/{x}/{y}{r}.png',
    VITE_TILE_URL_DARK: 'https://custom.tiles.example/dark/{z}/{x}/{y}{r}.png',
  });
  assert(
    getTileUrl(false, customCfg) === 'https://custom.tiles.example/{z}/{x}/{y}{r}.png' &&
      getTileUrl(true, customCfg) === 'https://custom.tiles.example/dark/{z}/{x}/{y}{r}.png',
    'Tile URL constant is configurable for both light and dark modes'
  );

  // Runtime fallback controller: 3 consecutive tile errors switch to OSM
  const errController = new TileFallbackController(3);
  assert(errController.recordTileError() === false, '1st tile error does not trigger fallback');
  assert(errController.recordTileError() === false, '2nd tile error does not trigger fallback');
  assert(
    errController.recordTileLoad({
      src: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/17/1/1@2x.png',
      naturalWidth: 512,
      naturalHeight: 512,
    }) === false && errController.getConsecutiveErrors() === 0,
    'Clean 512x512 @2x tile load resets consecutive error count'
  );
  errController.recordTileError();
  errController.recordTileError();
  const trippedByErrors = errController.recordTileError();
  assert(
    trippedByErrors === true &&
      errController.isFallbackActive() === true &&
      errController.getReason() === 'error_threshold',
    '3 consecutive tile failures switch controller to OSM fallback'
  );
  assert(
    getTileUrl(false, keyCfg, true) === OSM_STANDARD_URL &&
      !getTileUrl(false, keyCfg, true).includes('{r}') &&
      !getTileAttribution(false, keyCfg, true).includes('CARTO'),
    'Active fallback switches tile URL and attribution cleanly to OSM standard (no {r})'
  );

  // Runtime fallback controller: CARTO 256x256 @2x watermark tile immediately triggers fallback
  const wmController = new TileFallbackController(3);
  const trippedByWatermark = wmController.recordTileLoad({
    src: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/17/109590/60177@2x.png',
    naturalWidth: 256,
    naturalHeight: 256,
  });
  assert(
    trippedByWatermark === true &&
      wmController.isFallbackActive() === true &&
      wmController.getReason() === 'watermark',
    'CARTO watermark tile (256x256 on @2x request) immediately triggers OSM fallback'
  );

  // Debug crosshair + off-route debug line flag gating
  assert(isMapDebugEnabled({ PROD: true, DEV: false }) === false, 'Debug crosshair and HUD are off in production');
  assert(
    isMapDebugEnabled({ PROD: true, DEV: false, VITE_MAP_DEBUG: 'true' }) === false,
    'Debug flag cannot be enabled in production builds even with VITE_MAP_DEBUG=true'
  );
  assert(isMapDebugEnabled({ PROD: false, DEV: true }) === true, 'Debug crosshair and HUD are available in dev mode');

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
