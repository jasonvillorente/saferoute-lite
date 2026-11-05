import { createZoneAvoidPolygon } from '../src/utils/routeUtils';
import { normalizeDangerZone } from '../src/utils/zoneUtils';

const zone = normalizeDangerZone({
  id: 'z-palanan-center',
  location: { lat: 14.55740, lng: 120.99920 },
  radius: 74,
  active: true,
  activeTime: 'always_active',
  crimeCount: 8
});

const ring = createZoneAvoidPolygon(zone, 10, 32);

// Let's inspect what body was sent previously
const tripStart = [14.55915, 120.99920];
const tripEnd = [14.55565, 120.99920];

const apiKey = process.env.OPENROUTESERVICE_KEY;

async function probe() {
  console.log('Testing with API key present:', !!apiKey);

  // Test 1: What server.ts sent
  // coordinates: [[lng, lat], [lng, lat]]
  // avoidPolygons: [ [ ring ] ]
  // body.options.avoid_polygons = { type: 'MultiPolygon', coordinates: avoidPolygons }
  const body1: any = {
    coordinates: [[tripStart[1], tripStart[0]], [tripEnd[1], tripEnd[0]]],
    options: {
      avoid_polygons: {
        type: 'MultiPolygon',
        coordinates: [[ring]]
      }
    }
  };

  console.log('\n--- Test 1: Body with avoid_polygons as MultiPolygon [[ring]] ---');
  console.log('Coordinates:', JSON.stringify(body1.coordinates));
  console.log('Ring length:', ring.length, 'first pt:', ring[0], 'last pt:', ring[ring.length - 1]);
  
  try {
    const res1 = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
      method: 'POST',
      headers: {
        'Authorization': apiKey!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body1)
    });
    console.log('Status 1:', res1.status);
    const text1 = await res1.text();
    console.log('Response 1:', text1);
  } catch (err: any) {
    console.error('Error 1:', err.message);
  }

  // Test 2: What about simple direct route without avoid_polygons?
  console.log('\n--- Test 2: Simple direct route (no avoid_polygons) ---');
  try {
    const res2 = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking/geojson', {
      method: 'POST',
      headers: {
        'Authorization': apiKey!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        coordinates: [[tripStart[1], tripStart[0]], [tripEnd[1], tripEnd[0]]]
      })
    });
    console.log('Status 2:', res2.status);
    const text2 = await res2.text();
    console.log('Response 2:', text2);
  } catch (err: any) {
    console.error('Error 2:', err.message);
  }
}

probe();
