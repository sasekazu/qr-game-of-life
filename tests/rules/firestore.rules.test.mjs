// Security Rules tests, run against the Firestore emulator (needs Java 11+):
//   cd tests/rules && npm install && npm test
// `npm test` starts the emulator with ../../firestore.rules (see ../../firebase.json) and runs this file inside it.
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, getDocs, serverTimestamp, Timestamp } from "firebase/firestore";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-qrlife",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const ALICE = "alice", BOB = "bob";
const asAlice = () => env.authenticatedContext(ALICE).firestore();
const asBob = () => env.authenticatedContext(BOB).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const ref = (db, uid = ALICE, cls = "small") => doc(db, "rankings", cls, "scores", uid);
const entry = (over = {}) => ({ name: "Alice", score: 100, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });

// Alice already has a score of 100 (written with the rules disabled)
const seed = (score = 100) => env.withSecurityRulesDisabled(async ctx => {
  await setDoc(ref(ctx.firestore()), { name: "Alice", score, createdAt: Timestamp.fromMillis(1_000_000), updatedAt: Timestamp.fromMillis(1_000_000) });
});
// an improvement as ranking.js writes it: same createdAt, new updatedAt
const improve = (score, over = {}) => ({ name: "Alice", score, createdAt: Timestamp.fromMillis(1_000_000), updatedAt: serverTimestamp(), ...over });

// ---- the four cases asked for ----
test("cannot change someone else's score", async () => {
  await seed(100);
  await assertFails(setDoc(ref(asBob()), improve(9000, { name: "Bob" })));      // Bob writing Alice's document
  await assertFails(setDoc(ref(anon()), improve(9000)));                        // signed out
});

test("cannot delete someone else's score", async () => {
  await seed();
  await assertFails(deleteDoc(ref(asBob())));
  await assertFails(deleteDoc(ref(anon())));
  await assertFails(deleteDoc(ref(asAlice())));                                 // not even the owner
});

test("cannot register a score over 10,000", async () => {
  await assertFails(setDoc(ref(asAlice()), entry({ score: 10001 })));
  await assertFails(setDoc(ref(asAlice()), entry({ score: 99999999 })));
  await assertSucceeds(setDoc(ref(asAlice()), entry({ score: 10000 })));        // the limit itself is fine
});

test("cannot register a score when signed out", async () => {
  await assertFails(setDoc(ref(anon()), entry()));
  await assertFails(setDoc(ref(anon(), "anonymous"), entry()));
});

// ---- more shape / ownership checks ----
test("a signed-in player can register once under their own uid", async () => {
  await assertSucceeds(setDoc(ref(asAlice()), entry()));
  await assertSucceeds(setDoc(ref(asAlice(), ALICE, "large"), entry()));
});
test("cannot register under another uid or an unknown board class", async () => {
  await assertFails(setDoc(ref(asAlice(), BOB), entry()));
  await assertFails(setDoc(ref(asAlice(), ALICE, "medium"), entry()));
});
test("score must be a non-negative integer", async () => {
  for (const score of [-1, 1.5, "100", null, NaN])
    await assertFails(setDoc(ref(asAlice()), entry({ score })));
  await assertSucceeds(setDoc(ref(asAlice()), entry({ score: 0 })));
});
test("name must be a string of 1-32 characters", async () => {
  for (const name of ["", 123, null, "x".repeat(33)])
    await assertFails(setDoc(ref(asAlice()), entry({ name })));
  await assertSucceeds(setDoc(ref(asAlice()), entry({ name: "x".repeat(32) })));
});
test("no extra fields and no missing fields", async () => {
  await assertFails(setDoc(ref(asAlice()), entry({ admin: true })));
  const { name, score, updatedAt } = entry();
  await assertFails(setDoc(ref(asAlice()), { name, score, updatedAt }));        // no createdAt
});
test("dates must be the server time, not a client value", async () => {
  await assertFails(setDoc(ref(asAlice()), entry({ createdAt: new Date("2000-01-01") })));
  await assertFails(setDoc(ref(asAlice()), entry({ updatedAt: new Date("2000-01-01") })));
});

// ---- personal best ----
test("the owner can only raise their score", async () => {
  await seed(100);
  await assertFails(setDoc(ref(asAlice()), improve(99)));
  await assertFails(setDoc(ref(asAlice()), improve(100)));
  await assertSucceeds(setDoc(ref(asAlice()), improve(101)));
});
test("an update cannot change createdAt", async () => {
  await seed(100);
  await assertFails(setDoc(ref(asAlice()), improve(200, { createdAt: serverTimestamp() })));
  await assertFails(setDoc(ref(asAlice()), improve(200, { createdAt: Timestamp.fromMillis(5) })));
  await assertSucceeds(setDoc(ref(asAlice()), improve(200)));
});
test("an update is still range-checked", async () => {
  await seed(100);
  await assertFails(setDoc(ref(asAlice()), improve(10001)));
});

// ---- reading ----
test("anyone can read the top 10, but a query needs a limit of at most 50", async () => {
  await seed();
  const col = collection(anon(), "rankings", "small", "scores");
  await assertSucceeds(getDocs(query(col, orderBy("score", "desc"), limit(10))));
  await assertFails(getDocs(query(col, orderBy("score", "desc"))));              // no limit
  await assertFails(getDocs(query(col, orderBy("score", "desc"), limit(51))));
  await assertSucceeds(getDoc(ref(anon())));
});
test("nothing outside rankings is readable or writable", async () => {
  await assertFails(getDoc(doc(asAlice(), "other", "x")));
  await assertFails(setDoc(doc(asAlice(), "other", "x"), { a: 1 }));
});
