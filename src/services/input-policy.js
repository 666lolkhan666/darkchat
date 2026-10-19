const textInputTypes = new Set(["text", "password"]);

export function blockCursorOffset(inputRect, promptRect, textWidth, scrollLeft) {
  return inputRect.left - promptRect.left + textWidth - scrollLeft;
}

export function isAllowedTextInput(target) {
  return target?.tagName === "INPUT" &&
    target.dataset?.chatInput === "true" &&
    textInputTypes.has(target.type) &&
    !target.disabled &&
    !target.readOnly;
}

export function isAllowedFocusTarget(target) {
  if (isAllowedTextInput(target)) return true;
  if (target?.tagName === "BUTTON") return !target.disabled;
  return target?.tagName === "A" && Boolean(target.href);
}
