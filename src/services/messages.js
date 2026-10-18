import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from "firebase/firestore";
import { database } from "../firebase/client.js";
import { isFirebaseConfigured } from "../firebase/config.js";
import { cleanMessage } from "./message-validation.js";

const messagesCollection = () => {
  if (!isFirebaseConfigured() || !database) {
    throw new Error("Messaging is unavailable until Firebase is configured.");
  }
  return collection(database, "messages");
};

export async function sendMessage(name, text, threadId) {
  const message = cleanMessage(name, text);
  if (typeof threadId !== "string" || !threadId || threadId.length > 128) {
    throw new Error("Visitor session is not ready. Refresh and try again.");
  }
  await addDoc(messagesCollection(), {
    ...message,
    threadId,
    sender: "user",
    createdAt: serverTimestamp()
  });
}

export async function sendReply(name, text, threadId) {
  const message = cleanMessage(name, text);
  if (typeof threadId !== "string" || !threadId || threadId.length > 128) {
    throw new Error("Select a valid conversation.");
  }
  await addDoc(messagesCollection(), {
    ...message,
    threadId,
    sender: "owner",
    createdAt: serverTimestamp()
  });
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
