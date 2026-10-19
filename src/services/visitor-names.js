import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch
} from "firebase/firestore";
import { auth, database } from "../firebase/client.js";
import { isFirebaseConfigured, ownerUid } from "../firebase/config.js";
import { MAX_NAME_LENGTH } from "./message-validation.js";

const profilesCollection = () => collection(database, "visitorNames");
const messagesCollection = () => collection(database, "messages");
const threadReadsCollection = () => collection(database, "threadReads");
const typingStatesCollection = () => collection(database, "typingStates");

export function prepareVisitorName(name) {
  if (typeof name !== "string") {
    throw new Error(`Name must be between 1 and ${MAX_NAME_LENGTH} characters.`);
  }
  const displayName = name.trim();
  if (
    !displayName ||
    displayName.length > MAX_NAME_LENGTH ||
    displayName === "." ||
    displayName === ".."
  ) {
    throw new Error(`Name must be between 1 and ${MAX_NAME_LENGTH} characters.`);
  }
  return displayName;
}

function requireDatabase() {
  if (!isFirebaseConfigured() || !database || !auth?.currentUser) {
    throw new Error("A signed-in Firebase session is required to reserve a name.");
  }
}

export async function reserveVisitorName(requestedName, uid) {
  requireDatabase();
  const baseName = prepareVisitorName(requestedName);
  if (
    !uid ||
    uid === ownerUid ||
    (auth.currentUser.uid !== uid && auth.currentUser.uid !== ownerUid)
  ) {
    throw new Error("Visitor session is invalid. Refresh the page and try again.");
  }

  const profileRef = doc(profilesCollection(), uid);
  return runTransaction(database, async (transaction) => {
    const profile = await transaction.get(profileRef);
    if (profile.exists()) {
      if (!profile.data().active) {
        throw new Error("This account was removed from chat. Its name remains reserved; contact the owner for access.");
      }
      const savedName = profile.data().baseName || profile.data().name || baseName;
      if (profile.data().name !== savedName || profile.data().nameKey !== uid) {
        transaction.update(profileRef, {
          name: savedName,
          number: 1,
          nameKey: uid
        });
      }
      return { name: savedName };
    }

    transaction.set(profileRef, {
      name: baseName,
      baseName,
      number: 1,
      nameKey: uid,
      uid,
      active: true,
      createdAt: serverTimestamp()
    });
    return { name: baseName };
  });
}

export async function removeVisitorAccount(uid) {
  requireDatabase();
  if (auth.currentUser.uid !== ownerUid) {
    throw new Error("Only the owner can remove a visitor account.");
  }
  if (!uid || uid === ownerUid) {
    throw new Error("Select a valid visitor.");
  }

  const profileRef = doc(profilesCollection(), uid);
  const existingProfile = await getDoc(profileRef);
  if (!existingProfile.exists()) {
    const messages = await getDocs(
      query(
        messagesCollection(),
        where("threadId", "==", uid),
        limit(400)
      )
    );
    const legacyName = messages.docs.find((message) => message.data().sender === "user")
      ?.data().name;
    if (legacyName) await reserveVisitorName(legacyName, uid);
  }

  const profileData = await runTransaction(database, async (transaction) => {
    const profile = await transaction.get(profileRef);
    if (!profile.exists()) return null;
    const data = profile.data();
    if (data.active) transaction.update(profileRef, { active: false });
    return data;
  });
  let deleted = 0;
  while (true) {
    const page = await getDocs(
      query(messagesCollection(), where("threadId", "==", uid), limit(400))
    );
    if (page.empty) break;

    const batch = writeBatch(database);
    for (const message of page.docs) batch.delete(message.ref);
    await batch.commit();
    deleted += page.size;
  }

  if (profileData) {
    const cleanup = writeBatch(database);
    cleanup.delete(doc(threadReadsCollection(), uid));
    cleanup.delete(doc(typingStatesCollection(), uid));
    await cleanup.commit();
  }

  return deleted;
}
