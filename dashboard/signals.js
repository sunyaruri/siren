/**
 * Mirror of the ESP32 traffic-light state machine in wokwi/sketch.ino, so the dashboard can show each junction's
 * red/yellow/green. Same cycle, same stagger, same 3 s yield and the same "resume at the held lane's yellow".
 * shortcut: the NORMAL cycle runs on the browser clock, so it can drift a few seconds from the Wokwi LEDs; PRIORITY
 * transitions match because they come from the same MQTT command. Upgrade: have the ESP32 publish its colours.
 */

const GREEN_MS = 10_000;
const YELLOW_MS = 3_000;
const YIELD_MS = 3_000;

const STEPS = [
  { A: "green", B: "red", ms: GREEN_MS },
  { A: "yellow", B: "red", ms: YELLOW_MS },
  { A: "red", B: "green", ms: GREEN_MS },
  { A: "red", B: "yellow", ms: YELLOW_MS },
];

/** `normalFirstStep` per junction in sketch.ino: staggers the three cycles. */
export const FIRST_STEP = { S1: 0, S2: 2, S3: 1 };

/**
 * The lane (phase) a vehicle at lat/lng uses at an intersection `{ lat, lng, axisA }`: A when it sits within 45° of
 * the main road axis (either direction), otherwise B. Mirrors phaseFor + bearingDeg in backend/src/priority.ts.
 */
export function laneAt(info, lat, lng) {
  const rad = Math.PI / 180;
  const dLng = (lng - info.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(lat * rad);
  const x =
    Math.cos(info.lat * rad) * Math.sin(lat * rad) -
    Math.sin(info.lat * rad) * Math.cos(lat * rad) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) / rad + 360) % 360;
  const diff = Math.abs(bearing - info.axisA) % 180;
  return Math.min(diff, 180 - diff) < 45 ? "A" : "B";
}

function setStep(s, index, now) {
  s.step = index;
  s.stepStart = now;
  s.A = STEPS[index].A;
  s.B = STEPS[index].B;
}

export function createSignal(firstStep, now) {
  const s = {
    mode: "NORMAL",
    firstStep,
    phase: null,
    yielding: false,
    yieldStart: 0,
  };
  setStep(s, firstStep, now);
  return s;
}

/** Hold `phase` green; a green opposing lane goes yellow for 3 s first. */
export function enterPriority(s, phase, now) {
  const opposite = phase === "A" ? "B" : "A";
  s.mode = "PRIORITY";
  s.phase = phase;
  if (s[opposite] === "green") {
    s[opposite] = "yellow";
    s.yielding = true;
    s.yieldStart = now;
  } else {
    s[opposite] = "red";
    s[phase] = "green";
    s.yielding = false;
  }
}

/** Back to the cycle: the held lane goes yellow next, so the lane that waited gets green right after. */
export function enterNormal(s, now) {
  let step = s.firstStep;
  if (s.mode === "PRIORITY" && s.yielding) step = s.phase === "A" ? 2 : 0;
  else if (s.mode === "PRIORITY") step = s.phase === "A" ? 1 : 3;
  s.mode = "NORMAL";
  s.yielding = false;
  setStep(s, step, now);
}

/** Advances the machine to `now` and returns the current colours. */
export function advance(s, now) {
  if (s.mode === "PRIORITY") {
    if (s.yielding && now - s.yieldStart >= YIELD_MS) {
      s[s.phase === "A" ? "B" : "A"] = "red";
      s[s.phase] = "green";
      s.yielding = false;
    }
  } else {
    // A loop, not one step: a background tab may wake up many steps later.
    while (now - s.stepStart >= STEPS[s.step].ms)
      setStep(s, (s.step + 1) % STEPS.length, s.stepStart + STEPS[s.step].ms);
  }
  return { A: s.A, B: s.B };
}
