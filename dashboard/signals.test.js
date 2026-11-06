import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  createSignal,
  enterNormal,
  enterPriority,
  laneAt,
} from "./signals.js";

test("laneAt: main road (either side of the junction) is A, the cross street is B", () => {
  const info = { lat: -8.17, lng: 113.7, axisA: 90 }; // main road runs east-west
  assert.equal(laneAt(info, -8.17, 113.705), "A", "east of the junction");
  assert.equal(laneAt(info, -8.17, 113.695), "A", "west of the junction");
  assert.equal(laneAt(info, -8.165, 113.7), "B", "north of the junction");
  assert.equal(laneAt(info, -8.175, 113.7005), "B", "south, slightly off-axis");
});

test("normal cycle: A green 10 s, A yellow 3 s, B green 10 s, B yellow 3 s, repeat", () => {
  const s = createSignal(0, 0);
  assert.deepEqual(advance(s, 9_999), { A: "green", B: "red" });
  assert.deepEqual(advance(s, 10_000), { A: "yellow", B: "red" });
  assert.deepEqual(advance(s, 13_000), { A: "red", B: "green" });
  assert.deepEqual(advance(s, 23_000), { A: "red", B: "yellow" });
  assert.deepEqual(
    advance(s, 26_000 + 26_000 * 3),
    { A: "green", B: "red" },
    "catches up after a long gap",
  );
});

test("priority for A while B is green: B yellow 3 s, then A green and B red", () => {
  const s = createSignal(2, 0); // B green
  enterPriority(s, "A", 1_000);
  assert.deepEqual(advance(s, 3_999), { A: "red", B: "yellow" });
  assert.deepEqual(advance(s, 4_000), { A: "green", B: "red" });
  assert.deepEqual(
    advance(s, 60_000),
    { A: "green", B: "red" },
    "held while PRIORITY",
  );
});

test("priority when the opposing lane is not green switches at once; release resumes at the held lane's yellow", () => {
  const s = createSignal(0, 0); // A green, B red
  enterPriority(s, "A", 500);
  assert.deepEqual(advance(s, 500), { A: "green", B: "red" });
  enterNormal(s, 20_000);
  assert.deepEqual(advance(s, 20_000), { A: "yellow", B: "red" });
  assert.deepEqual(
    advance(s, 23_000),
    { A: "red", B: "green" },
    "the lane that waited gets green next",
  );
});

test("released while still yielding: the lane being cut off simply keeps its green", () => {
  const s = createSignal(2, 0); // B green
  enterPriority(s, "A", 1_000);
  enterNormal(s, 2_000);
  assert.deepEqual(advance(s, 2_000), { A: "red", B: "green" });
});
