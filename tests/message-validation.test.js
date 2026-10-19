import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanMessage,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH
} from "../src/services/message-validation.js";
import {
  prepareVisitorName
} from "../src/services/visitor-names.js";
import {
  compareTimestamps,
  isUnreadVisitorMessage
} from "../src/services/conversation-state.js";
import {
  isAllowedFocusTarget,
  isAllowedTextInput,
  blockCursorOffset
} from "../src/services/input-policy.js";

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

test("preserves the visitor's chosen display name without adding a suffix", () => {
  assert.equal(prepareVisitorName("  My Name  "), "My Name");
  assert.equal(prepareVisitorName(" A  Name "), "A  Name");
  assert.throws(() => prepareVisitorName(" "), /Name must be between/);
  assert.throws(() => prepareVisitorName("n".repeat(MAX_NAME_LENGTH + 1)), /Name must be between/);
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

test("allows text entry only in enabled app inputs", () => {
  const makeInput = (overrides = {}) => ({
    tagName: "INPUT",
    type: "text",
    dataset: { chatInput: "true" },
    disabled: false,
    readOnly: false,
    ...overrides
  });

  assert.equal(isAllowedTextInput(makeInput()), true);
  assert.equal(isAllowedTextInput(makeInput({ dataset: {} })), false);
  assert.equal(isAllowedTextInput(makeInput({ type: "email" })), false);
  assert.equal(isAllowedTextInput(makeInput({ disabled: true })), false);
  assert.equal(isAllowedTextInput(makeInput({ readOnly: true })), false);
  assert.equal(isAllowedTextInput({ tagName: "DIV", isContentEditable: true }), false);
});

test("focus is limited to app inputs and interactive controls", () => {
  assert.equal(isAllowedFocusTarget({
    tagName: "INPUT",
    type: "password",
    dataset: { chatInput: "true" },
    disabled: false,
    readOnly: false
  }), true);
  assert.equal(isAllowedFocusTarget({ tagName: "BUTTON", disabled: false }), true);
  assert.equal(isAllowedFocusTarget({ tagName: "BUTTON", disabled: true }), false);
  assert.equal(isAllowedFocusTarget({ tagName: "DIV", tabIndex: 0 }), false);
});

test("positions the block cursor relative to its chat prompt", () => {
  assert.equal(
    blockCursorOffset({ left: 120 }, { left: 100 }, 36, 4),
    52
  );
});
