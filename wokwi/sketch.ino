// SIREN traffic light controller. One ESP32 = one signalised intersection.
// Contract: ../docs/CONTRACT.md ("Aturan ESP32 (Wokwi)"). Do not change topic/payload shapes
// here without updating that file and Devan's backend at the same time.
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// --- per-deployment config: change this before flashing a different intersection ---
#define INTERSECTION_ID "S1" // "S1" | "S2" | "S3"

#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define MQTT_HOST "broker.hivemq.com"
#define MQTT_PORT 1883
#define TOPIC_PREFIX "siren-polnes26"

// Phase A = jalan utama, Phase B = jalan silang. Avoids ESP32 strapping pins (0/2/5/12/15).
const int PIN_A_RED = 25;
const int PIN_A_YELLOW = 26;
const int PIN_A_GREEN = 27;
const int PIN_B_RED = 14;
const int PIN_B_YELLOW = 32;
const int PIN_B_GREEN = 33;

// NORMAL cycle timing, per CONTRACT.md's suggested cycle.
const unsigned long NORMAL_GREEN_MS = 10000;
const unsigned long NORMAL_YELLOW_MS = 3000;
const unsigned long PRIORITY_YIELD_MS = 3000; // opposing green -> yellow before it goes red

enum Color { RED, YELLOW, GREEN };
enum Mode { NORMAL, PRIORITY };
// NORMAL cycles through these four steps in order, looping back to 0.
const int NORMAL_STEP_COUNT = 4;
struct NormalStep {
  Color a, b;
  unsigned long durationMs;
};
const NormalStep NORMAL_STEPS[NORMAL_STEP_COUNT] = {
  { GREEN, RED, NORMAL_GREEN_MS },
  { YELLOW, RED, NORMAL_YELLOW_MS },
  { RED, GREEN, NORMAL_GREEN_MS },
  { RED, YELLOW, NORMAL_YELLOW_MS },
};

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

Mode mode = NORMAL;
int normalStepIndex = 0;
unsigned long normalStepStartMs = 0;

// PRIORITY state
char priorityPhase = 'A';       // which phase is being held green
bool yielding = false;          // true while the opposing lane is on its 3s yellow before turning red
unsigned long yieldStartMs = 0;
unsigned long ttlMs = 15000;
unsigned long lastPriorityMs = 0;
unsigned long lastCountdownPrintMs = 0;

Color colorA = RED;
Color colorB = RED;

void applyColors() {
  digitalWrite(PIN_A_RED, colorA == RED ? HIGH : LOW);
  digitalWrite(PIN_A_YELLOW, colorA == YELLOW ? HIGH : LOW);
  digitalWrite(PIN_A_GREEN, colorA == GREEN ? HIGH : LOW);
  digitalWrite(PIN_B_RED, colorB == RED ? HIGH : LOW);
  digitalWrite(PIN_B_YELLOW, colorB == YELLOW ? HIGH : LOW);
  digitalWrite(PIN_B_GREEN, colorB == GREEN ? HIGH : LOW);
}

void enterNormal() {
  mode = NORMAL;
  yielding = false;
  normalStepIndex = 0;
  normalStepStartMs = millis();
  colorA = NORMAL_STEPS[0].a;
  colorB = NORMAL_STEPS[0].b;
  applyColors();
  Serial.println("[fsm] -> NORMAL");
}

// Starts (or re-targets) a PRIORITY hold for `phase`. If the opposing lane is green it yields
// through yellow first; otherwise the target lane can go green immediately.
void enterPriority(char phase, unsigned long ttlSeconds) {
  mode = PRIORITY;
  priorityPhase = phase;
  ttlMs = ttlSeconds * 1000UL;
  lastPriorityMs = millis();

  Color* target = (phase == 'A') ? &colorA : &colorB;
  Color* opposite = (phase == 'A') ? &colorB : &colorA;

  if (*opposite == GREEN) {
    *opposite = YELLOW;
    yielding = true;
    yieldStartMs = millis();
  } else {
    *opposite = RED;
    *target = GREEN;
    yielding = false;
  }
  applyColors();
  Serial.printf("[fsm] -> PRIORITY phase=%c ttl=%lus\n", phase, ttlSeconds);
}

void refreshPriority(unsigned long ttlSeconds) {
  ttlMs = ttlSeconds * 1000UL;
  lastPriorityMs = millis();
}

void onCommand(const JsonDocument& doc) {
  const char* modeStr = doc["mode"] | "";
  if (strcmp(modeStr, "NORMAL") == 0) {
    if (mode != NORMAL) enterNormal();
    return;
  }
  if (strcmp(modeStr, "PRIORITY") != 0) return; // unknown/malformed mode, ignore

  const char* phaseStr = doc["phase"] | "";
  if (strcmp(phaseStr, "A") != 0 && strcmp(phaseStr, "B") != 0) return;
  if (!doc["ttl"].is<unsigned long>() && !doc["ttl"].is<int>()) return;
  unsigned long ttlSeconds = doc["ttl"].as<unsigned long>();
  if (ttlSeconds == 0) return;
  char phase = phaseStr[0];

  if (mode == PRIORITY && priorityPhase == phase) {
    refreshPriority(ttlSeconds); // same vehicle's periodic re-send: just extend the failsafe clock
  } else {
    enterPriority(phase, ttlSeconds);
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[mqtt] bad json: %s\n", err.c_str());
    return;
  }
  onCommand(doc);
}

void connectWifi() {
  Serial.printf("[wifi] connecting to %s...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.printf("\n[wifi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  String clientId = "siren-esp32-" + String(INTERSECTION_ID) + "-" + String(random(0xffff), HEX);
  String cmdTopic = String(TOPIC_PREFIX) + "/intersection/" + INTERSECTION_ID + "/cmd";
  while (!mqtt.connected()) {
    Serial.printf("[mqtt] connecting as %s...\n", clientId.c_str());
    if (mqtt.connect(clientId.c_str())) {
      mqtt.subscribe(cmdTopic.c_str());
      Serial.printf("[mqtt] connected, subscribed to %s\n", cmdTopic.c_str());
    } else {
      Serial.printf("[mqtt] failed, rc=%d, retrying in 2s\n", mqtt.state());
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_A_RED, OUTPUT);
  pinMode(PIN_A_YELLOW, OUTPUT);
  pinMode(PIN_A_GREEN, OUTPUT);
  pinMode(PIN_B_RED, OUTPUT);
  pinMode(PIN_B_YELLOW, OUTPUT);
  pinMode(PIN_B_GREEN, OUTPUT);

  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(512);
  connectMqtt();

  enterNormal();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }
  if (!mqtt.connected()) {
    connectMqtt();
  }
  mqtt.loop();

  unsigned long now = millis();

  if (mode == PRIORITY) {
    // Failsafe: no PRIORITY refresh within ttl means the backend/vehicle went silent.
    if (now - lastPriorityMs > ttlMs) {
      Serial.println("[fsm] failsafe: PRIORITY expired, reverting to NORMAL");
      enterNormal();
      return;
    }
    if (yielding && now - yieldStartMs >= PRIORITY_YIELD_MS) {
      if (priorityPhase == 'A') {
        colorB = RED;
        colorA = GREEN;
      } else {
        colorA = RED;
        colorB = GREEN;
      }
      yielding = false;
      applyColors();
    }
    // Countdown display (Final stage: no LCD/7-seg in this build, so it prints to Serial).
    if (now - lastCountdownPrintMs >= 1000) {
      lastCountdownPrintMs = now;
      long remainingS = (long)(ttlMs - (now - lastPriorityMs)) / 1000;
      Serial.printf("[fsm] PRIORITY %c holding, failsafe in %lds\n", priorityPhase, remainingS);
    }
    return;
  }

  // NORMAL: advance through the fixed cycle on a timer.
  const NormalStep& step = NORMAL_STEPS[normalStepIndex];
  if (now - normalStepStartMs >= step.durationMs) {
    normalStepIndex = (normalStepIndex + 1) % NORMAL_STEP_COUNT;
    normalStepStartMs = now;
    colorA = NORMAL_STEPS[normalStepIndex].a;
    colorB = NORMAL_STEPS[normalStepIndex].b;
    applyColors();
  }
}
