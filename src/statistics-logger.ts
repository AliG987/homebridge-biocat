import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from 'homebridge';

import { ResolvedStatisticsLoggingConfig } from './config';
import { NormalizedBiocatSnapshot } from './normalizer';

interface StatisticsState {
  lastLoggedDate?: string;
  lastEntryFingerprint?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    const segments = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${segments.join(',')}}`;
  }

  const serialized = JSON.stringify(value);
  return serialized ?? 'undefined';
}

function isJsonObject(value: string): value is string {
  return value.trim().startsWith('{');
}

export class StatisticsLogger {
  private initialized = false;

  private state: StatisticsState = {};

  constructor(
    private readonly storagePath: string,
    private readonly log: Logger,
    private readonly config: ResolvedStatisticsLoggingConfig,
  ) {}

  private get directoryPath(): string {
    return path.join(this.storagePath, this.config.directory);
  }

  private get logFilePath(): string {
    return path.join(this.directoryPath, this.config.fileName);
  }

  private get stateFilePath(): string {
    return path.join(this.directoryPath, this.config.stateFileName);
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.config.enabled) {
      this.initialized = true;
      return;
    }

    await fs.mkdir(this.directoryPath, { recursive: true });
    await this.loadState();
    this.initialized = true;
  }

  async appendIfNeeded(snapshot: NormalizedBiocatSnapshot): Promise<void> {
    if (!this.config.enabled || !snapshot.statistics) {
      return;
    }

    await this.initialize();

    const entry = {
      loggedAt: new Date().toISOString(),
      entryDate: snapshot.statistics.logDate,
      accessoryId: snapshot.accessoryId,
      serialNumber: snapshot.serialNumber,
      name: snapshot.name,
      model: snapshot.model,
      firmwareVersion: snapshot.firmwareVersion,
      refreshedAt: snapshot.refreshedAt,
      online: snapshot.online,
      modeId: snapshot.modeId,
      modeName: snapshot.modeName,
      microLeakageState: snapshot.microLeakageState,
      event: {
        severity: snapshot.event.severity,
        isActive: snapshot.event.isActive,
        title: snapshot.event.title,
        message: snapshot.event.message,
        code: snapshot.event.code,
        occurredAt: snapshot.event.occurredAt,
      },
      waterProtection: {
        absenceModeEnabled: snapshot.waterProtection.absenceModeEnabled,
        pauseLeakageProtectionUntil: snapshot.waterProtection.pauseLeakageProtectionUntil,
        leakageProtectionPaused: snapshot.waterProtection.leakageProtectionPaused,
        leakDetected: snapshot.waterProtection.leakDetected,
        valveClosed: snapshot.waterProtection.valveClosed,
        protectionActive: snapshot.waterProtection.protectionActive,
        warningActive: snapshot.waterProtection.warningActive,
        faultActive: snapshot.waterProtection.faultActive,
      },
      maintenance: {
        changeRequired: snapshot.maintenance.changeRequired,
        filterLifeLevel: snapshot.maintenance.filterLifeLevel,
        nextServiceDate: snapshot.maintenance.nextServiceDate,
      },
      statistics: snapshot.statistics.raw,
    };

    const fingerprint = crypto
      .createHash('sha256')
      .update(stableSerialize(entry))
      .digest('hex');

    if (
      this.state.lastLoggedDate === snapshot.statistics.logDate ||
      this.state.lastEntryFingerprint === fingerprint
    ) {
      return;
    }

    await fs.appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });

    this.state = {
      lastLoggedDate: snapshot.statistics.logDate,
      lastEntryFingerprint: fingerprint,
    };

    await fs.writeFile(this.stateFilePath, JSON.stringify(this.state, null, 2), { encoding: 'utf8' });
  }

  private async loadState(): Promise<void> {
    try {
      const rawState = await fs.readFile(this.stateFilePath, 'utf8');
      const parsed = JSON.parse(rawState) as unknown;

      if (isRecord(parsed)) {
        this.state = {
          lastLoggedDate: typeof parsed.lastLoggedDate === 'string' ? parsed.lastLoggedDate : undefined,
          lastEntryFingerprint: typeof parsed.lastEntryFingerprint === 'string' ? parsed.lastEntryFingerprint : undefined,
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.warn(`Unable to read BIOCAT statistics state: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!this.state.lastLoggedDate || !this.state.lastEntryFingerprint) {
      await this.restoreStateFromLogFile();
    }
  }

  private async restoreStateFromLogFile(): Promise<void> {
    try {
      const content = await fs.readFile(this.logFilePath, 'utf8');
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && isJsonObject(line));

      const lastLine = lines.at(-1);
      if (!lastLine) {
        return;
      }

      const parsed = JSON.parse(lastLine) as unknown;
      if (!isRecord(parsed)) {
        return;
      }

      const entryDate = typeof parsed.entryDate === 'string' ? parsed.entryDate : undefined;
      if (!entryDate) {
        return;
      }

      this.state = {
        lastLoggedDate: entryDate,
        lastEntryFingerprint: crypto.createHash('sha256').update(stableSerialize(parsed)).digest('hex'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log.warn(`Unable to restore BIOCAT statistics state from JSONL log: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
