#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <TFT_eSPI.h>
#include <U8g2_for_TFT_eSPI.h>
#include <WiFi.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#include "flip_clock.h"

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
constexpr unsigned long kWifiConnectTimeoutMs = 15000;
constexpr unsigned long kNoDataClockTimeoutMs = 30000;
constexpr time_t kMinimumValidEpoch = 1609459200;  // 2021-01-01 UTC
constexpr int kIdleCardX[] = {4, 84, 164};
constexpr int kIdleCardY = 30;
constexpr int kIdleCardWidth = 72;
constexpr int kIdleCardHeight = 152;
constexpr int kIdleCardHalf = kIdleCardHeight / 2;

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
unsigned long lastFreshStatusAt = 0;
unsigned long configButtonPressedAt = 0;
bool hasRenderedStatus = false;
bool bridgeHealthy = false;
int64_t weeklyResetsAt = 0;
DisplayMode displayMode = DisplayMode::kUnknown;
int lastIdleHour = -1;
int lastIdleMinute = -1;
int lastIdleSecond = -1;
TFT_eSprite clockOld(&tft);
TFT_eSprite clockNext(&tft);
TFT_eSprite clockFrame(&tft);
bool clockBuffersReady = false;
bool clockFlipActive = false;
bool clockChanged[3] = {};
unsigned long clockFlipStartedAt = 0;
unsigned long clockFrameAt = 0;
bool idleClockSceneDrawn = false;

struct StatusResult {
  JsonDocument document;
  String error;
};
QueueHandle_t statusResults = nullptr;
TaskHandle_t statusWorker = nullptr;
bool statusRequestPending = false;

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

bool localClock(int &hour, int &minute, int &second) {
  const time_t now = time(nullptr);
  if (now < kMinimumValidEpoch) return false;
  struct tm localTime;
  localtime_r(&now, &localTime);
  hour = localTime.tm_hour;
  minute = localTime.tm_min;
  second = localTime.tm_sec;
  return true;
}

bool ensureClockBuffers() {
  if (clockBuffersReady) return true;
  clockBuffersReady = clockOld.createSprite(kIdleCardWidth * 3, kIdleCardHeight) &&
                      clockNext.createSprite(kIdleCardWidth * 3, kIdleCardHeight) &&
                      clockFrame.createSprite(kIdleCardWidth, kIdleCardHeight);
  if (!clockBuffersReady) {
    clockOld.deleteSprite();
    clockNext.deleteSprite();
    clockFrame.deleteSprite();
  }
  Serial.printf("[clock] HH:MM:SS flip buffers %s, duration %lums\n",
                clockBuffersReady ? "ready" : "unavailable (static fallback)",
                flip_clock::kDurationMs);
  return clockBuffersReady;
}

template <typename Canvas>
void drawPaintSegment(Canvas &canvas, int x, int y, int width, int height,
                      uint16_t color) {
  canvas.fillRoundRect(x - 1, y - 1, width + 2, height + 2, 3, kGraffitiOutline);
  canvas.fillRoundRect(x, y, width, height, 2, color);
}

template <typename Canvas>
void drawGraffitiDigit(Canvas &canvas, int x, int y, int digit, uint16_t color) {
  constexpr uint8_t segments[] = {0x3f, 0x06, 0x5b, 0x4f, 0x66,
                                  0x6d, 0x7d, 0x07, 0x7f, 0x6f};
  if (digit == 1) {
    drawPaintSegment(canvas, x + 11, y + 2, 7, 98, color);
    drawPaintSegment(canvas, x + 5, y + 7, 13, 6, color);
    drawPaintSegment(canvas, x + 5, y + 96, 20, 6, color);
  } else {
    const uint8_t mask = digit < 0 ? 0x40 : segments[digit];
    if (mask & 0x01) drawPaintSegment(canvas, x + 4, y, 20, 7, color);
    if (mask & 0x02) drawPaintSegment(canvas, x + 21, y + 5, 6, 43, color);
    if (mask & 0x04) drawPaintSegment(canvas, x + 21, y + 55, 6, 43, color);
    if (mask & 0x08) drawPaintSegment(canvas, x + 4, y + 96, 20, 7, color);
    if (mask & 0x10) drawPaintSegment(canvas, x + 1, y + 55, 6, 43, color);
    if (mask & 0x20) drawPaintSegment(canvas, x + 1, y + 5, 6, 43, color);
    if (mask & 0x40) drawPaintSegment(canvas, x + 4, y + 48, 20, 7, color);
  }
  for (int mark = 0; mark < 12; ++mark) {
    canvas.drawFastHLine(x + 3 + (mark * 17 + max(0, digit) * 3) % 22,
                         y + 3 + (mark * 29) % 98, 2, kGraffitiPanel);
  }
  if (digit >= 0) {
    for (int drip = 0; drip < 2; ++drip) {
      const int px = x + 5 + (digit * 3 + drip * 11) % 19;
      canvas.drawFastVLine(px, y + 105, 4 + (digit + drip * 3) % 9, color);
    }
  }
}

template <typename Canvas>
void drawGraffitiCard(Canvas &canvas, int x, int y, int group, int value) {
  canvas.fillRect(x, y, kIdleCardWidth, kIdleCardHeight, kGraffitiBackground);
  canvas.fillRoundRect(x, y, kIdleCardWidth, kIdleCardHeight, 5, kGraffitiPanel);
  canvas.drawRoundRect(x, y, kIdleCardWidth, kIdleCardHeight, 5, kGraffitiPanelEdge);
  for (int mark = 0; mark < 24; ++mark) {
    canvas.drawPixel(x + 3 + (mark * 19 + group * 7) % 65,
                     y + 3 + (mark * 37) % 145, kGraffitiTexture);
  }
  const uint16_t color = group == 1 ? kGraffitiGreen : kGraffitiPink;
  drawGraffitiDigit(canvas, x + 5, y + 24, value < 0 ? -1 : value / 10, color);
  drawGraffitiDigit(canvas, x + 39, y + 24, value < 0 ? -1 : value % 10, color);
  canvas.drawFastHLine(x + 2, y + kIdleCardHalf - 1, kIdleCardWidth - 4, TFT_BLACK);
  canvas.drawFastHLine(x + 2, y + kIdleCardHalf, kIdleCardWidth - 4, TFT_BLACK);
  canvas.drawFastHLine(x + 5, y + kIdleCardHalf + 1, kIdleCardWidth - 10,
                       kGraffitiPanelEdge);
  canvas.fillCircle(x + 2, y + kIdleCardHalf, 2, kGraffitiOutline);
  canvas.fillCircle(x + kIdleCardWidth - 3, y + kIdleCardHalf, 2, kGraffitiOutline);
}

void drawGraffitiColon() {
  for (int x : {80, 160}) {
    tft.fillCircle(x, 92, 2, kGraffitiOutline);
    tft.fillCircle(x, 120, 2, kGraffitiOutline);
  }
}

// Sprite pixels are stored byte-swapped by TFT_eSPI. Compose the entire card
// offscreen, including the stationary halves, and transfer it once per frame.
void drawClockFlipFrame(unsigned long elapsed) {
  const flip_clock::Frame motion = flip_clock::frame(elapsed, kIdleCardHalf);
  auto *oldPixels = static_cast<uint16_t *>(clockOld.getPointer());
  auto *nextPixels = static_cast<uint16_t *>(clockNext.getPointer());
  auto *pixels = static_cast<uint16_t *>(clockFrame.getPointer());
  constexpr int stride = kIdleCardWidth * 3;
  for (int group = 0; group < 3; ++group) {
    if (!clockChanged[group]) continue;
    for (int y = 0; y < kIdleCardHeight; ++y) {
      const auto row = flip_clock::row(motion, y, kIdleCardHalf);
      const auto *source = row.oldPage ? oldPixels : nextPixels;
      for (int x = 0; x < kIdleCardWidth; ++x) {
        uint16_t pixel = source[row.sourceY * stride + group * kIdleCardWidth + x];
        if (row.moving) pixel = flip_clock::shadeSwapped565(pixel, motion.light);
        pixels[y * kIdleCardWidth + x] = pixel;
      }
    }
    // The leading edge travels toward / away from the hinge, following the
    // projected digit itself instead of covering it with an opaque band.
    if (motion.height > 0 && elapsed < flip_clock::kDurationMs) {
      const int edge = motion.falling ? kIdleCardHalf + motion.height - 1
                                      : kIdleCardHalf - motion.height;
      clockFrame.drawFastHLine(3, edge, kIdleCardWidth - 6, kGraffitiOutline);
    }
    clockFrame.drawFastHLine(2, kIdleCardHalf - 1, kIdleCardWidth - 4, TFT_BLACK);
    clockFrame.drawFastHLine(2, kIdleCardHalf, kIdleCardWidth - 4, TFT_BLACK);
    clockFrame.fillCircle(2, kIdleCardHalf, 2, kGraffitiOutline);
    clockFrame.fillCircle(kIdleCardWidth - 3, kIdleCardHalf, 2, kGraffitiOutline);
    clockFrame.pushSprite(kIdleCardX[group], kIdleCardY);
  }
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
  tft.drawString(bridgeHealthy ? "IDLE" : "CLOCK", 12, 218, 2);
  tft.setTextColor(kGraffitiOutline, kGraffitiBackground);
  tft.drawString(environment, 55, 218, 2);
  tft.fillCircle(188, 226, 3, bridgeHealthy ? kGreen : kAmber);
  tft.setTextDatum(TR_DATUM);
  tft.drawString(bridgeHealthy ? "LIVE" : "STALE", 228, 218, 2);
  tft.setTextDatum(TL_DATUM);
}

void drawIdleClockScene(int hour, int minute, int second) {
  tft.fillScreen(kGraffitiBackground);
  const int values[] = {hour, minute, second};
  const char *labels[] = {"HOUR", "MIN", "SEC"};
  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(kGraffitiOutline, kGraffitiBackground);
  for (int group = 0; group < 3; ++group) {
    drawGraffitiCard(tft, kIdleCardX[group], kIdleCardY, group, values[group]);
    tft.drawString(labels[group], kIdleCardX[group] + kIdleCardWidth / 2, 9, 2);
  }
  drawGraffitiColon();
  drawIdleClockFooter();
}

void updateIdleClock(bool forceRedraw) {
  int hour = -1, minute = -1, second = -1;
  const bool hasTime = localClock(hour, minute, second);
  if (forceRedraw || !idleClockSceneDrawn) {
    clockFlipActive = false;
    ensureClockBuffers();
    drawIdleClockScene(hour, minute, second);
    idleClockSceneDrawn = true;
  } else if (hasTime && (hour != lastIdleHour || minute != lastIdleMinute ||
                         second != lastIdleSecond)) {
    if (clockFlipActive) drawClockFlipFrame(flip_clock::kDurationMs);
    const int previous[] = {lastIdleHour, lastIdleMinute, lastIdleSecond};
    const int next[] = {hour, minute, second};
    // First sync and time corrections snap to the actual time. Never replay
    // stale seconds after an outage or continue an animation from old buffers.
    clockFlipActive = clockBuffersReady &&
        flip_clock::isNextSecond(lastIdleHour, lastIdleMinute, lastIdleSecond,
                                 hour, minute, second);
    for (int group = 0; group < 3; ++group) {
      clockChanged[group] = previous[group] != next[group];
      if (!clockChanged[group]) continue;
      if (clockFlipActive) {
        drawGraffitiCard(clockOld, group * kIdleCardWidth, 0, group, previous[group]);
        drawGraffitiCard(clockNext, group * kIdleCardWidth, 0, group, next[group]);
      } else {
        drawGraffitiCard(tft, kIdleCardX[group], kIdleCardY, group, next[group]);
      }
    }
    clockFlipStartedAt = millis();
    clockFrameAt = millis() - 25;
  }
  if (hasTime) {
    lastIdleHour = hour;
    lastIdleMinute = minute;
    lastIdleSecond = second;
  }
  if (clockFlipActive && millis() - clockFrameAt >= 25) {
    clockFrameAt = millis();
    const unsigned long elapsed = millis() - clockFlipStartedAt;
    drawClockFlipFrame(elapsed);
    if (elapsed >= flip_clock::kDurationMs) clockFlipActive = false;
  }
}

void showIdleClock() {
  if (displayMode != DisplayMode::kIdleClock) {
    displayMode = DisplayMode::kIdleClock;
    lastIdleHour = -1;
    lastIdleMinute = -1;
    lastIdleSecond = -1;
    idleClockSceneDrawn = false;
    Serial.println(bridgeHealthy ? "[display] idle clock" : "[display] offline clock");
    updateIdleClock(true);
  } else {
    drawIdleClockFooter();
  }
}

void updateNoDataTimeout() {
  // Use a monotonic timer: NTP corrections must not affect the fallback.
  // A configured 60-second poll interval is not itself a connection failure.
  if (!bridgeHealthy && millis() - lastFreshStatusAt >= kNoDataClockTimeoutMs) {
    if (displayMode != DisplayMode::kIdleClock) showIdleClock();
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

  bridgeHealthy = true;
  lastFreshStatusAt = millis();
  hasRenderedStatus = true;

  if (runningCount == 0) {
    showIdleClock();
    return;
  }

  if (displayMode != DisplayMode::kStatus) Serial.println("[display] live status");
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

// Network I/O owns no display state. The main loop alone renders, even when
// a connection or response takes several seconds to time out.
void fetchStatusInBackground(StatusResult &result, const String &url) {
  if (WiFi.status() != WL_CONNECTED) {
    result.error = "Wi-Fi disconnected";
    return;
  }
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  if (!http.begin(url)) {
    result.error = "Invalid bridge URL";
    return;
  }
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    result.error = "HTTP " + String(code);
    return;
  }
  const DeserializationError error = deserializeJson(result.document, http.getStream());
  http.end();
  if (error) {
    result.error = "Invalid JSON";
    return;
  }
  JsonDocument &doc = result.document;
  if (!(doc["ok"] | false) || (doc["stale"] | false)) {
    result.error = "Bridge data unavailable";
    return;
  }
  if (!doc["runningCount"].is<int>() || doc["runningCount"].as<int>() < 0) {
    result.error = "Invalid status payload";
  }
}

void statusWorkerLoop(void *) {
  // Configuration changes reboot the device; take a private immutable copy.
  const String url = widgetConfig.bridgeUrl;
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    auto *result = new StatusResult;
    fetchStatusInBackground(*result, url);
    xQueueSend(statusResults, &result, portMAX_DELAY);
  }
}

void fetchStatus() {
  if (statusWorker == nullptr || statusRequestPending) return;
  statusRequestPending = true;
  xTaskNotifyGive(statusWorker);
}

void receiveStatus() {
  StatusResult *result = nullptr;
  if (statusResults == nullptr || xQueueReceive(statusResults, &result, 0) != pdTRUE) return;
  statusRequestPending = false;
  if (result->error.isEmpty()) drawStatus(result->document);
  else markConnectionStale(result->error);
  delete result;
}

void startStatusWorker() {
  statusResults = xQueueCreate(1, sizeof(StatusResult *));
  if (statusResults != nullptr &&
      xTaskCreate(statusWorkerLoop, "bridge-status", 8192, nullptr, 1,
                  &statusWorker) == pdPASS) return;
  if (statusResults != nullptr) vQueueDelete(statusResults);
  statusResults = nullptr;
  statusWorker = nullptr;
  markConnectionStale("Status worker unavailable");
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
  ensureClockBuffers();
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
  lastFreshStatusAt = millis();
  startStatusWorker();
  fetchStatus();
  lastPollAt = millis();
  startBleThermometer();
}

void loop() {
  handleLanConfigServer();
  handleConfigButton();
  receiveStatus();
  updateNoDataTimeout();

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

  updateNoDataTimeout();
  if (displayMode == DisplayMode::kIdleClock) updateIdleClock(false);
  if (millis() - lastClockDrawAt >= 1000) {
    lastClockDrawAt = millis();
    if (displayMode == DisplayMode::kIdleClock) {
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
  delay(displayMode == DisplayMode::kIdleClock ? 5 : 50);
}
