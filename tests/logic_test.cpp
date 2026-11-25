#include "supervision.h"
#include <stdio.h>
#include <stdlib.h>
using namespace SmartBin;
static unsigned checks=0;
#define CHECK(x) do { ++checks; if(!(x)){fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#x);exit(1);} } while(0)
static void establish(SupervisedAssessment& a){for(int i=0;i<3;++i)a.sample(0,0,2,3);CHECK(a.emptyVerified());}
static void serviceCase(float aCm,float bCm,bool expectPass){
  Level a,b;SupervisedAssessment guard;ServiceCycle service;
  service.begin();CHECK(service.mode==ServiceMode::Servicing);CHECK(service.finish());
  for(unsigned i=0;i<5;++i){
    bool va=a.sample(aCm,40,4),vb=b.sample(bCm,40,4);
    if(va&&vb)guard.sample(a.percent,b.percent,2,3);else guard.unavailable(a.fault||b.fault);
    service.observe((i+1)*2000,true,va&&vb,nearEmpty(a.percent,b.percent,2),guard.emptyVerified());
    if(!expectPass)CHECK(!guard.full());
  }
  CHECK(service.mode==(expectPass?ServiceMode::Operating:ServiceMode::Failed));
  CHECK(guard.emptyVerified()==expectPass);
}
int main(){
  Lid lid;lid.tick(0,false);CHECK(!lid.open);lid.tick(100,true);CHECK(lid.open);
  lid.tick(5000,true);CHECK(lid.open);lid.tick(7999,false);CHECK(lid.open);lid.tick(8000,false);CHECK(!lid.open);
  lid.tick(8100,false,true);CHECK(lid.open);lid.tick(20000,false,true);CHECK(lid.open);
  lid.tick(22999,false,false);CHECK(lid.open);lid.tick(23000,false,false);CHECK(!lid.open);
  lid.requestOpen(24000);lid.tick(24000,false);CHECK(lid.open);lid.tick(29000,false);CHECK(!lid.open);
  lid.tick(30000,false,false,true);CHECK(lid.open); // Service hold has no automatic timeout.
  lid.tick(60000,true,false,false);CHECK(lid.open); // A request to leave service cannot overrule a hand.
  Presence mouth;mouth.tick(100,true);CHECK(!mouth.prolonged(2099,2000));CHECK(mouth.prolonged(2100,2000));
  mouth.tick(2101,false);CHECK(!mouth.prolonged(9000,2000));
  mouth.tick(0xfffffff0u,true);CHECK(mouth.prolonged(0x7c0u,2000));
  Button button;CHECK(!button.pressed(0,false));CHECK(!button.pressed(1,true));CHECK(!button.pressed(2,false));
  CHECK(!button.pressed(3,true));CHECK(!button.pressed(40,true));CHECK(button.pressed(43,true));CHECK(!button.pressed(44,true));
  CHECK(!button.pressed(45,false));CHECK(!button.pressed(85,false));CHECK(!button.pressed(90,true));CHECK(button.pressed(130,true));
  Level measure;CHECK(!measure.sample(400,40,4));CHECK(measure.fault);CHECK(!measure.sample(NAN,40,4));
  CHECK(!measure.sample(1,40,4));CHECK(!measure.sample(20,4,40));measure.reset();
  CHECK(!measure.sample(40,40,4));CHECK(!measure.sample(40,40,4));CHECK(measure.sample(40,40,4));CHECK(measure.percent==0);
  CHECK(measure.sample(7,40,4));CHECK(measure.percent==0);CHECK(measure.sample(40,40,4));CHECK(measure.percent==0);
  measure.reset();CHECK(!measure.valid&&!measure.fault); // Bag check cannot reuse samples taken before replacement.
  SupervisedAssessment guarded;establish(guarded);guarded.sample(95,95,2,3);
  CHECK(guarded.state()==LevelState::InspectionRequired);CHECK(!guarded.full());
  for(int i=0;i<20;++i){guarded.sample(95,95,2,3);CHECK(!guarded.full());CHECK(!guarded.emptyVerified());}
  guarded.sample(0,0,2,3);CHECK(!guarded.emptyVerified());guarded.sample(0,0,2,3);CHECK(!guarded.emptyVerified());
  guarded.sample(0,0,2,3);CHECK(guarded.emptyVerified());CHECK(guarded.state()==LevelState::Normal);
  guarded.sample(50,50,2,3);guarded.suspend();guarded.sample(80,80,2,3);guarded.sample(92,94,2,3);
  CHECK(!guarded.full());guarded.sample(92,94,2,3);CHECK(!guarded.full());guarded.sample(92,94,2,3);CHECK(guarded.full());
  guarded.unavailable(true);CHECK(!guarded.full());guarded.sample(92,94,2,3);CHECK(!guarded.full());CHECK(!guarded.emptyVerified());
  guarded.reset();for(int i=0;i<10;++i){guarded.sample(99,99,2,3);CHECK(guarded.state()==LevelState::HighUnverified);CHECK(!guarded.full());}
  guarded.reset();establish(guarded);for(int i=0;i<10;++i){guarded.sample(99,0,1,3);CHECK(!guarded.full());}
  serviceCase(40,40,true);serviceCase(4,4,false);serviceCase(7,40,false);serviceCase(40,7,false);
  ServiceCycle failed;CHECK(!failed.finish());failed.begin();CHECK(failed.finish());CHECK(!failed.finish());
  for(unsigned t=0;t<=20000;t+=2000)failed.observe(t,true,false,false,false);
  CHECK(failed.mode==ServiceMode::Failed);CHECK(failed.finish());
  for(unsigned t=0;t<=30000;t+=2000)failed.observe(t,false,true,false,false);
  CHECK(failed.mode==ServiceMode::Verifying); // Open lid / blocked mouth pauses validation, not a false pass.
  failed.begin();CHECK(failed.mode==ServiceMode::Servicing);
  CHECK(commandFresh(1000,6000));CHECK(!commandFresh(6000,6000));CHECK(!commandFresh(6001,6000));
  CHECK(!commandFresh(1000,11001));CHECK(commandFresh(0xfffffff0u,0x20u));CHECK(elapsed(0x20u,0xfffffff0u)==48);
  printf("PASS: %u native checks: lid, mouth persistence, debounce, echo bounds, median, paper/bag guards, service success/failure/recovery, expiry/rollover.\n",checks);
}
