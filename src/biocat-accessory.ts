import { PlatformAccessory, Service } from 'homebridge';

import { NormalizedBiocatSnapshot } from './normalizer';
import { BiocatPlatform } from './platform';

export class BiocatAccessory {
  private readonly informationService: Service;

  private readonly leakSensorService: Service;

  private readonly valveService: Service;

  private readonly absenceSwitchService: Service;

  private readonly maintenanceService: Service;

  private currentSnapshot?: NormalizedBiocatSnapshot;

  constructor(
    private readonly platform: BiocatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.informationService = this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.accessory.addService(this.platform.Service.AccessoryInformation);

    this.leakSensorService = this.accessory.getServiceById(this.platform.Service.LeakSensor, 'leak-sensor')
      ?? this.accessory.addService(this.platform.Service.LeakSensor, `${this.platform.accessoryName} Leak Protection`, 'leak-sensor');

    this.valveService = this.accessory.getServiceById(this.platform.Service.Valve, 'water-supply')
      ?? this.accessory.addService(this.platform.Service.Valve, `${this.platform.accessoryName} Water Supply`, 'water-supply');

    this.absenceSwitchService = this.accessory.getServiceById(this.platform.Service.Switch, 'absence-mode')
      ?? this.accessory.addService(this.platform.Service.Switch, `${this.platform.accessoryName} Absence Mode`, 'absence-mode');

    this.maintenanceService = this.accessory.getServiceById(this.platform.Service.FilterMaintenance, 'maintenance')
      ?? this.accessory.addService(this.platform.Service.FilterMaintenance, `${this.platform.accessoryName} Maintenance`, 'maintenance');

    this.leakSensorService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Leak Protection`);
    this.absenceSwitchService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Absence Mode`);
    this.maintenanceService.setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Maintenance`);

    this.valveService
      .setCharacteristic(this.platform.Characteristic.Name, `${this.platform.accessoryName} Water Supply`)
      .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.GENERIC_VALVE);

    this.absenceSwitchService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.currentSnapshot?.waterProtection.absenceModeEnabled ?? false)
      .onSet(async (value) => {
        await this.platform.setAbsenceMode(Boolean(value));
      });

    this.valveService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.isWaterSupplyOpen()
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE)
      .onSet(async (value) => {
        const desiredOpen = Number(value) === this.platform.Characteristic.Active.ACTIVE;
        await this.platform.setWaterSupplyOpen(desiredOpen);
      });

    this.valveService
      .getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => this.isWaterSupplyOpen()
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE);
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

    this.leakSensorService
      .updateCharacteristic(
        this.platform.Characteristic.LeakDetected,
        snapshot.waterProtection.leakDetected
          ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.Characteristic.LeakDetected.NOT_DETECTED,
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

    this.absenceSwitchService.updateCharacteristic(
      this.platform.Characteristic.On,
      snapshot.waterProtection.absenceModeEnabled,
    );

    this.valveService
      .updateCharacteristic(
        this.platform.Characteristic.Active,
        this.isWaterSupplyOpen()
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE,
      )
      .updateCharacteristic(
        this.platform.Characteristic.InUse,
        this.isWaterSupplyOpen()
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE,
      );

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
}
