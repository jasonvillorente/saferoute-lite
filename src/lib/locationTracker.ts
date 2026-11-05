import { Geolocation, Position } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isInsidePalanan } from './palananBounds';
import { getDistanceMeters } from '../utils/routeUtils';

export type LocationStatus = 'idle' | 'searching' | 'strong' | 'weak' | 'lost' | 'off' | 'denied';

export interface LocationState {
  position: [number, number] | null;
  rawPosition: [number, number] | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  status: LocationStatus;
  lastUpdate: number | null;
  isOutsidePalanan: boolean;
  isStale: boolean;
  isSimulating: boolean;
}

type Listener = (state: LocationState) => void;

class LocationTrackerService {
  private static instance: LocationTrackerService;

  private state: LocationState = {
    position: null,
    rawPosition: null,
    accuracy: null,
    heading: null,
    speed: null,
    status: 'idle',
    lastUpdate: null,
    isOutsidePalanan: false,
    isStale: false,
    isSimulating: false,
  };

  private listeners: Set<Listener> = new Set();
  private activeWatchId: string | number | null = null;
  private isNativeWatch = false;
  private isWatcherStarting = false;
  private retryCount = 0;
  private maxRetries = 3;
  private retryTimer: any = null;
  private staleTimer: any = null;
  private backgroundPaused = false;

  // Signal processing state
  private lastAcceptedRaw: { lat: number; lng: number; time: number } | null = null;
  private consecutiveJumpCandidate: { lat: number; lng: number; accuracy: number; time: number } | null = null;
  private simulatedOverride: { pos: [number, number] | null; heading: number | null; speed: number | null } | null = null;

  // Watch counter for telemetry / unit tests verification
  public watcherStartCount = 0;
  public watcherStopCount = 0;

  private constructor() {
    this.loadLastKnownPosition();
    this.setupLifecycleListeners();
  }

  public static getInstance(): LocationTrackerService {
    if (!LocationTrackerService.instance) {
      LocationTrackerService.instance = new LocationTrackerService();
    }
    return LocationTrackerService.instance;
  }

  private loadLastKnownPosition() {
    try {
      if (typeof window === 'undefined') return;
      const cached = localStorage.getItem('saferoute_last_gps_fix');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
          // Provide fast first fix immediately to UI
          this.state = {
            ...this.state,
            position: [parsed.lat, parsed.lng],
            rawPosition: [parsed.lat, parsed.lng],
            accuracy: parsed.accuracy || 20,
            heading: parsed.heading ?? null,
            speed: parsed.speed ?? 0,
            status: 'searching',
            lastUpdate: parsed.timestamp || Date.now(),
            isOutsidePalanan: !isInsidePalanan(parsed.lat, parsed.lng),
            isStale: true,
          };
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private setupLifecycleListeners() {
    if (typeof window === 'undefined') return;

    // Capacitor Native appStateChange
    if (Capacitor.isNativePlatform()) {
      try {
        App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) {
            this.handleAppBackground();
          } else {
            this.handleAppForeground();
          }
        });
      } catch (err) {
        console.warn('[LocationTracker] Failed to register App state listener:', err);
      }
    }

    // Web visibilitychange
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.handleAppBackground();
        } else {
          this.handleAppForeground();
        }
      });
    }
  }

  private handleAppBackground() {
    this.backgroundPaused = true;
    // Pause watcher to conserve battery
    this.stopWatcherInternal();
  }

  private handleAppForeground() {
    if (this.backgroundPaused) {
      this.backgroundPaused = false;
      if (this.listeners.size > 0 && !this.activeWatchId) {
        this.startWatcher();
      }
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Push current state immediately
    listener(this.getState());

    // Start single continuous watcher if not already started
    if (this.listeners.size === 1 && !this.activeWatchId && !this.backgroundPaused) {
      this.startWatcher();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopWatcherInternal();
      }
    };
  }

  public getState(): LocationState {
    if (this.state.isSimulating && this.simulatedOverride?.pos) {
      return {
        ...this.state,
        position: this.simulatedOverride.pos,
        rawPosition: this.simulatedOverride.pos,
        accuracy: null,
        heading: this.simulatedOverride.heading ?? this.state.heading,
        speed: this.simulatedOverride.speed ?? this.state.speed,
        isOutsidePalanan: !isInsidePalanan(this.simulatedOverride.pos[0], this.simulatedOverride.pos[1]),
        status: 'strong',
      };
    }
    return { ...this.state };
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (e) {
        console.error('[LocationTracker] Listener notification error:', e);
      }
    });
  }

  public async requestPermission(): Promise<boolean> {
    try {
      if (Capacitor.isNativePlatform()) {
        let status;
        try {
          status = await Geolocation.requestPermissions();
        } catch {
          status = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
        }
        if (status.location === 'granted' || status.coarseLocation === 'granted') {
          this.retryCount = 0;
          this.startWatcher();
          return true;
        }
        this.updateState({ status: 'denied' });
        return false;
      } else {
        if (!navigator.geolocation) {
          this.updateState({ status: 'off' });
          return false;
        }
        return new Promise<boolean>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => {
              this.retryCount = 0;
              this.startWatcher();
              resolve(true);
            },
            (err) => {
              if (err.code === 1) {
                this.updateState({ status: 'denied' });
              } else {
                this.updateState({ status: 'off' });
              }
              resolve(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        });
      }
    } catch {
      this.updateState({ status: 'denied' });
      return false;
    }
  }

  public async openSettings(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        // Trigger Android application details intent
        window.location.href = 'app-settings:';
      } catch {
        // Fallback
      }
    }
  }

  public startWatcher() {
    if (this.activeWatchId || this.isWatcherStarting) return;
    this.isWatcherStarting = true;
    this.watcherStartCount++;
    this.updateState({ status: this.state.position ? this.state.status : 'searching' });

    this.resetStaleTimer();

    if (Capacitor.isNativePlatform()) {
      this.isNativeWatch = true;
      Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
        (pos: Position | null, err: any) => {
          if (err) {
            this.handleWatchError(err);
            return;
          }
          if (pos) {
            this.processIncomingFix(pos);
          }
        }
      )
        .then((id) => {
          this.isWatcherStarting = false;
          this.activeWatchId = id;
        })
        .catch((err) => {
          this.isWatcherStarting = false;
          this.handleWatchError(err);
        });
    } else {
      this.isNativeWatch = false;
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        this.activeWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            this.isWatcherStarting = false;
            this.processIncomingFix(pos);
          },
          (err) => {
            this.isWatcherStarting = false;
            this.handleWatchError(err);
          },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        );
      } else {
        this.isWatcherStarting = false;
        this.activeWatchId = 999;
      }
    }
  }

  private stopWatcherInternal() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.staleTimer) {
      clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }

    if (this.activeWatchId !== null) {
      this.watcherStopCount++;
      if (this.isNativeWatch) {
        Geolocation.clearWatch({ id: String(this.activeWatchId) }).catch(() => {});
      } else if (typeof navigator !== 'undefined' && navigator.geolocation && this.activeWatchId !== 999) {
        navigator.geolocation.clearWatch(Number(this.activeWatchId));
      }
      this.activeWatchId = null;
    }
    this.isWatcherStarting = false;
  }

  private handleWatchError(err: any) {
    console.warn('[LocationTracker] Location watch error:', err);
    const code = err?.code;

    if (code === 1) {
      // Permission denied
      this.updateState({ status: 'denied', isStale: true });
      return;
    }
    if (code === 2) {
      // Position unavailable / GPS hardware off
      this.updateState({ status: 'off', isStale: true });
      return;
    }

    // Timeout or generic error: attempt retry with exponential backoff
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const backoffMs = Math.pow(2, this.retryCount) * 1000;
      this.stopWatcherInternal();
      this.updateState({ status: 'searching' });
      this.retryTimer = setTimeout(() => {
        this.startWatcher();
      }, backoffMs);
      if (this.retryTimer?.unref) this.retryTimer.unref();
    } else {
      this.updateState({ status: 'lost', isStale: true });
    }
  }

  private resetStaleTimer() {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    // If no new fix arrives within 15 seconds, mark state as stale and lost
    this.staleTimer = setTimeout(() => {
      this.updateState({ isStale: true, status: 'lost' });
    }, 15000);
    if (this.staleTimer?.unref) this.staleTimer.unref();
  }

  /**
   * Process raw GPS fix through signal quality filters:
   * 1. Ignore accuracy > 100m
   * 2. Reject impossible jumps (> 12 m/s) unless confirmed by consecutive accurate fix
   * 3. Light smoothing & hold position when stationary (< 0.3 m/s)
   * 4. Calculate movement-based heading when speed > 0.5 m/s
   */
  public processIncomingFix(raw: Position | GeolocationPosition) {
    const lat = raw.coords.latitude;
    const lng = raw.coords.longitude;
    const accuracy = raw.coords.accuracy;
    const hardwareHeading = raw.coords.heading ?? null;
    const reportedSpeed = raw.coords.speed ?? null;
    const now = raw.timestamp || Date.now();

    this.resetStaleTimer();
    this.retryCount = 0;

    // Rule 1: Ignore fixes with accuracy worse than 100m for movement & warnings
    if (accuracy > 100) {
      this.updateState({
        rawPosition: [lat, lng],
        accuracy,
        status: 'weak',
        lastUpdate: now,
        isStale: false,
      });
      return;
    }

    // Rule 2: Jump rejection (implied speed > 12 m/s and distance > 25m for pedestrian app)
    if (this.lastAcceptedRaw) {
      const dt = Math.max(0.2, (now - this.lastAcceptedRaw.time) / 1000);
      const dist = getDistanceMeters(this.lastAcceptedRaw.lat, this.lastAcceptedRaw.lng, lat, lng);
      const impliedSpeed = dist / dt;

      if (dist > 25 && impliedSpeed > 12) {
        // Impossible jump detected
        if (
          this.consecutiveJumpCandidate &&
          getDistanceMeters(this.consecutiveJumpCandidate.lat, this.consecutiveJumpCandidate.lng, lat, lng) < 15 &&
          accuracy <= 50
        ) {
          // Second consecutive accurate fix confirms user actually moved (e.g., entered vehicle)
          this.consecutiveJumpCandidate = null;
        } else {
          // Reject jump, keep previous accepted position
          this.consecutiveJumpCandidate = { lat, lng, accuracy, time: now };
          this.updateState({
            rawPosition: [lat, lng],
            accuracy,
            lastUpdate: now,
            isStale: false,
          });
          return;
        }
      } else {
        this.consecutiveJumpCandidate = null;
      }
    }

    // Rule 3: Smoothing & zero-speed hold
    const prevPos = this.state.position;
    let finalLat = lat;
    let finalLng = lng;
    const speed = reportedSpeed !== null && !isNaN(reportedSpeed) ? reportedSpeed : 0;

    if (prevPos) {
      const distFromPrev = getDistanceMeters(prevPos[0], prevPos[1], lat, lng);

      // Stationary drift hold
      if (speed < 0.3 && distFromPrev < 3.5) {
        finalLat = prevPos[0];
        finalLng = prevPos[1];
      } else {
        // Accuracy-weighted exponential moving average
        const weight = Math.min(1.0, Math.max(0.25, 1 - accuracy / 120));
        finalLat = prevPos[0] + weight * (lat - prevPos[0]);
        finalLng = prevPos[1] + weight * (lng - prevPos[1]);
      }
    }

    // Rule 4: Heading computation
    let finalHeading = hardwareHeading;
    if (prevPos && speed > 0.5) {
      const dist = getDistanceMeters(prevPos[0], prevPos[1], finalLat, finalLng);
      if (dist > 1.5) {
        finalHeading = this.computeBearing(prevPos[0], prevPos[1], finalLat, finalLng);
      }
    }
    if (finalHeading === null || isNaN(finalHeading)) {
      finalHeading = this.state.heading;
    }

    // Determine status
    const status: LocationStatus = accuracy <= 50 ? 'strong' : 'weak';
    const isOutside = !isInsidePalanan(finalLat, finalLng);

    this.lastAcceptedRaw = { lat: finalLat, lng: finalLng, time: now };

    // Persist to localStorage for fast first fix on next app launch
    try {
      localStorage.setItem(
        'saferoute_last_gps_fix',
        JSON.stringify({
          lat: finalLat,
          lng: finalLng,
          accuracy,
          heading: finalHeading,
          speed,
          timestamp: now,
        })
      );
    } catch {}

    this.updateState({
      position: [finalLat, finalLng],
      rawPosition: [lat, lng],
      accuracy,
      heading: finalHeading,
      speed,
      status,
      lastUpdate: now,
      isOutsidePalanan: isOutside,
      isStale: false,
    });
  }

  private computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const y = Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180);
    const x =
      Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
      Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }

  public setSimulatedOverride(pos: [number, number] | null, heading: number | null = null, speed: number | null = null) {
    if (pos) {
      this.simulatedOverride = { pos, heading, speed };
      this.updateState({ isSimulating: true });
    } else {
      this.simulatedOverride = null;
      this.updateState({ isSimulating: false });
    }
  }

  public async getFilteredPosition(): Promise<{
    coords: [number, number];
    accuracy: number;
    status: LocationStatus;
    isOutsidePalanan: boolean;
  }> {
    // If we have a fresh strong or weak fix in memory, return it
    if (this.state.position && (!this.state.isStale || Date.now() - (this.state.lastUpdate || 0) < 20000)) {
      return {
        coords: this.state.position,
        accuracy: this.state.accuracy || 15,
        status: this.state.status,
        isOutsidePalanan: this.state.isOutsidePalanan,
      };
    }

    // Otherwise, perform one-time fetch and feed it through pipeline
    if (Capacitor.isNativePlatform()) {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 3000,
      });
      this.processIncomingFix(pos);
    } else if (navigator.geolocation) {
      await new Promise<void>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.processIncomingFix(pos);
            resolve();
          },
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }
        );
      });
    }

    const state = this.getState();
    const fallbackCoords: [number, number] = state.position || [14.5585, 120.9995];
    return {
      coords: fallbackCoords,
      accuracy: state.accuracy || 20,
      status: state.status,
      isOutsidePalanan: state.isOutsidePalanan,
    };
  }

  private updateState(partial: Partial<LocationState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  // Testing helper: reset singleton for test isolation
  public static __resetForTests() {
    if (LocationTrackerService.instance) {
      LocationTrackerService.instance.stopWatcherInternal();
      LocationTrackerService.instance.listeners.clear();
      LocationTrackerService.instance.watcherStartCount = 0;
      LocationTrackerService.instance.watcherStopCount = 0;
      LocationTrackerService.instance = null as any;
    }
  }
}

export const locationTracker = LocationTrackerService.getInstance();
