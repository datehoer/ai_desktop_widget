#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <TFT_eSPI.h>
#include <U8g2_for_TFT_eSPI.h>
#include <WiFi.h>
#include <time.h>

#include "config_portal.h"
#include "ble_thermometer.h"
#include "device_config.h"

namespace {
constexpr uint16_t kBackground = TFT_BLACK;
constexpr uint16_t kPanel = 0x1082;
constexpr uint16_t kMuted = 0x8C71;
constexpr uint16_t kGreen = 0x3F67;
constexpr uint16_t kAmber = 0xFD20;
constexpr uint16_t kRed = 0xF986;
constexpr unsigned long kWifiConnectTimeoutMs = 15000;
constexpr time_t kMinimumValidEpoch = 1609459200;  // 2021-01-01 UTC

TFT_eSPI tft;
U8g2_for_TFT_eSPI utf8Font;
WidgetConfig widgetConfig;
unsigned long lastPollAt = 0;
unsigned long lastClockDrawAt = 0;
unsigned long lastResetDrawAt = 0;
unsigned long configButtonPressedAt = 0;
bool hasRenderedStatus = false;
bool bridgeHealthy = false;
int64_t weeklyResetsAt = 0;

uint16_t quotaColor(float usedPercent) {
  if (usedPercent >= 90) return kRed;
  if (usedPercent >= 70) return kAmber;
  return kGreen;
}

String timeUntil(int64_t epochSeconds) {
  if (epochSeconds <= 0) return "--";
  const time_t now = time(nullptr);
  if (now < kMinimumValidEpoch) return "--";
  const int64_t seconds = epochSeconds - now;
  if (seconds <= 0) return "now";
  const int days = seconds / 86400;
  const int hours = (seconds % 86400) / 3600;
  if (days > 0) return String(days) + "d " + String(hours) + "h";
  const int minutes = (seconds % 3600) / 60;
  return String(hours) + "h " + String(minutes) + "m";
}

void drawResetCountdown() {
  // Clear only the countdown value so it can update independently after NTP sync.
  tft.fillRect(68, 89, 70, 24, kBackground);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawString(timeUntil(weeklyResetsAt), 69, 92, 2);
}

String fitText(String text, size_t maxLength) {
  text.replace("\n", " ");
  text.trim();
  if (text.length() <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

String fitUtf8Text(String text, int maxWidth) {
  text.replace("\n", " ");
  text.trim();
  if (utf8Font.getUTF8Width(text.c_str()) <= maxWidth) return text;

  int end = text.length();
  while (end > 0) {
    int previous = end - 1;
    while (previous > 0 && (static_cast<uint8_t>(text[previous]) & 0xC0) == 0x80) {
      previous--;
    }
    end = previous;
    const String candidate = text.substring(0, end) + "...";
    if (utf8Font.getUTF8Width(candidate.c_str()) <= maxWidth) return candidate;
  }
  return "...";
}

String clockText() {
  struct tm localTime;
  if (!getLocalTime(&localTime, 10)) return "--:--";
  char buffer[6];
  strftime(buffer, sizeof(buffer), "%H:%M", &localTime);
  return String(buffer);
}

void drawHeader(bool online) {
  tft.fillRect(0, 0, 240, 35, kBackground);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawString("CODEX", 12, 9, 4);
  tft.fillCircle(171, 17, 4, online ? kGreen : kAmber);
  tft.setTextDatum(TR_DATUM);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawString(clockText(), 228, 10, 2);
  tft.setTextDatum(TL_DATUM);
}

void drawFooter() {
  tft.fillRect(0, 216, 240, 24, kBackground);
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  tft.fillCircle(12, 228, 3, wifiConnected ? kGreen : kRed);
  tft.setTextColor(kMuted, kBackground);
  const String wifiText = wifiConnected ? String(WiFi.RSSI()) + "dB" : "OFF";
  tft.drawString(wifiText, 20, 220, 2);

  const BleThermometerReading thermometer = getBleThermometerReading();
  String thermometerText;
  uint16_t thermometerColor = kMuted;
  if (thermometer.hasValue) {
    thermometerText = String(thermometer.temperatureC, 1) + "C " +
                      String(thermometer.humidityPercent) + "%";
    const bool fresh = millis() - thermometer.updatedAtMs <= 180000;
    thermometerColor = fresh ? TFT_WHITE : kAmber;
  } else if (thermometer.state == BleThermometerState::kScanning ||
             thermometer.state == BleThermometerState::kConnecting) {
    thermometerText = "BLE...";
  } else if (thermometer.state == BleThermometerState::kReadError) {
    thermometerText = "BLE ERR";
    thermometerColor = kAmber;
  } else {
    thermometerText = "BLE --";
  }
  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(thermometerColor, kBackground);
  tft.drawString(thermometerText, 132, 220, 2);

  tft.setTextDatum(TR_DATUM);
  tft.setTextColor(bridgeHealthy ? kGreen : kAmber, kBackground);
  tft.drawString(bridgeHealthy ? "LIVE" : "STALE", 228, 220, 2);
  tft.setTextDatum(TL_DATUM);
}

void drawProgressBar(int x, int y, int width, float usedPercent) {
  tft.fillRoundRect(x, y, width, 11, 5, 0x2945);
  const int filled = max(0, min(width, static_cast<int>(width * usedPercent / 100.0f)));
  if (filled > 0) tft.fillRoundRect(x, y, filled, 11, 5, quotaColor(usedPercent));
}

void drawOffline(const String &message) {
  drawHeader(false);
  tft.fillRect(0, 35, 240, 205, kBackground);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawCentreString("NO DATA", 120, 85, 4);
  tft.setTextColor(kMuted, kBackground);
  tft.drawCentreString(fitText(message, 30), 120, 125, 2);
  drawFooter();
}

void drawStatus(JsonDocument &doc) {
  const float weeklyUsed = doc["quota"]["weekly"]["usedPercent"] | 0.0f;
  weeklyResetsAt = doc["quota"]["weekly"]["resetsAt"] | 0LL;
  const int resetCredits = doc["resetCredits"] | -1;
  const int runningCount = doc["runningCount"] | 0;

  bridgeHealthy = doc["ok"] | false;
  hasRenderedStatus = true;
  drawHeader(bridgeHealthy);
  tft.fillRect(0, 35, 240, 181, kBackground);

  tft.setTextColor(kMuted, kBackground);
  tft.drawString("WEEKLY", 12, 45, 2);
  tft.setTextDatum(TR_DATUM);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawString(String(static_cast<int>(roundf(weeklyUsed))) + "%", 228, 41, 4);
  tft.setTextDatum(TL_DATUM);
  drawProgressBar(12, 72, 216, weeklyUsed);

  tft.setTextColor(kMuted, kBackground);
  tft.drawString("RESET", 12, 93, 2);
  drawResetCountdown();
  tft.setTextColor(kMuted, kBackground);
  tft.drawString("CREDITS", 143, 93, 2);
  tft.setTextDatum(TR_DATUM);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawString(resetCredits < 0 ? "--" : String(resetCredits), 228, 92, 2);
  tft.setTextDatum(TL_DATUM);

  tft.drawFastHLine(12, 119, 216, 0x3186);
  tft.fillCircle(17, 139, 4, runningCount > 0 ? kGreen : kMuted);
  tft.setTextColor(TFT_WHITE, kBackground);
  tft.drawString("RUNNING", 29, 132, 2);
  tft.setTextDatum(TR_DATUM);
  tft.drawString(String(runningCount), 228, 132, 2);
  tft.setTextDatum(TL_DATUM);

  JsonArray running = doc["running"].as<JsonArray>();
  int y = 158;
  int shown = 0;
  for (JsonObject task : running) {
    if (shown >= 2) break;
    const char *taskTitle = task["title"].as<const char *>();
    if (taskTitle == nullptr || taskTitle[0] == '\0') {
      taskTitle = task["displayName"].as<const char *>();
    }
    if (taskTitle == nullptr || taskTitle[0] == '\0') taskTitle = "未命名任务";
    Serial.printf("[task] title: %s\n", taskTitle);
    const String title = fitUtf8Text(String(shown + 1) + "  " + taskTitle, 216);
    utf8Font.setForegroundColor(shown == 0 ? TFT_WHITE : kMuted);
    utf8Font.drawUTF8(12, y + 14, title.c_str());
    y += 23;
    shown++;
  }
  if (shown == 0) {
    tft.setTextColor(kMuted, kBackground);
    tft.drawString("No active tasks", 12, 158, 2);
  }
  drawFooter();
}

void markConnectionStale(const String &reason) {
  bridgeHealthy = false;
  Serial.println("[bridge] " + reason);
  if (hasRenderedStatus) {
    drawHeader(false);
    drawFooter();
  } else {
    drawOffline(reason);
  }
}

bool fetchStatus() {
  if (WiFi.status() != WL_CONNECTED) {
    markConnectionStale("Wi-Fi disconnected");
    return false;
  }

  HTTPClient http;
  http.setTimeout(4000);
  if (!http.begin(widgetConfig.bridgeUrl)) {
    markConnectionStale("Invalid bridge URL");
    return false;
  }
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    markConnectionStale("HTTP " + String(code));
    return false;
  }

  JsonDocument doc;
  const DeserializationError error = deserializeJson(doc, http.getStream());
  http.end();
  if (error) {
    markConnectionStale("Invalid JSON");
    return false;
  }
  drawStatus(doc);
  return true;
}

bool connectWifi() {
  drawOffline("Connecting Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  Serial.println("[wifi] scanning nearby networks");
  const int networkCount = WiFi.scanNetworks();
  bool configuredSsidFound = false;
  for (int index = 0; index < networkCount; index++) {
    const String discoveredSsid = WiFi.SSID(index);
    if (discoveredSsid == widgetConfig.wifiSsid) {
      configuredSsidFound = true;
      Serial.printf("[wifi] configured SSID found: %s (%d dBm)\n", discoveredSsid.c_str(), WiFi.RSSI(index));
      break;
    }
  }
  if (!configuredSsidFound) {
    Serial.printf("[wifi] configured SSID not found: %s\n", widgetConfig.wifiSsid.c_str());
  }
  WiFi.scanDelete();
  WiFi.begin(widgetConfig.wifiSsid.c_str(), widgetConfig.wifiPassword.c_str());
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < kWifiConnectTimeoutMs) {
    delay(250);
  }
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (!connected) drawOffline("Wi-Fi failed");
  return connected;
}

void handleConfigButton() {
  if (digitalRead(kConfigButtonPin) == LOW) {
    if (configButtonPressedAt == 0) configButtonPressedAt = millis();
    if (millis() - configButtonPressedAt >= kConfigButtonHoldMs) {
      runConfigPortal(tft, widgetConfig, "BOOT BUTTON");
    }
  } else {
    configButtonPressedAt = 0;
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("[boot] Codex Usage Widget");
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);
  Serial.println("[boot] initialising TFT on SPI3/HSPI");
  tft.init();
  Serial.println("[boot] TFT ready");
  tft.setRotation(0);
  tft.fillScreen(kBackground);
  tft.setTextWrap(false);
  utf8Font.begin(tft);
  utf8Font.setFontMode(1);
  utf8Font.setFontDirection(0);
  utf8Font.setFont(u8g2_font_wqy14_t_gb2312b);
  pinMode(kConfigButtonPin, INPUT_PULLUP);

  loadWidgetConfig(widgetConfig);
  Serial.println(widgetConfig.loadedFromStorage ? "[config] loaded from NVS" : "[config] using firmware fallback");
  if (!hasCompleteWidgetConfig(widgetConfig)) {
    runConfigPortal(tft, widgetConfig, "CONFIG REQUIRED");
  }

  if (!connectWifi()) {
    Serial.println("[wifi] connection failed; starting setup portal");
    runConfigPortal(tft, widgetConfig, "WI-FI FAILED");
  }
  Serial.printf("[wifi] connected: %s\n", WiFi.localIP().toString().c_str());

  if (!widgetConfig.loadedFromStorage && saveWidgetConfig(widgetConfig)) {
    widgetConfig.loadedFromStorage = true;
    Serial.println("[config] migrated firmware fallback to NVS");
  }

  Serial.printf("[config] bridge: %s\n", widgetConfig.bridgeUrl.c_str());
  Serial.printf("[config] hold BOOT for %lus to reconfigure\n", kConfigButtonHoldMs / 1000);
  startLanConfigServer(widgetConfig);
  configTzTime(timezonePosixRule(widgetConfig.timezoneId), "pool.ntp.org", "time.cloudflare.com");
  fetchStatus();
  lastPollAt = millis();
  startBleThermometer();
}

void loop() {
  handleLanConfigServer();
  handleConfigButton();

  const unsigned long pollIntervalMs = widgetConfig.pollIntervalSeconds * 1000UL;
  if (millis() - lastPollAt >= pollIntervalMs) {
    lastPollAt = millis();
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
    } else {
      fetchStatus();
    }
  }

  if (millis() - lastClockDrawAt >= 1000) {
    lastClockDrawAt = millis();
    drawHeader(bridgeHealthy);
    drawFooter();
  }
  if (hasRenderedStatus && millis() - lastResetDrawAt >= 1000) {
    lastResetDrawAt = millis();
    drawResetCountdown();
  }
  delay(250);
}
