#pragma once
#include <stdint.h>
#include <math.h>

// Platform-independent control logic. All time comparisons survive millis rollover.
namespace SmartBin {
constexpr uint32_t elapsed(uint32_t now, uint32_t then) { return now - then; }
constexpr uint32_t CLOSE_HOLD_MS = 3000;
constexpr uint32_t REMOTE_OPEN_MS = 5000;

class Lid {
 public:
  bool hand = false;
  bool open = false;
  bool muted = false;
  bool remote = false;
  void tick(uint32_t now, bool detected, bool mouthBlocked=false, bool servicing=false) {
    hand = detected;
    if (hand || mouthBlocked) { lastHand_ = now; sawHand_ = true; }
    if (remote && elapsed(now, remoteAt_) >= REMOTE_OPEN_MS) remote = false;
    open = hand || mouthBlocked || servicing || remote || (sawHand_ && elapsed(now, lastHand_) < CLOSE_HOLD_MS);
  }
  void requestOpen(uint32_t now) { remote = true; remoteAt_ = now; }
  void requestAuto() { remote = false; }
 private:
  uint32_t lastHand_ = 0, remoteAt_ = 0;
  bool sawHand_ = false;
};

class Level {
 public:
  bool valid = false;
  bool fault = false;
  float distance = 0, percent = 0;
  void reset() { *this = Level(); }
  bool sample(float cm, float emptyCm, float fullCm) {
    // A missing echo is a fault, never an empty bin or a fresh valid value.
    if (!isfinite(cm) || cm < 2 || cm > 400 || cm > emptyCm + 5 || emptyCm <= fullCm) {
      valid = false; fault = true; count_ = 0; return false;
    }
    samples_[next_] = cm; next_ = (next_ + 1) % 3;
    if (count_ < 3) ++count_;
    if (count_ < 3) { valid = false; return false; }
    float a = samples_[0], b = samples_[1], c = samples_[2];
    distance = fmaxf(fminf(a,b), fminf(fmaxf(a,b),c)); // Median of 3.
    percent = fmaxf(0, fminf(100, (emptyCm-distance)*100/(emptyCm-fullCm)));
    valid = true;
    fault = false;
    return true;
  }
 private:
  float samples_[3] = {};
  unsigned next_ = 0, count_ = 0;
};

enum class LevelState : uint8_t {
  Warming, Settling, SensorFault, Normal, Checking,
  ObstructionSuspected, HighUnverified, Full, InspectionRequired,
  MouthBlocked, Service, EmptyCheck, BagCheckFailed
};
inline const char* stateName(LevelState s) {
  switch (s) {
    case LevelState::Warming: return "warming";
    case LevelState::Settling: return "settling";
    case LevelState::SensorFault: return "sensor_fault";
    case LevelState::Normal: return "normal";
    case LevelState::Checking: return "checking";
    case LevelState::ObstructionSuspected: return "obstruction_suspected";
    case LevelState::HighUnverified: return "high_unverified";
    case LevelState::Full: return "full";
    case LevelState::InspectionRequired: return "inspection_required";
    case LevelState::MouthBlocked: return "mouth_blocked";
    case LevelState::Service: return "service";
    case LevelState::EmptyCheck: return "empty_check";
    case LevelState::BagCheckFailed: return "bag_check_failed";
  }
  return "sensor_fault";
}

// A pure transition function allows the actual firmware policy to be checked by
// static_assert during compilation, without starting WiFi or a simulator.
struct Evaluation {
  LevelState state;
  bool full;
  unsigned fullStreak, mismatchStreak;
  bool singleHigh;
  constexpr Evaluation(LevelState s=LevelState::Warming, bool f=false,
      unsigned n=0, unsigned m=0, bool h=false)
    : state(s), full(f), fullStreak(n), mismatchStreak(m), singleHigh(h) {}
};
constexpr unsigned advance(unsigned n, unsigned limit) { return n < limit ? n+1 : limit; }
constexpr Evaluation evaluateHigh(Evaluation previous, unsigned count) {
  return Evaluation(previous.full || advance(previous.fullStreak,count)>=count ? LevelState::Full : LevelState::Checking,
    previous.full || advance(previous.fullStreak,count)>=count, advance(previous.fullStreak,count));
}
constexpr Evaluation evaluateMismatch(Evaluation previous, unsigned count) {
  return Evaluation(advance(previous.mismatchStreak,count)>=count ? LevelState::ObstructionSuspected : LevelState::Checking,
    false,0,advance(previous.mismatchStreak,count));
}
constexpr Evaluation evaluateMiddle(Evaluation previous, float a, float b) {
  return Evaluation(previous.full && a>=85 && b>=85 ? LevelState::Full :
    ((a>90 || b>90) ? LevelState::Checking : LevelState::Normal), previous.full && a>=85 && b>=85);
}
constexpr Evaluation evaluateSingle(Evaluation previous, float a) {
  return Evaluation(a>90 || (previous.singleHigh && a>=85) ? LevelState::HighUnverified : LevelState::Normal,
    false,0,0,a>90 || (previous.singleHigh && a>=85));
}
constexpr Evaluation evaluateLevel(Evaluation previous, float a, float b, unsigned sensors, unsigned count) {
  return count==0 || (sensors!=1 && sensors!=2) || !(a>=0 && a<=100) || (sensors==2 && !(b>=0 && b<=100)) ? Evaluation(LevelState::SensorFault) :
    sensors==1 ? evaluateSingle(previous,a) :
    ((a>90 && b<85) || (b>90 && a<85)) ? evaluateMismatch(previous,count) :
    (a>90 && b>90) ? evaluateHigh(previous,count) : evaluateMiddle(previous,a,b);
}

// Two spatial samples provide evidence, not identification of the object/material.
// Call sample() exactly once per new measurement pair, never per main-loop tick.
class Assessment {
 public:
  LevelState state = LevelState::Warming;
  bool full = false;
  void suspend() { set(Evaluation(LevelState::Settling)); }
  void unavailable(bool fault) { set(Evaluation(fault ? LevelState::SensorFault : LevelState::Warming)); }
  void sample(float a, float b, unsigned sensors, unsigned confirmations) {
    set(evaluateLevel(previous_,a,b,sensors,confirmations));
  }
 private:
  Evaluation previous_;
  void set(Evaluation next) { previous_=next; state=next.state; full=next.full; }
};
}
