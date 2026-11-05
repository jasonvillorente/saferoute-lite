/**
 * Diagnostic script to examine route calculation, routing service responses,
 * detour candidates generation, rejection reasons, and final route count.
 */
import { PALANAN_BOUNDS, isInsidePalanan } from '../src/lib/palananBounds';
import { DangerZone, isZoneResolved } from '../src/types';
import { normalizeDangerZone, isZoneCurrentlyActive, ZONE_COLOR } from '../src/utils/zoneUtils';

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function getMinDistanceToSegmentMeters(
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

async function runDiagnosis() {
  console.log('=== ROUTE CALCULATION DIAGNOSIS ===\n');

  // Example route: Palanan Barangay Hall [14.55986, 120.99925] to Cash & Carry Mall [14.55845, 121.00160]
  const currentStart: [number, number] = [14.55986, 120.99925];
  const currentEnd: [number, number] = [14.55845, 121.00160];

  // Active zone right along the path
  const sampleActiveZone = normalizeDangerZone({
    id: 'zone-dian-junction',
    name: 'Dian & Gil Puyat High Incident Area',
    locationName: 'Dian & Gil Puyat',
    latitude: 14.55870,
    longitude: 121.00030,
    radius: 90,
    active: true,
    activeTime: 'all_day',
    crimeCount: 8,
    dataPeriod: '2025-2026'
  });

  const activeZones = [sampleActiveZone];

  console.log(`Start: [${currentStart.join(', ')}]`);
  console.log(`End: [${currentEnd.join(', ')}]`);
  console.log(`Active Zone: "${sampleActiveZone.name}" at [${sampleActiveZone.latitude}, ${sampleActiveZone.longitude}] radius ${sampleActiveZone.radius}m\n`);

  // Step 1: Query primary routing service
  const osmDeUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${currentStart[1]},${currentStart[0]};${currentEnd[1]},${currentEnd[0]}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  console.log(`[Diagnostic] Querying service: ${osmDeUrl}`);

  let res = await fetch(osmDeUrl);
  let data: any = await res.json();

  console.log(`[Diagnostic] Service status: ${data.code}`);
  console.log(`[Diagnostic] Number of candidate routes returned by routing service: ${data.routes ? data.routes.length : 0}`);

  if (data.routes && data.routes.length > 0) {
    data.routes.forEach((r: any, idx: number) => {
      console.log(`   - Candidate ${idx + 1}: distance=${r.distance}m, duration=${Math.round(r.duration)}s, coords=${r.geometry.coordinates.length}`);
    });
  }

  // Step 2: Detour generation simulation as currently coded in MapPage.tsx
  const detourCandidates: { name: string; waypoints: [number, number][]; result?: any; status: string; reason?: string }[] = [];

  const latDegreeMeters = 111000;
  const lngDegreeMeters = 111000 * Math.cos(sampleActiveZone.location.lat * Math.PI / 180);
  const shiftMeters = Math.max(sampleActiveZone.radius + 35, 75);

  const shiftLat = shiftMeters / latDegreeMeters;
  const shiftLng = shiftMeters / lngDegreeMeters;

  const wayNorth: [number, number] = [sampleActiveZone.location.lat + shiftLat, sampleActiveZone.location.lng];
  const waySouth: [number, number] = [sampleActiveZone.location.lat - shiftLat, sampleActiveZone.location.lng];
  const wayEast: [number, number] = [sampleActiveZone.location.lat, sampleActiveZone.location.lng + shiftLng];
  const wayWest: [number, number] = [sampleActiveZone.location.lat, sampleActiveZone.location.lng - shiftLng];

  const waypointsList = [
    { name: 'North waypoint', wp: [wayNorth] },
    { name: 'South waypoint', wp: [waySouth] },
    { name: 'East waypoint', wp: [wayEast] },
    { name: 'West waypoint', wp: [wayWest] }
  ];

  console.log(`\n[Diagnostic] Generating detour candidates (${waypointsList.length} offsets around zone)...`);

  for (const item of waypointsList) {
    const coordsString = [currentStart, ...item.wp, currentEnd].map(p => `${p[1]},${p[0]}`).join(';');
    const detourUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordsString}?overview=full&geometries=geojson&steps=true`;
    
    try {
      const dRes = await fetch(detourUrl);
      const dData: any = await dRes.json();
      if (dData.code === 'Ok' && dData.routes && dData.routes.length > 0) {
        const coords: [number, number][] = dData.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);
        
        // Check rejection rules from MapPage.tsx lines 1394-1410:
        let crossesInside = false;
        for (const zone of activeZones) {
          for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const d = getMinDistanceToSegmentMeters(p1[0], p1[1], p2[0], p2[1], zone.location.lat, zone.location.lng);
            if (d <= zone.radius * 0.95) {
              crossesInside = true;
              break;
            }
          }
          if (crossesInside) break;
        }

        if (crossesInside) {
          detourCandidates.push({ name: item.name, waypoints: item.wp, status: 'REJECTED', reason: 'crosses an active zone (d <= radius * 0.95)' });
        } else {
          detourCandidates.push({ name: item.name, waypoints: item.wp, status: 'ACCEPTED', result: dData.routes[0] });
        }
      } else {
        detourCandidates.push({ name: item.name, waypoints: item.wp, status: 'REJECTED', reason: 'service returned no route / error' });
      }
    } catch (e: any) {
      detourCandidates.push({ name: item.name, waypoints: item.wp, status: 'REJECTED', reason: `network error: ${e.message}` });
    }
  }

  console.log(`[Diagnostic] Detour candidate evaluation:`);
  detourCandidates.forEach(dc => {
    console.log(`   - ${dc.name}: ${dc.status}${dc.reason ? ` -> Reason: ${dc.reason}` : ''}`);
  });

  const acceptedDetours = detourCandidates.filter(dc => dc.status === 'ACCEPTED');
  console.log(`\n[Diagnostic] Accepted detours: ${acceptedDetours.length}`);

  // MapPage.tsx line 1471:
  // "const directRoute = calculated[0];"
  // It only took calculated[0]! Even if routing service returned 2 or 3 alternatives!
  console.log(`[Diagnostic] Direct routes accepted by MapPage: only calculated[0] (alternatives ignored at line 1471)`);
  console.log(`[Diagnostic] Final routes shown to user: ${1 + acceptedDetours.length}`);
}

runDiagnosis().catch(console.error);
