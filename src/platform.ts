import {
  API,
  APIEvent,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { BiocatAccessory } from './biocat-accessory';
import { BiocatClient } from './biocat-client';
import { BiocatPlatformConfig, resolvePlatformConfig, ResolvedBiocatPlatformConfig } from './config';
import { normalizeSnapshot } from './normalizer';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { StatisticsLogger } from './statistics-logger';

export class BiocatPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;

  public readonly Characteristic: typeof Characteristic;

  public readonly accessoryName: string;

  private readonly cachedAccessories = new Map<string, PlatformAccessory>();

  private readonly resolvedConfig: ResolvedBiocatPlatformConfig;

  private readonly client: BiocatClient;

  private readonly statisticsLogger: StatisticsLogger;

  private accessoryHandler?: BiocatAccessory;

  private pollTimer?: NodeJS.Timeout;

  private pollInFlight?: Promise<void>;

  private actionInFlight?: Promise<void>;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    const typedConfig = config as BiocatPlatformConfig;
    this.resolvedConfig = resolvePlatformConfig(typedConfig);
    this.accessoryName = this.resolvedConfig.name;
    this.client = new BiocatClient(this.resolvedConfig);
    this.statisticsLogger = new StatisticsLogger(
      this.api.user.storagePath(),
      this.log,
      this.resolvedConfig.statistics,
    );

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      void this.startPlatform();
    });

    this.log.debug(`Finished initializing platform: ${PLUGIN_NAME}`);
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  async setAbsenceMode(enabled: boolean): Promise<void> {
    await this.runAction(
      enabled ? 'enable absence mode' : 'disable absence mode',
      async () => this.client.setAbsenceMode(enabled),
    );
  }

  async setWaterSupplyOpen(open: boolean): Promise<void> {
    if (open && !this.resolvedConfig.allowWaterSupplyOpen) {
      throw new Error('The BIOCAT Reopen Water Supply command is disabled. Set allowWaterSupplyOpen=true to enable it.');
    }

    await this.runAction(
      open ? 'open water supply' : 'close water supply',
      async () => this.client.setWaterSupplyOpen(open),
    );
  }

  private async startPlatform(): Promise<void> {
    if (!this.resolvedConfig.apiKey) {
      this.log.warn('BIOCAT apiKey is missing. The platform will stay idle until it is configured.');
      return;
    }

    const mainAccessory = this.ensureAccessory('main', this.accessoryName);
    const shutoffAccessory = this.ensureAccessory('water-shutoff', `${this.accessoryName} Emergency Shutoff`);
    const reopenAccessory = this.resolvedConfig.allowWaterSupplyOpen
      ? this.ensureAccessory('water-reopen', `${this.accessoryName} Reopen Water Supply`)
      : undefined;

    this.unregisterStaleAccessories(new Set([
      mainAccessory.UUID,
      shutoffAccessory.UUID,
      ...(reopenAccessory ? [reopenAccessory.UUID] : []),
    ]));

    this.accessoryHandler = new BiocatAccessory(this, mainAccessory, shutoffAccessory, reopenAccessory);
    await this.statisticsLogger.initialize();
    await this.refreshDeviceState();
    this.startPolling();
  }

  private ensureAccessory(accessoryType: 'main' | 'water-shutoff' | 'water-reopen', displayName: string): PlatformAccessory {
    const uuidSeed = accessoryType === 'main'
      ? `${PLATFORM_NAME}:${this.resolvedConfig.apiBaseUrl}:${this.accessoryName}`
      : `${PLATFORM_NAME}:${this.resolvedConfig.apiBaseUrl}:${this.accessoryName}:${accessoryType}`;
    const uuid = this.api.hap.uuid.generate(uuidSeed);
    const existingAccessory = this.cachedAccessories.get(uuid);

    if (existingAccessory) {
      return existingAccessory;
    }

    const accessory = new this.api.platformAccessory(displayName, uuid);
    accessory.context.deviceId = uuid;
    accessory.context.accessoryType = accessoryType;
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.cachedAccessories.set(uuid, accessory);

    return accessory;
  }

  private unregisterStaleAccessories(desiredUuids: Set<string>): void {
    for (const [cachedUuid, cachedAccessory] of this.cachedAccessories.entries()) {
      if (desiredUuids.has(cachedUuid)) {
        continue;
      }

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
      this.cachedAccessories.delete(cachedUuid);
    }
  }

  private startPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(() => {
      void this.refreshDeviceState();
    }, this.resolvedConfig.pollIntervalSeconds * 1_000);
  }

  private async refreshDeviceState(): Promise<void> {
    if (this.actionInFlight) {
      await this.actionInFlight;
      return;
    }

    if (this.pollInFlight) {
      return this.pollInFlight;
    }

    this.pollInFlight = this.refreshDeviceStateInternal().finally(() => {
      this.pollInFlight = undefined;
    });

    return this.pollInFlight;
  }

  private async refreshDeviceStateInternal(): Promise<void> {
    try {
      const statePayload = await this.client.fetchState();

      let statisticsPayload: unknown | null = null;
      if (this.resolvedConfig.statistics.enabled) {
        try {
          statisticsPayload = await this.client.fetchDailyStatistics();
        } catch (error) {
          this.log.warn(`Unable to refresh BIOCAT statistics: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const snapshot = normalizeSnapshot(
        {
          state: statePayload,
          statistics: statisticsPayload,
        },
        this.accessoryName,
        this.api.hap.uuid.generate(`${this.resolvedConfig.apiBaseUrl}:${this.accessoryName}`),
      );

      if (!this.accessoryHandler) {
        const mainAccessory = this.ensureAccessory('main', this.accessoryName);
        const shutoffAccessory = this.ensureAccessory('water-shutoff', `${this.accessoryName} Emergency Shutoff`);
        const reopenAccessory = this.resolvedConfig.allowWaterSupplyOpen
          ? this.ensureAccessory('water-reopen', `${this.accessoryName} Reopen Water Supply`)
          : undefined;

        this.accessoryHandler = new BiocatAccessory(this, mainAccessory, shutoffAccessory, reopenAccessory);
      }

      this.accessoryHandler.update(snapshot);
      await this.statisticsLogger.appendIfNeeded(snapshot);

      this.log.debug(
        `Updated BIOCAT state: online=${snapshot.online}, mode=${snapshot.modeId ?? 'n/a'}, absence=${snapshot.waterProtection.absenceModeEnabled}, ` +
        `leakDetected=${snapshot.waterProtection.leakDetected}, valveClosed=${snapshot.waterProtection.valveClosed}, statisticsDate=${snapshot.statistics?.logDate ?? 'n/a'}`,
      );
    } catch (error) {
      this.log.error(`Unable to refresh BIOCAT state: ${error instanceof Error ? error.message : String(error)}`);
      this.accessoryHandler?.markConnectionFault();
    }
  }

  private async runAction(
    actionLabel: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.actionInFlight) {
      return this.actionInFlight;
    }

    this.actionInFlight = this.runActionInternal(actionLabel, action).finally(() => {
      this.actionInFlight = undefined;
    });

    return this.actionInFlight;
  }

  private async runActionInternal(
    actionLabel: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.pollInFlight) {
      await this.pollInFlight;
    }

    await action();
    this.log.info(`BIOCAT command completed: ${actionLabel}`);
    await this.refreshDeviceStateInternal();
  }
}
