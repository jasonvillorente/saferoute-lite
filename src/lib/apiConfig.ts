import { Capacitor } from '@capacitor/core';

/**
 * Returns the base URL for backend API requests.
 *
 * In a packaged mobile app (Capacitor on Android/iOS), the WebView runs locally on
 * `https://localhost` or `capacitor://localhost`. Relative paths such as `/api/directions/ors`
 * would resolve against localhost on the device and fail to reach the cloud backend.
 *
 * Precedence:
 * 1. window.__API_BASE_URL__ / globalThis.__API_BASE_URL__ (runtime configuration override)
 * 2. VITE_API_BASE_URL (build-time environment variable)
 * 3. Capacitor Native: falls back to VITE_APP_URL or deployed backend URL
 * 4. Web Browser: "" (empty string, using relative same-origin requests)
 */
export function getApiBaseUrl(): string {
  const globalObj =
    typeof window !== 'undefined'
      ? window
      : typeof globalThis !== 'undefined'
      ? globalThis
      : undefined;

  if (globalObj && (globalObj as any).__API_BASE_URL__) {
    return (globalObj as any).__API_BASE_URL__.replace(/\/$/, '');
  }

  const envObj =
    typeof import.meta !== 'undefined' && (import.meta as any)?.env
      ? (import.meta as any).env
      : typeof process !== 'undefined' && process.env
      ? process.env
      : {};

  const envBase = envObj.VITE_API_BASE_URL;
  if (envBase && typeof envBase === 'string' && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/$/, '');
  }

  // Packaged Capacitor mobile application on Android/iOS
  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    const appUrl =
      envObj.VITE_APP_URL ||
      envObj.APP_URL ||
      'https://ais-dev-xuza2iymwbnv7auf3yw7yc-62155457241.asia-southeast1.run.app';
    return appUrl.replace(/\/$/, '');
  }

  // Web browser on the deployed origin
  return '';
}

/**
 * Returns a fully-qualified or normalized API URL for the given route path.
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return `${base}${cleanPath}`;
}
