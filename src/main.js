import "./style.css";
import {
  isFirebaseConfigured,
  isOwnerConfigured,
  ownerUid
} from "./firebase/config.js";
import {
  ensureVisitorSession,
  signInOwner,
  signOutOwner,
  watchAuthSession
} from "./services/auth.js";
import {
  sendMessage,
  sendReply,
  watchMessages
} from "./services/messages.js";
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH
} from "./services/message-validation.js";
import { deleteVisitorData, reserveVisitorName } from "./services/visitor-names.js";

const app = document.querySelector("#app");
const ownerTitle = '✿ㅤ"MʙɪㅤDᴀʀᴋ"';
const savedNameKey = "dark-host-name";
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;

let stopSessionWatch = null;
let stopMessagesWatch = null;
let inactivityTimer = null;
let messageWatchGeneration = 0;
let messages = [];
let visitorMessages = [];
const visitorNamesByUid = new Map();
let visitorUid = "";
let currentVisitorName = "";
let selectedThreadId = "";
let sidebarOpen = true;
let messageError = "";
let replyError = "";
let ownerNotice = "";
let sessionExpiredNotice = "";
let deletingThreadId = "";
let lastAuthUid = "";
let visitorTranscript = null;
let visitorErrorLine = null;
let lastActivityWrite = 0;
let storageWarningShown = false;

function readSavedName() {
  try {
    return localStorage.getItem(savedNameKey) || "";
  } catch (error) {
    console.warn("Could not read the saved visitor name.", error);
    return "";
  }
}

function saveVisitorName(name) {
  try {
    localStorage.setItem(savedNameKey, name);
  } catch (error) {
    console.warn("Could not save the visitor name.", error);
  }
}

function clearSavedName() {
  try {
    localStorage.removeItem(savedNameKey);
  } catch (error) {
    console.warn("Could not clear the saved visitor name.", error);
  }
}

function activityKey(uid) {
  return `dark-host-last-activity:${uid}`;
}

function readLastActivity(uid) {
  try {
    const value = Number(localStorage.getItem(activityKey(uid)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (error) {
    warnStorageOnce("Could not read the visitor activity time.", error);
    return 0;
  }
}

function writeLastActivity(uid, timestamp) {
  try {
    localStorage.setItem(activityKey(uid), String(timestamp));
  } catch (error) {
    warnStorageOnce("Could not save the visitor activity time.", error);
  }
}

function removeLastActivity(uid) {
  try {
    localStorage.removeItem(activityKey(uid));
  } catch (error) {
    warnStorageOnce("Could not clear the visitor activity time.", error);
  }
}

function warnStorageOnce(message, error) {
  if (storageWarningShown) return;
  storageWarningShown = true;
  console.warn(message, error);
}

function stopInactivityTimer() {
  window.clearTimeout(inactivityTimer);
  inactivityTimer = null;
}

function scheduleInactivityLogout(uid, lastActivity) {
  stopInactivityTimer();
  if (uid !== visitorUid || !uid || uid === ownerUid) return;

  const remaining = INACTIVITY_TIMEOUT_MS - (Date.now() - lastActivity);
  if (remaining <= 0) {
    void expireVisitorSession(uid);
    return;
  }
  inactivityTimer = window.setTimeout(() => {
    void expireVisitorSession(uid);
  }, remaining);
}

function recordVisitorActivity() {
  if (!visitorUid || visitorUid === ownerUid) return;
  const now = Date.now();
  if (now - lastActivityWrite < 1_000) return;
  scheduleInactivityLogout(visitorUid, now);
  if (now - lastActivityWrite >= 10_000) {
    writeLastActivity(visitorUid, now);
    lastActivityWrite = now;
  }
}

async function expireVisitorSession(uid) {
  if (uid !== visitorUid || uid === ownerUid) return;
  stopInactivityTimer();
  clearSavedName();
  removeLastActivity(uid);
  visitorUid = "";
  sessionExpiredNotice = "You were signed out after one hour of inactivity. Enter your name to continue.";
  try {
    await signOutOwner();
  } catch (error) {
    visitorUid = uid;
    scheduleInactivityLogout(uid, Date.now());
    showMessagePrompt(currentVisitorName);
    if (visitorErrorLine) {
      visitorErrorLine.className = "line error";
      visitorErrorLine.textContent = error.message || "Could not sign out after inactivity.";
    }
  }
}

function stopMessageWatch() {
  messageWatchGeneration += 1;
  stopMessagesWatch?.();
  stopMessagesWatch = null;
}

function pause(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function focusForDesktop(input) {
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    input.focus();
  }
}

function makeLine(text = "", className = "") {
  const line = document.createElement("div");
  line.className = `line ${className}`.trim();
  line.textContent = text;
  return line;
}

function makeInput(label, value = "", type = "text") {
  const row = document.createElement("div");
  row.className = "input-row";

  const labelNode = document.createElement("label");
  labelNode.className = "prompt";
  labelNode.textContent = label;

  const input = document.createElement("input");
  input.className = "terminal-input";
  input.type = type;
  input.autocomplete = type === "password" ? "current-password" : "off";
  input.spellcheck = false;
  input.value = value;
  input.setAttribute("aria-label", label.replace(/:\s*$/, ""));
  labelNode.append(input);
  row.append(labelNode);

  input.addEventListener("input", () => {
    row.classList.toggle("has-value", input.value.length > 0);
  });

  return { row, input };
}

async function startup() {
  app.replaceChildren();
  app.className = "startup";
  const output = document.createElement("div");
  output.className = "startup-output";
  app.append(output);

  const lines = [
    "Initializing DARK HOST...",
    "Loading terminal...",
    "Establishing secure channel...",
    "Initialization complete."
  ];
  for (const text of lines) {
    const line = makeLine();
    const content = document.createTextNode("");
    const cursor = document.createElement("span");
    cursor.className = "cursor startup-cursor";
    cursor.setAttribute("aria-hidden", "true");
    line.append(content, cursor);
    output.append(line);
    for (const character of text) {
      content.data += character;
      await pause(8);
    }
    cursor.remove();
    await pause(text.startsWith("Initialization") ? 100 : 75);
  }
  app.className = "";
}

function showNamePrompt(errorText = "") {
  app.replaceChildren();
  app.className = "terminal";
  const { row, input } = makeInput("whats your name ?");
  input.maxLength = MAX_NAME_LENGTH;
  const status = makeLine(errorText, errorText ? "error" : "");
  status.setAttribute("role", "status");
  app.append(row);
  app.append(status);
  focusForDesktop(input);
  row.addEventListener("click", () => input.focus());
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    if (name.replace(/\s+/g, " ").toUpperCase() === "MBI DARK") {
      showOwnerPasswordPrompt();
      return;
    }
    input.disabled = true;
    status.className = "line status";
    status.textContent = "Checking name...";
    const uid = visitorUid;
    try {
      const assignment = await reserveVisitorName(name, uid);
      if (visitorUid !== uid) return;
      currentVisitorName = assignment.name;
      saveVisitorName(assignment.name);
      showMessagePrompt(assignment.name);
      startMessageListener(false, visitorUid);
      if (assignment.renamed) {
        visitorErrorLine.className = "line status";
        visitorErrorLine.textContent = `That name was in use. Your name is ${assignment.name}.`;
      }
    } catch (error) {
      status.className = "line error";
      status.textContent = error.message || "Could not reserve that name.";
      input.disabled = false;
      input.focus();
    }
  });
}

function showMessagePrompt(name) {
  currentVisitorName = name;
  app.replaceChildren();
  app.className = "terminal";
  app.append(makeLine("olny way to the dark"));

  visitorTranscript = document.createElement("div");
  visitorTranscript.className = "visitor-transcript";
  visitorTranscript.setAttribute("aria-live", "polite");
  app.append(visitorTranscript);
  visitorErrorLine = makeLine(messageError, messageError ? "error" : "");
  visitorErrorLine.setAttribute("role", "status");
  app.append(visitorErrorLine);
  renderVisitorTranscript();

  const addComposer = () => {
    const entry = document.createElement("div");
    entry.className = "message-entry";
    const { row, input } = makeInput("", "", "text");
    input.maxLength = MAX_MESSAGE_LENGTH;
    input.setAttribute("aria-label", "Message");
    const status = makeLine();
    status.setAttribute("role", "status");
    entry.append(row, status);
    app.append(entry);
    focusForDesktop(input);
    row.addEventListener("click", () => input.focus());
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const text = input.value.trim();
      if (!text || input.disabled) return;
      input.disabled = true;
      let timeoutId;
      try {
        await Promise.race([
          sendMessage(name, text, visitorUid),
          new Promise((_, reject) => {
            timeoutId = window.setTimeout(
              () => reject(new Error("No confirmation from Firebase. Delivery is unconfirmed; check your connection before retrying.")),
              20000
            );
          })
        ]);
        entry.remove();
        addComposer();
      } catch (error) {
        status.className = "line status error";
        status.textContent = error.message || "Message could not be sent.";
        input.disabled = false;
        focusForDesktop(input);
      } finally {
        window.clearTimeout(timeoutId);
      }
    });
  };
  addComposer();
}

function createChatMessage(message, threadName = "") {
  const isOwner = message.sender === "owner";
  const article = document.createElement("article");
  article.className = `chat-message ${isOwner ? "from-owner" : "from-user"}`;

  const senderName = isOwner ? "Dark" : threadName || message.name || "User";

  const content = document.createElement("div");
  content.className = "chat-content";
  content.append(document.createTextNode(`${senderName}: `), document.createTextNode(message.text || ""));

  article.append(content);
  return article;
}

function renderVisitorTranscript() {
  if (!visitorTranscript) return;
  visitorTranscript.replaceChildren();
  for (const message of visitorMessages) {
    visitorTranscript.append(createChatMessage(message, currentVisitorName));
  }
}

function showOwnerPasswordPrompt() {
  app.replaceChildren();
  app.className = "terminal";
  const { row, input } = makeInput("Enter password:", "", "password");
  const status = makeLine();
  status.setAttribute("role", "status");
  if (!isOwnerConfigured()) {
    status.className = "line error";
    status.textContent = "Owner login not configured. Add the Firebase owner email and UID.";
  }
  app.append(row, status);
  focusForDesktop(input);
  row.addEventListener("click", () => input.focus());
  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!input.value) return;
    input.disabled = true;
    status.className = "line status";
    status.textContent = "Authenticating...";
    try {
      await signInOwner(input.value);
      app.replaceChildren();
      app.className = "terminal";
      app.append(makeLine(`Welcome ${ownerTitle}`));
      await pause(450);
      if (lastAuthUid === ownerUid) showOwnerInterface();
    } catch (error) {
      status.className = "line error";
      status.textContent = error.message || "Authentication failed.";
      input.value = "";
      input.disabled = false;
      input.focus();
    }
  });
}

function getThreads() {
  const threads = new Map();
  for (const message of messages) {
    if (!message.threadId) continue;
    const thread = threads.get(message.threadId) || { id: message.threadId, name: message.name };
    if (message.sender === "user") thread.name = message.name;
    threads.set(message.threadId, thread);
  }
  for (const thread of threads.values()) {
    thread.name = visitorNamesByUid.get(thread.id) || thread.name;
  }
  return [...threads.values()];
}

async function ensureVisitorNames(currentMessages) {
  const names = new Map();
  for (const message of currentMessages) {
    if (message.sender === "user" && message.threadId && message.name && !names.has(message.threadId)) {
      names.set(message.threadId, message.name);
    }
  }

  const failures = [];
  await Promise.all([...names].map(async ([uid, name]) => {
    if (visitorNamesByUid.has(uid)) return;
    try {
      const assignment = await reserveVisitorName(name, uid);
      visitorNamesByUid.set(uid, assignment.name);
    } catch (error) {
      failures.push(error);
    }
  }));
  if (failures.length) {
    console.warn("Some existing visitor names could not be reserved.", failures);
    ownerNotice = `Could not reserve every existing name. Publish the current Firestore rules. ${failures[0].message || ""}`;
  } else if (ownerNotice.startsWith("Could not reserve every existing name.")) {
    ownerNotice = "";
  }
}

function showOwnerInterface() {
  app.replaceChildren();
  app.className = `owner-layout${sidebarOpen ? "" : " sidebar-closed"}`;

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.setAttribute("aria-label", "Users");

  const createToggle = () => {
    const toggle = document.createElement("button");
    toggle.className = "text-control owner-toggle";
    toggle.type = "button";
    toggle.textContent = ownerTitle;
    toggle.setAttribute("aria-expanded", String(sidebarOpen));
    toggle.addEventListener("click", () => {
      sidebarOpen = !sidebarOpen;
      showOwnerInterface();
    });
    return toggle;
  };

  const userList = document.createElement("nav");
  userList.className = "user-list";
  userList.setAttribute("aria-label", "Message senders");
  for (const thread of getThreads()) {
    const entry = document.createElement("button");
    entry.className = `text-control user-entry${selectedThreadId === thread.id ? " selected" : ""}`;
    entry.type = "button";
    entry.textContent = thread.name;
    entry.addEventListener("click", () => {
      selectedThreadId = thread.id;
      replyError = "";
      ownerNotice = "";
      showOwnerInterface();
    });
    userList.append(entry);
  }

  const logout = document.createElement("button");
  logout.className = "text-control logout";
  logout.type = "button";
  logout.textContent = "Logout";
  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      clearSavedName();
      await signOutOwner();
    } catch (error) {
      logout.disabled = false;
      main.replaceChildren(makeLine(error.message || "Could not log out.", "error"));
    }
  });
  if (sidebarOpen) sidebar.append(createToggle());
  sidebar.append(userList, logout);

  const main = document.createElement("section");
  main.className = "owner-main";
  main.setAttribute("aria-label", "Selected messages");
  if (!sidebarOpen) main.append(createToggle());
  const thread = getThreads().find((item) => item.id === selectedThreadId);
  const currentMessages = messages.filter((message) => message.threadId === selectedThreadId);
  if (thread) {
    main.append(makeLine(thread.name, "conversation-title"));
    const clearData = document.createElement("button");
    clearData.className = "text-control clear-user-data";
    clearData.type = "button";
    clearData.textContent = "Clear user data";
    clearData.disabled = deletingThreadId === thread.id;
    clearData.addEventListener("click", async () => {
      if (deletingThreadId === thread.id) return;
      if (!window.confirm(`Permanently clear all messages and the name reservation for ${thread.name}?`)) {
        return;
      }
      deletingThreadId = thread.id;
      clearData.disabled = true;
      try {
        const count = await deleteVisitorData(thread.id);
        if (lastAuthUid !== ownerUid) return;
        messages = messages.filter((message) => message.threadId !== thread.id);
        visitorNamesByUid.delete(thread.id);
        selectedThreadId = getThreads()[0]?.id || "";
        replyError = "";
        ownerNotice = `Cleared ${count} messages and released ${thread.name}'s name.`;
        deletingThreadId = "";
        showOwnerInterface();
      } catch (error) {
        if (lastAuthUid !== ownerUid) return;
        replyError = "";
        ownerNotice = `Could not clear visitor data. ${error.message || ""}`;
        deletingThreadId = "";
        showOwnerInterface();
      }
    });
    main.append(clearData);
    const transcript = document.createElement("div");
    transcript.className = "owner-transcript";
    for (const message of currentMessages) {
      transcript.append(createChatMessage(message, thread.name));
    }
    main.append(transcript);

    const reply = document.createElement("div");
    reply.className = "owner-reply-composer";
    const { row, input } = makeInput("", "", "text");
    input.maxLength = MAX_MESSAGE_LENGTH;
    input.setAttribute("aria-label", "Reply");
    const status = makeLine(replyError, replyError ? "error" : "");
    status.setAttribute("role", "status");
    row.addEventListener("click", () => input.focus());
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const text = input.value.trim();
      if (!text || input.disabled) return;
      input.disabled = true;
      try {
        await sendReply(text, thread.id);
        replyError = "";
        showOwnerInterface();
      } catch (error) {
        replyError = error.message || "Reply could not be sent.";
        status.className = "line error";
        status.textContent = replyError;
        input.disabled = false;
        input.focus();
      }
    });
    reply.append(row, status);
    main.append(reply);
  } else {
    main.append(makeLine("Select a user."));
  }
  if (!isFirebaseConfigured()) {
    main.append(makeLine("Firebase is not configured. Owner messages are unavailable.", "error"));
  } else if (messageError) {
    main.append(makeLine(messageError, "error"));
  }
  if (ownerNotice) main.append(makeLine(ownerNotice, "status"));
  app.append(sidebar, main);
}

function startMessageListener(isOwner, threadId) {
  stopMessageWatch();
  const generation = messageWatchGeneration;
  messageError = "";
  stopMessagesWatch = watchMessages(
    async (nextMessages) => {
      if (generation !== messageWatchGeneration) return;
      messageError = "";
      if (isOwner) {
        messages = nextMessages;
        await ensureVisitorNames(nextMessages);
        if (generation !== messageWatchGeneration) return;
        if (!getThreads().some((thread) => thread.id === selectedThreadId)) {
          selectedThreadId = getThreads()[0]?.id || "";
        }
        showOwnerInterface();
      } else {
        visitorMessages = nextMessages.sort((a, b) =>
          (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)
        );
        if (visitorErrorLine) {
          visitorErrorLine.className = "line";
          visitorErrorLine.textContent = "";
        }
        renderVisitorTranscript();
      }
    },
    (error) => {
      if (generation !== messageWatchGeneration) return;
      messageError = error.message || "Could not load messages.";
      if (isOwner) showOwnerInterface();
      else {
        const savedName = readSavedName();
        if (savedName) showMessagePrompt(savedName);
        else showNamePrompt(messageError);
      }
    },
    threadId
  );
}

async function handleAuthChange(user) {
  if (user?.uid === lastAuthUid) return;
  lastAuthUid = user?.uid || "";
  visitorUid = "";
  currentVisitorName = "";
  stopInactivityTimer();
  messages = [];
  visitorMessages = [];
  deletingThreadId = "";
  visitorErrorLine = null;
  stopMessageWatch();

  if (user?.uid === ownerUid) {
    startMessageListener(true);
    showOwnerInterface();
    return;
  }

  if (user) {
    visitorUid = user.uid;
    const lastActivity = readLastActivity(user.uid) || Date.now();
    lastActivityWrite = lastActivity;
    writeLastActivity(user.uid, lastActivity);
    scheduleInactivityLogout(user.uid, lastActivity);
    if (visitorUid !== user.uid) return;
    const savedName = readSavedName();
    if (savedName) {
      try {
        const assignment = await reserveVisitorName(savedName, user.uid);
        if (lastAuthUid !== user.uid) return;
        currentVisitorName = assignment.name;
        saveVisitorName(assignment.name);
        showMessagePrompt(assignment.name);
        startMessageListener(false, user.uid);
        if (assignment.renamed) {
          visitorErrorLine.className = "line status";
          visitorErrorLine.textContent = `That name was in use. Your name is ${assignment.name}.`;
        }
      } catch (error) {
        if (lastAuthUid === user.uid) showNamePrompt(error.message || "Could not reserve that name.");
      }
    } else {
      const notice = sessionExpiredNotice;
      sessionExpiredNotice = "";
      showNamePrompt(notice);
    }
    return;
  }

  try {
    await ensureVisitorSession();
  } catch (error) {
    const notice = sessionExpiredNotice;
    sessionExpiredNotice = "";
    showNamePrompt(notice || error.message || "Visitor session unavailable.");
  }
}

async function boot() {
  await startup();
  for (const eventName of ["pointerdown", "keydown", "input", "touchstart", "scroll"]) {
    document.addEventListener(eventName, recordVisitorActivity, { passive: true });
  }
  document.addEventListener("pointermove", recordVisitorActivity, { passive: true });
  stopSessionWatch = watchAuthSession(handleAuthChange);
}

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  stopMessageWatch();
  stopSessionWatch?.();
});

boot();
