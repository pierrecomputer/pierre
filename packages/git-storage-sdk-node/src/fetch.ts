import { errorEnvelopeSchema } from './schemas';
import type { ValidAPIVersion, ValidMethod, ValidPath } from './types';
import { getUserAgent } from './version';

interface RequestOptions {
  allowedStatus?: number[];
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly method: ValidMethod;
  public readonly url: string;
  public readonly body?: unknown;

  constructor(params: {
    message: string;
    status: number;
    statusText: string;
    method: ValidMethod;
    url: string;
    body?: unknown;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.statusText = params.statusText;
    this.method = params.method;
    this.url = params.url;
    this.body = params.body;
  }
}

export class ApiFetcher {
  constructor(
    private readonly API_BASE_URL: string,
    private readonly version: ValidAPIVersion
  ) {}

  private getBaseUrl() {
    return `${this.API_BASE_URL}/api/v${this.version}`;
  }

  private getRequestUrl(path: ValidPath) {
    if (typeof path === 'string') {
      return `${this.getBaseUrl()}/${path}`;
    } else if (path.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(path.params)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            searchParams.append(key, v);
          }
        } else {
          searchParams.append(key, value);
        }
      }
      const paramStr = searchParams.toString();
      return `${this.getBaseUrl()}/${path.path}${paramStr ? `?${paramStr}` : ''}`;
    } else {
      return `${this.getBaseUrl()}/${path.path}`;
    }
  }

  private async fetch(
    path: ValidPath,
    method: ValidMethod,
    jwt: string,
    options?: RequestOptions
  ) {
    const requestUrl = this.getRequestUrl(path);

    const requestOptions: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'Code-Storage-Agent': getUserAgent(),
      },
    };

    if (method !== 'GET' && typeof path !== 'string' && path.body) {
      requestOptions.body = JSON.stringify(path.body);
    }

    const response = await fetch(requestUrl, requestOptions);

    if (!response.ok) {
      const allowed = options?.allowedStatus ?? [];
      if (allowed.includes(response.status)) {
        return response;
      }

      let errorBody: unknown;
      let message: string | undefined;
      const contentType = response.headers.get('content-type') ?? '';

      try {
        if (contentType.includes('application/json')) {
          errorBody = await response.json();
        } else {
          const text = await response.text();
          errorBody = text;
        }
      } catch {
        // Fallback to plain text if JSON parse failed after reading body
        try {
          errorBody = await response.text();
        } catch {
          errorBody = undefined;
        }
      }

      if (typeof errorBody === 'string') {
        const trimmed = errorBody.trim();
        if (trimmed) {
          message = trimmed;
        }
      } else if (errorBody && typeof errorBody === 'object') {
        const parsedError = errorEnvelopeSchema.safeParse(errorBody);
        if (parsedError.success) {
          const trimmed = parsedError.data.error.trim();
          if (trimmed) {
            message = trimmed;
          }
        }
      }

      throw new ApiError({
        message:
          message ??
          `Request ${method} ${requestUrl} failed with status ${response.status} ${response.statusText}`,
        status: response.status,
        statusText: response.statusText,
        method,
        url: requestUrl,
        body: errorBody,
      });
    }
    return response;
  }

  async get(path: ValidPath, jwt: string, options?: RequestOptions) {
    return this.fetch(path, 'GET', jwt, options);
  }

  async post(path: ValidPath, jwt: string, options?: RequestOptions) {
    return this.fetch(path, 'POST', jwt, options);
  }

  async put(path: ValidPath, jwt: string, options?: RequestOptions) {
    return this.fetch(path, 'PUT', jwt, options);
  }

  async delete(path: ValidPath, jwt: string, options?: RequestOptions) {
    return this.fetch(path, 'DELETE', jwt, options);
  }
}
