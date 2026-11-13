const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiFetch<T>(endpoint: string, options: ApiFetchOptions = {}): Promise<T> {
  const token = localStorage.getItem('pos_auth_token');
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${BASE_URL}${endpoint}`;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const isIdempotent =
    !options.method ||
    options.method.toUpperCase() === 'GET' ||
    options.method.toUpperCase() === 'HEAD';
  const maxRetries = options.retries ?? (isIdempotent ? 2 : 0);

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const callerSignal = options.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener('abort', onCallerAbort);
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (isIdempotent && [502, 503, 504].includes(response.status) && attempt < maxRetries) {
          attempt++;
          const backoffMs = Math.round(500 * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4));
          await sleep(backoffMs);
          continue;
        }

        let errorMsg = `HTTP ${response.status} ${response.statusText}`;
        let errData: unknown;
        try {
          errData = await response.json();
          if (errData && typeof errData === 'object' && 'message' in errData) {
            errorMsg = String((errData as { message: unknown }).message);
          }
        } catch {
          // Non-json response
        }

        if (response.status === 401) {
          localStorage.removeItem('pos_auth_token');
          localStorage.removeItem('pos_user_context');
          window.dispatchEvent(new Event('auth:unauthorized'));
        }

        throw new ApiError(response.status, errorMsg, errData);
      }

      return (await response.json()) as Promise<T>;
    } catch (err) {
      if (callerSignal?.aborted) {
        throw err;
      }

      if (isIdempotent && attempt < maxRetries && !(err instanceof ApiError)) {
        attempt++;
        const backoffMs = Math.round(500 * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4));
        await sleep(backoffMs);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }
}
