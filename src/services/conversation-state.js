function timestampMillis(timestamp) {
  return typeof timestamp?.toMillis === "function" ? timestamp.toMillis() : 0;
}

export function compareTimestamps(left, right) {
  const leftSeconds = Number.isInteger(left?.seconds)
    ? left.seconds
    : Math.floor(timestampMillis(left) / 1_000);
  const rightSeconds = Number.isInteger(right?.seconds)
    ? right.seconds
    : Math.floor(timestampMillis(right) / 1_000);
  if (leftSeconds !== rightSeconds) return leftSeconds - rightSeconds;

  const leftNanos = Number.isInteger(left?.nanoseconds)
    ? left.nanoseconds
    : (timestampMillis(left) % 1_000) * 1_000_000;
  const rightNanos = Number.isInteger(right?.nanoseconds)
    ? right.nanoseconds
    : (timestampMillis(right) % 1_000) * 1_000_000;
  return leftNanos - rightNanos;
}

export function isUnreadVisitorMessage(message, lastReadAt) {
  if (message.sender !== "user") return false;
  if (!message.createdAt) return true;
  return compareTimestamps(message.createdAt, lastReadAt) > 0;
}
