import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where
} from "firebase/firestore";
import { auth, database } from "../firebase/client.js";
import { isFirebaseConfigured, ownerUid } from "../firebase/config.js";
import { compareTimestamps } from "./conversation-state.js";
import { cleanMessage } from "./message-validation.js";

const threadReadsCollection = () => {
  if (!isFirebaseConfigured() || !database) {
    throw new Error("Conversation status is unavailable until Firebase is configured.");
  }
  return collection(database, "threadReads");
};

const typingStatesCollection = () => {
  if (!isFirebaseConfigured() || !database) {
    throw new Error("Typing status is unavailable until Firebase is configured.");
  }
  return collection(database, "typingStates");
};

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

export async function sendReply(text, threadId) {
  const cleanText = cleanMessage("Dark", text).text;
  if (typeof threadId !== "string" || !threadId || threadId.length > 128) {
    throw new Error("Select a valid conversation.");
  }
  await addDoc(messagesCollection(), {
    name: "Dark",
    text: cleanText,
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

export function watchThreadReads(onReads, onError) {
  return onSnapshot(
    threadReadsCollection(),
    (snapshot) => {
      onReads(new Map(snapshot.docs.map((item) => [item.id, item.data().lastReadAt])));
    },
    onError
  );
}

export async function markThreadRead(threadId, lastReadAt) {
  if (!auth?.currentUser || auth.currentUser.uid !== ownerUid) {
    throw new Error("Only the owner can update conversation read status.");
  }
  if (typeof threadId !== "string" || !threadId || !lastReadAt) return;

  const stateRef = doc(threadReadsCollection(), threadId);
  await runTransaction(database, async (transaction) => {
    const state = await transaction.get(stateRef);
    const currentReadAt = state.data()?.lastReadAt;
    if (currentReadAt && compareTimestamps(currentReadAt, lastReadAt) >= 0) return;

    transaction.set(stateRef, {
      lastReadAt,
      updatedAt: serverTimestamp()
    });
  });
}

export function watchTypingState(threadId, onState, onError) {
  if (typeof threadId !== "string" || !threadId) {
    throw new Error("Select a valid conversation to watch typing status.");
  }
  return onSnapshot(
    doc(typingStatesCollection(), threadId),
    (snapshot) => {
      onState(snapshot.exists() ? snapshot.data() : null);
    },
    onError
  );
}

export async function setTypingState(threadId, sender, isTyping) {
  if (typeof threadId !== "string" || !threadId) {
    throw new Error("A valid conversation is required to update typing status.");
  }
  if (sender !== "owner" && sender !== "visitor") {
    throw new Error("Invalid typing status sender.");
  }
  if (!auth?.currentUser) {
    throw new Error("A signed-in session is required to update typing status.");
  }
  if ((sender === "owner") !== (auth.currentUser.uid === ownerUid)) {
    throw new Error("The signed-in session cannot update this typing status.");
  }

  const stateRef = doc(typingStatesCollection(), threadId);
  await runTransaction(database, async (transaction) => {
    const state = await transaction.get(stateRef);
    const updatedAt = serverTimestamp();
    if (state.exists()) {
      transaction.set(stateRef, {
        [sender === "owner" ? "ownerTyping" : "visitorTyping"]: isTyping,
        updatedAt
      }, { merge: true });
      return;
    }

    transaction.set(stateRef, {
      visitorTyping: sender === "visitor" && isTyping,
      ownerTyping: sender === "owner" && isTyping,
      updatedAt
    });
  });
}
