import {
  isTimeInWindow,
  isZoneActiveNow,
  isZoneCurrentlyActive,
  normalizeDangerZone,
  getSourceLabel,
  formatActiveTimeWindow,
  formatIncidentCountText,
  calculateHomeSafetyScore,
  escapeHtml,
  getZoneMapStyles,
  ZONE_COLOR
} from './zoneUtils';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log('--- RUNNING ZONE UTILITY TESTS ---\n');

// 1. Time-window checks (Day-only 5:00 to 18:00)
// Decimal representations: 4:59 = 4 + 59/60 = 4.9833..., 5:00 = 5.0, 17:59 = 17 + 59/60 = 17.9833..., 18:00 = 18.0
const t459 = 4 + 59 / 60;
const t500 = 5.0;
const t1759 = 17 + 59 / 60;
const t1800 = 18.0;

assert(!isTimeInWindow(t459, 5, 18), 'Day-only window: 4:59 is INACTIVE');
assert(isTimeInWindow(t500, 5, 18), 'Day-only window: 5:00 is ACTIVE');
assert(isTimeInWindow(t1759, 5, 18), 'Day-only window: 17:59 is ACTIVE');
assert(!isTimeInWindow(t1800, 5, 18), 'Day-only window: 18:00 is INACTIVE');

// 2. Time-window checks (Night-only 18:00 to 5:00 crossing midnight)
assert(isTimeInWindow(t1800, 18, 5), 'Night-only window: 18:00 is ACTIVE');
assert(isTimeInWindow(t459, 18, 5), 'Night-only window: 4:59 is ACTIVE');
assert(!isTimeInWindow(t500, 18, 5), 'Night-only window: 5:00 is INACTIVE');
assert(!isTimeInWindow(t1759, 18, 5), 'Night-only window: 17:59 is INACTIVE');
assert(isTimeInWindow(23.5, 18, 5), 'Night-only window: 23:30 is ACTIVE');
assert(isTimeInWindow(2.0, 18, 5), 'Night-only window: 02:00 is ACTIVE');
assert(!isTimeInWindow(12.0, 18, 5), 'Night-only window: 12:00 (Noon) is INACTIVE');

// 3. Stored startHour / endHour override defaults; ignore them for all_day
const customNightZone = normalizeDangerZone({
  id: 'z1',
  activeTime: 'night_only',
  startHour: 20,
  endHour: 4
});
assert(customNightZone.startHour === 20 && customNightZone.endHour === 4, 'Custom night window overrides defaults to 20:00 - 4:00');

const allDayZone = normalizeDangerZone({
  id: 'z2',
  activeTime: 'all_day',
  startHour: 10,
  endHour: 14
});
assert(isZoneActiveNow(allDayZone), 'all_day zone is always active regardless of time or hours');

// 4. Default handling for old unmigrated records
const oldRecord = normalizeDangerZone({
  id: 'old_1',
  name: 'Old Unmigrated Zone',
  riskLevel: 'high',
  active: true
});
assert(oldRecord.source === 'resident_report', 'Old record source defaults to resident_report');
assert(oldRecord.activeTime === 'all_day', 'Old record activeTime defaults to all_day');
assert(oldRecord.crimeCount === 0, 'Old record crimeCount defaults to 0');
assert(JSON.stringify(oldRecord.crimeTypes) === '{}', 'Old record crimeTypes defaults to {}');
assert(isZoneActiveNow(oldRecord), 'Old unmigrated record defaults to all_day and is active');

// 5. Popup text for each source type
assert(getSourceLabel('barangay_data') === 'Based on barangay records', 'Source label for barangay_data');
assert(getSourceLabel('resident_report') === 'Reported by residents', 'Source label for resident_report');
assert(getSourceLabel('both') === 'Both', 'Source label for both');
assert(getSourceLabel(undefined) === 'Reported by residents', 'Source label default');

// 6. formatIncidentCountText behavior:
// "Don't show '0 recorded incidents' when there is no count or data period. Show 'No incident count recorded'."
assert(
  formatIncidentCountText(oldRecord) === 'No incident count recorded',
  'Empty count and empty dataPeriod shows "No incident count recorded"'
);

const zoneWithCountAndPeriod = normalizeDangerZone({
  crimeCount: 7,
  dataPeriod: 'Jan 2025 - Sep 2026'
});
assert(
  formatIncidentCountText(zoneWithCountAndPeriod) === '7 incidents (Jan 2025 - Sep 2026)',
  'Count with data period formatted correctly'
);

const zoneWithCountOnly = normalizeDangerZone({
  crimeCount: 3
});
assert(
  formatIncidentCountText(zoneWithCountOnly) === 'No incident count recorded',
  'When dataPeriod is missing, returns "No incident count recorded"'
);

// 7. Active / resolved filtering check before time-window check
const resolvedZone = normalizeDangerZone({
  status: 'resolved',
  active: true,
  activeTime: 'all_day'
});
assert(!isZoneActiveNow(resolvedZone), 'Resolved zone is not active even if activeTime is all_day');

// 8. Escaping all Firestore text
const unsafeXss = '<script>alert("xss")</script>&"\'';
const escaped = escapeHtml(unsafeXss);
assert(!escaped.includes('<script>') && escaped.includes('&lt;script&gt;') && escaped.includes('&quot;'), 'escapeHtml escapes unsafe script tags and quotes');

// 9. Home score formula with cap at 30 points
const emptyScore = calculateHomeSafetyScore([]);
assert(emptyScore === 100, 'Zero active zones produces 100% safety score');

const zonesWithHighCrimes = [
  normalizeDangerZone({ crimeCount: 20 }),
  normalizeDangerZone({ crimeCount: 20 })
];
// 2 zones -> presence = 10. Total crimes = 40 -> crime penalty = min(30, 120) = 30.
// Score = 100 - 10 - 30 = 60.
assert(calculateHomeSafetyScore(zonesWithHighCrimes) === 60, 'Home safety score correctly caps crime contribution at 30 points');

// 10. Simulated Clock Override Tests
const nightZone = normalizeDangerZone({ id: 'nz-1', activeTime: 'night_only', startHour: 18, endHour: 5 });
const dayZone = normalizeDangerZone({ id: 'dz-1', activeTime: 'day_only', startHour: 5, endHour: 18 });

// A: When isSimulating is FALSE, simulatedHour override must NEVER be used (strictly real Manila time)
const realTimeNightActive = isZoneActiveNow(nightZone);
assert(
  isZoneCurrentlyActive(nightZone, false, 22) === realTimeNightActive,
  'Non-simulating mode (Real GPS) ignores simulatedHour=22 and matches real Manila time'
);
assert(
  isZoneCurrentlyActive(nightZone, false, 14) === realTimeNightActive,
  'Non-simulating mode (Real GPS) ignores simulatedHour=14 and matches real Manila time'
);

// B: When isSimulating is TRUE, simulated clock override is applied
// 10 PM (22:00) -> nightZone is active, dayZone is inactive
assert(isZoneCurrentlyActive(nightZone, true, 22) === true, 'Simulated 10 PM (22:00): Night-only zone is ACTIVE');
assert(isZoneCurrentlyActive(dayZone, true, 22) === false, 'Simulated 10 PM (22:00): Day-only zone is INACTIVE');

// 2 PM (14:00) -> nightZone is inactive, dayZone is active
assert(isZoneCurrentlyActive(nightZone, true, 14) === false, 'Simulated 2 PM (14:00): Night-only zone is INACTIVE');
assert(isZoneCurrentlyActive(dayZone, true, 14) === true, 'Simulated 2 PM (14:00): Day-only zone is ACTIVE');

// C: When isSimulating is TRUE but simulatedHour is null ("Now"), falls back to real Manila time
assert(
  isZoneCurrentlyActive(nightZone, true, null) === realTimeNightActive,
  'Simulated "Now" (null) falls back to real Manila time'
);

// D: all_day zones remain active regardless of simulated time
const simAllDayZone = normalizeDangerZone({ id: 'ad-1', activeTime: 'all_day' });
assert(isZoneCurrentlyActive(simAllDayZone, true, 14) === true, 'All-day zone active during simulated 2 PM');
assert(isZoneCurrentlyActive(simAllDayZone, true, 22) === true, 'All-day zone active during simulated 10 PM');

// E: Resolved zones remain inactive even during simulation with override
const resolvedNight = normalizeDangerZone({ id: 'rn-1', activeTime: 'night_only', isResolved: true });
assert(isZoneCurrentlyActive(resolvedNight, true, 22) === false, 'Resolved zone remains INACTIVE during simulated 10 PM');

// 11. Single Color Rule tests (#EA580C)
assert(ZONE_COLOR === '#EA580C', 'ZONE_COLOR constant is strictly #EA580C');

const mockCriticalZone = normalizeDangerZone({
  id: 'crit-1',
  name: 'Robbery Hotspot',
  category: 'Theft',
  riskLevel: 'critical',
  color: '#DC2626', // Red in legacy record
  crimeCount: 25,
  latitude: 14.56038,
  longitude: 120.99800
});

const mockLowZone = normalizeDangerZone({
  id: 'low-1',
  name: 'Minor Alley',
  category: 'Noise',
  riskLevel: 'low',
  color: '#10B981', // Green in legacy record
  crimeCount: 0,
  latitude: 14.56038,
  longitude: 120.99800
});

// A: Active zone styles use ZONE_COLOR regardless of riskLevel, category, color, or crimeCount
const activeCritStyle = getZoneMapStyles(mockCriticalZone, true);
const activeLowStyle = getZoneMapStyles(mockLowZone, true);

assert(activeCritStyle.color === '#EA580C', 'Critical zone with legacy red color uses ZONE_COLOR #EA580C when active');
assert(activeLowStyle.color === '#EA580C', 'Low risk zone with legacy green color uses ZONE_COLOR #EA580C when active');
assert(activeCritStyle.dashArray === '', 'Active zone uses solid border (empty dashArray)');
assert(activeCritStyle.weight === 2, 'Active zone uses solid weight 2');
assert(activeCritStyle.fillOpacityPrecision === 0.22, 'Active zone uses normal fillOpacity 0.22');

// B: Inactive zone styles use ZONE_COLOR, dashed border, lower fill opacity
const inactiveCritStyle = getZoneMapStyles(mockCriticalZone, false);
const inactiveLowStyle = getZoneMapStyles(mockLowZone, false);

assert(inactiveCritStyle.color === '#EA580C', 'Inactive zone uses ZONE_COLOR #EA580C');
assert(inactiveCritStyle.dashArray === '5, 5', 'Inactive zone uses dashed border (5, 5)');
assert(inactiveCritStyle.fillOpacityPrecision === 0.08, 'Inactive zone uses lower fillOpacity 0.08');
assert(inactiveCritStyle.fillOpacityGlow === 0.02, 'Inactive zone uses faint glow 0.02');
assert(inactiveCritStyle.color === inactiveLowStyle.color, 'Inactive styles are identical regardless of zone fields');

// 12. Contract field mapping and boundary validation tests
const contractDoc = {
  id: 'contract-test',
  locationName: 'Dian & Buendia Junction',
  latitude: 14.55800,
  longitude: 120.99700,
  active: true,
  status: 'active',
  needsLocation: false,
  source: 'barangay_data',
  activeTime: 'night_only',
  startHour: 19,
  endHour: 4,
  nightCrimeCount: 8,
  dayCrimeCount: 2,
  crimeCount: 10,
  crimeTypes: { 'Theft': 7, 'Robbery': 3 },
  dataPeriod: '2025-2026',
  lastIncidentDate: '2026-03-15'
};

const normalizedContract = normalizeDangerZone(contractDoc);
assert(normalizedContract.locationName === 'Dian & Buendia Junction', 'Reads locationName');
assert(normalizedContract.name === 'Dian & Buendia Junction', 'Populates name from locationName');
assert(normalizedContract.latitude === 14.55800, 'Reads latitude');
assert(normalizedContract.longitude === 120.99700, 'Reads longitude');
assert(normalizedContract.active === true, 'Reads active');
assert(normalizedContract.needsLocation === false, 'Reads needsLocation');
assert(normalizedContract.source === 'barangay_data', 'Reads source');
assert(normalizedContract.activeTime === 'night_only', 'Reads activeTime');
assert(normalizedContract.startHour === 19 && normalizedContract.endHour === 4, 'Reads startHour and endHour');
assert(normalizedContract.nightCrimeCount === 8 && normalizedContract.dayCrimeCount === 2, 'Reads crime day/night splits');
assert(normalizedContract.crimeCount === 10, 'Reads crimeCount');
assert(normalizedContract.crimeTypes?.Theft === 7, 'Reads crimeTypes dictionary');
assert(normalizedContract.dataPeriod === '2025-2026', 'Reads dataPeriod');
assert(normalizedContract.lastIncidentDate === '2026-03-15', 'Reads lastIncidentDate');

// 13. Invalid/deactivated zone skipping checks
const needsLocZone = normalizeDangerZone({ needsLocation: true, latitude: 14.56038, longitude: 120.99800 });
assert(needsLocZone.active === false && needsLocZone.isResolved === true, 'Zone with needsLocation=true is marked inactive and resolved');

const inactiveStatusZone = normalizeDangerZone({ status: 'inactive', latitude: 14.56038, longitude: 120.99800 });
assert(inactiveStatusZone.active === false && inactiveStatusZone.isResolved === true, 'Zone with status="inactive" is marked inactive and resolved');

const zeroCoordsZone = normalizeDangerZone({ latitude: 0, longitude: 0 });
assert(zeroCoordsZone.active === false && zeroCoordsZone.isResolved === true, 'Zone with (0,0) coordinates is marked inactive and resolved');

const outOfBoundsZone = normalizeDangerZone({ latitude: 14.8000, longitude: 121.5000 }); // Far outside Palanan
assert(outOfBoundsZone.active === false && outOfBoundsZone.isResolved === true, 'Zone outside Palanan bounds is marked inactive and resolved');

// 14. crimeCount fallback when missing
const fallbackZone = normalizeDangerZone({
  latitude: 14.56038,
  longitude: 120.99800,
  nightCrimeCount: 4,
  dayCrimeCount: 3
  // crimeCount omitted
});
assert(fallbackZone.crimeCount === 7, 'crimeCount falls back to nightCrimeCount + dayCrimeCount');

// 15. all_day ignores startHour/endHour (e.g., portal writes 0 and 24)
const allDayPortalZone = normalizeDangerZone({
  latitude: 14.56038,
  longitude: 120.99800,
  activeTime: 'all_day',
  startHour: 0,
  endHour: 24,
  active: true
});
assert(isZoneCurrentlyActive(allDayPortalZone, true, 3) === true, 'all_day active at 3 AM ignoring hours');
assert(isZoneCurrentlyActive(allDayPortalZone, true, 14) === true, 'all_day active at 2 PM ignoring hours');

// 16. formatIncidentCountText popup rules
const missingPeriodZone = normalizeDangerZone({
  latitude: 14.56038,
  longitude: 120.99800,
  crimeCount: 5
  // dataPeriod omitted
});
assert(formatIncidentCountText(missingPeriodZone) === 'No incident count recorded', 'Returns "No incident count recorded" when dataPeriod is missing');

const missingCountZone = normalizeDangerZone({
  latitude: 14.56038,
  longitude: 120.99800,
  dataPeriod: '2025'
  // crimeCount omitted and 0
});
assert(formatIncidentCountText(missingCountZone) === 'No incident count recorded', 'Returns "No incident count recorded" when crimeCount is missing/0');

const completeZone = normalizeDangerZone({
  latitude: 14.56038,
  longitude: 120.99800,
  crimeCount: 8,
  dataPeriod: '2025-2026'
});
assert(formatIncidentCountText(completeZone) === '8 incidents (2025-2026)', 'Returns count and period when both are present');

// 17. No zone style depends on riskLevel, category, or stored color
const variations = [
  { riskLevel: 'low', category: 'Theft', color: '#10B981' },
  { riskLevel: 'moderate', category: 'Harassment', color: '#F59E0B' },
  { riskLevel: 'high', category: 'Assault', color: '#EF4444' },
  { riskLevel: 'critical', category: 'Robbery', color: '#7F1D1D' },
];
for (const v of variations) {
  const z = normalizeDangerZone({ latitude: 14.56038, longitude: 120.99800, ...v });
  const activeStyle = getZoneMapStyles(z, true);
  const inactiveStyle = getZoneMapStyles(z, false);
  assert(activeStyle.color === ZONE_COLOR, `Active style strictly matches ZONE_COLOR for riskLevel: ${v.riskLevel}`);
  assert(inactiveStyle.color === ZONE_COLOR, `Inactive style strictly matches ZONE_COLOR for riskLevel: ${v.riskLevel}`);
  assert(activeStyle.dashArray === '', 'Active style always has solid border');
  assert(inactiveStyle.dashArray === '5, 5', 'Inactive style always has dashed border');
}

console.log(`\n--- TEST RUN FINISHED: ${passedTests}/${totalTests} PASSED ---`);
