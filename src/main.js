import "./style.css";
import {
  attachmentsEnabled,
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
  getAttachmentUrl,
  sendAttachments,
  sendMessage,
  sendReply,
  watchMessages
} from "./services/messages.js";

const app = document.querySelector("#app");
const ownerTitle = '✿ㅤ"MʙɪㅤDᴀʀᴋ"';
const savedNameKey = "dark-host-name";

let stopSessionWatch = null;
let stopMessagesWatch = null;
let messages = [];
let visitorMessages = [];
let visitorUid = "";
let selectedThreadId = "";
let sidebarOpen = true;
let messageError = "";
let replyError = "";
let lastAuthUid = "";
let visitorTranscript = null;
const attachmentUrls = new Map();

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
  app.append(row);
  if (errorText) app.append(makeLine(errorText, "error"));
  focusForDesktop(input);
  row.addEventListener("click", () => input.focus());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    if (name.replace(/\s+/g, " ").toUpperCase() === "MBI DARK") {
      showOwnerPasswordPrompt();
      return;
    }
    localStorage.setItem(savedNameKey, name);
    showMessagePrompt(name);
  });
}

function showMessagePrompt(name) {
  app.replaceChildren();
  app.className = "terminal";
  app.append(makeLine("olny way to the dark"));

  visitorTranscript = document.createElement("div");
  visitorTranscript.className = "visitor-transcript";
  visitorTranscript.setAttribute("aria-live", "polite");
  app.append(visitorTranscript);
  renderVisitorTranscript();

  const addComposer = () => {
    const entry = document.createElement("div");
    entry.className = "message-entry";
    const { row, input } = makeInput("", "", "text");
    input.maxLength = 2000;
    input.setAttribute("aria-label", "Message");
    const status = makeLine();
    status.setAttribute("role", "status");
    entry.append(row, status);
    if (attachmentsEnabled) {
      addAttachmentControl(entry, name, visitorUid, "user", (text, isError = false) => {
        status.className = isError ? "line error" : "line status";
        status.textContent = text;
      });
    }
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

function createChatMessage(message, perspective, threadName = "") {
  const isOwner = message.sender === "owner";
  const article = document.createElement("article");
  article.className = `chat-message ${isOwner ? "from-owner" : "from-user"}`;

  const sender = document.createElement("div");
  sender.className = "chat-sender";
  sender.textContent = perspective === "owner"
    ? (isOwner ? "Dark" : threadName || message.name || "User")
    : (isOwner ? "Dark" : "You");

  const content = document.createElement("div");
  content.className = "chat-content";
  if (message.attachment) {
    appendAttachment(content, message.attachment, perspective === "owner", !isOwner && perspective !== "owner");
  } else {
    content.textContent = message.text || "";
  }

  article.append(sender, content);
  return article;
}

function renderVisitorTranscript() {
  if (!visitorTranscript) return;
  visitorTranscript.replaceChildren();
  for (const message of visitorMessages) {
    visitorTranscript.append(createChatMessage(message, "user"));
  }
}

function addAttachmentControl(container, name, threadId, sender, reportStatus) {
  const controls = document.createElement("div");
  controls.className = "composer-controls";
  const picker = document.createElement("input");
  picker.type = "file";
  picker.multiple = true;
  picker.hidden = true;
  picker.tabIndex = -1;
  picker.setAttribute("aria-label", "Choose files");

  const attach = document.createElement("button");
  attach.type = "button";
  attach.className = "text-control attach-control";
  attach.textContent = "Attach";
  let holdTimer;
  let suppressAttachClick = false;
  attach.addEventListener("click", () => {
    if (suppressAttachClick) {
      suppressAttachClick = false;
      return;
    }
    picker.click();
  });
  attach.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") {
      holdTimer = window.setTimeout(() => {
        suppressAttachClick = true;
      }, 550);
    }
  });
  attach.addEventListener("pointerup", () => {
    window.clearTimeout(holdTimer);
    if (suppressAttachClick) picker.click();
  });
  for (const eventName of ["pointerleave", "pointercancel"]) {
    attach.addEventListener(eventName, () => {
      window.clearTimeout(holdTimer);
      suppressAttachClick = false;
    });
  }
  attach.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    picker.click();
  });

  const upload = async (files) => {
    if (!files.length) return;
    attach.disabled = true;
    try {
      await sendAttachments(name, files, threadId, sender, ({ file, index, count, transferred, total }) => {
        const percent = total ? Math.floor((transferred / total) * 100) : 0;
        reportStatus(`Uploading ${index + 1}/${count}: ${file.name} (${percent}%)`);
      });
      reportStatus("");
    } catch (error) {
      reportStatus(error.message || "File upload failed.", true);
    } finally {
      attach.disabled = false;
      picker.value = "";
    }
  };

  picker.addEventListener("change", () => upload([...picker.files]));
  container.addEventListener("dragover", (event) => {
    event.preventDefault();
    controls.classList.add("dragover");
  });
  container.addEventListener("dragleave", (event) => {
    if (!container.contains(event.relatedTarget)) controls.classList.remove("dragover");
  });
  container.addEventListener("drop", (event) => {
    event.preventDefault();
    controls.classList.remove("dragover");
    upload([...event.dataTransfer.files]);
  });
  controls.addEventListener("contextmenu", (event) => {
    if (event.target === controls) {
      event.preventDefault();
      picker.click();
    }
  });
  controls.append(attach, picker);
  container.append(controls);
}

function appendAttachment(line, attachment, canSave, sent = false) {
  const contentType = attachment.type || "application/octet-stream";
  const name = attachment.name || "Attachment";
  const details = document.createElement("span");
  details.className = "attachment-name";
  details.textContent = name;
  line.append(details);
  if (sent) {
    const tick = document.createElement("span");
    tick.className = "delivery-check";
    tick.textContent = " ✓";
    tick.setAttribute("aria-label", "Sent");
    line.append(tick);
  }

  let urlPromise = attachmentUrls.get(attachment.path);
  if (!urlPromise) {
    urlPromise = getAttachmentUrl(attachment.path);
    attachmentUrls.set(attachment.path, urlPromise);
    urlPromise.catch(() => attachmentUrls.delete(attachment.path));
  }

  const tools = document.createElement("span");
  tools.className = "attachment-tools";
  line.append(tools);
  urlPromise.then((url) => {
    const save = document.createElement("a");
    save.className = "text-control attachment-save";
    save.href = url;
    save.textContent = canSave ? "Save" : "Open";
    save.target = "_blank";
    save.rel = "noopener";
    if (canSave) {
      save.addEventListener("click", async (event) => {
        event.preventDefault();
        save.textContent = "Saving...";
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Download failed (${response.status}).`);
          const blobUrl = URL.createObjectURL(await response.blob());
          const download = document.createElement("a");
          download.href = blobUrl;
          download.download = name;
          download.click();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
          save.textContent = "Save";
        } catch (error) {
          save.textContent = error.message || "Save failed.";
          save.classList.add("error");
        }
      });
    }
    tools.append(save);
    if (canSave) {
      const open = document.createElement("a");
      open.className = "text-control attachment-save";
      open.href = url;
      open.textContent = "Open";
      open.target = "_blank";
      open.rel = "noopener";
      tools.append(open);
    }

    if (contentType.startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "attachment-preview";
      image.src = url;
      image.alt = name;
      image.loading = "lazy";
      image.addEventListener("click", () => image.requestFullscreen?.());
      line.append(image);
      const fullscreen = document.createElement("button");
      fullscreen.type = "button";
      fullscreen.className = "text-control attachment-save";
      fullscreen.textContent = "Full screen";
      fullscreen.addEventListener("click", () => image.requestFullscreen?.());
      tools.append(fullscreen);
    } else if (contentType.startsWith("video/")) {
      const video = document.createElement("video");
      video.className = "attachment-preview";
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", name);
      video.addEventListener("dblclick", () => video.requestFullscreen?.());
      line.append(video);
      const fullscreen = document.createElement("button");
      fullscreen.type = "button";
      fullscreen.className = "text-control attachment-save";
      fullscreen.textContent = "Full screen";
      fullscreen.addEventListener("click", () => video.requestFullscreen?.());
      tools.append(fullscreen);
    } else if (contentType.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.className = "attachment-audio";
      audio.src = url;
      audio.controls = true;
      audio.preload = "metadata";
      audio.setAttribute("aria-label", name);
      line.append(audio);
    }
  }).catch((error) => {
    const failure = document.createElement("span");
    failure.className = "error";
    failure.textContent = ` ${error.message || "Attachment preview unavailable."}`;
    tools.append(failure);
  });
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
  return [...threads.values()];
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
      localStorage.removeItem(savedNameKey);
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
    const transcript = document.createElement("div");
    transcript.className = "owner-transcript";
    for (const message of currentMessages) {
      transcript.append(createChatMessage(message, "owner", thread.name));
    }
    main.append(transcript);

    const reply = document.createElement("div");
    reply.className = "owner-reply-composer";
    const { row, input } = makeInput("", "", "text");
    input.maxLength = 2000;
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
        await sendReply(thread.name, text, thread.id);
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
    if (attachmentsEnabled) {
      addAttachmentControl(reply, thread.name, thread.id, "owner", (text, isError = false) => {
        status.className = isError ? "line error" : "line status";
        status.textContent = text;
      });
    }
    main.append(reply);
  } else {
    main.append(makeLine("Select a user."));
  }
  if (!isFirebaseConfigured()) {
    main.append(makeLine("Firebase is not configured. Owner messages are unavailable.", "error"));
  } else if (messageError) {
    main.append(makeLine(messageError, "error"));
  }
  app.append(sidebar, main);
}

function startMessageListener(isOwner, threadId) {
  if (stopMessagesWatch) stopMessagesWatch();
  messageError = "";
  stopMessagesWatch = watchMessages(
    (nextMessages) => {
      if (isOwner) {
        messages = nextMessages;
        if (!getThreads().some((thread) => thread.id === selectedThreadId)) {
          selectedThreadId = getThreads()[0]?.id || "";
        }
        showOwnerInterface();
      } else {
        visitorMessages = nextMessages.sort((a, b) =>
          (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0)
        );
        renderVisitorTranscript();
      }
    },
    (error) => {
      messageError = error.message || "Could not load messages.";
      if (isOwner) showOwnerInterface();
      else {
        const savedName = localStorage.getItem(savedNameKey);
        if (savedName) showMessagePrompt(savedName);
      }
    },
    threadId
  );
}

async function handleAuthChange(user) {
  if (user?.uid === lastAuthUid) return;
  lastAuthUid = user?.uid || "";
  visitorUid = "";
  messages = [];
  visitorMessages = [];
  if (stopMessagesWatch) {
    stopMessagesWatch();
    stopMessagesWatch = null;
  }

  if (user?.uid === ownerUid) {
    startMessageListener(true);
    showOwnerInterface();
    return;
  }

  if (user) {
    visitorUid = user.uid;
    startMessageListener(false, user.uid);
    const savedName = localStorage.getItem(savedNameKey);
    if (savedName) showMessagePrompt(savedName);
    else showNamePrompt();
    return;
  }

  try {
    await ensureVisitorSession();
  } catch (error) {
    showNamePrompt(error.message || "Visitor session unavailable.");
  }
}

async function boot() {
  await startup();
  stopSessionWatch = watchAuthSession(handleAuthChange);
}

window.addEventListener("pagehide", () => {
  stopMessagesWatch?.();
  stopSessionWatch?.();
});

boot();
