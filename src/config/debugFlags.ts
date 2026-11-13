/**
 * Runtime debug feature flags for map diagnostics (coordinate crosshair & off-route telemetry HUD).
 * Strictly disabled in production builds (env.PROD === true).
 */
export interface DebugEnvLike {
  PROD?: boolean;
  DEV?: boolean;
  VITE_MAP_DEBUG?: string;
}

export function isMapDebugEnabled(
  env: DebugEnvLike = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
): boolean {
  if (env.PROD) {
    return false;
  }
  if (env.VITE_MAP_DEBUG === 'false') {
    return false;
  }
  if (env.VITE_MAP_DEBUG === 'true') {
    return true;
  }
  return Boolean(env.DEV);
}
