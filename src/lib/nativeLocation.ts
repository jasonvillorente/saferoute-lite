import { Geolocation, Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

export interface GpsLocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
}

/**
 * Check if the user has already granted location permission
 */
export async function checkLocationPermission(): Promise<'granted' | 'prompt' | 'denied'> {
  try {
    if (Capacitor.isNativePlatform()) {
      const status = await Geolocation.checkPermissions();
      if (status.location === 'granted') {
        return 'granted';
      }
      if (status.location === 'denied') {
        return 'denied';
      }
      return 'prompt';
    } else {
      if ('permissions' in navigator && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (status.state === 'granted') return 'granted';
        if (status.state === 'denied') return 'denied';
        return 'prompt';
      }
      return 'prompt';
    }
  } catch (err) {
    console.warn('Permission check error:', err);
    return 'prompt';
  }
}

/**
 * Request location permission from native Android OS or browser
 */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const status = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
      return status.location === 'granted';
    } else {
      // In browser, trigger a small getCurrentPosition check to invoke browser prompt
      return new Promise<boolean>((resolve) => {
        if (!navigator.geolocation) {
          resolve(false);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });
    }
  } catch (err) {
    console.warn('Permission request error:', err);
    return false;
  }
}

/**
 * Get current high-accuracy GPS coordinates
 */
export async function getCurrentGpsPosition(): Promise<GpsLocationResult> {
  if (Capacitor.isNativePlatform()) {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 3000,
    });
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      heading: pos.coords.heading ?? null,
      speed: pos.coords.speed ?? null,
    };
  } else {
    return new Promise<GpsLocationResult>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed ?? null,
          });
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
      );
    });
  }
}

/**
 * Watch real-time GPS movement continuously
 */
export function watchGpsPosition(
  onUpdate: (location: GpsLocationResult) => void,
  onError?: (error: any) => void
): () => void {
  let isCancelled = false;
  let capacitorWatchId: string | null = null;
  let browserWatchId: number | null = null;

  if (Capacitor.isNativePlatform()) {
    Geolocation.watchPosition(
      { enableHighAccuracy: true },
      (pos: Position | null, err: any) => {
        if (isCancelled) return;
        if (err) {
          console.warn('Native GPS watch error:', err);
          if (onError) onError(err);
          return;
        }
        if (pos) {
          onUpdate({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed ?? null,
          });
        }
      }
    ).then((id) => {
      if (isCancelled) {
        Geolocation.clearWatch({ id });
      } else {
        capacitorWatchId = id;
      }
    }).catch((err) => {
      console.warn('Failed to start native watchPosition:', err);
      if (onError) onError(err);
    });
  } else {
    if (navigator.geolocation) {
      browserWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (isCancelled) return;
          onUpdate({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed ?? null,
          });
        },
        (err) => {
          if (isCancelled) return;
          console.warn('Web GPS watch error:', err);
          if (onError) onError(err);
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
    }
  }

  return () => {
    isCancelled = true;
    if (capacitorWatchId) {
      Geolocation.clearWatch({ id: capacitorWatchId });
    }
    if (browserWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(browserWatchId);
    }
  };
}
