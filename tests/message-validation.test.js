import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanMessage,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH
} from "../src/services/message-validation.js";
import {
  normalizeVisitorName,
  numberedVisitorName,
  visitorNameKey
} from "../src/services/visitor-names.js";
import {
  compareTimestamps,
  isUnreadVisitorMessage
} from "../src/services/conversation-state.js";

test("trims message names and text", () => {
  assert.deepEqual(cleanMessage("  MBI  ", "  Hello  "), {
    name: "MBI",
    text: "Hello"
  });
});

test("accepts names and messages at their configured limits", () => {
  assert.equal(cleanMessage("n".repeat(MAX_NAME_LENGTH), "m").name.length, MAX_NAME_LENGTH);
  assert.equal(cleanMessage("n", "m".repeat(MAX_MESSAGE_LENGTH)).text.length, MAX_MESSAGE_LENGTH);
});

test("rejects blank and non-string values", () => {
  for (const [name, text] of [[" ", "hello"], ["name", "\n"], [null, "hello"], ["name", 42]]) {
    assert.throws(() => cleanMessage(name, text), /Enter a name and a message/);
  }
});

test("rejects values exceeding their configured limits", () => {
  assert.throws(
    () => cleanMessage("n".repeat(MAX_NAME_LENGTH + 1), "hello"),
    /Names cannot be longer/
  );
  assert.throws(
    () => cleanMessage("name", "m".repeat(MAX_MESSAGE_LENGTH + 1)),
    /Messages cannot be longer/
  );
});

test("normalizes names consistently for unique reservations", () => {
  assert.equal(normalizeVisitorName("  Dark   Chat "), "dark chat");
  assert.equal(visitorNameKey(" DArk/Chat "), "dark／chat");
});

test("numbers duplicate names and keeps generated names within the limit", () => {
  assert.equal(numberedVisitorName("Dark", 1), "Dark");
  assert.equal(numberedVisitorName("Dark", 2), "Dark 2");
  assert.equal(numberedVisitorName("n".repeat(100), 123).length, 100);
});

test("marks only new visitor messages unread", () => {
  const timestamp = (seconds, nanoseconds = 0) => ({
    seconds,
    nanoseconds,
    toMillis: () => seconds * 1_000 + nanoseconds / 1_000_000
  });
  const readAt = timestamp(10, 200_000);
  assert.equal(
    isUnreadVisitorMessage({ sender: "user", createdAt: timestamp(10, 300_000) }, readAt),
    true
  );
  assert.equal(
    isUnreadVisitorMessage({ sender: "user", createdAt: timestamp(10, 200_000) }, readAt),
    false
  );
  assert.equal(
    isUnreadVisitorMessage({ sender: "owner", createdAt: timestamp(10, 300_000) }, readAt),
    false
  );
  assert.equal(isUnreadVisitorMessage({ sender: "user" }, readAt), true);
  assert.equal(compareTimestamps(timestamp(10, 300_000), readAt), 100_000);
});
