/**
 * Official geographic boundaries for Barangay Palanan, Makati City.
 * Defined by southwest and northeast bounding coordinates:
 * - Southwest: [14.5510, 120.9900] (Buendia LRT / Taft Ave corridor)
 * - Northeast: [14.5680, 121.0080] (Zobel Roxas / Pres. Osmeña Hwy)
 */
export const PALANAN_BOUNDS: [[number, number], [number, number]] = [
  [14.5510, 120.9900],
  [14.5680, 121.0080]
];

export const PALANAN_CENTER: [number, number] = [14.56038, 120.99800];

/**
 * Validates whether the given latitude and longitude coordinates
 * are located inside Barangay Palanan.
 *
 * @param latitude  The actual GPS latitude
 * @param longitude The actual GPS longitude
 * @returns true if inside Barangay Palanan, false otherwise
 */
export function isInsidePalanan(latitude: number, longitude: number): boolean {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    isNaN(latitude) ||
    isNaN(longitude)
  ) {
    return false;
  }

  const southWest = PALANAN_BOUNDS[0];
  const northEast = PALANAN_BOUNDS[1];

  const minLat = Math.min(southWest[0], northEast[0]);
  const maxLat = Math.max(southWest[0], northEast[0]);
  const minLng = Math.min(southWest[1], northEast[1]);
  const maxLng = Math.max(southWest[1], northEast[1]);

  return (
    latitude >= minLat &&
    latitude <= maxLat &&
    longitude >= minLng &&
    longitude <= maxLng
  );
}
