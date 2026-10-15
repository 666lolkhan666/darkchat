import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from "firebase/firestore";
import { database, storage } from "../firebase/client.js";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable
} from "firebase/storage";
import { attachmentsEnabled, isFirebaseConfigured } from "../firebase/config.js";

export const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024;

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
    throw new Error("File attachments are temporarily disabled.");
  }
  if (!isFirebaseConfigured() || !database || !storage) {
    throw new Error("File sharing is unavailable until Firebase is configured.");
  }
  if (!threadId) throw new Error("Conversation session is not ready.");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error(`${file?.name || "File"} is empty or unavailable.`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than the 256 MB per-file limit.`);
  }

  const id = crypto.randomUUID();
  const storagePath = `attachments/${threadId}/${id}`;
  const fileRef = ref(storage, storagePath);
  const task = uploadBytesResumable(fileRef, file, {
    contentType: file.type || "application/octet-stream"
  });

  await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => onProgress?.(snapshot.bytesTransferred, snapshot.totalBytes),
      reject,
      resolve
    );
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
      await deleteObject(fileRef);
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
  if (!attachmentsEnabled || !storage || !isFirebaseConfigured()) {
    throw new Error("File storage is not configured.");
  }
  return getDownloadURL(ref(storage, storagePath));
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
