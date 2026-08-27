#include "ble_thermometer.h"

#include <BLEAdvertisedDevice.h>
#include <BLEClient.h>
#include <BLEDevice.h>
#include <BLERemoteCharacteristic.h>
#include <BLERemoteService.h>
#include <BLEScan.h>

namespace {
constexpr char kTargetName[] = "LYWSD03MMC";
constexpr char kServiceUuid[] = "ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6";
constexpr char kReadingCharacteristicUuid[] = "ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6";
constexpr char kBatteryCharacteristicUuid[] = "ebe0ccc4-7a0a-4b0c-8a1a-6ff2997da3a6";
constexpr uint32_t kScanDurationSeconds = 5;
constexpr TickType_t kReadIntervalTicks = pdMS_TO_TICKS(60000);

BleThermometerReading reading;
portMUX_TYPE readingMux = portMUX_INITIALIZER_UNLOCKED;
TaskHandle_t taskHandle = nullptr;

void setState(BleThermometerState state) {
  portENTER_CRITICAL(&readingMux);
  reading.state = state;
  portEXIT_CRITICAL(&readingMux);
}

void publishReading(float temperatureC, uint8_t humidityPercent,
                    uint16_t batteryMillivolts, uint8_t batteryPercent, int rssi) {
  portENTER_CRITICAL(&readingMux);
  reading.temperatureC = temperatureC;
  reading.humidityPercent = humidityPercent;
  reading.batteryMillivolts = batteryMillivolts;
  reading.batteryPercent = batteryPercent;
  reading.rssi = rssi;
  reading.updatedAtMs = millis();
  reading.state = BleThermometerState::kReady;
  reading.hasValue = true;
  portEXIT_CRITICAL(&readingMux);
}

bool decodeReading(const std::string &value, float &temperatureC,
                   uint8_t &humidityPercent, uint16_t &batteryMillivolts) {
  if (value.size() < 5) return false;

  const auto *bytes = reinterpret_cast<const uint8_t *>(value.data());
  const int16_t rawTemperature = static_cast<int16_t>(
      static_cast<uint16_t>(bytes[0]) | (static_cast<uint16_t>(bytes[1]) << 8));
  temperatureC = rawTemperature / 100.0f;
  humidityPercent = bytes[2];
  batteryMillivolts = static_cast<uint16_t>(bytes[3]) |
                      (static_cast<uint16_t>(bytes[4]) << 8);

  return rawTemperature >= -4000 && rawTemperature <= 8500 &&
         humidityPercent <= 100 && batteryMillivolts >= 1500 && batteryMillivolts <= 4000;
}

bool findTarget(BLEAdvertisedDevice &target, int &rssi) {
  BLEScan *scan = BLEDevice::getScan();
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(50);

  BLEScanResults results = scan->start(kScanDurationSeconds, false);
  bool found = false;
  rssi = -127;
  for (int index = 0; index < results.getCount(); index++) {
    BLEAdvertisedDevice candidate = results.getDevice(index);
    if (!candidate.haveName() || candidate.getName() != kTargetName) continue;
    if (!found || candidate.getRSSI() > rssi) {
      target = candidate;
      rssi = candidate.getRSSI();
      found = true;
    }
  }
  scan->clearResults();
  return found;
}

bool readTarget(BLEAdvertisedDevice &target, int scanRssi) {
  BLEClient *client = BLEDevice::createClient();
  if (client == nullptr) return false;

  bool success = false;
  if (client->connect(&target)) {
    BLERemoteService *service = client->getService(kServiceUuid);
    BLERemoteCharacteristic *readingCharacteristic =
        service == nullptr ? nullptr : service->getCharacteristic(kReadingCharacteristicUuid);

    if (readingCharacteristic != nullptr && readingCharacteristic->canRead()) {
      const std::string rawReading = readingCharacteristic->readValue();
      float temperatureC = 0.0f;
      uint8_t humidityPercent = 0;
      uint16_t batteryMillivolts = 0;
      if (decodeReading(rawReading, temperatureC, humidityPercent, batteryMillivolts)) {
        uint8_t batteryPercent = 0;
        BLERemoteCharacteristic *batteryCharacteristic =
            service->getCharacteristic(kBatteryCharacteristicUuid);
        if (batteryCharacteristic != nullptr && batteryCharacteristic->canRead()) {
          const std::string rawBattery = batteryCharacteristic->readValue();
          if (!rawBattery.empty()) {
            batteryPercent = min<uint8_t>(100, static_cast<uint8_t>(rawBattery[0]));
          }
        }
        publishReading(temperatureC, humidityPercent, batteryMillivolts,
                       batteryPercent, scanRssi);
        Serial.printf("[ble] %.2f C, %u%% RH, %u%% battery, %u mV, %d dBm\n",
                      temperatureC, humidityPercent, batteryPercent,
                      batteryMillivolts, scanRssi);
        success = true;
      }
    }
    client->disconnect();
    const unsigned long disconnectStartedAt = millis();
    while (client->isConnected() && millis() - disconnectStartedAt < 1000) {
      delay(25);
    }
  }

  delete client;
  return success;
}

void bleThermometerTask(void *) {
  BLEDevice::init("Codex Widget");
  Serial.println("[ble] thermometer reader started");

  while (true) {
    setState(BleThermometerState::kScanning);
    BLEAdvertisedDevice target;
    int rssi = -127;
    if (!findTarget(target, rssi)) {
      Serial.println("[ble] LYWSD03MMC not found");
      setState(BleThermometerState::kNotFound);
    } else {
      Serial.printf("[ble] LYWSD03MMC found at %d dBm\n", rssi);
      setState(BleThermometerState::kConnecting);
      if (!readTarget(target, rssi)) {
        Serial.println("[ble] thermometer read failed");
        setState(BleThermometerState::kReadError);
      }
    }
    vTaskDelay(kReadIntervalTicks);
  }
}
}  // namespace

void startBleThermometer() {
  if (taskHandle != nullptr) return;
  const BaseType_t created = xTaskCreate(bleThermometerTask, "ble-thermometer", 8192,
                                         nullptr, 1, &taskHandle);
  if (created != pdPASS) {
    taskHandle = nullptr;
    setState(BleThermometerState::kReadError);
    Serial.println("[ble] unable to create thermometer task");
  }
}

BleThermometerReading getBleThermometerReading() {
  portENTER_CRITICAL(&readingMux);
  const BleThermometerReading snapshot = reading;
  portEXIT_CRITICAL(&readingMux);
  return snapshot;
}
