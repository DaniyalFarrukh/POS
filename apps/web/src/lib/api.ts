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

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('pos_auth_token');
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
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

  return response.json() as Promise<T>;
}
