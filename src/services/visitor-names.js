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
const reservationsCollection = () => collection(database, "visitorNameKeys");
const messagesCollection = () => collection(database, "messages");
const threadReadsCollection = () => collection(database, "threadReads");
const typingStatesCollection = () => collection(database, "typingStates");

export function normalizeVisitorName(name) {
  return name.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function visitorNameKey(name) {
  return normalizeVisitorName(name).replaceAll("/", "／");
}

export function numberedVisitorName(baseName, number) {
  const suffix = number === 1 ? "" : ` ${number}`;
  let prefix = "";
  for (const character of baseName) {
    if (prefix.length + character.length > MAX_NAME_LENGTH - suffix.length) break;
    prefix += character;
  }
  return `${prefix.trimEnd()}${suffix}`;
}

function requireDatabase() {
  if (!isFirebaseConfigured() || !database || !auth?.currentUser) {
    throw new Error("A signed-in Firebase session is required to reserve a name.");
  }
}

export async function reserveVisitorName(requestedName, uid) {
  requireDatabase();
  const baseName = requestedName.trim().replace(/\s+/gu, " ");
  if (!baseName || baseName.length > MAX_NAME_LENGTH || baseName === "." || baseName === "..") {
    throw new Error(`Name must be between 1 and ${MAX_NAME_LENGTH} characters.`);
  }
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
      return { name: profile.data().name, renamed: profile.data().name !== baseName };
    }

    for (let number = 1; number <= 1000; number += 1) {
      const candidate = numberedVisitorName(baseName, number);
      const key = visitorNameKey(candidate);
      const reservationRef = doc(reservationsCollection(), key);
      const reservation = await transaction.get(reservationRef);

      if (!reservation.exists()) {
        transaction.set(profileRef, {
          name: candidate,
          baseName,
          number,
          nameKey: key,
          uid,
          active: true,
          createdAt: serverTimestamp()
        });
        transaction.set(reservationRef, {
          name: candidate,
          baseName,
          number,
          uid,
          createdAt: serverTimestamp()
        });
        return { name: candidate, renamed: number > 1 };
      }
    }

    throw new Error("Could not assign a unique name. Please choose another name.");
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
