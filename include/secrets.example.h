#pragma once
// Copy to secrets.h. Never commit real credentials.
#define REAL_WIFI_SSID "YOUR_2_4_GHZ_WIFI"
#define REAL_WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
// Public broker for classroom simulation. For a local broker in Wokwi VS Code:
// #define BIN_MQTT_HOST "host.wokwi.internal"
#define BIN_MQTT_HOST "broker.hivemq.com"
#define BIN_MQTT_PORT 1883
#define BIN_MQTT_USER ""
#define BIN_MQTT_PASSWORD ""
#define BIN_TOPIC_PREFIX "iot/nhom6/bin-a7f39c"
// 2 = two spatial measurements; 1 = high level remains unverified, never auto-full.
#define BIN_LEVEL_SENSOR_COUNT 2
// Real hardware disables MQTT control by default. Enable only with your secured broker/network.
// #define BIN_ALLOW_REMOTE_CONTROL 1
// Enable only after creating your Blynk device and datastreams (see docs/BLYNK.md).
#define BIN_ENABLE_BLYNK 0
#define BLYNK_TEMPLATE_ID "YOUR_TEMPLATE_ID"
#define BLYNK_TEMPLATE_NAME "Thung rac thong minh"
#define BLYNK_AUTH_TOKEN "YOUR_DEVICE_AUTH_TOKEN"
