/*
 * DeskStock — ESP32 Firmware
 * ─────────────────────────────────────────────────────────────────────────────
 * What this does:
 *   1. Connects to WiFi and syncs time via NTP.
 *   2. On button press: GETs /api/run-config to load the component weight table.
 *   3. Weighs each component with an HX711 load cell, matches within tolerance.
 *   4. Routes the component to the correct bin (bin 6 = reject/unknown).
 *   5. POSTs running snapshots to /api/ingest once per second.
 *   6. On second button press: POSTs the final complete payload and ends the run.
 *
 * Required libraries (Arduino Library Manager):
 *   • ArduinoJson   by Benoit Blanchon  — tested on v6.x
 *   • HX711         by Rob Tillaart     — or Bogdan Necula's fork
 *
 * Hardware assumed:
 *   • HX711 DOUT → GPIO 21, SCK → GPIO 22
 *   • Start / Stop button → GPIO 0 (the BOOT button; active LOW)
 *   • Bin routing mechanism → implement routeToBin() for your servo/stepper
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "HX711.h"
#include <time.h>

// ── User configuration ────────────────────────────────────────────────────────
// Copy these values from your environment; never commit real credentials.

#define WIFI_SSID        "YOUR_WIFI_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"
#define SERVER_BASE_URL  "https://deskstock.vercel.app"  // no trailing slash
#define INGEST_TOKEN     "YOUR_INGEST_TOKEN"
#define SORT_PROFILE     "Default"

// ── Pin assignments ───────────────────────────────────────────────────────────

#define HX711_DOUT_PIN  21
#define HX711_SCK_PIN   22
#define BTN_PIN          0   // BOOT button; active LOW; swap for your GPIO

// ── Scale calibration ─────────────────────────────────────────────────────────
// Run the HX711 calibration sketch, place a known mass, note the raw reading,
// then: CALIBRATION_FACTOR = raw_reading / known_mass_in_grams
// Positive value; flip sign if your readings come out negative.

#define CALIBRATION_FACTOR     420.0f  // ← update after calibration
#define STABLE_SAMPLE_COUNT       10   // readings averaged per measurement
#define COMPONENT_PRESENT_MG     100   // min mg to treat platform as occupied
#define COMPONENT_ABSENT_MG       40   // max mg to treat platform as empty

// ── Timing ────────────────────────────────────────────────────────────────────

#define INGEST_INTERVAL_MS  1000   // push a running snapshot every second
#define NTP_TIMEOUT_MS      8000

// ── Component table ───────────────────────────────────────────────────────────

struct Component {
  char name[48];
  int  weight_mg;
  int  tolerance_mg;
  int  bin_idx;         // 0–5; bin 6 is the reject chute (never in the table)
};

static Component weightTable[6];
static int       tableSize = 0;

// ── Run state ─────────────────────────────────────────────────────────────────

static int           binCounts[7];   // index = bin_idx; 7 = reject slot
static String        runId;
static time_t        runStartEpoch;
static unsigned long runStartMs;
static int           totalSorted;
static bool          sortRunning = false;

// ── Hardware ──────────────────────────────────────────────────────────────────

static HX711 scale;

// ─────────────────────────────────────────────────────────────────────────────
// routeToBin — STUB
// Implement for your physical mechanism (servo, stepper, solenoid gate, etc.).
// bin 0–5: registered components.  bin 6: reject/unknown chute.
// ─────────────────────────────────────────────────────────────────────────────
void routeToBin(int bin) {
  Serial.printf("[route] → bin %d\n", bin);

  // Example: rotate a servo to a pre-mapped angle
  // const int angles[7] = {0, 30, 60, 90, 120, 150, 180};
  // gateServo.write(angles[bin]);
  // delay(600);   // wait for gate to open fully
  // gateServo.write(90);  // return to home

  delay(200);  // placeholder
}

// ─────────────────────────────────────────────────────────────────────────────
// readWeightMg — stable average of STABLE_SAMPLE_COUNT readings, in milligrams
// ─────────────────────────────────────────────────────────────────────────────
int readWeightMg() {
  if (!scale.is_ready()) return 0;
  float grams = scale.get_units(STABLE_SAMPLE_COUNT);
  if (grams < 0) grams = 0;
  return (int)(grams * 1000.0f);
}

// ─────────────────────────────────────────────────────────────────────────────
// matchComponent — linear scan through the weight table.
// Returns bin_idx (0–5) on match, or 6 for reject.
// ─────────────────────────────────────────────────────────────────────────────
int matchComponent(int weight_mg) {
  for (int i = 0; i < tableSize; i++) {
    int lo = weightTable[i].weight_mg - weightTable[i].tolerance_mg;
    int hi = weightTable[i].weight_mg + weightTable[i].tolerance_mg;
    if (weight_mg >= lo && weight_mg <= hi) {
      return weightTable[i].bin_idx;
    }
  }
  return 6;
}

// ─────────────────────────────────────────────────────────────────────────────
// componentNameForBin — reverse lookup: bin_idx → name string
// ─────────────────────────────────────────────────────────────────────────────
const char* componentNameForBin(int bin_idx) {
  for (int i = 0; i < tableSize; i++) {
    if (weightTable[i].bin_idx == bin_idx) return weightTable[i].name;
  }
  return "Unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// httpPost — send a JSON string to path, return HTTP status code.
// Returns a negative error code on connection failure.
// ─────────────────────────────────────────────────────────────────────────────
int httpPost(const char* path, const String& body) {
  WiFiClientSecure client;
  client.setInsecure();  // accepts any TLS cert — fine for this use case
                         // for stricter deployments: client.setCACert(rootCAPem)

  HTTPClient http;
  http.begin(client, String(SERVER_BASE_URL) + path);
  http.addHeader("Content-Type",  "application/json");
  http.addHeader("Authorization", "Bearer " INGEST_TOKEN);

  int code = http.POST(body);
  if (code < 0) {
    Serial.printf("[http] POST %s error: %s\n", path,
                  HTTPClient::errorToString(code).c_str());
  } else {
    Serial.printf("[http] POST %s → %d\n", path, code);
    if (code == 422) {
      // Log the server's validation error so it's visible over Serial
      Serial.println("       response: " + http.getString());
    }
  }
  http.end();
  return code;
}

// ─────────────────────────────────────────────────────────────────────────────
// httpGet — GET path, write response body into `out`. Returns HTTP status code.
// ─────────────────────────────────────────────────────────────────────────────
int httpGet(const char* path, String& out) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, String(SERVER_BASE_URL) + path);
  http.addHeader("Authorization", "Bearer " INGEST_TOKEN);

  int code = http.GET();
  if (code == 200) {
    out = http.getString();
  } else {
    Serial.printf("[http] GET %s → %d\n", path, code);
  }
  http.end();
  return code;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildBinsArray — serialise current bin counts into the JSON doc.
//
// IMPORTANT: the complete payload requires sum(bins[].count) === total.
// Bin 6 (reject) must be included in the array whenever items landed there.
// The server marks the highest bin_idx as the reject chute, so always putting
// bin 6 last keeps that invariant even if registered bins skip indices.
// ─────────────────────────────────────────────────────────────────────────────
void buildBinsArray(DynamicJsonDocument& doc) {
  JsonArray bins = doc.createNestedArray("bins");

  for (int i = 0; i < tableSize; i++) {
    JsonObject b  = bins.createNestedObject();
    b["idx"]       = weightTable[i].bin_idx;
    b["component"] = weightTable[i].name;
    b["count"]     = binCounts[weightTable[i].bin_idx];
  }

  // Always append bin 6 so the server can identify it as the reject chute
  // (it marks max(bin_idx) as reject). Count = 0 is fine — it won't affect
  // inventory, and the sum check passes as long as binCounts[6] is included.
  JsonObject reject  = bins.createNestedObject();
  reject["idx"]       = 6;
  reject["component"] = "Unknown";
  reject["count"]     = binCounts[6];
}

// ─────────────────────────────────────────────────────────────────────────────
// postRunning — POST /api/ingest with status:"running"
// ─────────────────────────────────────────────────────────────────────────────
void postRunning() {
  DynamicJsonDocument doc(1024);
  doc["status"]           = "running";
  doc["run_id"]           = runId;
  doc["profile"]          = SORT_PROFILE;
  doc["elapsed_ms"]       = (int)(millis() - runStartMs);
  doc["est_remaining_ms"] = nullptr;  // batch size unknown; send JSON null
  buildBinsArray(doc);

  String body;
  serializeJson(doc, body);
  httpPost("/api/ingest", body);
}

// ─────────────────────────────────────────────────────────────────────────────
// postComplete — POST /api/ingest with status:"complete"
//
// The server validates: sum(bins[].count) === total.
// totalSorted counts every routed component including rejects, and bin 6 is
// always appended by buildBinsArray, so the invariant holds.
// ─────────────────────────────────────────────────────────────────────────────
void postComplete() {
  unsigned long durationMs = millis() - runStartMs;

  // ISO 8601 UTC — server's z.string().datetime() requires this format
  char startedAt[25];
  strftime(startedAt, sizeof(startedAt), "%Y-%m-%dT%H:%M:%SZ",
           gmtime(&runStartEpoch));

  DynamicJsonDocument doc(1024);
  doc["status"]      = "complete";
  doc["run_id"]      = runId;
  doc["profile"]     = SORT_PROFILE;
  doc["total"]       = totalSorted;
  doc["duration_ms"] = (int)durationMs;
  doc["started_at"]  = startedAt;
  buildBinsArray(doc);

  String body;
  serializeJson(doc, body);
  httpPost("/api/ingest", body);
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchRunConfig — GET /api/run-config and populate weightTable[].
//
// Response shape: [{name, weight_mg, tolerance_mg, bin_idx}, ...]
// Returns true if at least one component was loaded.
// ─────────────────────────────────────────────────────────────────────────────
bool fetchRunConfig() {
  String body;
  if (httpGet("/api/run-config", body) != 200) return false;

  DynamicJsonDocument doc(2048);
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    Serial.println("[config] JSON parse failed");
    return false;
  }

  tableSize = 0;
  for (JsonObject entry : doc.as<JsonArray>()) {
    if (tableSize >= 6) break;

    strlcpy(weightTable[tableSize].name,
            entry["name"] | "?",
            sizeof(weightTable[0].name));
    weightTable[tableSize].weight_mg    = entry["weight_mg"]    | 0;
    weightTable[tableSize].tolerance_mg = entry["tolerance_mg"] | 50;
    weightTable[tableSize].bin_idx      = entry["bin_idx"]      | tableSize;
    tableSize++;
  }

  Serial.printf("[config] %d component(s) loaded:\n", tableSize);
  for (int i = 0; i < tableSize; i++) {
    Serial.printf("  bin %d  %-30s  %d ± %d mg\n",
                  weightTable[i].bin_idx,
                  weightTable[i].name,
                  weightTable[i].weight_mg,
                  weightTable[i].tolerance_mg);
  }
  return tableSize > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// makeRunId — "<last 3 mac octets>-<epoch seconds>"
// Unique enough for a single-device setup; replace with UUID if needed.
// ─────────────────────────────────────────────────────────────────────────────
String makeRunId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[28];
  snprintf(buf, sizeof(buf), "%02x%02x%02x-%lu",
           mac[3], mac[4], mac[5], (unsigned long)time(nullptr));
  return String(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// startRun — fetch config, reset state, begin posting
// ─────────────────────────────────────────────────────────────────────────────
void startRun() {
  Serial.println("[run] fetching component table…");

  if (!fetchRunConfig()) {
    Serial.println("[run] aborted — registry is empty. Register components first.");
    return;
  }

  memset(binCounts, 0, sizeof(binCounts));
  totalSorted  = 0;
  runId        = makeRunId();
  runStartMs   = millis();
  time(&runStartEpoch);
  sortRunning  = true;

  Serial.printf("[run] started  id=%s\n", runId.c_str());
  postRunning();  // immediate first snapshot so the dashboard shows the run
}

// ─────────────────────────────────────────────────────────────────────────────
// endRun — finalise and report; call with complete=false to cancel
// ─────────────────────────────────────────────────────────────────────────────
void endRun(bool complete) {
  sortRunning = false;
  if (complete) {
    postComplete();
    Serial.printf("[run] complete  total=%d  duration=%lums\n",
                  totalSorted, millis() - runStartMs);
  } else {
    Serial.println("[run] cancelled");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n── DeskStock firmware booting ──────────────────────────────");

  // Button — internal pull-up; BOOT button pulls LOW when pressed
  pinMode(BTN_PIN, INPUT_PULLUP);

  // Scale
  scale.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();
  Serial.println("[scale] tared (remove everything from platform now)");

  // WiFi
  Serial.printf("[wifi]  connecting to \"%s\"", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\n[wifi]  connected — IP %s\n", WiFi.localIP().toString().c_str());

  // NTP — required so started_at is a valid UTC timestamp
  Serial.print("[ntp]   syncing");
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  struct tm t;
  unsigned long ntpStart = millis();
  while (!getLocalTime(&t, 500)) {
    if (millis() - ntpStart > NTP_TIMEOUT_MS) {
      Serial.println("\n[ntp]   TIMEOUT — started_at will be wrong! Check NTP access.");
      break;
    }
    Serial.print(".");
  }
  char timeBuf[32];
  strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%dT%H:%M:%SZ", &t);
  Serial.printf("\n[ntp]   %s\n", timeBuf);

  Serial.println("────────────────────────────────────────────────────────────");
  Serial.println("Ready. Press the button to start a sort run.");
}

// ─────────────────────────────────────────────────────────────────────────────
// loop
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
  static bool          btnPrev     = HIGH;
  static unsigned long lastIngest  = 0;

  // ── Button: rising edge = toggle start / stop ─────────────────────────────
  bool btnNow = digitalRead(BTN_PIN);
  if (btnPrev == HIGH && btnNow == LOW) {
    delay(40);  // debounce
    if (digitalRead(BTN_PIN) == LOW) {
      if (!sortRunning) {
        startRun();
      } else {
        endRun(/*complete=*/true);
      }
    }
  }
  btnPrev = btnNow;

  if (!sortRunning) {
    delay(50);
    return;
  }

  // ── Periodic running snapshot ─────────────────────────────────────────────
  if (millis() - lastIngest >= INGEST_INTERVAL_MS) {
    postRunning();
    lastIngest = millis();
  }

  // ── Weighing cycle ────────────────────────────────────────────────────────
  int weight = readWeightMg();

  if (weight < COMPONENT_PRESENT_MG) {
    delay(20);  // nothing on platform — poll fast
    return;
  }

  // Something placed — wait for the reading to settle, then take a clean sample
  Serial.printf("[weigh] detected ~%d mg, settling…\n", weight);
  delay(300);
  weight = readWeightMg();
  Serial.printf("[weigh] stable   %d mg\n", weight);

  // Match against the weight table
  int bin = matchComponent(weight);
  Serial.printf("[match] %d mg → bin %d (%s)\n",
                weight, bin, componentNameForBin(bin));

  // Route the part
  routeToBin(bin);
  binCounts[bin]++;
  totalSorted++;

  // Wait for the platform to clear before the next component
  Serial.println("[weigh] waiting for removal…");
  while (readWeightMg() > COMPONENT_ABSENT_MG) {
    delay(50);
  }
  Serial.println("[weigh] platform clear — ready");
}
