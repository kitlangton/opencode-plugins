import { expect, test } from "bun:test";
import { automaticRecapEligible } from "../src/eligibility";

test("requires three minutes away and three user turns", () => {
  expect(
    automaticRecapEligible({
      awayMs: 179_999,
      userIDs: ["one", "two", "three"],
    }),
  ).toBe(false);
  expect(
    automaticRecapEligible({ awayMs: 180_000, userIDs: ["one", "two"] }),
  ).toBe(false);
  expect(
    automaticRecapEligible({
      awayMs: 180_000,
      userIDs: ["one", "two", "three"],
    }),
  ).toBe(true);
});

test("requires activity after the previous automatic recap", () => {
  expect(
    automaticRecapEligible({
      awayMs: 180_000,
      userIDs: ["one", "two", "three"],
      lastAutomaticUserID: "three",
    }),
  ).toBe(false);
  expect(
    automaticRecapEligible({
      awayMs: 180_000,
      userIDs: ["one", "two", "three", "four"],
      lastAutomaticUserID: "three",
    }),
  ).toBe(true);
});

test("does not repeat for an unchanged session after dismissal", () => {
  const userIDs = ["one", "two", "three"];
  expect(
    automaticRecapEligible({
      awayMs: 180_000,
      userIDs,
      lastAutomaticUserID: userIDs.at(-1),
    }),
  ).toBe(false);
  expect(
    automaticRecapEligible({
      awayMs: 360_000,
      userIDs,
      lastAutomaticUserID: userIDs.at(-1),
    }),
  ).toBe(false);
});
