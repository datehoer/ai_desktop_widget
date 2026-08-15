#pragma once

#include <Arduino.h>

struct WidgetConfig {
  String wifiSsid;
  String wifiPassword;
  String bridgeUrl;
  String timezoneId = "Asia/Shanghai";
  uint16_t pollIntervalSeconds = 5;
  bool loadedFromStorage = false;
};

void loadWidgetConfig(WidgetConfig &config);
bool saveWidgetConfig(const WidgetConfig &config);
bool hasCompleteWidgetConfig(const WidgetConfig &config);
bool isSupportedTimezone(const String &timezoneId);
const char *timezonePosixRule(const String &timezoneId);
