#include "controller.h"
#include <stdio.h>
#include <stdlib.h>
using namespace SmartBin;
static unsigned checks=0;
#define CHECK(x) do { ++checks;if(!(x)){fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#x);exit(1);} } while(0)
static void advanceTo(Controller& c,uint32_t& now,unsigned duration,float a=40,float b=40,bool hand=false) {
  for(unsigned t=0;t<duration;t+=20) {
    now+=20;c.tick(now,hand);unsigned sensor=c.nextSensor(now);
    if(sensor)c.sample(now,sensor,sensor==1?a:b);
  }
}
int main() {
  Controller c;uint32_t now=0;
  advanceTo(c,now,1800);CHECK(c.pairs==0);CHECK(!c.sensorOk(now));
  advanceTo(c,now,11000);CHECK(c.assessment.emptyVerified());CHECK(c.state(now)==LevelState::Normal);
  c.tick(now,true);CHECK(c.lid.open);CHECK(!c.a.valid&&!c.b.valid);CHECK(!c.sensorOk(now));
  unsigned pairs=c.pairs;
  advanceTo(c,now,5000,4,4,true);CHECK(c.pairs==pairs);CHECK(c.nextSensor(now)==0);
  CHECK(c.assessment.emptyVerified());CHECK(!c.full(now));
  advanceTo(c,now,2900,4,4);CHECK(c.lid.open);
  advanceTo(c,now,200,4,4);CHECK(!c.lid.open);CHECK(c.nextSensor(now)==0);
  advanceTo(c,now,1700,4,4);CHECK(c.pairs==pairs); // Still settling.
  advanceTo(c,now,1000,4,4);CHECK(!c.a.valid&&!c.b.valid); // Old medians are gone.
  advanceTo(c,now,10000,4,4);CHECK(c.state(now)==LevelState::InspectionRequired);CHECK(!c.full(now));
  // A partly measured pair must be cancelled when the lid opens.
  Controller half;now=2000;half.tick(now,false);CHECK(half.nextSensor(now)==1);
  CHECK(half.sample(now,1,40));CHECK(half.nextSensor(now+79)==0);CHECK(half.nextSensor(now+80)==2);
  half.tick(now+40,true);CHECK(!half.sample(now+100,2,4));CHECK(half.pairs==0);
  // Covered bag fails validation; replacing it with a clear bag recovers.
  CHECK(c.command(Control::BeginService,now));advanceTo(c,now,200,4,4);CHECK(c.lid.open);
  CHECK(c.command(Control::FinishService,now));advanceTo(c,now,15000,4,4);
  CHECK(c.service.mode==ServiceMode::Failed);CHECK(!c.full(now));
  CHECK(c.command(Control::BeginService,now));advanceTo(c,now,100);
  CHECK(c.command(Control::FinishService,now));advanceTo(c,now,15000);
  CHECK(c.service.mode==ServiceMode::Operating);CHECK(c.assessment.emptyVerified());
  // Legitimate gradual rise still reaches likely-full after closing/re-filtering.
  c.tick(now,true);advanceTo(c,now,100,22,22,true);advanceTo(c,now,15000,22,22);
  CHECK(c.assessment.emptyVerified());CHECK(!c.full(now));
  c.tick(now,true);advanceTo(c,now,100,11,11,true);advanceTo(c,now,15000,11,11);
  c.tick(now,true);advanceTo(c,now,100,7,7,true);advanceTo(c,now,17000,7,7);CHECK(c.full(now));
  // A confirmed full bin sounds for 200 ms at 0, 3 and 6 seconds.
  CHECK(c.fullAlarmTone(now));
  advanceTo(c,now,200,7,7);CHECK(!c.fullAlarmTone(now));
  advanceTo(c,now,2800,7,7);CHECK(c.fullAlarmTone(now));
  advanceTo(c,now,200,7,7);CHECK(!c.fullAlarmTone(now));
  advanceTo(c,now,2800,7,7);CHECK(c.fullAlarmTone(now));
  advanceTo(c,now,200,7,7);CHECK(!c.fullAlarmTone(now));
  advanceTo(c,now,2800,7,7);CHECK(c.full(now));CHECK(!c.fullAlarmTone(now));
  c.tick(now,true);advanceTo(c,now,100,7,7,true);advanceTo(c,now,17000,7,7);
  CHECK(c.full(now));CHECK(!c.fullAlarmTone(now)); // Reopening is still the same full bin.
  // Completed pairs are published atomically, including during a full state.
  for(unsigned wait=0;wait<200 && c.nextSensor(now)!=1;++wait) {
    now+=20;c.tick(now,false);
    if(c.nextSensor(now)==2)c.sample(now,2,7);
  }
  CHECK(c.nextSensor(now)==1);
  const float committedA=c.a.distance;
  CHECK(c.sample(now,1,NAN));CHECK(c.a.distance==committedA);CHECK(c.full(now));
  CHECK(c.sample(now+80,2,7));now+=80;CHECK(c.state(now)==LevelState::SensorFault);
  // A missing echo is never displayed as an empty bin. No physical lid feedback.
  advanceTo(c,now,5000,NAN,7);CHECK(!c.sensorOk(now));CHECK(c.state(now)==LevelState::SensorFault);CHECK(!c.full(now));
  advanceTo(c,now,15000);CHECK(c.assessment.emptyVerified());
  advanceTo(c,now,12000,11,11);advanceTo(c,now,12000,7,7);
  CHECK(c.fullAlarmTone(now)); // A new collection cycle can sound again.
  CHECK(c.command(Control::Mute,now));CHECK(!c.fullAlarmTone(now));
  // The same reading at startup is unverified, not proof of full.
  Controller boot;now=0;advanceTo(boot,now,20000,7,7);CHECK(!boot.full(now));CHECK(boot.state(now)==LevelState::HighUnverified);
  // A post-open window also works across millis rollover.
  Controller wrap;uint32_t w=0xfffffff0u;wrap.tick(w,true);wrap.tick(w+3000,false);
  CHECK(!wrap.lid.open);CHECK(wrap.nextSensor(w+4999)==0);CHECK(wrap.nextSensor(w+5000)==1);
  printf("PASS: %u controller checks (lid-mounted gating, fresh filters, pair cancellation, history, service, echo fault, rollover).\n",checks);
}
