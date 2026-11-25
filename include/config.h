#pragma once
#if defined(SMARTBIN_WOKWI_LOCAL)
#define BIN_MQTT_HOST "host.wokwi.internal"
#define BIN_MQTT_PORT 18885
#define BIN_TOPIC_PREFIX "sim/nhom6/bin-wokwi"
#elif __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef BIN_MQTT_HOST
#define BIN_MQTT_HOST "broker.hivemq.com"
#endif
#ifndef BIN_MQTT_PORT
#define BIN_MQTT_PORT 1883
#endif
#ifndef BIN_MQTT_USER
#define BIN_MQTT_USER ""
#define BIN_MQTT_PASSWORD ""
#endif
#ifndef BIN_TOPIC_PREFIX
#define BIN_TOPIC_PREFIX "iot/nhom6/bin-a7f39c"
#endif
#ifndef BIN_ENABLE_BLYNK
#define BIN_ENABLE_BLYNK 0
#endif
#ifndef BIN_LEVEL_SENSOR_COUNT
#define BIN_LEVEL_SENSOR_COUNT 2
#endif
#ifndef BIN_ALLOW_REMOTE_CONTROL
#ifdef SMARTBIN_REAL
#define BIN_ALLOW_REMOTE_CONTROL 0
#else
#define BIN_ALLOW_REMOTE_CONTROL 1
#endif
#endif
#if defined(SMARTBIN_REAL) && (!defined(REAL_WIFI_SSID) || !defined(REAL_WIFI_PASSWORD))
#error "Copy include/secrets.example.h to include/secrets.h and set real WiFi credentials."
#endif

namespace Config {
constexpr bool REMOTE_CONTROL = BIN_ALLOW_REMOTE_CONTROL != 0;
constexpr int IR_PIN = 13; // Active LOW; IR output must be 3.3V compatible.
constexpr int SERVICE_BUTTON_PIN = 14; // Local start/finish bag replacement button.
constexpr unsigned HAND_WARN_MS = 30000;
constexpr int TRIG_PIN = 25;
constexpr int ECHO_PIN = 26;
constexpr int TRIG_B_PIN = 32;
constexpr int ECHO_B_PIN = 33;
constexpr unsigned LEVEL_SENSOR_COUNT = BIN_LEVEL_SENSOR_COUNT;
constexpr int SERVO_PIN = 18;
constexpr int BUZZER_PIN = 19; // Passive piezo, separate LEDC timer from servo.
constexpr int FULL_LED_PIN = 23;
constexpr float EMPTY_CM = 40.0f;
constexpr float FULL_CM = 4.0f;
constexpr float EMPTY_B_CM = 40.0f;
constexpr float FULL_B_CM = 4.0f;
constexpr unsigned SENSOR_GAP_MS = 80; // Fire sequentially; do not overlap echoes.
constexpr unsigned LID_SETTLE_MS = 2000;
constexpr unsigned CONFIRM_PAIRS = 3;
constexpr unsigned LEVEL_INTERVAL_MS = 2000;
constexpr unsigned TELEMETRY_INTERVAL_MS = 1000;
constexpr unsigned ECHO_TIMEOUT_US = 25000;
constexpr unsigned SENSOR_STALE_MS = 6500;
constexpr int SERVO_CLOSED_DEG = 0;
constexpr int SERVO_OPEN_DEG = 90;
constexpr unsigned SERVO_MIN_US = 500;
constexpr unsigned SERVO_MAX_US = 2400;
constexpr unsigned WARNING_BUZZER_PERIOD_MS = 5000;
constexpr unsigned FULL_BUZZER_INTERVAL_MS = 3000;
constexpr unsigned FULL_BUZZER_PULSES = 3;
constexpr unsigned BUZZER_ON_MS = 200;
static_assert(EMPTY_CM > FULL_CM && FULL_CM >= 2, "Invalid bin calibration");
static_assert(EMPTY_B_CM > FULL_B_CM && FULL_B_CM >= 2, "Invalid sensor B calibration");
static_assert(LEVEL_SENSOR_COUNT == 1 || LEVEL_SENSOR_COUNT == 2, "Use 1 or 2 level sensors");
}
