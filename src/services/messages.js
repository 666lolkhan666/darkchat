import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from "firebase/firestore";
import { auth, database } from "../firebase/client.js";
import {
  attachmentsEnabled,
  fileApiUrl,
  isFirebaseConfigured
} from "../firebase/config.js";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const messagesCollection = () => {
  if (!isFirebaseConfigured() || !database) {
    throw new Error("Messaging is unavailable until Firebase is configured.");
  }
  return collection(database, "messages");
};

function cleanMessage(name, text) {
  const cleanName = name.trim();
  const cleanText = text.trim();
  if (!cleanName || !cleanText) {
    throw new Error("Enter a name and a message.");
  }
  return { name: cleanName, text: cleanText };
}

export async function sendMessage(name, text, threadId) {
  const message = cleanMessage(name, text);
  if (!threadId) throw new Error("Visitor session is not ready. Refresh and try again.");
  await addDoc(messagesCollection(), {
    ...message,
    threadId,
    sender: "user",
    createdAt: serverTimestamp()
  });
}

async function sendAttachment(name, file, threadId, sender, onProgress) {
  if (!attachmentsEnabled) {
    throw new Error("File sharing is not set up yet. Configure the Cloudflare Worker URL first.");
  }
  if (!isFirebaseConfigured() || !database || !auth?.currentUser) {
    throw new Error("File sharing is unavailable until Firebase authentication is ready.");
  }
  if (!threadId) throw new Error("Conversation session is not ready.");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error(`${file?.name || "File"} is empty or unavailable.`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than the 50 MB per-file limit.`);
  }

  const id = crypto.randomUUID();
  const storagePath = `attachments/${threadId}/${id}`;
  const token = await auth.currentUser.getIdToken();
  const uploadUrl = `${fileApiUrl.replace(/\/+$/, "")}/${storagePath}`;

  await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size);
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(request.responseText || `Upload failed (${request.status}).`));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed. Check your connection and try again.")));
    request.addEventListener("abort", () => reject(new Error("Upload was cancelled.")));
    request.send(file);
  });

  try {
    await addDoc(messagesCollection(), {
      name: name.trim(),
      text: file.name,
      threadId,
      sender,
      createdAt: serverTimestamp(),
      attachment: {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        path: storagePath
      }
    });
  } catch (error) {
    try {
      const response = await fetch(uploadUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Cleanup failed (${response.status}).`);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "The attachment message failed to save, and its uploaded file could not be removed."
      );
    }
    throw error;
  }
}

export function sendAttachments(name, files, threadId, sender, onProgress) {
  const pending = [...files];
  return pending.reduce(
    (chain, file, index) =>
      chain.then(() =>
        sendAttachment(name, file, threadId, sender, (transferred, total) =>
          onProgress?.({ file, index, count: pending.length, transferred, total })
        )
      ),
    Promise.resolve()
  );
}

export async function sendReply(name, text, threadId) {
  const message = cleanMessage(name, text);
  if (!threadId) throw new Error("Select a valid conversation.");
  await addDoc(messagesCollection(), {
    ...message,
    threadId,
    sender: "owner",
    createdAt: serverTimestamp()
  });
}

export async function getAttachmentUrl(storagePath) {
  if (!attachmentsEnabled || !isFirebaseConfigured() || !auth?.currentUser) {
    throw new Error("File storage is not configured or you are signed out.");
  }
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`${fileApiUrl.replace(/\/+$/, "")}/${storagePath}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error((await response.text()) || `Download failed (${response.status}).`);
  }
  return URL.createObjectURL(await response.blob());
}

export function watchMessages(onMessages, onError, threadId = null) {
  const items = threadId
    ? query(messagesCollection(), where("threadId", "==", threadId))
    : query(messagesCollection(), orderBy("createdAt", "asc"));
  return onSnapshot(
    items,
    (snapshot) => {
      onMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}
