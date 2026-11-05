import { DangerZone, isZoneResolved } from '../types';
import { isInsidePalanan } from '../lib/palananBounds';

/**
 * Single color rule for all danger zones across the app (matches Admin Portal).
 */
export const ZONE_COLOR = '#EA580C';

/**
 * Escapes unsafe HTML characters to prevent XSS in Leaflet popups or HTML rendering.
 */
export function escapeHtml(str: string | undefined | null): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes zone fields with safe defaults for old or incomplete Firestore records.
 * Reads all schema fields: locationName, latitude, longitude, active, status, needsLocation,
 * source, activeTime, startHour, endHour, nightCrimeCount, dayCrimeCount, crimeCount,
 * crimeTypes, dataPeriod, lastIncidentDate.
 * Skips/deactivates zones if needsLocation is true, coordinates are missing/zero, or outside bounds.
 */
export function normalizeDangerZone(raw: any, id: string = ''): DangerZone {
  const needsLocation = raw?.needsLocation === true || raw?.needsLocation === 'true';
  const isResolvedBase = isZoneResolved(raw);

  // Parse location coordinates from both nested and flat schemas
  const rawLoc = raw?.location;
  let lat = typeof raw?.latitude === 'number' && !isNaN(raw.latitude) 
    ? raw.latitude 
    : (rawLoc && typeof rawLoc.lat === 'number' && !isNaN(rawLoc.lat) 
        ? rawLoc.lat 
        : (rawLoc && typeof rawLoc.latitude === 'number' && !isNaN(rawLoc.latitude) ? rawLoc.latitude : undefined));
  let lng = typeof raw?.longitude === 'number' && !isNaN(raw.longitude) 
    ? raw.longitude 
    : (rawLoc && typeof rawLoc.lng === 'number' && !isNaN(rawLoc.lng) 
        ? rawLoc.lng 
        : (rawLoc && typeof rawLoc.longitude === 'number' && !isNaN(rawLoc.longitude) ? rawLoc.longitude : undefined));

  if (typeof lat === 'string' && !isNaN(Number(lat))) lat = Number(lat);
  if (typeof lng === 'string' && !isNaN(Number(lng))) lng = Number(lng);

  const hasExplicitCoords = lat !== undefined && lng !== undefined;
  const isZeroCoords = hasExplicitCoords && lat === 0 && lng === 0;
  const isOutOfBounds = hasExplicitCoords && !isInsidePalanan(lat, lng);
  const isInvalidCoords = isZeroCoords || isOutOfBounds;
  const hasValidCoords = hasExplicitCoords && !isInvalidCoords;

  // If coordinates are explicitly 0/0, outside bounds, needsLocation is true, or already resolved -> mark resolved
  const zoneId = raw?.id || id || 'unknown';
  if (raw?.active === false) {
    console.warn(`[DangerZone] Skipped zone "${zoneId}": inactive`);
  } else if (raw?.status === 'inactive') {
    console.warn(`[DangerZone] Skipped zone "${zoneId}": inactive status`);
  } else if (isResolvedBase) {
    console.warn(`[DangerZone] Skipped zone "${zoneId}": resolved`);
  } else if (needsLocation) {
    console.warn(`[DangerZone] Skipped zone "${zoneId}": needsLocation`);
  } else if (isZeroCoords || !hasExplicitCoords) {
    console.warn(`[DangerZone] Skipped zone "${zoneId}": bad coordinates (${lat}, ${lng})`);
  } else if (isOutOfBounds) {
    console.warn(`[DangerZone] Skipped zone "${zoneId}": out of bounds (${lat}, ${lng})`);
  }

  const isResolved = isResolvedBase || needsLocation || isInvalidCoords;
  const active = !isResolved && (
    raw?.active !== undefined
      ? (typeof raw.active === 'string' ? raw.active === 'true' : !!raw.active)
      : (raw?.status === 'active' || raw?.status === 'approved' || !raw?.status)
  );

  const source = raw?.source === 'barangay_data' || raw?.source === 'resident_report' || raw?.source === 'both'
    ? raw.source
    : 'resident_report';

  const activeTime = raw?.activeTime === 'night_only' || raw?.activeTime === 'day_only' || raw?.activeTime === 'all_day'
    ? raw.activeTime
    : 'all_day';

  let startHour = typeof raw?.startHour === 'number' && !isNaN(raw.startHour) ? raw.startHour : undefined;
  let endHour = typeof raw?.endHour === 'number' && !isNaN(raw.endHour) ? raw.endHour : undefined;

  // Set default hours if not explicitly provided
  if (activeTime === 'night_only') {
    if (startHour === undefined) startHour = 18;
    if (endHour === undefined) endHour = 5;
  } else if (activeTime === 'day_only') {
    if (startHour === undefined) startHour = 5;
    if (endHour === undefined) endHour = 18;
  }

  const nightCrimeCount = typeof raw?.nightCrimeCount === 'number' && !isNaN(raw.nightCrimeCount)
    ? raw.nightCrimeCount
    : (typeof raw?.nightCrimeCount === 'string' && !isNaN(Number(raw.nightCrimeCount)) ? Number(raw.nightCrimeCount) : undefined);

  const dayCrimeCount = typeof raw?.dayCrimeCount === 'number' && !isNaN(raw.dayCrimeCount)
    ? raw.dayCrimeCount
    : (typeof raw?.dayCrimeCount === 'string' && !isNaN(Number(raw.dayCrimeCount)) ? Number(raw.dayCrimeCount) : undefined);

  // Fallback: If crimeCount is missing, fall back to nightCrimeCount + dayCrimeCount
  let crimeCount: number;
  if (raw?.crimeCount !== undefined && raw?.crimeCount !== null && raw?.crimeCount !== '' && !isNaN(Number(raw.crimeCount))) {
    crimeCount = Number(raw.crimeCount);
  } else if (nightCrimeCount !== undefined || dayCrimeCount !== undefined) {
    crimeCount = (nightCrimeCount || 0) + (dayCrimeCount || 0);
  } else {
    crimeCount = 0;
  }

  // Crime types dictionary
  let crimeTypes: Record<string, number> = {};
  if (raw?.crimeTypes && typeof raw.crimeTypes === 'object' && !Array.isArray(raw.crimeTypes)) {
    crimeTypes = { ...raw.crimeTypes };
  }

  const locName = raw?.locationName ? String(raw.locationName) : (raw?.name ? String(raw.name) : undefined);

  return {
    id: raw?.id || id,
    location: hasValidCoords ? { lat: lat!, lng: lng! } : { lat: 14.56038, lng: 120.99800 },
    latitude: hasValidCoords ? lat : undefined,
    longitude: hasValidCoords ? lng : undefined,
    radius: Number(raw?.radius) || 100,
    description: String(raw?.description || 'Caution area in Palanan'),
    name: locName,
    locationName: locName,
    category: raw?.category ? String(raw.category) : undefined,
    addedBy: raw?.addedBy,
    createdAt: raw?.createdAt,
    active,
    resolved: isResolved,
    isResolved,
    status: raw?.status,
    needsLocation,
    source,
    activeTime,
    startHour,
    endHour,
    crimeCount,
    nightCrimeCount: nightCrimeCount ?? 0,
    dayCrimeCount: dayCrimeCount ?? 0,
    crimeTypes,
    dataPeriod: raw?.dataPeriod ? String(raw.dataPeriod).trim() : undefined,
    lastIncidentDate: raw?.lastIncidentDate,
    updatedAt: raw?.updatedAt,
  };
}

/**
 * Returns current Manila (UTC+8) time components or evaluates given Date.
 */
export function getManilaTime(customDate?: Date): { hour: number; minute: number; timeDecimal: number } {
  const d = customDate || new Date();
  // Using Intl to extract Asia/Manila hour and minute reliably regardless of client timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour12: false,
    hour: 'numeric',
    minute: 'numeric',
  });
  const parts = formatter.formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'hour') {
      hour = parseInt(part.value, 10);
      if (hour === 24) hour = 0;
    }
    if (part.type === 'minute') {
      minute = parseInt(part.value, 10);
    }
  }
  const timeDecimal = hour + minute / 60;
  return { hour, minute, timeDecimal };
}

/**
 * Checks whether the current time falls within the given start and end hour.
 * Supports crossing midnight (e.g., 18:00 to 05:00).
 * Interval is half-open: [startHour, endHour) in decimal hours.
 * For example, 18 to 5 includes 18:00 up to 04:59.999... but not 05:00.
 */
export function isTimeInWindow(
  timeDecimal: number,
  startHour: number,
  endHour: number
): boolean {
  if (startHour === endHour) {
    return true; // 24-hour cycle
  }

  if (startHour < endHour) {
    // Standard daytime window, e.g., 5 to 18
    return timeDecimal >= startHour && timeDecimal < endHour;
  } else {
    // Midnight crossing window, e.g., 18 to 5 (active from >= 18:00 OR < 5:00)
    return timeDecimal >= startHour || timeDecimal < endHour;
  }
}

/**
 * Checks if a danger zone is active right now based on its activeTime window.
 * Zones with activeTime === 'all_day' are always active.
 * Inactive or resolved zones always return false.
 * Accepts optional Date object or decimal hour (0-23.99).
 */
export function isZoneActiveNow(zone: DangerZone, customDateOrHour?: Date | number): boolean {
  if (!zone || zone.active === false || isZoneResolved(zone)) {
    return false;
  }

  const activeTime = zone.activeTime || 'all_day';
  if (activeTime === 'all_day') {
    return true;
  }

  let timeDecimal: number;
  if (typeof customDateOrHour === 'number' && !isNaN(customDateOrHour)) {
    timeDecimal = customDateOrHour;
  } else if (customDateOrHour instanceof Date) {
    timeDecimal = getManilaTime(customDateOrHour).timeDecimal;
  } else {
    timeDecimal = getManilaTime().timeDecimal;
  }

  if (activeTime === 'night_only') {
    const start = zone.startHour !== undefined ? zone.startHour : 18;
    const end = zone.endHour !== undefined ? zone.endHour : 5;
    return isTimeInWindow(timeDecimal, start, end);
  }

  if (activeTime === 'day_only') {
    const start = zone.startHour !== undefined ? zone.startHour : 5;
    const end = zone.endHour !== undefined ? zone.endHour : 18;
    return isTimeInWindow(timeDecimal, start, end);
  }

  return true;
}

/**
 * Checks whether a zone is currently active.
 * CRITICAL RULE:
 * - When isSimulating is TRUE and simulatedHour is a number, the simulated clock override is applied.
 * - When isSimulating is FALSE or simulatedHour is null/undefined, real Manila time is ALWAYS used.
 * Real GPS behavior and regular application operations must NEVER use the override.
 */
export function isZoneCurrentlyActive(
  zone: DangerZone,
  isSimulating: boolean = false,
  simulatedHour?: number | null
): boolean {
  if (isSimulating && typeof simulatedHour === 'number' && !isNaN(simulatedHour)) {
    return isZoneActiveNow(zone, simulatedHour);
  }
  // Real GPS and normal mode: strictly real Manila time
  return isZoneActiveNow(zone);
}

/**
 * Formats source label based on data contract.
 */
export function getSourceLabel(source: string | undefined): string {
  switch (source) {
    case 'barangay_data':
      return 'Based on barangay records';
    case 'both':
      return 'Both';
    case 'resident_report':
    default:
      return 'Reported by residents';
  }
}

/**
 * Formats active time window text for display.
 */
export function formatActiveTimeWindow(zone: DangerZone): string {
  const activeTime = zone.activeTime || 'all_day';
  if (activeTime === 'all_day') {
    return 'Active 24/7 (All Day)';
  }

  const formatHour = (h: number): string => {
    const mod = h % 24;
    const period = mod >= 12 ? 'PM' : 'AM';
    const displayH = mod % 12 === 0 ? 12 : mod % 12;
    return `${displayH} ${period}`;
  };

  const start = zone.startHour !== undefined
    ? zone.startHour
    : (activeTime === 'night_only' ? 18 : 5);
  const end = zone.endHour !== undefined
    ? zone.endHour
    : (activeTime === 'night_only' ? 5 : 18);

  const label = activeTime === 'night_only' ? 'Night only' : 'Day only';
  return `${label} (${formatHour(start)} - ${formatHour(end)})`;
}

/**
 * Formats incident count display.
 * Rule: The popup shows no "Recent records" label and no "0 incidents" when dataPeriod or crimeCount is missing;
 * it should say "No incident count recorded".
 */
export function formatIncidentCountText(zone: DangerZone): string {
  const count = zone.crimeCount;
  const hasCount = typeof count === 'number' && !isNaN(count) && count > 0;
  const period = zone.dataPeriod ? zone.dataPeriod.trim() : '';

  if (!hasCount || !period) {
    return 'No incident count recorded';
  }

  return `${count} incident${count === 1 ? '' : 's'} (${period})`;
}

/**
 * Circle styling for Leaflet map based strictly on active status using the Single Color Rule.
 * Uses ZONE_COLOR (#EA580C) exclusively. Does NOT depend on riskLevel, category, crimeCount, or stored color.
 * - Active right now: solid border (weight 2), normal fill (0.22), normal glow (0.10).
 * - Inactive right now: dashed border ('5, 5', weight 1.5), lower fill opacity (0.08), faint glow (0.02).
 */
export function getZoneMapStyles(zone: DangerZone, isCurrentlyActive: boolean) {
  if (!isCurrentlyActive) {
    return {
      color: ZONE_COLOR,
      fillOpacityGlow: 0.02,
      fillOpacityPrecision: 0.08,
      weight: 1.5,
      dashArray: '5, 5',
      badgeClass: 'bg-slate-50 text-slate-600 border border-slate-200',
      badgeText: 'Inactive right now',
      isWarning: false,
    };
  }

  return {
    color: ZONE_COLOR,
    fillOpacityGlow: 0.10,
    fillOpacityPrecision: 0.22,
    weight: 2,
    dashArray: '',
    badgeClass: 'bg-orange-50 text-orange-800 border border-orange-200 font-bold',
    badgeText: 'Currently active',
    isWarning: true,
  };
}

/**
 * Computes safety score for Home page:
 * Formula: 100 - base penalty for active zones - crime contribution capped at 30 points.
 */
export function calculateHomeSafetyScore(activeZones: DangerZone[]): number {
  if (!activeZones || activeZones.length === 0) {
    return 100;
  }

  // Active zone base presence penalty: 5 points each (max 40)
  const presencePenalty = Math.min(40, activeZones.length * 5);

  // Total crimes across currently active zones, capped at 30 points
  const totalCrimes = activeZones.reduce((sum, z) => sum + (z.crimeCount || 0), 0);
  const crimeContribution = Math.min(30, totalCrimes * 3);

  const finalScore = Math.max(40, Math.min(100, 100 - presencePenalty - crimeContribution));
  return Math.round(finalScore);
}
