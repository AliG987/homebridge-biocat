import { ResolvedBiocatPlatformConfig } from './config';

class BiocatApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BiocatApiError';
  }
}

type QueryValue = string | number | boolean | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatErrorCause(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const details: string[] = [];
  for (const key of ['code', 'errno', 'syscall', 'hostname']) {
    const value = error[key];
    if (typeof value === 'string' || typeof value === 'number') {
      details.push(`${key}=${value}`);
    }
  }

  const message = error.message;
  if (typeof message === 'string' && message.trim() !== '') {
    details.push(`cause=${message}`);
  }

  return details.length > 0 ? details.join(', ') : undefined;
}

function formatRequestFailure(error: unknown, url: URL, timeoutMs: number): Error {
  if (error instanceof Error && error.name === 'AbortError') {
    return new Error(`BIOCAT request timed out after ${timeoutMs}ms for ${url.toString()}.`);
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? formatErrorCause(error.cause) : undefined;
  const suffix = cause ? ` (${cause})` : '';

  return new Error(`BIOCAT request failed for ${url.toString()}: ${message}${suffix}`);
}

export class BiocatClient {
  constructor(private readonly config: ResolvedBiocatPlatformConfig) {}

  async fetchState(): Promise<unknown> {
    return this.getJson('/state');
  }

  async fetchDailyStatistics(): Promise<unknown | null> {
    try {
      return await this.getJson('/statistics/daily/direct');
    } catch (error) {
      if (!(error instanceof BiocatApiError) || error.status !== 400) {
        throw error;
      }
    }

    const dailyConsumption = await this.getJson('/statistics/cumulative/daily');

    return {
      type: 'statistics',
      entries: [
        {
          consumption: typeof dailyConsumption === 'number' ? dailyConsumption : Number(dailyConsumption),
          date: new Date().toISOString(),
        },
      ],
    };
  }

  async setAbsenceMode(enabled: boolean): Promise<void> {
    await this.invokeCommand(enabled ? '/absence/enable' : '/absence/disable');
  }

  async setWaterSupplyOpen(open: boolean): Promise<void> {
    await this.invokeCommand(open ? '/watersupply/open' : '/watersupply/close');
  }

  private async invokeCommand(path: string): Promise<void> {
    await this.request(path);
  }

  private async getJson(path: string, query?: Record<string, QueryValue>): Promise<unknown> {
    const responseText = await this.request(path, query);

    if (responseText.trim() === '') {
      throw new Error(`BIOCAT response was empty for ${path}.`);
    }

    try {
      return JSON.parse(responseText) as unknown;
    } catch (error) {
      throw new Error(`BIOCAT response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async request(path: string, query?: Record<string, QueryValue>): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('No BIOCAT apiKey configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const headers = new Headers(this.config.headers);
      headers.set('Accept', 'application/json');
      headers.set('X-API-KEY', this.config.apiKey);

      const url = new URL(path.replace(/^\//, ''), `${this.config.apiBaseUrl}/`);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value === undefined) {
            continue;
          }

          url.searchParams.set(key, String(value));
        }
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
      } catch (error) {
        throw formatRequestFailure(error, url, this.config.requestTimeoutMs);
      }

      const responseText = await response.text();
      if (!response.ok) {
        throw new BiocatApiError(
          `BIOCAT request failed for ${path} with HTTP ${response.status} ${response.statusText}`,
          response.status,
        );
      }

      return responseText;
    } finally {
      clearTimeout(timeout);
    }
  }
}
