#pragma once

#include <Arduino.h>

enum class BleThermometerState : uint8_t {
  kStarting,
  kScanning,
  kConnecting,
  kReady,
  kNotFound,
  kReadError,
};

struct BleThermometerReading {
  float temperatureC = 0.0f;
  uint16_t batteryMillivolts = 0;
  uint32_t updatedAtMs = 0;
  int16_t rssi = 0;
  uint8_t humidityPercent = 0;
  uint8_t batteryPercent = 0;
  BleThermometerState state = BleThermometerState::kStarting;
  bool hasValue = false;
};

// Starts a background BLE client task. The task scans for the strongest
// LYWSD03MMC, reads it briefly, disconnects, and retries once per minute.
void startBleThermometer();

// Returns a thread-safe snapshot for rendering from the Arduino loop task.
BleThermometerReading getBleThermometerReading();
