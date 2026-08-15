#pragma once

#include <TFT_eSPI.h>

#include "device_config.h"

constexpr uint8_t kConfigButtonPin = 0;
constexpr unsigned long kConfigButtonHoldMs = 4000;

bool startLanConfigServer(WidgetConfig &currentConfig);
void handleLanConfigServer();

[[noreturn]] void runConfigPortal(TFT_eSPI &tft, const WidgetConfig &currentConfig,
                                  const String &reason);
