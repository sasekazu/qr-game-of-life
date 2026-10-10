// Online ranking on Cloud Firestore. Loaded lazily by index.html, so a failure here (CDN blocked, offline, quota used up)
// can never stop the game: every function rejects with a plain Error and the caller shows a message.
//
// Data: rankings/{small|large}/scores/{uid} = { name, score, createdAt }. The document id is the player's anonymous uid,
// so each player has exactly one entry per board class (their best), and firestore.rules lets only that uid write it.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const TOP_N = 10;
export const NAME_MAX = 16;                 // characters (code points); firestore.rules allows up to 32 UTF-16 units
const CLASSES = ["small", "large"];
const TIMEOUT_MS = 8000;
const CACHE_MS = 30000;                     // Spark plan: 50k reads/day, so do not re-read the board on every open

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Firestore writes wait forever while offline, so every network step races a timeout.
const withTimeout = (promise, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(what + " timed out")), TIMEOUT_MS)),
]);

let signingIn = null;
function ensureUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  signingIn ??= withTimeout(signInAnonymously(auth), "sign-in")
    .then(cred => cred.user)
    .finally(() => { signingIn = null; });
  return signingIn;
}

const checkClass = cls => { if (!CLASSES.includes(cls)) throw new Error("unknown board class"); };

// Trim, drop control characters, collapse whitespace, cut to NAME_MAX characters. "" means "not a usable name".
export function cleanName(raw) {
  const s = String(raw ?? "").replace(/[\p{C}\p{Z}]+/gu, " ").trim();
  return Array.from(s).slice(0, NAME_MAX).join("").trim();
}

// Saves `score` as this player's entry unless they already have an equal or better one online.
// Resolves { saved: true, best } or { saved: false, best } (best = the score now stored online).
export async function submitScore(cls, rawName, score) {
  checkClass(cls);
  const name = cleanName(rawName);
  if (!name) throw new Error("name required");
  if (!Number.isInteger(score) || score < 0) throw new Error("bad score");
  const user = await ensureUser();
  const ref = doc(db, "rankings", cls, "scores", user.uid);
  const prev = await withTimeout(getDoc(ref), "read");
  const prevScore = prev.exists() ? prev.data().score : -1;
  if (score <= prevScore) return { saved: false, best: prevScore };
  await withTimeout(setDoc(ref, { name, score, createdAt: serverTimestamp() }), "write");
  cache.delete(cls);
  return { saved: true, best: score };
}

const cache = new Map();                    // cls -> { at, data }
// Top TOP_N of a class: { rows: [{ name, score, createdAt: Date|null, mine }] }. Works without a successful sign-in
// (reading is public); `mine` then simply stays false.
export async function fetchTop(cls, { force = false } = {}) {
  checkClass(cls);
  const hit = cache.get(cls);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const user = await ensureUser().catch(() => null);
  const snap = await withTimeout(
    getDocs(query(collection(db, "rankings", cls, "scores"), orderBy("score", "desc"), limit(TOP_N))), "read");
  const rows = snap.docs.map(d => {
    const v = d.data();
    return {
      name: typeof v.name === "string" ? v.name : "?",
      score: Number.isFinite(v.score) ? v.score : 0,
      createdAt: v.createdAt?.toDate?.() ?? null,
      mine: !!user && d.id === user.uid,
    };
  });
  const data = { rows };
  cache.set(cls, { at: Date.now(), data });
  return data;
}
