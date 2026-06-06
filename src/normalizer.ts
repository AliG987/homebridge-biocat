type UnknownRecord = Record<string, unknown>;

export type EventSeverity = 'none' | 'info' | 'warning' | 'alarm' | 'error';

export interface NormalizedEvent {
  title?: string;
  message?: string;
  type?: string;
  code?: string;
  severity: EventSeverity;
  isActive: boolean;
  occurredAt?: string;
  raw: UnknownRecord;
}

export interface NormalizedWaterProtection {
  absenceModeEnabled: boolean;
  pauseLeakageProtectionUntil?: string;
  leakageProtectionPaused: boolean;
  leakDetected: boolean;
  valveClosed: boolean;
  protectionActive: boolean;
  warningActive: boolean;
  faultActive: boolean;
  raw: UnknownRecord;
}

export interface NormalizedMaintenance {
  changeRequired: boolean;
  filterLifeLevel?: number;
  nextServiceDate?: string;
  raw: UnknownRecord;
}

export interface NormalizedStatistics {
  logDate: string;
  waterConsumptionLiters?: number;
  energySavedKwh?: number;
  raw: UnknownRecord;
}

export interface NormalizedBiocatSnapshot {
  name: string;
  accessoryId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  online: boolean;
  modeId?: string;
  modeName?: string;
  microLeakageState?: string;
  refreshedAt: string;
  event: NormalizedEvent;
  waterProtection: NormalizedWaterProtection;
  maintenance: NormalizedMaintenance;
  statistics: NormalizedStatistics | null;
  raw: UnknownRecord;
}

interface WaterProtectionContext {
  online: boolean;
  modeId?: string;
  microLeakageState?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstRecordFromArray(value: unknown): UnknownRecord | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.find(isRecord);
}

function unwrapRoot(payload: unknown): UnknownRecord {
  if (Array.isArray(payload)) {
    const firstRecord = payload.find(isRecord);
    if (firstRecord) {
      return unwrapRoot(firstRecord);
    }
  }

  if (!isRecord(payload)) {
    return {};
  }

  const wrapperKeys = ['state', 'data', 'result', 'payload', 'device', 'snapshot', 'status'];
  for (const key of wrapperKeys) {
    const candidate = payload[key];
    if (!isRecord(candidate)) {
      continue;
    }

    if (
      key === 'state' ||
      'online' in candidate ||
      'mode' in candidate ||
      'event' in candidate ||
      'waterProtection' in candidate
    ) {
      return unwrapRoot(candidate);
    }
  }

  return payload;
}

function selectNestedRecord(source: UnknownRecord, keys: string[]): UnknownRecord | undefined {
  for (const key of keys) {
    const candidate = source[key];
    if (isRecord(candidate)) {
      return candidate;
    }

    const arrayCandidate = firstRecordFromArray(candidate);
    if (arrayCandidate) {
      return arrayCandidate;
    }
  }

  return undefined;
}

function pickValue(source: UnknownRecord | undefined, keys: string[]): unknown {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function pickString(source: UnknownRecord | undefined, keys: string[]): string | undefined {
  const value = pickValue(source, keys);

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }

    const normalized = trimmed.includes(',') && !trimmed.includes('.')
      ? trimmed.replace(',', '.')
      : trimmed;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function pickNumber(source: UnknownRecord | undefined, keys: string[]): number | undefined {
  return parseNumber(pickValue(source, keys));
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'on', 'active', 'enabled'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off', 'inactive', 'disabled', 'resolved', 'ok', 'normal'].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function pickBoolean(source: UnknownRecord | undefined, keys: string[]): boolean | undefined {
  return parseBoolean(pickValue(source, keys));
}

function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function pickIsoDate(source: UnknownRecord | undefined, keys: string[]): string | undefined {
  return toIsoDate(pickValue(source, keys));
}

function toLogDate(value: string): string {
  return value.slice(0, 10);
}

function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function collectTextParts(...values: Array<unknown>): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .map((value) => value.toLowerCase());
}

function textIncludes(patterns: RegExp[], texts: string[]): boolean {
  return texts.some((text) => patterns.some((pattern) => pattern.test(text)));
}

function normalizeSeverity(value: string | undefined, fallbackTexts: string[]): EventSeverity {
  const normalized = value?.toLowerCase();

  if (normalized) {
    if (['error', 'fault', 'failure', 'critical', 'stoerung'].includes(normalized)) {
      return 'error';
    }

    if (['alarm', 'alert'].includes(normalized)) {
      return 'alarm';
    }

    if (['warning', 'warn'].includes(normalized)) {
      return 'warning';
    }

    if (['info', 'information'].includes(normalized)) {
      return 'info';
    }

    if (['ok', 'normal', 'resolved', 'none', 'inactive'].includes(normalized)) {
      return 'none';
    }
  }

  if (textIncludes([/st(?:o|oe|\u00f6)rung/i, /error/i, /fault/i], fallbackTexts)) {
    return 'error';
  }

  if (textIncludes([/alarm/i, /alert/i, /leckagealarm/i, /leak/i], fallbackTexts)) {
    return 'alarm';
  }

  if (textIncludes([/warning/i, /warnung/i], fallbackTexts)) {
    return 'warning';
  }

  if (fallbackTexts.length > 0) {
    return 'info';
  }

  return 'none';
}

function detectLeak(texts: string[]): boolean {
  return textIncludes([/leak/i, /leck/i, /leckage/i, /wasseralarm/i, /wasserschaden/i], texts);
}

function detectValveClosed(texts: string[]): boolean | undefined {
  if (textIncludes([/closed/i, /geschlossen/i, /shut/i, /stop/i, /wasserstopp/i], texts)) {
    return true;
  }

  if (textIncludes([/open/i, /offen/i, /running/i], texts)) {
    return false;
  }

  return undefined;
}

function detectMaintenance(texts: string[]): boolean {
  return textIncludes([/maintenance/i, /service/i, /wartung/i, /kartusch/i, /granulat/i, /filter/i], texts);
}

function isFutureDate(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return Date.parse(value) > Date.now();
}

function normalizeEvent(source: UnknownRecord | undefined): NormalizedEvent {
  const raw = source ?? {};
  const title = pickString(source, ['title', 'name', 'summary', 'label']);
  const message = pickString(source, ['message', 'description', 'text', 'detail', 'details', 'errorMessage']);
  const type = pickString(source, ['type', 'category', 'kind', 'eventType']);
  const code = pickString(source, ['code', 'eventCode', 'key', 'identifier', 'eventId']);
  const severityText = pickString(source, ['severity', 'level', 'priority', 'status', 'state', 'category']);
  const occurredAt = pickIsoDate(source, ['occurredAt', 'timestamp', 'createdAt', 'updatedAt', 'date']);
  const active = pickBoolean(source, ['active', 'isActive', 'pending', 'open', 'visible', 'unacknowledged']);

  const texts = collectTextParts(title, message, type, severityText, code);
  const severity = normalizeSeverity(severityText, texts);
  const isActive = active ?? severity !== 'none';

  return {
    title,
    message,
    type,
    code,
    severity,
    isActive,
    occurredAt,
    raw,
  };
}

function normalizeWaterProtection(
  source: UnknownRecord | undefined,
  event: NormalizedEvent,
  context: WaterProtectionContext,
): NormalizedWaterProtection {
  const raw = source ?? {};
  const hasWaterProtectionData = Object.keys(raw).length > 0;
  const absenceModeEnabled = pickBoolean(source, ['absenceModeEnabled']) ?? false;
  const pauseLeakageProtectionUntil = pickIsoDate(source, [
    'pauseLeakageProtectionUntilUTC',
    'pauseLeakageProtectionUntil',
  ]);
  const leakageProtectionPaused = isFutureDate(pauseLeakageProtectionUntil);
  const texts = collectTextParts(
    pickString(source, ['state', 'status', 'mode', 'title', 'message', 'description']),
    event.title,
    event.message,
    event.type,
    context.microLeakageState,
    context.modeId,
  );

  const leakDetected = context.microLeakageState === 'leakage' || (
    pickBoolean(source, [
      'leakDetected',
      'leakageDetected',
      'leakAlarm',
      'leakageAlarm',
      'alarm',
      'alarmActive',
    ]) ?? detectLeak(texts)
  );

  const valveClosed = context.modeId === 'WO' || (
    pickBoolean(source, [
      'valveClosed',
      'closed',
      'waterStopped',
      'waterStop',
      'shutoffActive',
      'shutOffActive',
      'stopActive',
    ]) ?? detectValveClosed(texts) ?? false
  );

  const protectionActive = context.online &&
    !leakageProtectionPaused &&
    (pickBoolean(source, ['active', 'enabled', 'protectionActive', 'monitoringActive']) ?? hasWaterProtectionData);

  const warningActive = pickBoolean(source, ['warning', 'warningActive', 'hasWarning']) ??
    event.severity === 'warning';

  const faultActive = !context.online || (
    pickBoolean(source, ['fault', 'faultActive', 'error', 'errorActive', 'hasError']) ??
    event.severity === 'error'
  );

  return {
    absenceModeEnabled,
    pauseLeakageProtectionUntil,
    leakageProtectionPaused,
    leakDetected,
    valveClosed,
    protectionActive,
    warningActive,
    faultActive,
    raw,
  };
}

function normalizeMaintenance(
  source: UnknownRecord | undefined,
  event: NormalizedEvent,
): NormalizedMaintenance {
  const raw = source ?? {};
  const texts = collectTextParts(
    pickString(source, ['title', 'message', 'description', 'status', 'state']),
    event.title,
    event.message,
    event.type,
  );

  const changeRequired = pickBoolean(source, [
    'changeRequired',
    'filterChangeRequired',
    'cartridgeChangeRequired',
    'granulateChangeRequired',
    'serviceRequired',
    'maintenanceRequired',
  ]) ?? detectMaintenance(texts);

  const filterLifeLevel = clampPercent(pickNumber(source, [
    'filterLifeLevel',
    'cartridgeLifeLevel',
    'granulateLifeLevel',
    'remainingPercent',
    'remainingLifePercent',
  ]));

  const nextServiceDate = pickIsoDate(source, [
    'nextServiceDate',
    'nextMaintenanceDate',
    'serviceDate',
    'maintenanceDate',
    'dueDate',
  ]);

  return {
    changeRequired,
    filterLifeLevel,
    nextServiceDate,
    raw,
  };
}

function latestStatisticsEntry(source: UnknownRecord): UnknownRecord | undefined {
  const entriesValue = source.entries;
  if (!Array.isArray(entriesValue)) {
    return undefined;
  }

  let latestEntry: UnknownRecord | undefined;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const entry of entriesValue) {
    if (!isRecord(entry)) {
      continue;
    }

    const entryDate = pickIsoDate(entry, ['date', 'timestamp', 'measuredAt']) ?? '';
    const timestamp = Date.parse(entryDate);
    if (!latestEntry || (!Number.isNaN(timestamp) && timestamp >= latestTimestamp)) {
      latestEntry = entry;
      latestTimestamp = timestamp;
    }
  }

  return latestEntry;
}

function normalizeStatistics(
  source: unknown,
  refreshedAt: string,
): NormalizedStatistics | null {
  let raw: UnknownRecord | undefined;

  if (isRecord(source)) {
    raw = latestStatisticsEntry(source) ?? source;
  } else if (typeof source === 'number') {
    raw = {
      consumption: source,
      date: refreshedAt,
    };
  }

  if (!raw) {
    return null;
  }

  const waterConsumptionLiters = pickNumber(raw, [
    'consumption',
    'waterConsumptionLiters',
    'waterConsumptionL',
    'consumptionLiters',
    'dailyWaterConsumptionLiters',
    'todayWaterConsumptionLiters',
    'waterUsedLiters',
    'liters',
  ]);

  const energySavedKwh = pickNumber(raw, [
    'energySavedKwh',
    'energySavingsKwh',
    'savedEnergyKwh',
    'energyKwh',
    'kwh',
  ]);

  const statisticTimestamp = pickIsoDate(raw, [
    'date',
    'timestamp',
    'measuredAt',
    'updatedAt',
  ]) ?? refreshedAt;

  if (
    waterConsumptionLiters === undefined &&
    energySavedKwh === undefined &&
    Object.keys(raw).length === 0
  ) {
    return null;
  }

  return {
    logDate: toLogDate(statisticTimestamp),
    waterConsumptionLiters,
    energySavedKwh,
    raw,
  };
}

export function normalizeSnapshot(
  payload: unknown,
  configuredName: string,
  fallbackAccessoryId: string,
): NormalizedBiocatSnapshot {
  const payloadRecord = isRecord(payload) ? payload : {};
  const statePayload = 'state' in payloadRecord ? payloadRecord.state : payload;
  const statisticsPayload = 'statistics' in payloadRecord ? payloadRecord.statistics : undefined;

  const root = unwrapRoot(statePayload);
  const modeRecord = selectNestedRecord(root, ['mode']);
  const eventRecord =
    selectNestedRecord(root, ['event', 'currentEvent']) ??
    firstRecordFromArray(root.events) ??
    firstRecordFromArray(root.alerts);
  const waterProtectionRecord = selectNestedRecord(root, [
    'waterProtection',
    'water_protection',
    'leakProtection',
    'leakageProtection',
  ]);
  const maintenanceRecord = selectNestedRecord(root, [
    'maintenance',
    'service',
    'filter',
    'filterMaintenance',
    'cartridge',
  ]);

  const refreshedAt = new Date().toISOString();
  const online = pickBoolean(root, ['online']) ?? true;
  const modeId = pickString(modeRecord, ['id']) ?? pickString(root, ['modeId']);
  const modeName = pickString(modeRecord, ['name']) ?? pickString(root, ['modeName']);
  const microLeakageState = pickString(root, ['mlState']);
  const event = normalizeEvent(eventRecord);
  const waterProtection = normalizeWaterProtection(waterProtectionRecord, event, {
    online,
    modeId,
    microLeakageState,
  });
  const maintenance = normalizeMaintenance(maintenanceRecord, event);
  const statistics = normalizeStatistics(statisticsPayload, refreshedAt);

  const name = pickString(root, ['name', 'displayName', 'deviceName', 'installationName']) ?? configuredName;
  const serialNumber = pickString(root, ['serialNumber', 'serial', 'deviceId', 'id']) ?? fallbackAccessoryId;
  const model = pickString(root, ['model', 'deviceType', 'type']) ?? 'BIOCAT';
  const firmwareVersion = pickString(root, ['firmwareVersion', 'firmware', 'softwareVersion']) ?? 'Unknown';

  return {
    name,
    accessoryId: serialNumber || fallbackAccessoryId,
    manufacturer: 'WATERCryst',
    model,
    serialNumber: serialNumber || fallbackAccessoryId,
    firmwareVersion,
    online,
    modeId,
    modeName,
    microLeakageState,
    refreshedAt,
    event,
    waterProtection,
    maintenance,
    statistics,
    raw: root,
  };
}
