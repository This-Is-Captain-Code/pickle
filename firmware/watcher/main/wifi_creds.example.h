#pragma once
// Copy to wifi_creds.h (gitignored) and fill in.
#define WIFI_SSID  "<hotspot ssid>"
#define WIFI_PASS  "<hotspot password>"
// Optional fallback AP (venue WiFi); omit both lines to use a single network.
#define WIFI_SSID2 "<venue ssid>"
#define WIFI_PASS2 "<venue password>"
#define BROKER_URI "mqtt://<laptop-ip-on-hotspot>:1883"
#define DEV_ID     "watcher-01"
#define MQTT_PASS  "<from server/broker/credentials.local.json>"
