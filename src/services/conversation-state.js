function timestampMillis(timestamp) {
  return typeof timestamp?.toMillis === "function" ? timestamp.toMillis() : 0;
}

export function normalizeConversationName(name) {
  return typeof name === "string"
    ? name.trim().replace(/\s+/gu, " ").toLowerCase()
    : "";
}

export function groupMessagesByName(messages, namesByUid, activeByUid) {
  const groups = new Map();
  const resolvedNamesByUid = new Map(namesByUid);
  for (const message of messages) {
    if (message.sender === "user" && message.threadId && message.name) {
      resolvedNamesByUid.set(message.threadId, resolvedNamesByUid.get(message.threadId) || message.name);
    }
  }

  for (const message of messages) {
    const uid = message.threadId;
    const name = resolvedNamesByUid.get(uid) || "";
    const key = normalizeConversationName(name);
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        id: key,
        name,
        accounts: new Set(),
        activeAccounts: new Set(),
        messages: [],
        broadcastIds: new Set()
      };
      groups.set(key, group);
    }
    group.accounts.add(uid);
    if (activeByUid.get(uid) !== false) group.activeAccounts.add(uid);
    if (message.sender === "owner" && message.broadcastId) {
      if (group.broadcastIds.has(message.broadcastId)) continue;
      group.broadcastIds.add(message.broadcastId);
    }
    group.messages.push(message);
  }

  for (const group of groups.values()) {
    group.messages.sort((left, right) => compareTimestamps(left.createdAt, right.createdAt));
  }
  return [...groups.values()];
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
