import test from "node:test";
import assert from "node:assert/strict";
import { hoursPerTask, localDate } from "../src/sync.js";

test("distributes exactly eight hours among active tasks", () => {
  assert.equal(hoursPerTask(1), 8);
  assert.equal(hoursPerTask(2), 4);
  assert.equal(hoursPerTask(4), 2);
  assert.equal(hoursPerTask(0), 0);
});

test("calculates the day in the configured Europe/Rome timezone", () => {
  const utcLateNight = new Date("2026-09-24T22:30:00.000Z");
  assert.equal(localDate(utcLateNight, "Europe/Rome"), "2026-09-25");
});
