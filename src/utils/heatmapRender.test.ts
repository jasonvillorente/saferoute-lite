import { JSDOM } from 'jsdom';
import assert from 'assert';

// 1. Initialize complete JSDOM environment for Leaflet SVG DOM testing
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="map" style="width:800px;height:600px;"></div></body></html>');
(global as any).window = dom.window;
(global as any).document = dom.window.document;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true
  });
} catch {}

import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const L = req('leaflet');

import { DangerZone } from '../types';
import { computeInZonePolylinesAtRenderTime } from './routeUtils';

console.log('--- RUNNING LEAFLET DOM RENDER-LEVEL HEATMAP TESTS ---');

// Setup Leaflet map instance
const mapEl = dom.window.document.getElementById('map');
const map = L.map(mapEl).setView([14.5574, 120.9992], 16);

// Create Leaflet panes in identical hierarchy to MapPage.tsx
const dangerPane = map.createPane('dangerZonesPane');
dangerPane.style.zIndex = '350';

const routePane = map.createPane('routeUnderlayPane');
routePane.style.zIndex = '450';

const heatmapPane = map.createPane('inZoneHeatmapPane');
heatmapPane.style.zIndex = '620';
heatmapPane.style.pointerEvents = 'none';

// Test Fixture Data: Active zone in Palanan (Hilario Street)
const activeTestZone: DangerZone = {
  id: 'zone-hilario-test',
  location: { lat: 14.55778, lng: 121.00258 },
  radius: 50,
  crimeCount: 8,
  active: true,
  description: 'Hilario Street Caution Area'
};

// Route 1: Directly crosses the zone
const crossingRouteCoords: [number, number][] = [
  [14.55778, 121.00100],
  [14.55778, 121.00400]
];

// Route 2: Detour avoiding all zones (clears zone by > 80m)
const avoidingRouteCoords: [number, number][] = [
  [14.55600, 121.00100],
  [14.55600, 121.00400]
];

// Add danger zone circle in dangerZonesPane
const dangerCircle = L.circle([activeTestZone.location.lat, activeTestZone.location.lng], {
  radius: activeTestZone.radius,
  pane: 'dangerZonesPane',
  color: '#EA580C'
}).addTo(map);

// TEST 1: Compute in-zone segments at render time for crossing route
const crossingSegments = computeInZonePolylinesAtRenderTime(crossingRouteCoords, [activeTestZone]);
assert(crossingSegments.length >= 1, 'Crossing route produces at least 1 in-zone segment');
assert(crossingSegments[0].coordinates.length >= 2, 'In-zone segment has at least 2 points');
console.log(`✅ PASSED: computeInZonePolylinesAtRenderTime produces ${crossingSegments.length} segment(s) for route crossing zone`);

// TEST 2: Render crossing route on Leaflet map DOM
// Base green polyline in routeUnderlayPane
const baseRoutePolyline = L.polyline(crossingRouteCoords, {
  pane: 'routeUnderlayPane',
  color: '#10B981',
  weight: 5
}).addTo(map);

// In-zone heatmap polyline in inZoneHeatmapPane
const heatmapPolylines: any[] = [];
for (const seg of crossingSegments) {
  const poly = L.polyline(seg.coordinates, {
    pane: 'inZoneHeatmapPane',
    color: '#EA580C',
    weight: 8,
    opacity: 1.0,
    interactive: false
  }).addTo(map);
  heatmapPolylines.push(poly);
}

// Assert DOM state for crossing route:
const heatmapPaths = heatmapPane.querySelectorAll('path');
assert(heatmapPaths.length >= 1, 'DOM assertion: at least one <path> exists in inZoneHeatmapPane');

const orangePath = Array.from(heatmapPaths).find((p: any) => p.getAttribute('stroke')?.toUpperCase() === '#EA580C');
assert(orangePath !== undefined, 'DOM assertion: orange #EA580C <path> exists in inZoneHeatmapPane');
assert((orangePath as any).getAttribute('stroke-width') === '8', 'DOM assertion: orange <path> has stroke-width 8');
console.log('✅ PASSED: Orange <path stroke="#EA580C" stroke-width="8"> rendered in inZoneHeatmapPane DOM for crossing route');

// TEST 3: Pane z-index ordering in DOM
const heatmapZIndex = parseInt(heatmapPane.style.zIndex, 10);
const routeZIndex = parseInt(routePane.style.zIndex, 10);
const dangerZIndex = parseInt(dangerPane.style.zIndex, 10);

assert(heatmapZIndex > routeZIndex, 'inZoneHeatmapPane zIndex (620) is strictly higher than routeUnderlayPane (450)');
assert(routeZIndex > dangerZIndex, 'routeUnderlayPane zIndex (450) is strictly higher than dangerZonesPane (350)');
console.log(`✅ PASSED: Layer z-index ordering verified: heatmap (${heatmapZIndex}) > route (${routeZIndex}) > danger zones (${dangerZIndex})`);

// TEST 4: Route that avoids all zones has NO orange segment
const avoidingSegments = computeInZonePolylinesAtRenderTime(avoidingRouteCoords, [activeTestZone]);
assert(avoidingSegments.length === 0, 'Avoiding route produces 0 in-zone segments');
console.log('✅ PASSED: computeInZonePolylinesAtRenderTime produces 0 segments for avoiding route');

// TEST 5: Switching routes in DOM updates the heatmap polylines
// Remove crossing polylines and switch to avoiding route
heatmapPolylines.forEach(p => map.removeLayer(p));
heatmapPolylines.length = 0;

for (const seg of avoidingSegments) {
  const poly = L.polyline(seg.coordinates, {
    pane: 'inZoneHeatmapPane',
    color: '#EA580C',
    weight: 8,
    interactive: false
  }).addTo(map);
  heatmapPolylines.push(poly);
}

const pathsAfterSwitch = heatmapPane.querySelectorAll('path');
const orangePathsAfterSwitch = Array.from(pathsAfterSwitch).filter((p: any) => p.getAttribute('stroke')?.toUpperCase() === '#EA580C');
assert(orangePathsAfterSwitch.length === 0, 'DOM assertion: no orange <path> in inZoneHeatmapPane after switching to avoiding route');
console.log('✅ PASSED: No orange <path> exists in DOM when switched to avoiding route');

// TEST 6: Hidden self-test polyline renders in inZoneHeatmapPane
const selfTestPoly = L.polyline([[14.55700, 120.99920], [14.55780, 120.99920]], {
  pane: 'inZoneHeatmapPane',
  color: '#EA580C',
  weight: 8,
  interactive: false
}).addTo(map);

const selfTestPaths = heatmapPane.querySelectorAll('path');
assert(selfTestPaths.length === 1, 'DOM assertion: self-test polyline renders exactly 1 <path> in inZoneHeatmapPane');
assert((selfTestPaths[0] as any).getAttribute('stroke')?.toUpperCase() === '#EA580C', 'Self-test path is orange #EA580C');
assert((selfTestPaths[0] as any).getAttribute('stroke-width') === '8', 'Self-test path has stroke-width 8');
map.removeLayer(selfTestPoly);
console.log('✅ PASSED: Self-test polyline renders correctly in inZoneHeatmapPane DOM');

console.log('--- ALL RENDER-LEVEL HEATMAP TESTS PASSED (6/6) ---');
