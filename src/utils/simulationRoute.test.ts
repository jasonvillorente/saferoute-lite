import assert from 'assert';
import { CalculatedRoute } from '../types';

console.log('--- RUNNING SIMULATOR ROUTE PRESERVATION TESTS ---');

// Mock user-created route (e.g. from Dian St to Emilia St)
const userCreatedRoute: CalculatedRoute = {
  id: 'user-route-dian-emilia',
  name: 'User Created Safe Path',
  distance: 650,
  duration: 480,
  coordinates: [
    [14.5570, 120.9992],
    [14.5574, 120.9992],
    [14.5578, 120.9992],
    [14.5582, 120.9992]
  ],
  safety: 'safe',
  safetyScore: 95,
  totalCost: 650,
  steps: [],
  segments: [],
  metersInside: 0,
  metersBuffer: 0,
  crimeWeightedExposure: 0,
  passedZonesCount: 0,
  minClearance: 25,
  summaryText: 'User created route with zero caution areas'
};

const alternativeRoute: CalculatedRoute = {
  id: 'user-route-alt',
  name: 'Avoids caution areas (+80 m, +1 min)',
  distance: 730,
  duration: 540,
  coordinates: [
    [14.5570, 120.9985],
    [14.5575, 120.9985],
    [14.5582, 120.9985]
  ],
  safety: 'safe',
  safetyScore: 92,
  totalCost: 730,
  steps: [],
  segments: [],
  metersInside: 0,
  metersBuffer: 0,
  crimeWeightedExposure: 0,
  passedZonesCount: 0,
  minClearance: 40,
  summaryText: 'Alternative detour route'
};

const routes: CalculatedRoute[] = [userCreatedRoute, alternativeRoute];

// Mock simulation starter function simulating MapPage's startSimulation logic
function simulateStartWalk(
  targetIndexInput: any,
  activeRouteIndex: number,
  availableRoutes: CalculatedRoute[]
): {
  simulatedCoords: [number, number][];
  selectedRouteId: string;
  isSimulating: boolean;
} {
  const numericIndex = typeof targetIndexInput === 'number' ? targetIndexInput : activeRouteIndex;
  const targetRoute = availableRoutes[numericIndex] || availableRoutes[activeRouteIndex] || availableRoutes[0];

  assert(targetRoute !== undefined, 'Target route must be found');

  return {
    simulatedCoords: targetRoute.coordinates,
    selectedRouteId: targetRoute.id,
    isSimulating: true
  };
}

// TEST 1: User starts simulation on Route 0 (Fastest / Created)
const res1 = simulateStartWalk(0, 0, routes);
assert.strictEqual(res1.selectedRouteId, 'user-route-dian-emilia', 'Simulates user-created route 0');
assert.deepStrictEqual(res1.simulatedCoords, userCreatedRoute.coordinates, 'Simulated coordinates match user route 0');
console.log('✅ PASSED: Simulator begins on user-created route 0');

// TEST 2: User starts simulation on Route 1 (Alternative selected)
const res2 = simulateStartWalk(1, 1, routes);
assert.strictEqual(res2.selectedRouteId, 'user-route-alt', 'Simulates user-selected alternative route 1');
assert.deepStrictEqual(res2.simulatedCoords, alternativeRoute.coordinates, 'Simulated coordinates match alternative route');
console.log('✅ PASSED: Simulator preserves selected route 1');

// TEST 3: User clicks button where React passes a SyntheticEvent (targetIndexInput is an object)
const mockReactEvent = { nativeEvent: {}, target: {}, currentTarget: {}, type: 'click' };
const res3 = simulateStartWalk(mockReactEvent, 1, routes);
assert.strictEqual(res3.selectedRouteId, 'user-route-alt', 'Simulator handles React event object without resetting route');
assert.deepStrictEqual(res3.simulatedCoords, alternativeRoute.coordinates, 'Coordinates match route 1 when event is passed');
console.log('✅ PASSED: Simulator ignores event object and preserves user selected route');

// TEST 4: No targetIndex passed (defaults to activeRouteIndex = 0)
const res4 = simulateStartWalk(undefined, 0, routes);
assert.strictEqual(res4.selectedRouteId, 'user-route-dian-emilia', 'Defaults to currently active route');
console.log('✅ PASSED: Simulator correctly defaults to activeRouteIndex');

console.log('--- ALL SIMULATOR ROUTE PRESERVATION TESTS PASSED (4/4) ---');
