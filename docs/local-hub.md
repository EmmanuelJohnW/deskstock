# Laptop Hub: Sorting Without Internet

With the laptop hub, the sorting device and the laptop can work together on a phone hotspot that has **no internet**:
- the device sends its runs to the laptop;
- the laptop's dashboard shows the sort live;
- the results upload to the online database automatically when the internet is back.

With internet, everything works exactly as before.

```
           with internet                          without internet
device ──► deskstock.vercel.app ──► Supabase     device ──► laptop (hotspot) ──► saved on the laptop
                                                                  │
laptop dashboard ◄── live view ◄─┘               laptop dashboard ◄── live view    …uploads when online
```

## How it works

1. **Choosing a target.** At boot and at the start of every run, the device asks the website for its component list. If the website can't be reached, it asks the **laptop** at a fixed address on the hotspot, and the OLED shows **LAPTOP MODE**.
2. **Component list.** Each time the laptop answers online, it saves the component list. Offline, it serves that saved list for the inventory selected in its dashboard.
3. **During a run.** The device sends progress to the laptop, and the laptop's Sort page shows it live ("fw laptop hub").
4. **When the run finishes,** the laptop saves it, one file per run, in `.local-hub/runs/`. The device's clock isn't set without internet (it reads 1970), so the laptop records the real time instead.
5. **Upload.** The dashboard moves saved runs into its offline queue, in time order with any borrows or restocks made meanwhile, and uploads them when the internet is back. Each run is counted into the inventory it was sorted for.
   - The Sort page shows "1 sort run saved on this laptop".
   - The **Sync** page lists the runs, with Discard.
   - Uploads are safe to repeat: a run is never counted twice.

## 1. Firmware change (one-time, then re-flash)

These edits target the **current device sketch** (the one with `API_BASE_URL`, `testConnection()` and `sendIngestPayload()`), not the older `firmware/deskstock/deskstock.ino` in this repo. Everything else stays the same.

### a) Settings: add the laptop address

Below `API_BASE_URL`:

```cpp
const char* LOCAL_BASE_URL = "http://172.20.10.12:3000";  // the laptop on the iPhone hotspot (fixed IP, step 2)
String activeBaseUrl = API_BASE_URL;                       // where requests currently go
bool usingLaptop = false;
```

Add a `CONN_LAPTOP` value to the `ConnTestStatus` enum:

```cpp
enum ConnTestStatus { CONN_IDLE, CONN_TESTING, CONN_SUCCESS, CONN_LAPTOP,
                      CONN_FAIL_WIFI, CONN_FAIL_HTTP, CONN_FAIL_AUTH, CONN_FALLBACK_LOADED };
```

### b) Helpers: one request function for both targets

Add these above `testConnection()`. The website uses HTTPS; the laptop uses plain HTTP.

```cpp
WiFiClientSecure secureClient;
WiFiClient plainClient;

// Timeouts are set on the HTTPClient (setConnectTimeout / setTimeout, in ms).
bool beginRequest(HTTPClient& http, const String& base, const char* path) {
  String url = base + path;
  if (url.startsWith("https://")) {
    secureClient.setInsecure();
    return http.begin(secureClient, url);
  }
  return http.begin(plainClient, url);
}

// GET /api/run-config from `base`. Returns the HTTP code (negative = couldn't
// connect); on 200 the catalog is loaded into knownComponents.
int fetchCatalog(const String& base) {
  HTTPClient http;
  http.setConnectTimeout(2500);
  if (!beginRequest(http, base, "/api/run-config")) return -1;
  http.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
  http.setTimeout(2500);
  int httpCode = http.GET();
  if (httpCode == 200) {
    DynamicJsonDocument doc(16384);
    if (deserializeJson(doc, http.getString())) {
      httpCode = -2;  // unreadable reply
    } else {
      numLoadedComponents = 0;
      for (JsonVariant v : doc.as<JsonArray>()) {
        if (numLoadedComponents >= MAX_CATALOG_SIZE) break;
        knownComponents[numLoadedComponents].name = v["name"].as<String>();
        knownComponents[numLoadedComponents].weight_g = v["weight_g"].as<float>();
        numLoadedComponents++;
      }
      connTestCatalogCount = numLoadedComponents;
    }
  }
  http.end();
  return httpCode;
}
```

### c) Replace `testConnection()`

```cpp
void testConnection(bool allowFallback) {
  connTestStatus = CONN_TESTING;
  connTestHttpCode = 0;
  connTestCatalogCount = 0;
  updateDisplay();

  if (WiFi.status() != WL_CONNECTED) {
    if (allowFallback) {
      loadOfflineFallbackCatalog();
      connTestStatus = CONN_FALLBACK_LOADED;
    } else {
      connTestStatus = CONN_FAIL_WIFI;
    }
    updateDisplay();
    return;
  }

  // 1) The website (needs internet). 2) If it can't be reached, the laptop on the hotspot.
  int httpCode = fetchCatalog(API_BASE_URL);
  usingLaptop = false;
  if (httpCode < 0) {
    httpCode = fetchCatalog(LOCAL_BASE_URL);
    usingLaptop = (httpCode > 0);   // the laptop answered (even without a catalog)
  }
  activeBaseUrl = usingLaptop ? LOCAL_BASE_URL : API_BASE_URL;
  connTestHttpCode = httpCode;

  if (httpCode == 200) {
    connTestStatus = usingLaptop ? CONN_LAPTOP : CONN_SUCCESS;
  } else if (allowFallback) {
    loadOfflineFallbackCatalog();
    connTestStatus = CONN_FALLBACK_LOADED;
  } else {
    connTestStatus = (httpCode == 401) ? CONN_FAIL_AUTH : CONN_FAIL_HTTP;
  }
  updateDisplay();
}
```

In `updateDisplay()`, under `case STATE_TESTCONN:` → `switch (connTestStatus)`, add:

```cpp
        case CONN_LAPTOP:
          display.println("LAPTOP MODE");
          display.setCursor(5, 36);
          display.print("Catalog items: ");
          display.println(connTestCatalogCount);
          break;
```

### d) Send runs to the active target

In `sendIngestPayload()`, replace these lines:

```cpp
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(2000);

  HTTPClient http;
  http.setConnectTimeout(2000);
  String url = String(API_BASE_URL) + "/api/ingest";

  if (http.begin(client, url)) {
```

with:

```cpp
  HTTPClient http;
  http.setConnectTimeout(2000);

  if (beginRequest(http, activeBaseUrl, "/api/ingest")) {
```

At the end of the same block, replace:

```cpp
    int httpCode = http.POST(outPayload);
    http.end();
```

with:

```cpp
    int httpCode = http.POST(outPayload);
    http.end();

    // Internet dropped mid-run: resend to the laptop and keep using it.
    if (httpCode < 0 && !usingLaptop) {
      usingLaptop = true;
      activeBaseUrl = LOCAL_BASE_URL;
      HTTPClient retry;
      retry.setConnectTimeout(2000);
      if (beginRequest(retry, activeBaseUrl, "/api/ingest")) {
        retry.setTimeout(2000);
        retry.addHeader("Authorization", String("Bearer ") + INGEST_TOKEN);
        retry.addHeader("Content-Type", "application/json");
        int retryCode = retry.POST(outPayload);
        retry.end();
        if (retryCode < 0) Serial.println("[ingest] laptop unreachable too: this update was not saved");
      }
    }
```

### e) Check the target at the start of each run

In the menu handler, where **RUN** starts (`menuSelection == 7`), add `testConnection(true);` as the first line:

```cpp
        } else if (menuSelection == 7) {
          testConnection(true);   // pick website or laptop for this run
          generateNewRunId();
```

This also fixes an existing problem. The device used to ask for its component list only at boot. Online, that request is what opens the count session, and finishing a run closes it, so a **second** run after boot had no open session and was rejected. Now every run opens its own.

> When copying from a chat, check the menu line `if (menuSelection >= 8) menuSelection = 0;`. Some apps turn `8)` into an emoji.

## 2. Laptop setup (once, while you still have internet)

1. **Connect to the hotspot** "IphoneSE". On the iPhone, turn on **Maximize Compatibility** in Personal Hotspot.
2. **Give the laptop a fixed IP** in System Settings → Wi-Fi → (the hotspot) **Details** → **TCP/IP**:
   - Configure IPv4: **Manually**
   - IP address: **172.20.10.12**
   - Subnet mask: **255.255.255.240**
   - Router: **172.20.10.1**

   This must match `LOCAL_BASE_URL` in the firmware. If you pick another address, keep it between 172.20.10.2 and .14 and change both.
3. **Settings:** in `~/DeskStock/.env.local`, set or add:
   ```
   NEXT_PUBLIC_LOCAL_HUB=true
   NEXT_PUBLIC_USE_MOCK=false
   INGEST_TOKEN=<the same token as INGEST_TOKEN in the firmware>
   ```
4. **Build** (needs internet):
   ```bash
   cd ~/DeskStock && npm run build
   ```
5. **Start the hub:**
   ```bash
   npm run hub
   ```
   If macOS asks whether to allow `node` to accept incoming connections, choose **Allow**.
6. **Open the dashboard** at **http://localhost:3000** on the laptop, not deskstock.vercel.app. Select the inventory you'll sort into, and open each inventory you need once, so the laptop has a copy.
7. **Let the device fetch once while online** (Test Connection, or start a run), so the laptop saves the component list.

## 3. On the day

- Turn on the hotspot, start the hub (`npm run hub`), and open http://localhost:3000.
- Power on the device. Its OLED shows the connection result:
  - **Catalog items: N**: it reached the website (internet works);
  - **LAPTOP MODE**: no internet, it's using the laptop;
  - **OFFLINE MODE**: it reached neither. Check that the laptop is on the hotspot with the fixed IP, and that `npm run hub` is running.
- Sort as usual. The Sort page shows the run live with **fw laptop hub**.
- When internet is back, keep the dashboard open. Saved runs upload by themselves; the Sync page shows progress.

## Checking the connection

On the iPhone (connected to its own hotspot is fine), or any device on the hotspot, open `http://172.20.10.12:3000/api/local/live`. You should see `{"live":null,…}`. If not:
- check the laptop's IP;
- check that `npm run hub` is running;
- check the macOS firewall.

## Testing without the device

- `INGEST_URL=http://localhost:3000 INGEST_TOKEN=… bash test-ingest.sh` simulates a device run.
- Add `FAKE_NO_NTP=1` for a device whose clock isn't set.
- To simulate no internet on the laptop's server, create the file `.local-hub/force-offline`; delete it to go back online. Combine it with the dashboard's **Work offline** switch on the Sync page.

## Limitations

- **Plain HTTP on the hotspot.** The device's token is sent unencrypted to the laptop. The hotspot itself is password-protected (WPA2), so this is acceptable for a demo, but don't use an open network.
- **If neither the website nor the laptop can be reached** when a run finishes, that run's result is lost (as today). Keep the laptop on the hotspot with `npm run hub` running.
- **The dashboard must be open on the laptop to upload** saved runs; they're kept safely until it is.
- **Inventory:** the device sorts into the inventory selected on the laptop's dashboard. Components registered while offline reach the device's list only after syncing.
- **Return and Undo** made offline record the sync time.
- **Device page:** its live traffic feed and status need internet.
- **iPhone Personal Hotspot** needs Cellular Data switched on. With no signal or no data left, it still connects the device and the laptop.
