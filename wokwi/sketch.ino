// SIREN traffic light controller. One ESP32 drives all three demo intersections (S1-S3), 6 LEDs each.
// Contract: ../docs/CONTRACT.md ("Aturan ESP32 (Wokwi)"). Do not change topic/payload shapes
// here without updating that file and Devan's backend at the same time.
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#define WIFI_SSID "Wokwi-GUEST"
#define WIFI_PASSWORD ""
#define MQTT_HOST "broker.hivemq.com"
#define MQTT_PORT 1883
#define TOPIC_PREFIX "siren-polnes26"

// NORMAL cycle timing, per CONTRACT.md's suggested cycle.
const unsigned long NORMAL_GREEN_MS = 10000;
const unsigned long NORMAL_YELLOW_MS = 3000;
const unsigned long PRIORITY_YIELD_MS = 3000; // opposing green -> yellow before it goes red

enum Color { RED, YELLOW, GREEN };
enum Mode { NORMAL, PRIORITY };
enum { PHASE_A, PHASE_B };
enum { PIN_RED, PIN_YELLOW, PIN_GREEN };

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

struct Intersection {
  const char* id;
  int pins[2][3];          // [PHASE_A/PHASE_B][PIN_RED/PIN_YELLOW/PIN_GREEN]; A = jalan utama, B = jalan silang
  int normalFirstStep;     // staggers the NORMAL cycles so the three junctions do not blink in lockstep

  Mode mode;
  int normalStepIndex;
  unsigned long normalStepStartMs;

  char priorityPhase;      // which phase is being held green
  bool yielding;           // true while the opposing lane is on its 3s yellow before turning red
  unsigned long yieldStartMs;
  unsigned long ttlMs;
  unsigned long lastPriorityMs;
  unsigned long lastCountdownPrintMs;

  Color colorA, colorB;
};

// S1 keeps the original pins. The 15 non-strapping output pins run out at 18 LEDs, so S3 also uses the strapping
// pins 2/5/15: an LED + resistor to GND holds them low at boot, which is a safe level for all three.
// GPIO 12 is avoided (high at boot selects 1.8 V flash) and 0/1/3 are boot/serial.
Intersection junctions[] = {
  { "S1", { { 25, 26, 27 }, { 14, 32, 33 } }, 0 },
  { "S2", { { 16, 17, 18 }, { 19, 21, 22 } }, 2 },
  { "S3", { { 23, 4, 13 }, { 5, 2, 15 } }, 1 },
};
const int JUNCTION_COUNT = sizeof(junctions) / sizeof(junctions[0]);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

void applyColors(Intersection& j) {
  const Color colors[2] = { j.colorA, j.colorB };
  for (int phase = PHASE_A; phase <= PHASE_B; phase++) {
    digitalWrite(j.pins[phase][PIN_RED], colors[phase] == RED ? HIGH : LOW);
    digitalWrite(j.pins[phase][PIN_YELLOW], colors[phase] == YELLOW ? HIGH : LOW);
    digitalWrite(j.pins[phase][PIN_GREEN], colors[phase] == GREEN ? HIGH : LOW);
  }
}

void setNormalStep(Intersection& j, int index, unsigned long now) {
  j.normalStepIndex = index;
  j.normalStepStartMs = now;
  j.colorA = NORMAL_STEPS[index].a;
  j.colorB = NORMAL_STEPS[index].b;
  applyColors(j);
}

// Leaving PRIORITY, the held lane goes yellow next so the lane that waited gets green right after
// (A held -> step 1 "A yellow" -> step 2 "B green"; B held -> step 3 "B yellow" -> step 0 "A green").
// Released while still yielding, the held lane never went green, so the lane being cut off simply keeps its green.
// At boot the cycle starts at normalFirstStep instead.
void enterNormal(Intersection& j) {
  int step = j.normalFirstStep;
  if (j.mode == PRIORITY && j.yielding) step = (j.priorityPhase == 'A') ? 2 : 0;
  else if (j.mode == PRIORITY) step = (j.priorityPhase == 'A') ? 1 : 3;
  j.mode = NORMAL;
  j.yielding = false;
  setNormalStep(j, step, millis());
  Serial.printf("[%s] -> NORMAL\n", j.id);
}

// Starts (or re-targets) a PRIORITY hold for `phase`. If the opposing lane is green it yields
// through yellow first; otherwise the target lane can go green immediately.
void enterPriority(Intersection& j, char phase, unsigned long ttlSeconds) {
  j.mode = PRIORITY;
  j.priorityPhase = phase;
  j.ttlMs = ttlSeconds * 1000UL;
  j.lastPriorityMs = millis();

  Color* target = (phase == 'A') ? &j.colorA : &j.colorB;
  Color* opposite = (phase == 'A') ? &j.colorB : &j.colorA;

  if (*opposite == GREEN) {
    *opposite = YELLOW;
    j.yielding = true;
    j.yieldStartMs = millis();
  } else {
    *opposite = RED;
    *target = GREEN;
    j.yielding = false;
  }
  applyColors(j);
  Serial.printf("[%s] -> PRIORITY phase=%c ttl=%lus\n", j.id, phase, ttlSeconds);
}

void onCommand(Intersection& j, const JsonDocument& doc) {
  const char* modeStr = doc["mode"] | "";
  if (strcmp(modeStr, "NORMAL") == 0) {
    if (j.mode != NORMAL) enterNormal(j);
    return;
  }
  if (strcmp(modeStr, "PRIORITY") != 0) return; // unknown/malformed mode, ignore

  const char* phaseStr = doc["phase"] | "";
  if (strcmp(phaseStr, "A") != 0 && strcmp(phaseStr, "B") != 0) return;
  if (!doc["ttl"].is<unsigned long>() && !doc["ttl"].is<int>()) return;
  unsigned long ttlSeconds = doc["ttl"].as<unsigned long>();
  if (ttlSeconds == 0) return;
  char phase = phaseStr[0];

  if (j.mode == PRIORITY && j.priorityPhase == phase) {
    // Same vehicle's periodic re-send: just extend the failsafe clock.
    j.ttlMs = ttlSeconds * 1000UL;
    j.lastPriorityMs = millis();
  } else {
    enterPriority(j, phase, ttlSeconds);
  }
}

// Topic: <prefix>/intersection/<id>/cmd. Returns null for ids this board does not drive.
Intersection* junctionForTopic(const char* topic) {
  const char* idStart = topic + strlen(TOPIC_PREFIX "/intersection/");
  const char* idEnd = strchr(idStart, '/');
  if (idEnd == nullptr) return nullptr;
  size_t idLen = idEnd - idStart;
  for (Intersection& j : junctions) {
    if (strlen(j.id) == idLen && strncmp(j.id, idStart, idLen) == 0) return &j;
  }
  return nullptr;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Intersection* j = junctionForTopic(topic);
  if (j == nullptr) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[mqtt] bad json on %s: %s\n", topic, err.c_str());
    return;
  }
  onCommand(*j, doc);
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

const unsigned long MQTT_RETRY_MS = 2000;
unsigned long lastMqttAttemptMs = 0;

// One attempt only: loop() retries every MQTT_RETRY_MS, so the three junctions keep cycling (and their ttl
// failsafe keeps running) during a reconnect instead of freezing inside a blocking retry loop.
void connectMqtt() {
  lastMqttAttemptMs = millis();
  String clientId = "siren-esp32-" + String(random(0xffff), HEX);
  const char* cmdTopic = TOPIC_PREFIX "/intersection/+/cmd";
  Serial.printf("[mqtt] connecting as %s...\n", clientId.c_str());
  if (mqtt.connect(clientId.c_str())) {
    mqtt.subscribe(cmdTopic);
    Serial.printf("[mqtt] connected, subscribed to %s\n", cmdTopic);
  } else {
    Serial.printf("[mqtt] failed, rc=%d, retrying in %lus\n", mqtt.state(), MQTT_RETRY_MS / 1000);
  }
}

void updateJunction(Intersection& j, unsigned long now) {
  if (j.mode == PRIORITY) {
    // Failsafe: no PRIORITY refresh within ttl means the backend/vehicle went silent.
    if (now - j.lastPriorityMs > j.ttlMs) {
      Serial.printf("[%s] failsafe: PRIORITY expired, reverting to NORMAL\n", j.id);
      enterNormal(j);
      return;
    }
    if (j.yielding && now - j.yieldStartMs >= PRIORITY_YIELD_MS) {
      if (j.priorityPhase == 'A') {
        j.colorB = RED;
        j.colorA = GREEN;
      } else {
        j.colorA = RED;
        j.colorB = GREEN;
      }
      j.yielding = false;
      applyColors(j);
    }
    // Countdown display (Final stage: no LCD/7-seg in this build, so it prints to Serial).
    if (now - j.lastCountdownPrintMs >= 1000) {
      j.lastCountdownPrintMs = now;
      long remainingS = (long)(j.ttlMs - (now - j.lastPriorityMs)) / 1000;
      Serial.printf("[%s] PRIORITY %c holding, failsafe in %lds\n", j.id, j.priorityPhase, remainingS);
    }
    return;
  }

  // NORMAL: advance through the fixed cycle on a timer.
  if (now - j.normalStepStartMs >= NORMAL_STEPS[j.normalStepIndex].durationMs) {
    setNormalStep(j, (j.normalStepIndex + 1) % NORMAL_STEP_COUNT, now);
  }
}

void setup() {
  Serial.begin(115200);
  for (Intersection& j : junctions) {
    for (int phase = PHASE_A; phase <= PHASE_B; phase++) {
      for (int color = PIN_RED; color <= PIN_GREEN; color++) pinMode(j.pins[phase][color], OUTPUT);
    }
  }

  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setBufferSize(512);
  // PubSubClient's 15s default keepalive was too tight against the real public broker's round-trip
  // latency (observed reconnect loops in Wokwi simulation); 60s gives real margin.
  mqtt.setKeepAlive(60);
  mqtt.setSocketTimeout(30);

  for (Intersection& j : junctions) enterNormal(j);
  connectMqtt(); // retained cmd messages arrive right after subscribing and override NORMAL
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }
  if (!mqtt.connected() && millis() - lastMqttAttemptMs >= MQTT_RETRY_MS) {
    connectMqtt();
  }
  mqtt.loop();

  unsigned long now = millis();
  for (Intersection& j : junctions) updateJunction(j, now);
}
