#pragma once
#include "bin_logic.h"
namespace SmartBin {
// New measurements, not repeated MQTT packets, drive this policy.
struct GuardState {
  Evaluation result;
  float lastA, lastB;
  bool hasPrevious, emptyVerified, suspect;
  unsigned emptyStreak;
  constexpr GuardState(Evaluation r=Evaluation(),float a=0,float b=0,bool p=false,
      bool v=false,bool s=false,unsigned n=0)
    : result(r),lastA(a),lastB(b),hasPrevious(p),emptyVerified(v),suspect(s),emptyStreak(n) {}
};
constexpr bool nearEmpty(float a,float b,unsigned sensors) { return a<=15 && (sensors==1 || b<=15); }
constexpr bool abruptHigh(GuardState p,float a,float b,unsigned sensors) {
  return p.hasPrevious && (a>90 || (sensors==2 && b>90)) &&
    (a-p.lastA>30 || (sensors==2 && b-p.lastB>30));
}
constexpr GuardState remember(GuardState p,Evaluation result,float a,float b) {
  return GuardState(result,a,b,true,p.emptyVerified,
    p.suspect || result.state==LevelState::ObstructionSuspected,0);
}
constexpr GuardState guardNonEmpty(GuardState p,float a,float b,unsigned sensors,unsigned confirmations) {
  return p.suspect || abruptHigh(p,a,b,sensors) ?
    GuardState(Evaluation(LevelState::InspectionRequired),a,b,true,false,true,0) :
    (!p.emptyVerified && (a>90 || (sensors==2 && b>90))) ?
    GuardState(Evaluation(LevelState::HighUnverified),a,b,true,false,false,0) :
    remember(p,evaluateLevel(p.result,a,b,sensors,confirmations),a,b);
}
constexpr GuardState guardStep(GuardState p,float a,float b,unsigned sensors,unsigned confirmations) {
  return !(a>=0 && a<=100) || (sensors==2 && !(b>=0 && b<=100)) || confirmations==0 || (sensors!=1 && sensors!=2) ?
    GuardState(Evaluation(LevelState::SensorFault)) :
    nearEmpty(a,b,sensors) ? GuardState(
      Evaluation((p.suspect && advance(p.emptyStreak,confirmations)<confirmations) ? LevelState::InspectionRequired : LevelState::Normal),
      a,b,true,advance(p.emptyStreak,confirmations)>=confirmations,
      p.suspect && advance(p.emptyStreak,confirmations)<confirmations,advance(p.emptyStreak,confirmations)) :
    guardNonEmpty(p,a,b,sensors,confirmations);
}
class SupervisedAssessment {
 public:
  GuardState data;
  LevelState state() const { return data.result.state; }
  bool full() const { return data.result.full; }
  bool emptyVerified() const { return data.emptyVerified && !data.suspect; }
  void reset() { data=GuardState(); }
  void suspend() {
    data=GuardState(Evaluation(LevelState::Settling),data.lastA,data.lastB,
      data.hasPrevious,data.emptyVerified,data.suspect,0);
  }
  void unavailable(bool fault) {
    data=GuardState(Evaluation(fault?LevelState::SensorFault:LevelState::Warming),
      data.lastA,data.lastB,data.hasPrevious,false,data.suspect,0);
  }
  void sample(float a,float b,unsigned sensors,unsigned n) { data=guardStep(data,a,b,sensors,n); }
};

// A blocked mouth immediately prevents a close command; a warning requires persistence.
class Presence {
 public:
  bool active=false;
  uint32_t since=0;
  void tick(uint32_t now,bool input) { if(input && !active) since=now; active=input; }
  bool prolonged(uint32_t now,uint32_t ms) const { return active && elapsed(now,since)>=ms; }
};
class Button {
 public:
  bool pressed(uint32_t now,bool raw) {
    if(raw!=raw_) { raw_=raw; changed_=now; }
    if(raw_!=stable_ && elapsed(now,changed_)>=40) { stable_=raw_; return stable_; }
    return false;
  }
 private:
  bool raw_=false,stable_=false;
  uint32_t changed_=0;
};
enum class ServiceMode:uint8_t { Operating, Servicing, Verifying, Failed };
inline const char* serviceName(ServiceMode mode) {
  return mode==ServiceMode::Servicing?"servicing":mode==ServiceMode::Verifying?"verifying_empty":
    mode==ServiceMode::Failed?"service_failed":"operating";
}
class ServiceCycle {
 public:
  ServiceMode mode=ServiceMode::Operating;
  void begin() { mode=ServiceMode::Servicing; started_=false; bad_=0; }
  bool finish() {
    if(mode!=ServiceMode::Servicing && mode!=ServiceMode::Failed) return false;
    mode=ServiceMode::Verifying; started_=false; bad_=0; return true;
  }
  void observe(uint32_t now,bool stable,bool valid,bool isEmpty,bool verified) {
    if(mode!=ServiceMode::Verifying)return;
    if(!stable){started_=false;bad_=0;return;}
    if(!started_){started_=true;since_=now;}
    if(valid && isEmpty && verified){mode=ServiceMode::Operating;return;}
    if(valid && !isEmpty){if(bad_<3)++bad_;}else bad_=0;
    if(bad_>=3 || elapsed(now,since_)>=20000)mode=ServiceMode::Failed;
  }
 private:
  bool started_=false;
  uint32_t since_=0;
  unsigned bad_=0;
};
// Deadline uses the device's own boot/uptime epoch: no wall clock or NTP dependency.
constexpr bool commandFresh(uint32_t now,uint32_t deadline) {
  return static_cast<int32_t>(deadline-now)>0 && static_cast<int32_t>(deadline-now)<=10000;
}
}
