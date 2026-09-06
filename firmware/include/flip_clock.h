#pragma once

#include <cmath>
#include <cstdint>

namespace flip_clock {
constexpr unsigned long kDurationMs = 650;
constexpr unsigned long kFoldMs = 300;
constexpr unsigned long kEdgePauseMs = 40;

struct Frame {
  bool falling;
  int height;
  int light;
};

inline Frame frame(unsigned long elapsed, int halfHeight) {
  if (elapsed >= kDurationMs) return {true, halfHeight, 255};
  const bool falling = elapsed >= kFoldMs;
  float projection;
  if (!falling) {
    const float t = static_cast<float>(elapsed) / kFoldMs;
    projection = std::cos(t * t * 1.570796327f);
  } else {
    const float t = elapsed < kFoldMs + kEdgePauseMs ? 0.0f :
        static_cast<float>(elapsed - kFoldMs - kEdgePauseMs) /
        (kDurationMs - kFoldMs - kEdgePauseMs);
    projection = std::sin((1.0f - (1.0f - t) * (1.0f - t)) * 1.570796327f);
  }
  return {falling, static_cast<int>(halfHeight * projection + 0.5f),
          static_cast<int>(95 + 160 * projection)};
}

struct Row {
  bool oldPage;
  bool moving;
  int sourceY;
};

inline Row row(const Frame &motion, int y, int halfHeight) {
  if (!motion.falling && y < halfHeight && y >= halfHeight - motion.height) {
    return {true, true, (y - halfHeight + motion.height) * halfHeight / motion.height};
  }
  if (motion.falling && y >= halfHeight && y < halfHeight + motion.height) {
    return {false, true, halfHeight + (y - halfHeight) * halfHeight / motion.height};
  }
  return {y >= halfHeight, false, y};
}

inline uint16_t shadeSwapped565(uint16_t swapped, int light) {
  const uint16_t pixel = (swapped >> 8) | (swapped << 8);
  const uint16_t shaded = (((pixel >> 11) * light / 255) << 11) |
      ((((pixel >> 5) & 63) * light / 255) << 5) | ((pixel & 31) * light / 255);
  return (shaded >> 8) | (shaded << 8);
}

inline bool isNextSecond(int oldHour, int oldMinute, int oldSecond,
                         int hour, int minute, int second) {
  if (oldHour < 0 || oldMinute < 0 || oldSecond < 0) return false;
  const int before = oldHour * 3600 + oldMinute * 60 + oldSecond;
  const int after = hour * 3600 + minute * 60 + second;
  return (before + 1) % 86400 == after;
}
}  // namespace flip_clock
