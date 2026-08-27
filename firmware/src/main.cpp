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
constexpr uint16_t kGraffitiBackground = 0x0841;
constexpr uint16_t kGraffitiPanel = 0x10A2;
constexpr uint16_t kGraffitiPanelEdge = 0x4208;
constexpr uint16_t kGraffitiTexture = 0x2104;
constexpr uint16_t kGraffitiOutline = 0xD69A;
constexpr uint16_t kGraffitiPink = 0xF9B0;
constexpr uint16_t kGraffitiGreen = 0xA7E0;
constexpr uint16_t kGraffitiFold = 0x2945;
constexpr unsigned long kWifiConnectTimeoutMs = 15000;
constexpr time_t kMinimumValidEpoch = 1609459200;  // 2021-01-01 UTC
constexpr int kIdleCardX[] = {4, 61, 124, 181};
constexpr int kIdleCardY = 9;
constexpr int kIdleCardWidth = 55;
constexpr int kIdleCardHeight = 191;

constexpr uint8_t kDigitSegments[] = {
    0b0111111,  // 0: A B C D E F
    0b0000110,  // 1: B C
    0b1011011,  // 2: A B D E G
    0b1001111,  // 3: A B C D G
    0b1100110,  // 4: B C F G
    0b1101101,  // 5: A C D F G
    0b1111101,  // 6: A C D E F G
    0b0000111,  // 7: A B C
    0b1111111,  // 8: A B C D E F G
    0b1101111,  // 9: A B C D F G
};

enum class DisplayMode {
  kUnknown,
  kStatus,
  kIdleClock,
  kOffline,
};

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
DisplayMode displayMode = DisplayMode::kUnknown;
int lastIdleHour = -1;
int lastIdleMinute = -1;
bool idleClockSceneDrawn = false;

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

bool localClock(int &hour, int &minute) {
  struct tm localTime;
  if (!getLocalTime(&localTime, 10)) return false;
  hour = localTime.tm_hour;
  minute = localTime.tm_min;
  return true;
}

int clockDigit(int hour, int minute, int index) {
  if (hour < 0 || minute < 0) return -1;
  if (index == 0) return hour / 10;
  if (index == 1) return hour % 10;
  if (index == 2) return minute / 10;
  return minute % 10;
}

uint16_t digitColor(int index) {
  return index == 0 || index == 3 ? kGraffitiPink : kGraffitiGreen;
}

void drawPaintSegment(int x, int y, int width, int height, uint16_t color) {
  const int radius = min(5, min(width, height) / 2);
  tft.fillRoundRect(x - 2, y - 2, width + 4, height + 4, radius + 1,
                    kGraffitiOutline);
  tft.fillRoundRect(x, y, width, height, radius, color);
}

void drawGraffitiDigit(int cardX, int digit, uint16_t color) {
  constexpr int top = 34;
  constexpr int middle = 94;
  constexpr int bottom = 154;
  const int left = cardX + 10;
  const int right = cardX + 34;

  if (digit == 1) {
    // A centered, poster-like one reads better than the right-aligned LED form.
    drawPaintSegment(cardX + 23, top + 3, 10, 116, color);
    drawPaintSegment(cardX + 15, top + 9, 18, 9, color);
    drawPaintSegment(cardX + 14, bottom - 4, 29, 9, color);
  } else {
    const uint8_t segments = digit < 0 ? 0b1000000 : kDigitSegments[digit];
    if (segments & 0b0000001) drawPaintSegment(left + 3, top, 27, 10, color);       // A
    if (segments & 0b0000010) drawPaintSegment(right, top + 5, 10, 54, color);      // B
    if (segments & 0b0000100) drawPaintSegment(right, middle + 5, 10, 54, color);   // C
    if (segments & 0b0001000) drawPaintSegment(left + 3, bottom, 27, 10, color);    // D
    if (segments & 0b0010000) drawPaintSegment(left, middle + 5, 10, 54, color);    // E
    if (segments & 0b0100000) drawPaintSegment(left, top + 5, 10, 54, color);       // F
    if (segments & 0b1000000) drawPaintSegment(left + 3, middle, 27, 10, color);    // G
  }

  // Deterministic chips and scratches make the bright paint look worn without
  // storing a large bitmap in flash.
  for (int index = 0; index < 23; index++) {
    const int px = cardX + 8 + ((index * 17 + max(0, digit) * 11) % 39);
    const int py = top + ((index * 29 + max(0, digit) * 7) % 130);
    tft.drawFastHLine(px, py, 2 + index % 4, kGraffitiPanel);
  }

  if (digit >= 0) {
    for (int drip = 0; drip < 4; drip++) {
      const int px = cardX + 13 + ((drip * 13 + digit * 5) % 31);
      const int length = 5 + ((drip * 7 + digit * 3) % 18);
      tft.drawFastVLine(px, 167, length, color);
      tft.fillCircle(px, 167 + length, 1, color);
    }
  }
}

void drawGraffitiCard(int index, int digit) {
  const int x = kIdleCardX[index];
  tft.fillRoundRect(x + 2, kIdleCardY + 3, kIdleCardWidth, kIdleCardHeight, 6,
                    TFT_BLACK);
  tft.fillRoundRect(x, kIdleCardY, kIdleCardWidth, kIdleCardHeight, 6,
                    kGraffitiPanel);
  tft.drawRoundRect(x, kIdleCardY, kIdleCardWidth, kIdleCardHeight, 6,
                    kGraffitiPanelEdge);

  for (int mark = 0; mark < 34; mark++) {
    const int px = x + 3 + ((mark * 19 + index * 7) % (kIdleCardWidth - 7));
    const int py = kIdleCardY + 4 + ((mark * 37 + index * 13) % (kIdleCardHeight - 9));
    if (mark % 3 == 0) {
      tft.drawFastHLine(px, py, 2 + mark % 7, kGraffitiTexture);
    } else {
      tft.drawPixel(px, py, kGraffitiPanelEdge);
    }
  }

  drawGraffitiDigit(x, digit, digitColor(index));

  const int seam = kIdleCardY + 96;
  tft.drawFastHLine(x + 2, seam, kIdleCardWidth - 4, TFT_BLACK);
  tft.drawFastHLine(x + 5, seam + 2, kIdleCardWidth - 10, kGraffitiPanelEdge);
  tft.fillCircle(x + 3, seam, 2, kGraffitiPanelEdge);
  tft.fillCircle(x + kIdleCardWidth - 4, seam, 2, kGraffitiPanelEdge);
}

void drawGraffitiColon() {
  tft.fillCircle(120, 81, 4, kGraffitiOutline);
  tft.fillCircle(120, 124, 4, kGraffitiOutline);
  tft.drawFastVLine(120, 128, 12, kGraffitiOutline);
  tft.fillCircle(120, 141, 1, kGraffitiOutline);
}

void drawIdleClockFooter() {
  tft.fillRect(0, 202, 240, 38, kGraffitiBackground);
  tft.drawFastHLine(12, 207, 216, kGraffitiTexture);

  const BleThermometerReading thermometer = getBleThermometerReading();
  String environment = "ROOM --";
  if (thermometer.hasValue) {
    environment = String(thermometer.temperatureC, 1) + "C " +
                  String(thermometer.humidityPercent) + "%";
  } else if (thermometer.state == BleThermometerState::kScanning ||
             thermometer.state == BleThermometerState::kConnecting) {
    environment = "ROOM ...";
  }

  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(kGraffitiPanelEdge, kGraffitiBackground);
  tft.drawString("IDLE", 12, 218, 2);
  tft.setTextColor(kGraffitiOutline, kGraffitiBackground);
  tft.drawString(environment, 55, 218, 2);
  tft.fillCircle(188, 226, 3, bridgeHealthy ? kGreen : kAmber);
  tft.setTextDatum(TR_DATUM);
  tft.drawString(bridgeHealthy ? "LIVE" : "STALE", 228, 218, 2);
  tft.setTextDatum(TL_DATUM);
}

void drawIdleClockScene(int hour, int minute) {
  tft.fillScreen(kGraffitiBackground);
  for (int index = 0; index < 4; index++) {
    drawGraffitiCard(index, clockDigit(hour, minute, index));
  }
  drawGraffitiColon();
  drawIdleClockFooter();
}

void animateIdleClockFlip(int hour, int minute) {
  constexpr int seam = kIdleCardY + 96;
  bool changed[4];
  for (int index = 0; index < 4; index++) {
    changed[index] = clockDigit(lastIdleHour, lastIdleMinute, index) !=
                     clockDigit(hour, minute, index);
  }

  for (int bandHeight = 8; bandHeight <= 72; bandHeight += 16) {
    for (int index = 0; index < 4; index++) {
      if (!changed[index]) continue;
      drawGraffitiCard(index, clockDigit(lastIdleHour, lastIdleMinute, index));
      tft.fillRect(kIdleCardX[index] + 2, seam - bandHeight / 2,
                   kIdleCardWidth - 4, bandHeight, kGraffitiFold);
      tft.drawFastHLine(kIdleCardX[index] + 2, seam,
                        kIdleCardWidth - 4, TFT_BLACK);
    }
    delay(25);
  }

  for (int bandHeight = 72; bandHeight >= 8; bandHeight -= 16) {
    for (int index = 0; index < 4; index++) {
      if (!changed[index]) continue;
      drawGraffitiCard(index, clockDigit(hour, minute, index));
      tft.fillRect(kIdleCardX[index] + 2, seam - bandHeight / 2,
                   kIdleCardWidth - 4, bandHeight, kGraffitiFold);
      tft.drawFastHLine(kIdleCardX[index] + 2, seam,
                        kIdleCardWidth - 4, TFT_BLACK);
    }
    delay(25);
  }

  for (int index = 0; index < 4; index++) {
    if (changed[index]) drawGraffitiCard(index, clockDigit(hour, minute, index));
  }
  drawGraffitiColon();
}

void updateIdleClock(bool forceRedraw) {
  int hour = -1;
  int minute = -1;
  const bool hasTime = localClock(hour, minute);

  if (forceRedraw || !idleClockSceneDrawn) {
    drawIdleClockScene(hasTime ? hour : -1, hasTime ? minute : -1);
    idleClockSceneDrawn = true;
  } else if (hasTime && (lastIdleHour < 0 || lastIdleMinute < 0)) {
    for (int index = 0; index < 4; index++) {
      drawGraffitiCard(index, clockDigit(hour, minute, index));
    }
    drawGraffitiColon();
  } else if (hasTime && (hour != lastIdleHour || minute != lastIdleMinute)) {
    animateIdleClockFlip(hour, minute);
  }

  if (hasTime) {
    lastIdleHour = hour;
    lastIdleMinute = minute;
  }
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
  displayMode = DisplayMode::kOffline;
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

  const bool wasBridgeHealthy = bridgeHealthy;
  bridgeHealthy = doc["ok"] | false;
  hasRenderedStatus = true;

  if (runningCount == 0) {
    const bool enteringIdleClock = displayMode != DisplayMode::kIdleClock;
    displayMode = DisplayMode::kIdleClock;
    if (enteringIdleClock) {
      lastIdleHour = -1;
      lastIdleMinute = -1;
      idleClockSceneDrawn = false;
      updateIdleClock(true);
    } else if (wasBridgeHealthy != bridgeHealthy) {
      drawIdleClockFooter();
    }
    return;
  }

  displayMode = DisplayMode::kStatus;
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
  if (displayMode == DisplayMode::kIdleClock) {
    drawIdleClockFooter();
  } else if (hasRenderedStatus) {
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
      markConnectionStale("Wi-Fi disconnected");
    } else {
      fetchStatus();
    }
  }

  if (millis() - lastClockDrawAt >= 1000) {
    lastClockDrawAt = millis();
    if (displayMode == DisplayMode::kIdleClock) {
      updateIdleClock(false);
      drawIdleClockFooter();
    } else if (displayMode == DisplayMode::kStatus) {
      drawHeader(bridgeHealthy);
      drawFooter();
    }
  }
  if (displayMode == DisplayMode::kStatus && hasRenderedStatus &&
      millis() - lastResetDrawAt >= 1000) {
    lastResetDrawAt = millis();
    drawResetCountdown();
  }
  delay(250);
}
