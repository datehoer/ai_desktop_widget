#include "flip_clock.h"
#include <cassert>
#include <iostream>

int main() {
  using namespace flip_clock;
  constexpr int half = 76;
  for (unsigned long ms = 0; ms <= 1000; ++ms) {
    const Frame motion = frame(ms, half);
    assert(motion.height >= 0 && motion.height <= half);
    assert(motion.light >= 95 && motion.light <= 255);
    for (int y = 0; y < half * 2; ++y) {
      const Row sample = row(motion, y, half);
      assert(sample.sourceY >= 0 && sample.sourceY < half * 2);
      if (ms == 0) assert(sample.oldPage && sample.sourceY == y);
      if (ms >= kDurationMs) assert(!sample.oldPage && sample.sourceY == y);
      if (ms >= kFoldMs && ms <= kFoldMs + kEdgePauseMs) {
        assert(!sample.moving);
        assert(sample.oldPage == (y >= half));
      }
      // The stationary lower half must retain the old number until the new
      // lower flap reaches it; revealing a full new card early loses the flip.
      if (!motion.falling && y >= half) assert(sample.oldPage && !sample.moving);
      if (motion.falling && y < half) assert(!sample.oldPage && !sample.moving);
    }
  }
  int prior = half;
  for (unsigned long ms = 0; ms < kFoldMs; ++ms) {
    assert(frame(ms, half).height <= prior);
    prior = frame(ms, half).height;
  }
  prior = 0;
  for (unsigned long ms = kFoldMs; ms <= kDurationMs; ++ms) {
    assert(frame(ms, half).height >= prior);
    prior = frame(ms, half).height;
  }
  for (int before = 0; before < 86400; ++before) {
    int after = (before + 1) % 86400;
    assert(isNextSecond(before / 3600, before / 60 % 60, before % 60,
                        after / 3600, after / 60 % 60, after % 60));
  }
  assert(!isNextSecond(-1, -1, -1, 12, 0, 0));
  assert(!isNextSecond(12, 0, 0, 12, 0, 5));
  assert(!isNextSecond(12, 0, 5, 12, 0, 0));
  for (unsigned int pixel = 0; pixel <= 65535; ++pixel) {
    assert(shadeSwapped565(pixel, 255) == pixel);
    assert(shadeSwapped565(pixel, 0) == 0);
  }
  std::cout << "PASS: flap geometry, all daily rollovers, time jumps, RGB565 shading\n";
}
