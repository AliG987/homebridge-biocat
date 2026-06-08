# homebridge-biocat

Ein Homebridge-Plugin fuer WATERCryst BIOCAT-Anlagen auf Basis der offiziellen myBIOCAT REST-API.

Das Plugin liest den Geraetestatus ueber `GET /state`, kann den Abwesenheitsmodus schalten, die Wasserzufuhr schliessen und optional auch wieder oeffnen. Zusaetzlich werden Tagesstatistiken als JSONL protokolliert.

## Funktionsumfang

- Dynamisches Homebridge-Platform-Plugin
- Native HomeKit-Services fuer BIOCAT-Funktionen
- `LeakSensor` fuer Leckage- und Stoerungsanzeige
- `Valve` fuer die Wasserzufuhr
- `Switch` fuer `Absence Mode`
- `FilterMaintenance` fuer Wartungs- und Wechselhinweise
- Offizielle WATERCryst API mit `X-API-KEY`
- JSONL-Statistiklogging mit Duplikatschutz
- Persistenz des zuletzt geloggten Statistikdatums ueber Neustarts

## Voraussetzungen

- Node.js `^22.10.0` oder `^24.0.0`
- Homebridge `^1.8.0` oder `^2.0.0`
- Eine aktive myBIOCAT REST-API fuer dein Geraet
- Ein API-Key aus `app.watercryst.com`

## Installation

Ueber die Homebridge UI nach `homebridge-biocat` suchen und das Plugin installieren.

Alternativ per npm:

```bash
sudo npm install -g homebridge-biocat
```

Danach das Plugin in der Homebridge UI konfigurieren oder den folgenden Eintrag in `config.json` ergaenzen.

## Entwicklung

```bash
npm install
npm run build
```

## Homebridge-Konfiguration

Beispiel fuer `config.json`:

```json
{
  "platforms": [
    {
      "platform": "BiocatPlatform",
      "name": "BIOCAT",
      "apiBaseUrl": "https://appapi.watercryst.com/v1",
      "apiKey": "YOUR_API_KEY",
      "pollIntervalSeconds": 60,
      "requestTimeoutMs": 15000,
      "allowWaterSupplyOpen": false,
      "statistics": {
        "enabled": true,
        "directory": "biocat",
        "fileName": "statistics.jsonl",
        "stateFileName": ".statistics-state.json"
      }
    }
  ]
}
```

## Konfigurationsoptionen

| Feld | Typ | Standard | Beschreibung |
| --- | --- | --- | --- |
| `platform` | `string` | - | Muss `BiocatPlatform` sein |
| `name` | `string` | `BIOCAT` | Anzeigename in Homebridge und HomeKit |
| `apiBaseUrl` | `string` | `https://appapi.watercryst.com/v1` | Basis-URL der WATERCryst REST-API |
| `apiKey` | `string` | - | API-Key fuer den Header `X-API-KEY` |
| `headers` | `object` | `{}` | Optionale zusaetzliche HTTP-Header |
| `pollIntervalSeconds` | `number` | `60` | Polling-Intervall, intern auf `15` bis `86400` begrenzt |
| `requestTimeoutMs` | `number` | `15000` | Timeout pro API-Aufruf, intern auf `1000` bis `120000` begrenzt |
| `allowWaterSupplyOpen` | `boolean` | `false` | Erlaubt das Oeffnen der Wasserzufuhr aus HomeKit heraus |
| `statistics.enabled` | `boolean` | `true` | Aktiviert das Tagesstatistik-Logging |
| `statistics.directory` | `string` | `biocat` | Relativer Ordner unterhalb des Homebridge-Storage-Pfads |
| `statistics.fileName` | `string` | `statistics.jsonl` | Dateiname fuer JSONL-Statistiken |
| `statistics.stateFileName` | `string` | `.statistics-state.json` | Dateiname fuer den letzten Log-Zustand |

Hinweis:

- `statusUrl` wird weiterhin als Legacy-Eingabe akzeptiert. Wenn sie auf `/state` endet, wird automatisch die API-Basis-URL daraus abgeleitet.
- `authToken` wird als Fallback ebenfalls als API-Key akzeptiert.

## HomeKit-Abbildung

Das Plugin legt ein dynamisches Accessory mit diesen nativen HomeKit-Services an:

- `LeakSensor`: zeigt Leckage oder relevante Stoerungen an
- `Valve`: zeigt den Zustand der Wasserzufuhr und kann sie schliessen
- `Switch`: `Absence Mode` ein- oder ausschalten
- `FilterMaintenance`: Wartungs- bzw. Granulatwechsel-Hinweise
- `AccessoryInformation`: Hersteller, Modell, Seriennummer, Firmware

## Schaltfunktionen in HomeKit

### Absence Mode

Der BIOCAT-Abwesenheitsmodus wird als nativer `Switch` exponiert. Dadurch kannst du in der Home-App ganz normale Automationen verwenden, zum Beispiel:

- Wenn die letzte Person das Haus verlaesst, `Absence Mode` einschalten
- Wenn die erste Person nach Hause kommt, `Absence Mode` ausschalten

Intern nutzt das Plugin:

- `GET /absence/enable`
- `GET /absence/disable`

### Water Supply Valve

Die Wasserzufuhr wird als HomeKit-`Valve` exponiert.

Damit sind Automationen moeglich wie:

- Wenn ein HomeKit-Wassersensor ein Leck erkennt, `Water Supply` ausschalten

Intern nutzt das Plugin:

- `GET /watersupply/close`
- `GET /watersupply/open`

Sicherheitsverhalten:

- Schliessen ist immer erlaubt
- Oeffnen ist standardmaessig gesperrt
- Wenn du das Oeffnen aus HomeKit erlauben willst, setze `allowWaterSupplyOpen` auf `true`

## Verwendete BIOCAT-Endpunkte

- `GET /state`
- `GET /statistics/daily/direct`
- Fallback: `GET /statistics/cumulative/daily`
- `GET /absence/enable`
- `GET /absence/disable`
- `GET /watersupply/close`
- Optional: `GET /watersupply/open`

## Erwartete State-Antwort

Das Plugin ist auf die offizielle API-Struktur ausgelegt. Wichtige Felder sind:

- `online`
- `mode.id`
- `mode.name`
- `event`
- `waterProtection.absenceModeEnabled`
- `waterProtection.pauseLeakageProtectionUntilUTC`
- `mlState`

Beispiel:

```json
{
  "online": true,
  "mode": {
    "id": "WT",
    "name": "Water Treatment"
  },
  "event": {},
  "waterProtection": {
    "absenceModeEnabled": false,
    "pauseLeakageProtectionUntilUTC": "2026-03-15T10:00:00Z"
  },
  "mlState": "idle"
}
```

## Statistiklogging

Wenn `statistics.enabled` aktiv ist, schreibt das Plugin Tagesstatistiken als JSONL.

Speicherorte:

- JSONL-Datei: `<homebridge-storage>/<statistics.directory>/<statistics.fileName>`
- State-Datei: `<homebridge-storage>/<statistics.directory>/<statistics.stateFileName>`

Eigenschaften:

- Verzeichnisse werden automatisch angelegt
- Schreiben erfolgt append-sicher
- Doppelte Statistik-Eintraege werden verhindert
- Das zuletzt geloggte Datum bleibt ueber Neustarts erhalten
- Falls die State-Datei fehlt, wird der letzte Stand aus der JSONL-Datei rekonstruiert

## Projektstruktur

- `src/index.ts`: Homebridge-Registrierung
- `src/platform.ts`: Plattform-Lebenszyklus, Polling und Command-Ausfuehrung
- `src/biocat-client.ts`: REST-Client fuer die offizielle API
- `src/normalizer.ts`: Defensive Normalisierung von `state` und Statistikantworten
- `src/biocat-accessory.ts`: HomeKit-Service-Mapping und `onSet`-Handler
- `src/statistics-logger.ts`: JSONL-Logging mit Zustands-Persistenz
- `src/config.ts`: Konfig-Aufbereitung und Defaultwerte
- `config.schema.json`: Homebridge UI-Konfigurationsformular

Build:

```bash
npm install
npm run build
```

Paket pruefen:

```bash
npm pack --dry-run
```

Veroeffentlichen:

```bash
npm publish
```

## Hinweise

- Ohne `apiKey` bleibt die Plattform absichtlich inaktiv.
- Laut offizieller API sind maximal 10 Requests pro Sekunde sowie 200 Requests in 15 Minuten pro Kunde und Geraet erlaubt.
- Das Plugin behandelt fehlende oder leere `event`- und `waterProtection`-Objekte defensiv.
- Leckage wird in der offiziellen API nicht als eigenes boolesches Feld geliefert. Das Plugin leitet sie deshalb aus `mlState`, Eventdaten und bekannten Textmustern ab.
