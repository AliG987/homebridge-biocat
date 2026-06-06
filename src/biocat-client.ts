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

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

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
