#include "controller.h"
#include <stdio.h>
#include <string.h>
using namespace SmartBin;

static void number(float value,bool valid) {
  if(valid && isfinite(value)) printf("%.3f",static_cast<double>(value)); else printf("null");
}
int main() {
  Controller model;
  unsigned fullBuzzerPulses=0;
  bool previousTone=false;
  char line[256];
  // Local pipe protocol only: uptime hand cmA cmB command. 8 resets the device.
  while(fgets(line,sizeof(line),stdin)) {
    unsigned now=0,hand=0,action=0;float a=40,b=40;
    if(sscanf(line,"%u %u %f %f %u",&now,&hand,&a,&b,&action)!=5) continue;
    if(action==8) {
      model=Controller();
      fullBuzzerPulses=0;
      previousTone=false;
    }
    const bool applied=action>0 && action<8 ? model.command(static_cast<Control>(action-1),now) : true;
    model.tick(now,hand!=0);
    const unsigned sensor=model.nextSensor(now);
    if(sensor) model.sample(now,sensor,sensor==1?a:b);
    const bool ok=model.sensorOk(now),okA=model.okA(now),okB=model.okB(now);
    const bool tone=model.fullAlarmTone(now);
    if(tone&&!previousTone) ++fullBuzzerPulses;
    previousTone=tone;
    printf("{\"schema\":4,\"source\":\"desktop_simulator\",\"remote_control\":true,\"mouth_sensor_available\":false,\"mouth_blocked\":null,\"lid_position_confirmed\":false,\"uptime_ms\":%u,\"sensor_count\":%u,\"sample_pairs\":%u,\"measurement_status\":\"%s\",\"level_state\":\"%s\",\"service_mode\":\"%s\",\"empty_verified\":%s,\"sensor_ok\":%s,\"sensor_a_ok\":%s,\"sensor_b_ok\":%s,\"full\":%s,\"lid\":\"%s\",\"hand_detected\":%s,\"hand_held\":%s,\"muted\":%s,\"open_count\":%u,\"mode\":\"%s\",\"command_applied\":%s,\"sample_age_ms\":%u,",
      now,Config::LEVEL_SENSOR_COUNT,model.pairs,model.measurementStatus(now),stateName(model.state(now)),serviceName(model.service.mode),
      model.assessment.emptyVerified()?"true":"false",ok?"true":"false",okA?"true":"false",okB?"true":"false",
      model.full(now)?"true":"false",model.lid.open?"open":"closed",hand?"true":"false",model.handHeld(now)?"true":"false",
      model.lid.muted?"true":"false",model.openCount,model.lid.remote?"remote_timed":"auto",applied?"true":"false",
      elapsed(now,model.lastA)>elapsed(now,model.lastB)?elapsed(now,model.lastA):elapsed(now,model.lastB));
    printf("\"full_buzzer_pulses\":%u,",fullBuzzerPulses);
    printf("\"distance_a_cm\":");number(model.a.distance,okA);
    printf(",\"distance_b_cm\":");number(model.b.distance,okB);
    printf(",\"fill_a_percent\":");number(model.a.percent,okA);
    printf(",\"fill_b_percent\":");number(model.b.percent,okB);
    printf(",\"distance_cm\":");number(Config::LEVEL_SENSOR_COUNT==2?(model.a.distance+model.b.distance)/2:model.a.distance,ok);
    printf(",\"fill_percent\":");number(Config::LEVEL_SENSOR_COUNT==2?(model.a.percent+model.b.percent)/2:model.a.percent,ok);
    printf("}\n");fflush(stdout);
  }
  return 0;
}
