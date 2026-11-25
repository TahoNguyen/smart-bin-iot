#pragma once
#include "config.h"
#include "supervision.h"

namespace SmartBin {
enum class Control : uint8_t { Open, Auto, Mute, Unmute, BeginService, FinishService, Recheck };

// Shared by ESP32 firmware and the desktop simulator. Distances enter only at
// scheduled sampling instants; UI animation is never position feedback.
class Controller {
 public:
  Lid lid;
  Level a, b;
  SupervisedAssessment assessment;
  ServiceCycle service;
  Presence handPresence;
  uint32_t openCount=0, pairs=0, lastChange=0, lastA=0, lastB=0;

  bool command(Control action, uint32_t now) {
    switch(action) {
      case Control::Open: lid.requestOpen(now); break;
      case Control::Auto: lid.requestAuto(); break;
      case Control::Mute: lid.muted=true; break;
      case Control::Unmute: lid.muted=false; break;
      case Control::BeginService:
        service.begin(); lid.requestAuto(); reset(now); break;
      case Control::FinishService:
        if(!service.finish()) return false;
        lid.requestAuto(); reset(now); break;
      case Control::Recheck:
        if(service.mode!=ServiceMode::Operating) return false;
        reset(now); break;
    }
    return true;
  }
  void tick(uint32_t now, bool hand) {
    handPresence.tick(now,hand);
    const bool before=lid.open;
    lid.tick(now,hand,false,service.mode==ServiceMode::Servicing);
    if(before!=lid.open) {
      lastChange=now;
      if(lid.open) ++openCount;
      clearFilters();
      assessment.suspend(); // Keep historical suspicion / empty reference.
    }
  }
  bool canMeasure(uint32_t now) const {
    return !lid.open && service.mode!=ServiceMode::Servicing &&
      elapsed(now,lastChange)>=Config::LID_SETTLE_MS;
  }
  // 0: no trigger; 1: sensor A; 2: sensor B. Never trigger both together.
  unsigned nextSensor(uint32_t now) const {
    if(!canMeasure(now)) return 0;
    if(waitingB_) return elapsed(now,firstAt_)>=Config::SENSOR_GAP_MS ? 2 : 0;
    return !started_ || elapsed(now,lastCycle_)>=Config::LEVEL_INTERVAL_MS ? 1 : 0;
  }
  bool sample(uint32_t now, unsigned sensor, float cm) {
    if(sensor==0 || sensor!=nextSensor(now)) return false;
    if(sensor==1) {
      filterA_.sample(cm,Config::EMPTY_CM,Config::FULL_CM);
      firstAt_=now; lastCycle_=now; started_=true;
      waitingB_=Config::LEVEL_SENSOR_COUNT==2;
      if(waitingB_) return true;
    } else {
      filterB_.sample(cm,Config::EMPTY_B_CM,Config::FULL_B_CM);
      waitingB_=false;
    }
    // Publish/assess a completed pair atomically. Do not mix the new A value
    // with the previous B value during the acoustic quiet gap.
    a=filterA_; b=filterB_; lastA=firstAt_;
    if(Config::LEVEL_SENSOR_COUNT==2) lastB=now;
    ++pairs;
    const bool valid=a.valid && (Config::LEVEL_SENSOR_COUNT==1 || b.valid);
    if(valid) assessment.sample(a.percent,b.percent,Config::LEVEL_SENSOR_COUNT,Config::CONFIRM_PAIRS);
    else if(a.fault || (Config::LEVEL_SENSOR_COUNT==2 && b.fault)) assessment.unavailable(true);
    // The first two new samples rebuild the median, not an actual echo fault.
    // Preserve the history across a lid cycle until a real measurement arrives.
    else assessment.suspend();
    const bool empty=nearEmpty(a.percent,b.percent,Config::LEVEL_SENSOR_COUNT);
    service.observe(now,true,valid,empty,assessment.emptyVerified());
    if(valid&&empty&&assessment.emptyVerified()){
      fullAlarmPlayed_=false;
      fullAlarmActive_=false;
    }
    return true;
  }
  bool okA(uint32_t now) const {
    return canMeasure(now) && a.valid && elapsed(now,lastA)<=Config::SENSOR_STALE_MS;
  }
  bool okB(uint32_t now) const {
    return Config::LEVEL_SENSOR_COUNT==2 && canMeasure(now) && b.valid && elapsed(now,lastB)<=Config::SENSOR_STALE_MS;
  }
  bool sensorOk(uint32_t now) const { return okA(now) && (Config::LEVEL_SENSOR_COUNT==1 || okB(now)); }
  const char* measurementStatus(uint32_t now) const {
    if(lid.open) return "paused_open";
    if(!canMeasure(now)) return "settling";
    if(a.fault || (Config::LEVEL_SENSOR_COUNT==2 && b.fault) ||
       (a.valid && !okA(now)) || (b.valid && Config::LEVEL_SENSOR_COUNT==2 && !okB(now))) return "fault";
    return sensorOk(now) ? "ready" : "warming";
  }
  LevelState state(uint32_t now) const {
    if(service.mode==ServiceMode::Servicing) return LevelState::Service;
    if(service.mode==ServiceMode::Failed) return LevelState::BagCheckFailed;
    if(service.mode==ServiceMode::Verifying) return LevelState::EmptyCheck;
    if(!canMeasure(now)) return LevelState::Settling;
    if(!sensorOk(now)) return measurementStatus(now)[0]=='f' ? LevelState::SensorFault : LevelState::Warming;
    return assessment.state();
  }
  bool full(uint32_t now) const { return sensorOk(now) && state(now)==LevelState::Full; }
  bool fullAlarmTone(uint32_t now) {
    const bool confirmedFull=full(now);
    if(confirmedFull&&!fullAlarmPlayed_){
      fullAlarmPlayed_=true;
      fullAlarmActive_=true;
      fullAlarmStartedAt_=now;
    }
    if(!fullAlarmActive_) return false;
    const uint32_t age=elapsed(now,fullAlarmStartedAt_);
    constexpr unsigned duration=(Config::FULL_BUZZER_PULSES-1)*Config::FULL_BUZZER_INTERVAL_MS+Config::BUZZER_ON_MS;
    if(age>=duration) fullAlarmActive_=false;
    return fullAlarmActive_&&confirmedFull&&!lid.muted&&age%Config::FULL_BUZZER_INTERVAL_MS<Config::BUZZER_ON_MS;
  }
  bool handHeld(uint32_t now) const { return handPresence.prolonged(now,Config::HAND_WARN_MS); }
  bool warning(uint32_t now) const {
    const LevelState s=state(now);
    return s==LevelState::BagCheckFailed || s==LevelState::InspectionRequired ||
      s==LevelState::ObstructionSuspected || s==LevelState::HighUnverified || s==LevelState::SensorFault ||
      (service.mode==ServiceMode::Operating && handHeld(now));
  }
 private:
  bool waitingB_=false, started_=false;
  bool fullAlarmPlayed_=false, fullAlarmActive_=false;
  Level filterA_,filterB_;
  uint32_t firstAt_=0, lastCycle_=0;
  uint32_t fullAlarmStartedAt_=0;
  void clearFilters() { a.reset(); b.reset(); filterA_.reset(); filterB_.reset(); waitingB_=false; started_=false; lastA=lastB=0; }
  void reset(uint32_t now) { clearFilters(); assessment.reset(); lastChange=now; }
};
}
