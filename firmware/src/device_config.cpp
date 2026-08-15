#include "device_config.h"

#include <Preferences.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define STATUS_URL ""
#endif

namespace {
constexpr char kPreferencesNamespace[] = "codex-widget";

bool looksLikePlaceholder(const String &value) {
  return value.length() == 0 || value == "your-wifi-name" || value == "configure-secrets.h";
}

struct TimezoneDefinition {
  const char *id;
  const char *posixRule;
};

constexpr TimezoneDefinition kTimezones[] = {
    {"Etc/UTC", "UTC0"},
    {"Asia/Shanghai", "CST-8"},
    {"Asia/Tokyo", "JST-9"},
    {"Asia/Singapore", "SGT-8"},
    {"Asia/Kolkata", "IST-5:30"},
    {"Asia/Dubai", "GST-4"},
    {"Europe/London", "GMT0BST,M3.5.0/1,M10.5.0"},
    {"Europe/Berlin", "CET-1CEST,M3.5.0,M10.5.0/3"},
    {"America/New_York", "EST5EDT,M3.2.0/2,M11.1.0/2"},
    {"America/Chicago", "CST6CDT,M3.2.0/2,M11.1.0/2"},
    {"America/Denver", "MST7MDT,M3.2.0/2,M11.1.0/2"},
    {"America/Los_Angeles", "PST8PDT,M3.2.0/2,M11.1.0/2"},
    {"Australia/Sydney", "AEST-10AEDT,M10.1.0/2,M4.1.0/3"},
    {"Pacific/Auckland", "NZST-12NZDT,M9.5.0/2,M4.1.0/3"},
};

String timezoneFromLegacyOffset(int offsetMinutes) {
  switch (offsetMinutes) {
    case 0: return "Etc/UTC";
    case 480: return "Asia/Shanghai";
    case 540: return "Asia/Tokyo";
    case 330: return "Asia/Kolkata";
    case 240: return "Asia/Dubai";
    case -300: return "America/New_York";
    case -360: return "America/Chicago";
    case -420: return "America/Denver";
    case -480: return "America/Los_Angeles";
    case 600: return "Australia/Sydney";
    case 720: return "Pacific/Auckland";
    default: return "Asia/Shanghai";
  }
}
}  // namespace

bool isSupportedTimezone(const String &timezoneId) {
  for (const auto &timezone : kTimezones) {
    if (timezoneId == timezone.id) return true;
  }
  return false;
}

const char *timezonePosixRule(const String &timezoneId) {
  for (const auto &timezone : kTimezones) {
    if (timezoneId == timezone.id) return timezone.posixRule;
  }
  return "CST-8";
}

void loadWidgetConfig(WidgetConfig &config) {
  Preferences preferences;
  bool needsMigration = false;
  if (preferences.begin(kPreferencesNamespace, true)) {
    const bool saved = preferences.getBool("saved", false);
    if (saved) {
      config.wifiSsid = preferences.getString("ssid", "");
      config.wifiPassword = preferences.getString("password", "");
      config.bridgeUrl = preferences.getString("bridge", "");
      if (preferences.isKey("tz_id")) {
        config.timezoneId = preferences.getString("tz_id", "Asia/Shanghai");
      } else {
        config.timezoneId = timezoneFromLegacyOffset(preferences.getInt("tz_minutes", 8 * 60));
        needsMigration = true;
      }
      if (!isSupportedTimezone(config.timezoneId)) config.timezoneId = "Asia/Shanghai";
      if (preferences.isKey("token") || preferences.isKey("tz_minutes")) needsMigration = true;
      config.pollIntervalSeconds = preferences.getUShort("poll_seconds", 5);
      config.loadedFromStorage = true;
    }
    preferences.end();
  }

  if (!config.loadedFromStorage) {
    // Backward-compatible one-time migration for devices previously flashed with secrets.h.
    config.wifiSsid = WIFI_SSID;
    config.wifiPassword = WIFI_PASSWORD;
    config.bridgeUrl = STATUS_URL;
  }

  if (needsMigration) saveWidgetConfig(config);
}

bool saveWidgetConfig(const WidgetConfig &config) {
  Preferences preferences;
  if (!preferences.begin(kPreferencesNamespace, false)) return false;

  preferences.putString("ssid", config.wifiSsid);
  preferences.putString("password", config.wifiPassword);
  preferences.putString("bridge", config.bridgeUrl);
  preferences.putString("tz_id", config.timezoneId);
  preferences.remove("token");
  preferences.remove("tz_minutes");
  preferences.putUShort("poll_seconds", config.pollIntervalSeconds);
  preferences.putBool("saved", true);
  preferences.end();
  return true;
}

bool hasCompleteWidgetConfig(const WidgetConfig &config) {
  if (looksLikePlaceholder(config.wifiSsid)) return false;
  if (!config.bridgeUrl.startsWith("http://")) return false;
  if (config.bridgeUrl.indexOf("localhost") >= 0 || config.bridgeUrl.indexOf("127.0.0.1") >= 0) {
    return false;
  }
  return config.pollIntervalSeconds >= 2 && config.pollIntervalSeconds <= 60
      && isSupportedTimezone(config.timezoneId);
}
