import { Capacitor } from '@capacitor/core';

export interface ApiConfigOptions {
  isNative?: boolean;
}

export interface ApiHealthResult {
  ok: boolean;
  reason: 'ok' | 'not_configured' | 'redirect' | 'non_json' | 'http_error' | 'timeout' | 'cors_or_network';
  status?: number;
  detail?: string;
  checkedAt: number;
}

let cachedHealthResult: ApiHealthResult | null = null;
let inflightHealthCheck: Promise<ApiHealthResult> | null = null;

function readEnvObject(): Record<string, any> {
  if (typeof import.meta !== 'undefined' && (import.meta as any)?.env) {
    return (import.meta as any).env;
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env;
  }
  return {};
}

function readGlobalOverride(): string | null {
  const globalObj =
    typeof window !== 'undefined'
      ? window
      : typeof globalThis !== 'undefined'
      ? globalThis
      : undefined;

  const raw = globalObj ? (globalObj as any).__API_BASE_URL__ : undefined;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim().replace(/\/$/, '');
  }
  return null;
}

function resolveIsNative(options?: ApiConfigOptions): boolean {
  if (options?.isNative !== undefined) {
    return options.isNative;
  }
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

/**
 * Returns the configured API base URL (runtime override or VITE_API_BASE_URL).
 * For packaged native builds (Capacitor) without either configured, returns "".
 * No hardcoded preview URL fallback is included.
 */
export function getApiBaseUrl(options?: ApiConfigOptions): string {
  const override = readGlobalOverride();
  if (override) {
    return override;
  }

  const envObj = readEnvObject();
  const envBase = envObj.VITE_API_BASE_URL;
  if (typeof envBase === 'string' && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/$/, '');
  }

  return '';
}

/**
 * True on Capacitor native builds when neither window.__API_BASE_URL__ nor VITE_API_BASE_URL is set.
 */
export function isNativeMissingApiBaseUrl(options?: ApiConfigOptions): boolean {
  if (!resolveIsNative(options)) {
    return false;
  }
  return getApiBaseUrl(options).length === 0;
}

/**
 * Returns a fully-qualified or normalized API URL for the given route path.
 */
export function getApiUrl(path: string, options?: ApiConfigOptions): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl(options);
  return `${base}${cleanPath}`;
}

export function getCachedApiHealth(): ApiHealthResult | null {
  return cachedHealthResult;
}

export function clearApiHealthCache(): void {
  cachedHealthResult = null;
  inflightHealthCheck = null;
}

/**
 * Runs a single GET /api/health self-check (5s default timeout) and caches the result
 * for the session. Detects unconfigured native base URL, non-JSON responses,
 * auth/cookie redirects (302 / __cookie_check), HTTP errors, timeouts, and CORS failures.
 */
export async function checkApiHealth(options?: {
  timeoutMs?: number;
  forceRefresh?: boolean;
  fetchFn?: typeof fetch;
  isNative?: boolean;
}): Promise<ApiHealthResult> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const forceRefresh = options?.forceRefresh ?? false;
  const customEnvTest = options?.fetchFn !== undefined || options?.isNative !== undefined;

  if (!forceRefresh && !customEnvTest) {
    if (cachedHealthResult) {
      return cachedHealthResult;
    }
    if (inflightHealthCheck) {
      return inflightHealthCheck;
    }
  }

  const runCheck = async (): Promise<ApiHealthResult> => {
    if (isNativeMissingApiBaseUrl({ isNative: options?.isNative })) {
      const res: ApiHealthResult = {
        ok: false,
        reason: 'not_configured',
        detail: 'VITE_API_BASE_URL is not configured for native build.',
        checkedAt: Date.now()
      };
      cachedHealthResult = res;
      return res;
    }

    const activeFetch = options?.fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);
    if (!activeFetch) {
      const res: ApiHealthResult = {
        ok: false,
        reason: 'cors_or_network',
        detail: 'Fetch API is unavailable.',
        checkedAt: Date.now()
      };
      cachedHealthResult = res;
      return res;
    }

    const url = getApiUrl('/api/health', { isNative: options?.isNative });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await activeFetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal
      });
      clearTimeout(timer);

      if (
        response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400) ||
        response.redirected ||
        (typeof response.url === 'string' && response.url.includes('__cookie_check'))
      ) {
        const res: ApiHealthResult = {
          ok: false,
          reason: 'redirect',
          status: response.status || 302,
          detail: 'Service redirected (possible auth gate or __cookie_check).',
          checkedAt: Date.now()
        };
        cachedHealthResult = res;
        return res;
      }

      if (!response.ok) {
        const res: ApiHealthResult = {
          ok: false,
          reason: 'http_error',
          status: response.status,
          detail: `HTTP ${response.status}`,
          checkedAt: Date.now()
        };
        cachedHealthResult = res;
        return res;
      }

      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType && !contentType.toLowerCase().includes('application/json')) {
        const res: ApiHealthResult = {
          ok: false,
          reason: 'non_json',
          status: response.status,
          detail: `Unexpected content-type: ${contentType}`,
          checkedAt: Date.now()
        };
        cachedHealthResult = res;
        return res;
      }

      const rawText = typeof response.text === 'function'
        ? await response.text()
        : JSON.stringify(await response.json());
      const trimmed = (rawText || '').trim();
      if (!trimmed || trimmed.startsWith('<')) {
        const res: ApiHealthResult = {
          ok: false,
          reason: 'non_json',
          status: response.status,
          detail: 'Response body is HTML or empty instead of JSON.',
          checkedAt: Date.now()
        };
        cachedHealthResult = res;
        return res;
      }

      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') {
        const res: ApiHealthResult = {
          ok: false,
          reason: 'non_json',
          status: response.status,
          detail: 'Invalid JSON payload.',
          checkedAt: Date.now()
        };
        cachedHealthResult = res;
        return res;
      }

      const okRes: ApiHealthResult = {
        ok: true,
        reason: 'ok',
        status: response.status,
        checkedAt: Date.now()
      };
      cachedHealthResult = okRes;
      return okRes;
    } catch (err: any) {
      clearTimeout(timer);
      const isAbort = err?.name === 'AbortError';
      const res: ApiHealthResult = {
        ok: false,
        reason: isAbort ? 'timeout' : 'cors_or_network',
        detail: isAbort ? 'Health check timed out.' : 'CORS or network failure.',
        checkedAt: Date.now()
      };
      cachedHealthResult = res;
      return res;
    }
  };

  if (!customEnvTest) {
    inflightHealthCheck = runCheck().finally(() => {
      inflightHealthCheck = null;
    });
    return inflightHealthCheck;
  }

  return runCheck();
}
