// Firebase web app config. These values are NOT secrets (they ship to every browser); what protects the data is
// firestore.rules plus the API-key restrictions described in RANKING.md.
// Paste the values from: Firebase console > Project settings > Your apps > SDK setup and configuration (Config).
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID",
};

// While the placeholders are still here, the game hides the ranking UI and never touches the network.
export const rankingEnabled = !Object.values(firebaseConfig).some(v => /^YOUR_/.test(v));
