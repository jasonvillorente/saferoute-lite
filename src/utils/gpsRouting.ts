import { locationTracker, LocationState } from '../lib/locationTracker';
import { isInsidePalanan } from '../lib/palananBounds';

export type GpsStartSuccess = {
  success: true;
  point: [number, number];
  accuracy: number;
  isApproximate: boolean;
  notice?: string;
  isSimulated?: boolean;
  reason?: undefined;
  message?: undefined;
  canOpenSettings?: undefined;
  offerPickOnMap?: undefined;
};

export type GpsStartFailure = {
  success: false;
  reason: 'denied' | 'off' | 'lost' | 'outside_palanan' | 'timeout' | 'weak' | 'searching' | 'no_fix';
  message: string;
  canOpenSettings?: boolean;
  offerPickOnMap: boolean;
  point?: undefined;
  accuracy?: undefined;
  isApproximate?: undefined;
  notice?: undefined;
  isSimulated?: undefined;
};

export type GpsStartResult = GpsStartSuccess | GpsStartFailure;

export interface GetRouteStartOptions {
  waitForFix?: boolean;
  timeoutMs?: number;
  onStatus?: (msg: string) => void;
  tracker?: typeof locationTracker;
}

/**
 * Determines whether a fresh GPS fix after calculating a route from "My location"
 * should offer the "Recalculate from here" action (> 40 m shift).
 */
export function shouldOfferRecalculateForImprovedFix(params: {
  routeCalculated: boolean;
  isStartLinkedToGps: boolean;
  isSimulating: boolean;
  routeStart: [number, number] | null;
  livePosition: [number, number] | null;
  status: LocationState['status'];
  isStale: boolean;
  accuracy: number | null;
  distanceFn: (lat1: number, lng1: number, lat2: number, lng2: number) => number;
}): boolean {
  const {
    routeCalculated,
    isStartLinkedToGps,
    isSimulating,
    routeStart,
    livePosition,
    status,
    isStale,
    accuracy,
    distanceFn,
  } = params;

  if (!routeCalculated || !isStartLinkedToGps || isSimulating) return false;
  if (!routeStart || !livePosition) return false;
  if (isStale || status === 'lost' || status === 'denied' || status === 'off') return false;
  if (accuracy !== null && accuracy > 100) return false;

  const movedMeters = distanceFn(livePosition[0], livePosition[1], routeStart[0], routeStart[1]);
  return movedMeters > 40;
}

/**
 * Single source of truth helper for current-location routing.
 * Reads position, accuracy, and status from locationTracker (the same source as the blue dot & simulator).
 *
 * Rules:
 * - status === 'lost' or isStale === true: block routing and offer "Pick start on map".
 * - accuracy 50 m or better: use it.
 * - 50 to 100 m: use it and show "Using approximate location (±N m)".
 * - worse than 100 m or no fix: show "Waiting for a better GPS signal..." for up to 10 s, then offer "Pick start on map".
 * - permission denied or location off: show message with "Open settings" and "Pick start on map". Do not start a route.
 * - outside Palanan: show "You appear to be outside Barangay Palanan" with "Pick start on map".
 * - NEVER falls back silently to PALANAN_CENTER.
 */
export async function getRouteStartFromGps(options: GetRouteStartOptions = {}): Promise<GpsStartResult> {
  const tracker = options.tracker || locationTracker;
  const waitForFix = options.waitForFix ?? true;
  const timeoutMs = options.timeoutMs ?? 10000;
  const onStatus = options.onStatus;

  const evaluateState = (state: LocationState): GpsStartResult | null => {
    // 1. Simulator override
    if (state.isSimulating && state.position) {
      const lat = state.position[0];
      const lng = state.position[1];
      if (state.isOutsidePalanan || !isInsidePalanan(lat, lng)) {
        return {
          success: false,
          reason: 'outside_palanan',
          message: 'You appear to be outside Barangay Palanan',
          offerPickOnMap: true,
        };
      }
      return {
        success: true,
        point: [lat, lng],
        accuracy: 5,
        isApproximate: false,
        isSimulated: true,
      };
    }

    // 2. Permission denied
    if (state.status === 'denied') {
      return {
        success: false,
        reason: 'denied',
        message: 'Location permission denied. Please allow location access or pick your start on the map.',
        canOpenSettings: true,
        offerPickOnMap: true,
      };
    }

    // 3. Hardware location off
    if (state.status === 'off') {
      return {
        success: false,
        reason: 'off',
        message: 'Location services are disabled. Please enable GPS or pick your start on the map.',
        canOpenSettings: true,
        offerPickOnMap: true,
      };
    }

    // 4. Lost or stale GPS fix: not valid for routing
    if (state.status === 'lost' || state.isStale === true) {
      return {
        success: false,
        reason: 'lost',
        message: 'GPS signal lost. Pick start on map or wait for a fix.',
        offerPickOnMap: true,
      };
    }

    // 5. Have a fresh position fix
    if (state.position) {
      const lat = state.position[0];
      const lng = state.position[1];

      // Palanan service bounds check
      if (state.isOutsidePalanan || !isInsidePalanan(lat, lng)) {
        return {
          success: false,
          reason: 'outside_palanan',
          message: 'You appear to be outside Barangay Palanan',
          offerPickOnMap: true,
        };
      }

      const acc = state.accuracy ?? 15;

      // Rule: accuracy 50 m or better: use it.
      if (acc <= 50) {
        return {
          success: true,
          point: [lat, lng],
          accuracy: acc,
          isApproximate: false,
        };
      }

      // Rule: 50 to 100 m: use it and show "Using approximate location (±N m)".
      if (acc <= 100) {
        return {
          success: true,
          point: [lat, lng],
          accuracy: acc,
          isApproximate: true,
          notice: `Using approximate location (±${Math.round(acc)} m)`,
        };
      }

      // Worse than 100 m: treat as not sufficiently accurate yet
    }

    return null;
  };

  // Immediate check of current tracker state
  const currentState = tracker.getState();
  const immediateResult = evaluateState(currentState);
  if (immediateResult) {
    return immediateResult;
  }

  // If immediate evaluation returned null and caller does not want to wait:
  if (!waitForFix) {
    return {
      success: false,
      reason: currentState.status === 'searching' ? 'searching' : 'weak',
      message: 'Waiting for a better GPS signal...',
      offerPickOnMap: true,
    };
  }

  // Signal status callback
  if (onStatus) {
    onStatus('Waiting for a better GPS signal...');
  }

  // Ensure watcher is running
  tracker.startWatcher();

  return new Promise<GpsStartResult>((resolve) => {
    let resolved = false;
    let timer: any = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };

    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          success: false,
          reason: 'timeout',
          message: 'Waiting for a better GPS signal...',
          offerPickOnMap: true,
        });
      }
    }, timeoutMs);

    unsubscribe = tracker.subscribe((state) => {
      if (resolved) return;
      const res = evaluateState(state);
      if (res) {
        resolved = true;
        cleanup();
        resolve(res);
      }
    });
  });
}
