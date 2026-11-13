export interface MapTileConfig {
  lightUrl: string;
  darkUrl: string;
  lightAttribution: string;
  darkAttribution: string;
  attribution: string;
  fallbackUrl: string;
  fallbackAttribution: string;
  isUsingCartoLight: boolean;
  isUsingCartoDark: boolean;
  isUsingOsmDefault: boolean;
  maxNativeZoom: number;
  maxZoom: number;
  detectRetina: false;
  tileSize: number;
  keepBuffer: number;
  lightBackgroundColor: string;
  darkBackgroundColor: string;
}

export interface TileEnvLike {
  VITE_CARTO_API_KEY?: string;
  VITE_TILE_URL_LIGHT?: string;
  VITE_TILE_URL_DARK?: string;
}

export const OSM_STANDARD_URL =
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const DEFAULT_CARTO_LIGHT_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

export const DEFAULT_CARTO_DARK_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export const CARTO_OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const MAX_CONSECUTIVE_TILE_ERRORS = 3;

function appendCartoApiKey(url: string, apiKey: string): string {
  if (!apiKey) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}key=${encodeURIComponent(apiKey)}`;
}

export function isCartoUrl(url: string): boolean {
  return url.includes('cartocdn.com');
}

export function isOsmStandardUrl(url: string): boolean {
  return url.includes('tile.openstreetmap.org');
}

/**
 * Strips any API key query parameter before logging or displaying diagnostics.
 */
export function redactTileUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]+/gi, '$1REDACTED');
}

export function buildMapTileConfig(
  env: TileEnvLike = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
): MapTileConfig {
  const apiKey = typeof env.VITE_CARTO_API_KEY === 'string' ? env.VITE_CARTO_API_KEY.trim() : '';
  const customLight =
    typeof env.VITE_TILE_URL_LIGHT === 'string' ? env.VITE_TILE_URL_LIGHT.trim() : '';
  const customDark =
    typeof env.VITE_TILE_URL_DARK === 'string' ? env.VITE_TILE_URL_DARK.trim() : '';

  const hasCartoKey = apiKey.length > 0;

  const lightUrl = customLight
    ? customLight
    : hasCartoKey
    ? appendCartoApiKey(DEFAULT_CARTO_LIGHT_URL, apiKey)
    : OSM_STANDARD_URL;

  const darkUrl = customDark
    ? customDark
    : hasCartoKey
    ? appendCartoApiKey(DEFAULT_CARTO_DARK_URL, apiKey)
    : OSM_STANDARD_URL;

  const isUsingCartoLight = isCartoUrl(lightUrl);
  const isUsingCartoDark = isCartoUrl(darkUrl);

  const lightAttribution = isUsingCartoLight ? CARTO_OSM_ATTRIBUTION : OSM_ATTRIBUTION;
  const darkAttribution = isUsingCartoDark ? CARTO_OSM_ATTRIBUTION : OSM_ATTRIBUTION;

  return {
    lightUrl,
    darkUrl,
    lightAttribution,
    darkAttribution,
    attribution: hasCartoKey || isUsingCartoLight || isUsingCartoDark ? CARTO_OSM_ATTRIBUTION : OSM_ATTRIBUTION,
    fallbackUrl: OSM_STANDARD_URL,
    fallbackAttribution: OSM_ATTRIBUTION,
    isUsingCartoLight,
    isUsingCartoDark,
    isUsingOsmDefault: !hasCartoKey && !customLight && !customDark,
    maxNativeZoom: 19,
    maxZoom: 20,
    detectRetina: false, // CARTO URLs use {r} directly; setting detectRetina true would double-request tiles
    tileSize: 256,
    keepBuffer: 4,
    lightBackgroundColor: '#f8fafc',
    darkBackgroundColor: '#0f172a',
  };
}

export const MAP_TILE_CONFIG: MapTileConfig = buildMapTileConfig();

export function getTileUrl(
  darkMode: boolean,
  config: MapTileConfig = MAP_TILE_CONFIG,
  useFallback: boolean = false
): string {
  if (useFallback) return config.fallbackUrl;
  return darkMode ? config.darkUrl : config.lightUrl;
}

export function getTileAttribution(
  darkMode: boolean,
  config: MapTileConfig = MAP_TILE_CONFIG,
  useFallback: boolean = false
): string {
  if (useFallback) return config.fallbackAttribution;
  return darkMode ? config.darkAttribution : config.lightAttribution;
}

/**
 * Checks whether a loaded CARTO tile appears to be CARTO's "API KEY REQUIRED" watermark.
 * - On Retina (@2x) requests, CARTO returns the watermark as 256x256 instead of 512x512.
 * - When canvas pixel inspection is available on CORS-enabled tiles, genuine basemap tiles
 *   are 100% opaque while the watermark PNG uses transparent pixels around diagonal text.
 */
export function detectCartoWatermarkTile(tile: {
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  hasTransparentPixels?: boolean;
}): boolean {
  const src = tile.src || '';
  if (!isCartoUrl(src)) return false;

  if (src.includes('@2x') && tile.naturalWidth === 256 && tile.naturalHeight === 256) {
    return true;
  }

  if (tile.hasTransparentPixels === true) {
    return true;
  }

  return false;
}

export interface TileLoadEventInfo {
  src?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  hasTransparentPixels?: boolean;
  isWatermark?: boolean;
}

export type TileFallbackReason = 'none' | 'error_threshold' | 'watermark';

/**
 * Pure controller tracking consecutive tile errors and watermark detection
 * to fail over safely from CARTO/custom URLs to OpenStreetMap standard tiles.
 */
export class TileFallbackController {
  private consecutiveErrors = 0;
  private fallbackActive = false;
  private reason: TileFallbackReason = 'none';
  private readonly errorThreshold: number;

  constructor(errorThreshold: number = MAX_CONSECUTIVE_TILE_ERRORS) {
    this.errorThreshold = errorThreshold;
  }

  public isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  public getConsecutiveErrors(): number {
    return this.consecutiveErrors;
  }

  public getReason(): TileFallbackReason {
    return this.reason;
  }

  public recordTileError(): boolean {
    if (this.fallbackActive) return true;
    this.consecutiveErrors += 1;
    if (this.consecutiveErrors >= this.errorThreshold) {
      this.fallbackActive = true;
      this.reason = 'error_threshold';
    }
    return this.fallbackActive;
  }

  public recordTileLoad(info: TileLoadEventInfo): boolean {
    if (this.fallbackActive) return true;

    const isWatermark = info.isWatermark === true || detectCartoWatermarkTile(info);
    if (isWatermark) {
      this.fallbackActive = true;
      this.reason = 'watermark';
      return true;
    }

    this.consecutiveErrors = 0;
    return false;
  }

  public reset(): void {
    this.consecutiveErrors = 0;
    this.fallbackActive = false;
    this.reason = 'none';
  }
}
