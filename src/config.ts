import path from 'node:path';
import { PlatformConfig } from 'homebridge';

import {
  DEFAULT_API_BASE_URL,
  DEFAULT_LOG_DIRECTORY,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STATISTICS_FILE_NAME,
  DEFAULT_STATISTICS_STATE_FILE_NAME,
} from './settings';

export interface StatisticsLoggingConfig {
  enabled?: boolean;
  directory?: string;
  fileName?: string;
  stateFileName?: string;
}

export interface BiocatPlatformConfig extends PlatformConfig {
  name?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  allowWaterSupplyOpen?: boolean;
  authToken?: string;
  statusUrl?: string;
  headers?: Record<string, unknown>;
  pollIntervalSeconds?: number;
  requestTimeoutMs?: number;
  statistics?: StatisticsLoggingConfig;
}

export interface ResolvedStatisticsLoggingConfig {
  enabled: boolean;
  directory: string;
  fileName: string;
  stateFileName: string;
}

export interface ResolvedBiocatPlatformConfig {
  name: string;
  apiBaseUrl: string;
  apiKey?: string;
  allowWaterSupplyOpen: boolean;
  headers: Record<string, string>;
  pollIntervalSeconds: number;
  requestTimeoutMs: number;
  statistics: ResolvedStatisticsLoggingConfig;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.min(max, Math.max(min, Math.round(parsed)));
    }
  }

  return fallback;
}

function sanitizeRelativeDirectory(input: unknown, fallback: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    return fallback;
  }

  const normalized = path
    .normalize(input.trim())
    .replace(/^([/\\])+/, '')
    .replace(/^(\.\.(\/|\\|$))+/, '');

  if (normalized === '' || normalized === '.') {
    return fallback;
  }

  return normalized;
}

function sanitizeFileName(input: unknown, fallback: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    return fallback;
  }

  const sanitized = path.basename(input.trim());
  return sanitized === '' || sanitized === '.' ? fallback : sanitized;
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string' || key.trim() === '') {
      continue;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      normalized[key] = value;
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      normalized[key] = String(value);
    }
  }

  return normalized;
}

function normalizeApiBaseUrl(apiBaseUrl: unknown, statusUrl: unknown): string {
  const configuredValue = typeof apiBaseUrl === 'string' && apiBaseUrl.trim() !== ''
    ? apiBaseUrl.trim()
    : typeof statusUrl === 'string' && statusUrl.trim() !== ''
      ? statusUrl.trim()
      : DEFAULT_API_BASE_URL;

  const trimmed = configuredValue.replace(/\/+$/, '');
  return trimmed.endsWith('/state') ? trimmed.slice(0, -'/state'.length) : trimmed;
}

export function resolvePlatformConfig(config: BiocatPlatformConfig): ResolvedBiocatPlatformConfig {
  return {
    name: typeof config.name === 'string' && config.name.trim() !== '' ? config.name.trim() : 'BIOCAT',
    apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl, config.statusUrl),
    apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() !== ''
      ? config.apiKey.trim()
      : typeof config.authToken === 'string' && config.authToken.trim() !== ''
        ? config.authToken.trim()
        : undefined,
    allowWaterSupplyOpen: config.allowWaterSupplyOpen ?? false,
    headers: normalizeHeaders(config.headers),
    pollIntervalSeconds: clampInt(config.pollIntervalSeconds, DEFAULT_POLL_INTERVAL_SECONDS, 15, 86_400),
    requestTimeoutMs: clampInt(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 1_000, 120_000),
    statistics: {
      enabled: config.statistics?.enabled ?? true,
      directory: sanitizeRelativeDirectory(config.statistics?.directory, DEFAULT_LOG_DIRECTORY),
      fileName: sanitizeFileName(config.statistics?.fileName, DEFAULT_STATISTICS_FILE_NAME),
      stateFileName: sanitizeFileName(config.statistics?.stateFileName, DEFAULT_STATISTICS_STATE_FILE_NAME),
    },
  };
}
