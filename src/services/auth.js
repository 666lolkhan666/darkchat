import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { auth } from "../firebase/client.js";
import { isOwnerConfigured, ownerEmail, ownerUid } from "../firebase/config.js";

export async function signInOwner(password) {
  if (!isOwnerConfigured() || !auth) {
    throw new Error("Owner authentication is not configured. Add the Firebase owner email and UID.");
  }

  const credential = await signInWithEmailAndPassword(auth, ownerEmail, password);
  if (credential.user.uid !== ownerUid) {
    await signOut(auth);
    throw new Error("This account is not authorized as the owner.");
  }

  return credential.user;
}

export async function ensureVisitorSession() {
  if (!auth) {
    throw new Error("Visitor sessions are unavailable. Configure Firebase first.");
  }
  if (!auth.currentUser) await signInAnonymously(auth);
  if (auth.currentUser?.uid === ownerUid) {
    throw new Error("Sign out of the owner account before starting a visitor session.");
  }
  return auth.currentUser;
}

export async function signOutOwner() {
  if (!auth) {
    throw new Error("Owner authentication is unavailable. Configure Firebase first.");
  }
  await signOut(auth);
}

export function watchAuthSession(onChange) {
  if (!auth) {
    onChange(null);
    return () => {};
  }

  return onAuthStateChanged(auth, onChange);
}
