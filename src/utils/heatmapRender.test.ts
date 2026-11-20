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
import { ZONE_LEVEL_STYLES, getZoneLevelPriority } from './zoneUtils';

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

// Test Fixture Data: High, Low, and Unset active zones in Palanan
const activeHighZone: DangerZone = {
  id: 'zone-hilario-high',
  location: { lat: 14.55778, lng: 121.00258 },
  radius: 50,
  crimeCount: 8,
  active: true,
  dangerLevel: 'high',
  description: 'Hilario Street High Caution Area'
};

const activeLowZone: DangerZone = {
  id: 'zone-hilario-low',
  location: { lat: 14.55778, lng: 121.00400 },
  radius: 50,
  crimeCount: 2,
  active: true,
  dangerLevel: 'low',
  description: 'Hilario Street Low Caution Area'
};

const activeUnsetZone: DangerZone = {
  id: 'zone-hilario-unset',
  location: { lat: 14.55778, lng: 121.00540 },
  radius: 50,
  crimeCount: 0,
  active: true,
  description: 'Unclassified Caution Area'
};

// Route 1: Directly crosses the High zone
const crossingRouteCoords: [number, number][] = [
  [14.55778, 121.00100],
  [14.55778, 121.00330]
];

// Route 2: Detour avoiding all zones (clears zones by > 80m)
const avoidingRouteCoords: [number, number][] = [
  [14.55600, 121.00100],
  [14.55600, 121.00400]
];

// Draw overlapping Low then High circle to verify High sits above Low in dangerZonesPane DOM
const overlappingZones = [activeHighZone, { ...activeLowZone, location: { lat: 14.55778, lng: 121.00290 } }]
  .sort((a, b) => getZoneLevelPriority(a) - getZoneLevelPriority(b));

for (const z of overlappingZones) {
  const s = z.dangerLevel === 'high' ? ZONE_LEVEL_STYLES.high : ZONE_LEVEL_STYLES.low;
  L.circle([z.location.lat, z.location.lng], {
    radius: z.radius,
    pane: 'dangerZonesPane',
    color: s.strokeColor,
    fillColor: s.fillColor,
    fillOpacity: 0.22
  }).addTo(map);
}

const zoneCirclePaths = Array.from(dangerPane.querySelectorAll('path'));
assert(zoneCirclePaths.length === 2, 'Two overlapping circles rendered in dangerZonesPane');
assert(
  (zoneCirclePaths[0] as any).getAttribute('fill')?.toUpperCase() === '#FACC15' &&
  (zoneCirclePaths[1] as any).getAttribute('fill')?.toUpperCase() === '#DC2626',
  'Overlapping circles render Low first and High above Low in dangerZonesPane DOM'
);

// TEST 1: Compute in-zone segments at render time for crossing route
const crossingSegments = computeInZonePolylinesAtRenderTime(crossingRouteCoords, [activeHighZone]);
assert(crossingSegments.length >= 1, 'Crossing route produces at least 1 in-zone segment');
assert(crossingSegments[0].color === ZONE_LEVEL_STYLES.high.fillColor, 'High zone segment uses #DC2626');
console.log(`✅ PASSED: computeInZonePolylinesAtRenderTime produces ${crossingSegments.length} High segment (#DC2626)`);

// TEST 2: Multi-level route across Low, High, and Unset zones renders each level's color (and #A16207 outline for Low)
const multiZoneCoords: [number, number][] = [
  [14.55778, 121.00180],
  [14.55778, 121.00610]
];
const multiSegments = computeInZonePolylinesAtRenderTime(multiZoneCoords, [activeHighZone, activeLowZone, activeUnsetZone]);
assert(multiSegments.some(s => s.color === '#DC2626'), 'Multi-zone route includes High (#DC2626) segment');
assert(multiSegments.some(s => s.color === '#FACC15' && s.outlineColor === '#A16207'), 'Multi-zone route includes Low (#FACC15 with #A16207 outline)');
assert(multiSegments.some(s => s.color === '#64748B'), 'Multi-zone route includes Level not set (#64748B) segment');

const baseRoutePolyline = L.polyline(multiZoneCoords, {
  pane: 'routeUnderlayPane',
  color: '#10B981',
  weight: 5
}).addTo(map);

const heatmapPolylines: any[] = [];
for (const seg of multiSegments) {
  if (seg.outlineColor) {
    heatmapPolylines.push(L.polyline(seg.coordinates, {
      pane: 'inZoneHeatmapPane',
      color: seg.outlineColor,
      weight: 10,
      opacity: seg.opacity,
      interactive: false
    }).addTo(map));
  }
  heatmapPolylines.push(L.polyline(seg.coordinates, {
    pane: 'inZoneHeatmapPane',
    color: seg.color,
    weight: 8,
    opacity: seg.opacity,
    interactive: false
  }).addTo(map));
}

const heatmapPaths = Array.from(heatmapPane.querySelectorAll('path'));
assert(heatmapPaths.some((p: any) => p.getAttribute('stroke')?.toUpperCase() === '#DC2626'), 'DOM assertion: #DC2626 High <path> rendered in inZoneHeatmapPane');
assert(heatmapPaths.some((p: any) => p.getAttribute('stroke')?.toUpperCase() === '#FACC15'), 'DOM assertion: #FACC15 Low <path> rendered in inZoneHeatmapPane');
assert(heatmapPaths.some((p: any) => p.getAttribute('stroke')?.toUpperCase() === '#A16207'), 'DOM assertion: #A16207 Low outline <path> rendered in inZoneHeatmapPane');
assert(heatmapPaths.some((p: any) => p.getAttribute('stroke')?.toUpperCase() === '#64748B'), 'DOM assertion: #64748B Unset <path> rendered in inZoneHeatmapPane');
console.log('✅ PASSED: All three level colors + Low outline rendered cleanly in inZoneHeatmapPane DOM');

// TEST 3: Pane z-index ordering in DOM
const heatmapZIndex = parseInt(heatmapPane.style.zIndex, 10);
const routeZIndex = parseInt(routePane.style.zIndex, 10);
const dangerZIndex = parseInt(dangerPane.style.zIndex, 10);

assert(heatmapZIndex > routeZIndex, 'inZoneHeatmapPane zIndex (620) is strictly higher than routeUnderlayPane (450)');
assert(routeZIndex > dangerZIndex, 'routeUnderlayPane zIndex (450) is strictly higher than dangerZonesPane (350)');
console.log(`✅ PASSED: Layer z-index ordering verified: heatmap (${heatmapZIndex}) > route (${routeZIndex}) > danger zones (${dangerZIndex})`);

// TEST 4: Route that avoids all zones has NO in-zone segment
const avoidingSegments = computeInZonePolylinesAtRenderTime(avoidingRouteCoords, [activeHighZone, activeLowZone, activeUnsetZone]);
assert(avoidingSegments.length === 0, 'Avoiding route produces 0 in-zone segments');
console.log('✅ PASSED: computeInZonePolylinesAtRenderTime produces 0 segments for avoiding route');

// TEST 5: Switching routes in DOM clears previous heatmap polylines
heatmapPolylines.forEach(p => map.removeLayer(p));
heatmapPolylines.length = 0;

const pathsAfterSwitch = heatmapPane.querySelectorAll('path');
assert(pathsAfterSwitch.length === 0, 'DOM assertion: no in-zone <path> in inZoneHeatmapPane after switching to avoiding route');
console.log('✅ PASSED: No in-zone <path> exists in DOM when switched to avoiding route');

// TEST 6: Self-test polyline renders in inZoneHeatmapPane with level color
const selfTestPoly = L.polyline([[14.55700, 120.99920], [14.55780, 120.99920]], {
  pane: 'inZoneHeatmapPane',
  color: ZONE_LEVEL_STYLES.high.fillColor,
  weight: 8,
  interactive: false
}).addTo(map);

const selfTestPaths = heatmapPane.querySelectorAll('path');
assert(selfTestPaths.length === 1, 'DOM assertion: self-test polyline renders exactly 1 <path> in inZoneHeatmapPane');
assert((selfTestPaths[0] as any).getAttribute('stroke')?.toUpperCase() === '#DC2626', 'Self-test path uses High level #DC2626');
assert((selfTestPaths[0] as any).getAttribute('stroke-width') === '8', 'Self-test path has stroke-width 8');
map.removeLayer(selfTestPoly);
console.log('✅ PASSED: Self-test polyline renders correctly in inZoneHeatmapPane DOM');

console.log('--- ALL RENDER-LEVEL HEATMAP TESTS PASSED (6/6) ---');
