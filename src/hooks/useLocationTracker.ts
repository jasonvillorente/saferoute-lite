import { useState, useEffect, useCallback } from 'react';
import { locationTracker, LocationState } from '../lib/locationTracker';
import { getRouteStartFromGps, GpsStartResult, GetRouteStartOptions } from '../utils/gpsRouting';
import type L from 'leaflet';

export { getRouteStartFromGps };
export type { GpsStartResult, GetRouteStartOptions };

export interface UseLocationTrackerResult extends LocationState {
  autoFollow: boolean;
  setAutoFollow: (val: boolean) => void;
  recenter: (map?: L.Map | null) => void;
  openSettings: () => Promise<void>;
  requestPermission: () => Promise<boolean>;
  setSimulatedOverride: (pos: [number, number] | null, heading?: number | null, speed?: number | null) => void;
  getFilteredPosition: () => Promise<{
    coords: [number, number];
    accuracy: number;
    status: LocationState['status'];
    isOutsidePalanan: boolean;
  }>;
  getRouteStart: (options?: GetRouteStartOptions) => Promise<GpsStartResult>;
}

export function useLocationTracker(initialAutoFollow = true): UseLocationTrackerResult {
  const [state, setState] = useState<LocationState>(() => locationTracker.getState());
  const [autoFollow, setAutoFollow] = useState<boolean>(initialAutoFollow);

  useEffect(() => {
    // Subscribe to singleton location tracker — never restarts watcher on component re-renders
    const unsubscribe = locationTracker.subscribe((updatedState) => {
      setState(updatedState);
    });
    return unsubscribe;
  }, []);

  const recenter = useCallback((map?: L.Map | null) => {
    setAutoFollow(true);
    const pos = locationTracker.getState().position;
    if (map && pos) {
      map.setView(pos, Math.max(map.getZoom(), 17), { animate: true });
    }
  }, []);

  const openSettings = useCallback(async () => {
    await locationTracker.openSettings();
  }, []);

  const requestPermission = useCallback(async () => {
    return await locationTracker.requestPermission();
  }, []);

  const setSimulatedOverride = useCallback(
    (pos: [number, number] | null, heading: number | null = null, speed: number | null = null) => {
      locationTracker.setSimulatedOverride(pos, heading, speed);
    },
    []
  );

  const getFilteredPosition = useCallback(async () => {
    return await locationTracker.getFilteredPosition();
  }, []);

  const getRouteStart = useCallback(async (options?: GetRouteStartOptions) => {
    return await getRouteStartFromGps(options);
  }, []);

  return {
    ...state,
    autoFollow,
    setAutoFollow,
    recenter,
    openSettings,
    requestPermission,
    setSimulatedOverride,
    getFilteredPosition,
    getRouteStart,
  };
};
