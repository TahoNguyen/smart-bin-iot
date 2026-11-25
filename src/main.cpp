#include <Arduino.h>
#include "config.h"
#include "controller.h"
#include <esp_system.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_arduino_version.h>
#if BIN_ENABLE_BLYNK
#include <BlynkSimpleEsp32.h>
#endif

// The Arduino loop owns sensors/actuators; the network task owns all clients.
// Queues carry copies, so a stalled MQTT/Blynk connection cannot stall the lid.
struct Snapshot {
  uint32_t uptime, sampleAge;
  float distance, fill;
  float distanceA, distanceB, fillA, fillB;
  uint8_t sensorCount;
  SmartBin::LevelState levelState;
  bool sensorOkA, sensorOkB;
  bool sensorOk, hand, lidOpen, full, muted, remote;
  bool handHeld, emptyVerified;
  const char* measurementStatus;
  SmartBin::ServiceMode serviceMode;
  uint32_t openCount;
  char lastCommandId[49];
  char lastCommandResult[17];
};
using Action = SmartBin::Control;
struct Command { Action action; char id[49]; uint32_t deadline; };
QueueHandle_t snapshotQueue, commandQueue;
SmartBin::Controller controller;
SmartBin::Button serviceButton;
WiFiClient transport;
PubSubClient mqtt(transport);
String telemetryTopic, commandTopic, availabilityTopic;
bool lastLid = false, lastBuzz = false;
char lastCommandId[49] = "";
char lastCommandResult[17] = "none";
char bootId[17] = "";
SmartBin::LevelState lastReportedState=SmartBin::LevelState::Warming;
SmartBin::ServiceMode lastReportedMode=SmartBin::ServiceMode::Operating;
bool lastReportedEmpty=false;

void servoAngle(int degrees) {
  const uint32_t us = map(degrees, 0, 180, Config::SERVO_MIN_US, Config::SERVO_MAX_US);
  const uint32_t duty = us * 65535UL / 20000UL;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(Config::SERVO_PIN, duty);
#else
  ledcWrite(0, duty);
#endif
}

void buzzer(bool on) {
  if (on == lastBuzz) return;
  lastBuzz = on;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(Config::BUZZER_PIN, on ? 2000 : 0);
#else
  ledcWriteTone(2, on ? 2000 : 0);
#endif
}

void onMqtt(char*, byte* payload, unsigned length) {
  if(!Config::REMOTE_CONTROL)return;
  StaticJsonDocument<384> doc;
  if (length > 360 || deserializeJson(doc, payload, length)) return;
  const char* name = doc["command"] | "";
  const char* id = doc["request_id"] | "";
  if (strlen(id) == 0 || strlen(id) > 48) return;
  if(strcmp(doc["boot_id"] | "",bootId) || !doc["expires_at_uptime_ms"].is<uint32_t>())return;
  const uint32_t deadline=doc["expires_at_uptime_ms"].as<uint32_t>();
  if(!SmartBin::commandFresh(millis(),deadline))return;
  static char recent[24][49]={};
  static unsigned next=0;
  for(const auto& previous:recent)if(!strcmp(previous,id))return;
  Command cmd{};
  if (!strcmp(name,"open")) cmd.action = Action::Open;
  else if (!strcmp(name,"auto")) cmd.action = Action::Auto;
  else if (!strcmp(name,"mute")) cmd.action = Action::Mute;
  else if (!strcmp(name,"unmute")) cmd.action = Action::Unmute;
  else if (!strcmp(name,"begin_service")) cmd.action = Action::BeginService;
  else if (!strcmp(name,"finish_service")) cmd.action = Action::FinishService;
  else if (!strcmp(name,"recheck")) cmd.action = Action::Recheck;
  else return;
  strlcpy(cmd.id, id, sizeof(cmd.id));
  cmd.deadline=deadline;
  if (xQueueSend(commandQueue, &cmd, 0) != pdTRUE) Serial.println("COMMAND queue full");
  else {strlcpy(recent[next],id,sizeof(recent[next])); next=(next+1)%24;}
}

void publishSnapshot(const Snapshot& s) {
  StaticJsonDocument<1536> doc;
  doc["schema"] = 4;
  doc["source"] = "esp32";
  doc["mouth_sensor_available"] = false;
  doc["mouth_blocked"] = nullptr;
  doc["lid_position_confirmed"] = false;
  doc["measurement_status"] = s.measurementStatus;
  doc["boot_id"] = bootId;
  doc["remote_control"] = Config::REMOTE_CONTROL;
  doc["device_id"] = "bin-a7f39c";
  doc["uptime_ms"] = s.uptime;
  doc["sample_age_ms"] = s.sampleAge;
  doc["sensor_ok"] = s.sensorOk;
  doc["sensor_count"] = s.sensorCount;
  doc["hand_held"] = s.handHeld;
  doc["empty_verified"] = s.emptyVerified;
  doc["service_mode"] = SmartBin::serviceName(s.serviceMode);
  doc["level_state"] = SmartBin::stateName(s.levelState);
  doc["sensor_a_ok"] = s.sensorOkA;
  doc["sensor_b_ok"] = s.sensorCount == 2 && s.sensorOkB;
  if (s.sensorOkA) { doc["distance_a_cm"] = s.distanceA; doc["fill_a_percent"] = s.fillA; }
  else { doc["distance_a_cm"] = nullptr; doc["fill_a_percent"] = nullptr; }
  if (s.sensorCount == 2 && s.sensorOkB) { doc["distance_b_cm"] = s.distanceB; doc["fill_b_percent"] = s.fillB; }
  else { doc["distance_b_cm"] = nullptr; doc["fill_b_percent"] = nullptr; }
  if (s.sensorOk) { doc["distance_cm"] = s.distance; doc["fill_percent"] = s.fill; }
  else { doc["distance_cm"] = nullptr; doc["fill_percent"] = nullptr; }
  doc["hand_detected"] = s.hand;
  doc["lid"] = s.lidOpen ? "open" : "closed";
  doc["full"] = s.full;
  doc["muted"] = s.muted;
  doc["mode"] = s.remote ? "remote_timed" : "auto";
  doc["open_count"] = s.openCount;
  doc["last_command_id"] = s.lastCommandId;
  doc["last_command_result"] = s.lastCommandResult;
  doc["rssi"] = WiFi.RSSI();
  char output[1536];
  size_t n = serializeJson(doc, output, sizeof(output));
  // Non-retained telemetry: dashboard must receive fresh data after reconnect.
  if (mqtt.connected() && !mqtt.publish(telemetryTopic.c_str(), reinterpret_cast<const uint8_t*>(output), n, false))
    Serial.println("MQTT telemetry publish failed");
#if BIN_ENABLE_BLYNK
  if (Blynk.connected()) {
    Blynk.virtualWrite(V4, s.sensorOk ? 1 : 0);
    if (s.sensorOk) { Blynk.virtualWrite(V0, s.fill); Blynk.virtualWrite(V3, s.distance); }
    Blynk.virtualWrite(V1, s.lidOpen ? 1 : 0);
    Blynk.virtualWrite(V2, s.full ? 1 : 0);
    Blynk.virtualWrite(V5, SmartBin::stateName(s.levelState));
    Blynk.virtualWrite(V6, "not_installed");
    Blynk.virtualWrite(V7, SmartBin::serviceName(s.serviceMode));
  }
#endif
}

void networkTask(void*) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
#ifdef SMARTBIN_REAL
  WiFi.begin(REAL_WIFI_SSID, REAL_WIFI_PASSWORD);
#else
  WiFi.begin("Wokwi-GUEST", "", 6);
#endif
  telemetryTopic = String(BIN_TOPIC_PREFIX) + "/telemetry";
  commandTopic = String(BIN_TOPIC_PREFIX) + "/command";
  availabilityTopic = String(BIN_TOPIC_PREFIX) + "/availability";
  mqtt.setServer(BIN_MQTT_HOST, BIN_MQTT_PORT);
  mqtt.setCallback(onMqtt);
  mqtt.setBufferSize(1800);
  mqtt.setKeepAlive(15);
  mqtt.setSocketTimeout(1);
#if BIN_ENABLE_BLYNK
  Blynk.config(BLYNK_AUTH_TOKEN);
  uint32_t lastBlynkTry = 0;
#endif
  uint32_t lastMqttTry = 0, lastWiFiTry = 0, lastPublish = 0;
  bool triedMqtt = false;
  for (;;) {
    uint32_t now = millis();
    if (WiFi.status() != WL_CONNECTED) {
      if (SmartBin::elapsed(now,lastWiFiTry) >= 10000) {
        lastWiFiTry = now; WiFi.reconnect();
      }
    } else {
      if (!mqtt.connected() && (!triedMqtt || SmartBin::elapsed(now,lastMqttTry) >= 5000)) {
        triedMqtt = true; lastMqttTry = now;
        String id = String("smartbin-") + String(static_cast<uint32_t>(ESP.getEfuseMac()),HEX);
        bool ok = mqtt.connect(id.c_str(), strlen(BIN_MQTT_USER) ? BIN_MQTT_USER : nullptr,
            strlen(BIN_MQTT_USER) ? BIN_MQTT_PASSWORD : nullptr,
            availabilityTopic.c_str(), 1, true, "offline");
        if (ok) {
          mqtt.subscribe(commandTopic.c_str(), 0);
          mqtt.publish(availabilityTopic.c_str(),"online",true);
          Serial.println("MQTT connected");
        } else Serial.printf("MQTT retry, state=%d\n", mqtt.state());
      }
      if (mqtt.connected()) mqtt.loop();
#if BIN_ENABLE_BLYNK
      if (!Blynk.connected() && SmartBin::elapsed(now,lastBlynkTry) >= 10000) {
        lastBlynkTry = now; Blynk.connect(500);
      }
      if (Blynk.connected()) Blynk.run();
#endif
      if (SmartBin::elapsed(now,lastPublish) >= Config::TELEMETRY_INTERVAL_MS) {
        Snapshot s{};
        if (xQueuePeek(snapshotQueue, &s, 0) == pdTRUE) {
          // Do not publish an old snapshot as fresh after a long reconnect.
          if (SmartBin::elapsed(millis(), s.uptime) < 1500) publishSnapshot(s);
        }
        lastPublish = millis();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void setup() {
  Serial.begin(115200);
  snprintf(bootId,sizeof(bootId),"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
  pinMode(Config::IR_PIN, INPUT_PULLUP);
  pinMode(Config::SERVICE_BUTTON_PIN, INPUT_PULLUP);
  pinMode(Config::TRIG_PIN, OUTPUT);
  pinMode(Config::ECHO_PIN, INPUT);
  if (Config::LEVEL_SENSOR_COUNT == 2) {
    pinMode(Config::TRIG_B_PIN, OUTPUT); digitalWrite(Config::TRIG_B_PIN, LOW);
    pinMode(Config::ECHO_B_PIN, INPUT);
  }
  pinMode(Config::FULL_LED_PIN, OUTPUT);
  digitalWrite(Config::TRIG_PIN, LOW);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttachChannel(Config::SERVO_PIN, 50, 16, 0);
  ledcAttachChannel(Config::BUZZER_PIN, 2000, 8, 2);
#else
  ledcSetup(0, 50, 16); ledcAttachPin(Config::SERVO_PIN, 0);
  ledcSetup(2, 2000, 8); ledcAttachPin(Config::BUZZER_PIN, 2);
#endif
  servoAngle(Config::SERVO_CLOSED_DEG);
  snapshotQueue = xQueueCreate(1, sizeof(Snapshot));
  commandQueue = xQueueCreate(8, sizeof(Command));
  if (!snapshotQueue || !commandQueue) { Serial.println("FATAL: queue allocation"); abort(); }
  if (xTaskCreatePinnedToCore(networkTask,"network",8192,nullptr,1,nullptr,0) != pdPASS) {
    Serial.println("FATAL: network task allocation"); abort();
  }
  Serial.println("SMARTBIN v4 ready | H=hand S=service | no mouth sensor | lid-mounted A/B");
}

float readDistance(int trig, int echo) {
  digitalWrite(trig, LOW); delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(10); digitalWrite(trig, LOW);
  unsigned long us = pulseIn(echo, HIGH, Config::ECHO_TIMEOUT_US);
  return us ? us / 58.0f : NAN;
}

void loop() {
  uint32_t now=millis();
  if(serviceButton.pressed(now,digitalRead(Config::SERVICE_BUTTON_PIN)==LOW)) {
    controller.command(controller.service.mode==SmartBin::ServiceMode::Servicing ?
      Action::FinishService : Action::BeginService,now);
  }
  Command cmd{};
  if(xQueueReceive(commandQueue,&cmd,0)==pdTRUE) {
    const bool fresh=SmartBin::commandFresh(now,cmd.deadline);
    const bool accepted=fresh && controller.command(cmd.action,now);
    strlcpy(lastCommandId,cmd.id,sizeof(lastCommandId));
    strlcpy(lastCommandResult,!fresh?"expired":!accepted?"rejected":
      (cmd.action==Action::BeginService || cmd.action==Action::FinishService)?"accepted":"applied",sizeof(lastCommandResult));
    Serial.printf("COMMAND %s id=%s\n",lastCommandResult,cmd.id);
  }
  controller.tick(now,digitalRead(Config::IR_PIN)==LOW);
  if(controller.lid.open!=lastLid) {
    lastLid=controller.lid.open;
    servoAngle(lastLid?Config::SERVO_OPEN_DEG:Config::SERVO_CLOSED_DEG);
    Serial.println(lastLid?"LID OPEN":"LID CLOSED");
  }
  // The same scheduler runs in the desktop simulator. No pings while opening,
  // open, closing or settling. A lid cycle cancels an unfinished A/B pair.
  const unsigned sensor=controller.nextSensor(now);
  if(sensor) {
    const float cm=readDistance(sensor==1?Config::TRIG_PIN:Config::TRIG_B_PIN,
                                sensor==1?Config::ECHO_PIN:Config::ECHO_B_PIN);
    // Use the start timestamp: a timeout must not advance a second trigger.
    controller.sample(now,sensor,cm);
    if(sensor==Config::LEVEL_SENSOR_COUNT) Serial.printf("LEVEL pairs=%lu state=%s\n",
      static_cast<unsigned long>(controller.pairs),SmartBin::stateName(controller.state(millis())));
  }
  now=millis();
  const auto state=controller.state(now);
  const auto mode=controller.service.mode;
  const bool empty=controller.assessment.emptyVerified();
  if(state!=lastReportedState || mode!=lastReportedMode || empty!=lastReportedEmpty) {
    Serial.printf("STATE %s service=%s empty=%d\n",SmartBin::stateName(state),SmartBin::serviceName(mode),empty);
    lastReportedState=state;lastReportedMode=mode;lastReportedEmpty=empty;
  }
  const bool full=controller.full(now),warning=controller.warning(now);
  digitalWrite(Config::FULL_LED_PIN,full || (warning && now%1000<500)?HIGH:LOW);
  const uint32_t phase=now%Config::WARNING_BUZZER_PERIOD_MS;
  const bool fullTone=controller.fullAlarmTone(now);
  const bool warningTone=warning && !controller.lid.muted && (phase<100 || (phase>=250 && phase<350));
  buzzer(fullTone || warningTone);
  Snapshot s{};
  s.uptime=now;
  s.sampleAge=Config::LEVEL_SENSOR_COUNT==2 ? max(SmartBin::elapsed(now,controller.lastA),SmartBin::elapsed(now,controller.lastB)) : SmartBin::elapsed(now,controller.lastA);
  s.distance=Config::LEVEL_SENSOR_COUNT==2 ? (controller.a.distance+controller.b.distance)/2 : controller.a.distance;
  s.fill=Config::LEVEL_SENSOR_COUNT==2 ? (controller.a.percent+controller.b.percent)/2 : controller.a.percent;
  s.distanceA=controller.a.distance;s.distanceB=controller.b.distance;
  s.fillA=controller.a.percent;s.fillB=controller.b.percent;
  s.sensorCount=Config::LEVEL_SENSOR_COUNT;s.levelState=state;
  s.sensorOkA=controller.okA(now);s.sensorOkB=controller.okB(now);s.sensorOk=controller.sensorOk(now);
  s.hand=controller.lid.hand;s.lidOpen=controller.lid.open;s.full=full;
  s.handHeld=controller.handHeld(now);s.emptyVerified=empty;s.serviceMode=mode;
  s.measurementStatus=controller.measurementStatus(now);
  s.muted=controller.lid.muted;s.remote=controller.lid.remote;s.openCount=controller.openCount;
  strlcpy(s.lastCommandId,lastCommandId,sizeof(s.lastCommandId));
  strlcpy(s.lastCommandResult,lastCommandResult,sizeof(s.lastCommandResult));
  xQueueOverwrite(snapshotQueue,&s);
  delay(5);
}
