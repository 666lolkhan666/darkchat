import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
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
      const profileData = profile.data();
      if (!profile.data().active) {
        if (auth.currentUser.uid !== ownerUid) {
          throw new Error("This account was removed from chat. Contact the owner for access.");
        }
        return { name: profileData.baseName || profileData.name || baseName, active: false };
      }
      const savedName = profileData.baseName || profileData.name || baseName;
      if (profileData.name !== savedName || profileData.nameKey !== uid) {
        transaction.update(profileRef, {
          name: savedName,
          number: 1,
          nameKey: uid
        });
      }
      return { name: savedName, active: true };
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
    return { name: baseName, active: true };
  });
}

export function watchVisitorAccount(uid, onAccount, onError) {
  requireDatabase();
  if (uid !== auth.currentUser.uid || uid === ownerUid) {
    throw new Error("Only the signed-in visitor can watch this account.");
  }
  return onSnapshot(
    doc(profilesCollection(), uid),
    (snapshot) => onAccount(snapshot.exists() ? snapshot.data() : null),
    onError
  );
}

export async function removeVisitorAccounts(uids) {
  requireDatabase();
  if (auth.currentUser.uid !== ownerUid) {
    throw new Error("Only the owner can remove visitor accounts.");
  }
  const uniqueUids = [...new Set(Array.isArray(uids) ? uids : [])]
    .filter((uid) => typeof uid === "string" && uid && uid.length <= 128 && uid !== ownerUid);
  if (!uniqueUids.length) {
    throw new Error("Select a valid visitor group.");
  }
  if (uniqueUids.length > 225) {
    throw new Error("This name group has too many accounts to archive in one operation.");
  }

  for (const uid of uniqueUids) {
    const profileRef = doc(profilesCollection(), uid);
    const existingProfile = await getDoc(profileRef);
    if (existingProfile.exists()) continue;

    const page = await getDocs(
      query(messagesCollection(), where("threadId", "==", uid), limit(400))
    );
    const legacyName = page.docs.find((message) => message.data().sender === "user")
      ?.data().name;
    if (legacyName) await reserveVisitorName(legacyName, uid);
  }

  const profiles = await Promise.all(uniqueUids.map(async (uid) => ({
    uid,
    snapshot: await getDoc(doc(profilesCollection(), uid))
  })));
  const missing = profiles.find(({ snapshot }) => !snapshot.exists());
  if (missing) {
    throw new Error(`Could not find the visitor profile for account ${missing.uid}.`);
  }

  const activeProfiles = profiles.filter(({ snapshot }) => snapshot.data().active);
  if (!activeProfiles.length) return 0;

  const archiveBatch = writeBatch(database);
  for (const { uid } of activeProfiles) {
    archiveBatch.update(doc(profilesCollection(), uid), { active: false });
    archiveBatch.delete(doc(typingStatesCollection(), uid));
  }
  await archiveBatch.commit();
  return activeProfiles.length;
}
