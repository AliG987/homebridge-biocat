import { PlatformAccessory, Service } from 'homebridge';

import { NormalizedBiocatSnapshot } from './normalizer';
import { BiocatPlatform } from './platform';

export class BiocatAccessory {
  private readonly informationService: Service;

  private readonly leakSensorService: Service;

  private readonly waterSupplyValveService: Service;

  private readonly absenceSwitchService: Service;

  private readonly maintenanceService: Service;

  private readonly shutoffInformationService: Service;

  private readonly shutoffSwitchService: Service;

  private readonly reopenInformationService?: Service;

  private readonly reopenSwitchService?: Service;

  private currentSnapshot?: NormalizedBiocatSnapshot;

  constructor(
    private readonly platform: BiocatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly shutoffAccessory: PlatformAccessory,
    private readonly reopenAccessory?: PlatformAccessory,
  ) {
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.accessory.addService(this.platform.Service.AccessoryInformation);

    this.leakSensorService = this.accessory.getServiceById(this.platform.Service.LeakSensor, 'leak-sensor')
      ?? this.accessory.addService(this.platform.Service.LeakSensor, `${this.platform.accessoryName} Leak Protection`, 'leak-sensor');

    const legacyContactSensorService = this.accessory.getServiceById(this.platform.Service.ContactSensor, 'water-supply-status');
    if (legacyContactSensorService) {
      this.accessory.removeService(legacyContactSensorService);
    }

    this.waterSupplyValveService = this.accessory.getServiceById(this.platform.Service.Valve, 'water-supply')
      ?? this.accessory.addService(this.platform.Service.Valve, `${this.platform.accessoryName} Water Supply`, 'water-supply');

    this.absenceSwitchService = this.accessory.getServiceById(this.platform.Service.Switch, 'absence-mode')
      ?? this.accessory.addService(this.platform.Service.Switch, `${this.platform.accessoryName} Absence Mode`, 'absence-mode');

    this.maintenanceService = this.accessory.getServiceById(this.platform.Service.FilterMaintenance, 'maintenance')
      ?? this.accessory.addService(this.platform.Service.FilterMaintenance, `${this.platform.accessoryName} Maintenance`, 'maintenance');

    this.shutoffInformationService = this.shutoffAccessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.shutoffAccessory.addService(this.platform.Service.AccessoryInformation);

    this.shutoffSwitchService = this.shutoffAccessory.getService(this.platform.Service.Switch)
      ?? this.shutoffAccessory.addService(this.platform.Service.Switch, `${this.platform.accessoryName} Emergency Shutoff`);

    if (this.reopenAccessory) {
      this.reopenInformationService = this.reopenAccessory.getService(this.platform.Service.AccessoryInformation)
        ?? this.reopenAccessory.addService(this.platform.Service.AccessoryInformation);

      this.reopenSwitchService = this.reopenAccessory.getService(this.platform.Service.Switch)
        ?? this.reopenAccessory.addService(this.platform.Service.Switch, `${this.platform.accessoryName} Reopen Water Supply`);
    }

    this.leakSensorService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Leak Protection`);
    this.waterSupplyValveService
      .setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Water Supply`)
      .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE);
    this.absenceSwitchService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Absence Mode`);
    this.maintenanceService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Maintenance`);

    this.shutoffSwitchService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Emergency Shutoff`);
    this.reopenSwitchService?.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Reopen Water Supply`);

    this.absenceSwitchService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.currentSnapshot?.waterProtection.absenceModeEnabled ?? false)
      .onSet(async (value) => {
        await this.platform.setAbsenceMode(Boolean(value));
      });

    this.waterSupplyValveService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.isWaterSupplyOpen()
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE)
      .onSet(() => {
        this.platform.log.debug('Ignoring direct BIOCAT Water Supply valve control. Use Emergency Shutoff or Reopen Water Supply instead.');
        this.updateWaterSupplyValveState();
      });

    this.waterSupplyValveService
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => this.isWaterSupplyOpen()
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE);

    this.shutoffSwitchService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (!Boolean(value)) {
          return;
        }

        try {
          await this.platform.setWaterSupplyOpen(false);
        } finally {
          this.shutoffSwitchService.updateCharacteristic(this.platform.Characteristic.On, false);
        }
      });

    this.reopenSwitchService
      ?.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => false)
      .onSet(async (value) => {
        if (!Boolean(value)) {
          return;
        }

        try {
          await this.platform.setWaterSupplyOpen(true);
        } finally {
          this.reopenSwitchService?.updateCharacteristic(this.platform.Characteristic.On, false);
        }
      });
  }

  update(snapshot: NormalizedBiocatSnapshot): void {
    this.currentSnapshot = snapshot;

    const leakServiceFault = !snapshot.online ||
      snapshot.waterProtection.faultActive ||
      snapshot.event.severity === 'error' ||
      snapshot.event.severity === 'alarm';

    this.informationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, snapshot.manufacturer)
      .setCharacteristic(this.platform.Characteristic.Model, snapshot.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, snapshot.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, snapshot.firmwareVersion);

    this.shutoffInformationService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, snapshot.manufacturer)
      .setCharacteristic(this.platform.Characteristic.Model, snapshot.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, snapshot.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, snapshot.firmwareVersion);

    this.reopenInformationService
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, snapshot.manufacturer)
      .setCharacteristic(this.platform.Characteristic.Model, snapshot.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, snapshot.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, snapshot.firmwareVersion);

    this.leakSensorService
      .updateCharacteristic(
        this.platform.Characteristic.LeakDetected,
        snapshot.waterProtection.leakDetected
          ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      )
      .updateCharacteristic(
        this.platform.Characteristic.StatusFault,
        leakServiceFault
          ? this.platform.Characteristic.StatusFault.GENERAL_FAULT
          : this.platform.Characteristic.StatusFault.NO_FAULT,
      )
      .updateCharacteristic(
        this.platform.Characteristic.StatusActive,
        snapshot.waterProtection.protectionActive,
      );

    this.updateWaterSupplyValveState();

    this.waterSupplyValveService
      .updateCharacteristic(
        this.platform.Characteristic.StatusActive,
        snapshot.online,
      )
      .updateCharacteristic(
        this.platform.Characteristic.StatusFault,
        snapshot.online
          ? this.platform.Characteristic.StatusFault.NO_FAULT
          : this.platform.Characteristic.StatusFault.GENERAL_FAULT,
      );

    this.absenceSwitchService.updateCharacteristic(
      this.platform.Characteristic.On,
      snapshot.waterProtection.absenceModeEnabled,
    );

    this.shutoffSwitchService.updateCharacteristic(this.platform.Characteristic.On, false);
    this.reopenSwitchService?.updateCharacteristic(this.platform.Characteristic.On, false);

    this.maintenanceService.updateCharacteristic(
      this.platform.Characteristic.FilterChangeIndication,
      snapshot.maintenance.changeRequired
        ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
        : this.platform.Characteristic.FilterChangeIndication.FILTER_OK,
    );

    if (snapshot.maintenance.filterLifeLevel !== undefined) {
      this.maintenanceService.updateCharacteristic(
        this.platform.Characteristic.FilterLifeLevel,
        snapshot.maintenance.filterLifeLevel,
      );
    }

    this.accessory.context.lastSnapshot = {
      refreshedAt: snapshot.refreshedAt,
      online: snapshot.online,
      modeId: snapshot.modeId,
      eventSeverity: snapshot.event.severity,
      absenceModeEnabled: snapshot.waterProtection.absenceModeEnabled,
      leakDetected: snapshot.waterProtection.leakDetected,
      valveClosed: snapshot.waterProtection.valveClosed,
      statisticsLogDate: snapshot.statistics?.logDate,
    };
  }

  markConnectionFault(): void {
    this.leakSensorService.updateCharacteristic(
      this.platform.Characteristic.StatusFault,
      this.platform.Characteristic.StatusFault.GENERAL_FAULT,
    );
  }

  private isWaterSupplyOpen(): boolean {
    return !(this.currentSnapshot?.waterProtection.valveClosed ?? false);
  }

  private updateWaterSupplyValveState(): void {
    const waterSupplyOpen = this.isWaterSupplyOpen();

    this.waterSupplyValveService
      .updateCharacteristic(
        this.platform.Characteristic.Active,
        waterSupplyOpen
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE,
      )
      .updateCharacteristic(
        this.platform.Characteristic.InUse,
        waterSupplyOpen
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE,
      );
  }
}
