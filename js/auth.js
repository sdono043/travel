import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig, FUNCTIONS_REGION } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

// Google OAuth scopes needed to read booking confirmations. Only the connected
// owner account needs these; other family members can just sign in normally.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

async function isAllowedFamilyMember(email) {
  if (!email) return false;
  const snap = await getDoc(doc(db, "familyMembers", email.toLowerCase()));
  return snap.exists();
}

export async function signUpWithEmail(email, password) {
  if (!(await isAllowedFamilyMember(email))) {
    throw new Error("This email isn't on the family allowlist yet. Ask the site owner to add it first.");
  }
  await createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithEmail(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  await enforceAllowlistOrSignOut();
}

export async function signInWithGoogle({ requestGmailAndCalendar = false } = {}) {
  const provider = new GoogleAuthProvider();
  if (requestGmailAndCalendar) {
    GOOGLE_SCOPES.forEach((scope) => provider.addScope(scope));
    provider.setCustomParameters({ prompt: "consent", access_type: "offline" });
  }
  const result = await signInWithPopup(auth, provider);
  await enforceAllowlistOrSignOut();

  if (requestGmailAndCalendar) {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    // Short-lived OAuth access token used client-side to call Gmail/Calendar APIs.
    // Not persisted anywhere durable; the user re-grants it each session via
    // "Connect Google" on the trip page before syncing.
    sessionStorage.setItem("googleAccessToken", credential.accessToken);
  }
  return result;
}

async function enforceAllowlistOrSignOut() {
  const email = auth.currentUser?.email;
  if (!(await isAllowedFamilyMember(email))) {
    await firebaseSignOut(auth);
    throw new Error("This account isn't on the family allowlist.");
  }
}

export function signOut() {
  sessionStorage.removeItem("googleAccessToken");
  return firebaseSignOut(auth);
}

export function getGoogleAccessToken() {
  return sessionStorage.getItem("googleAccessToken");
}

// Call on dashboard.html / trip.html to redirect unauthenticated visitors back to login.
export function requireAuth(onReady) {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    onReady(user);
  });
}
