// Firebase web app config. These values are NOT secrets (they ship to every browser); what protects the data is
// firestore.rules plus the API-key restrictions described in RANKING.md.
// Paste the values from: Firebase console > Project settings > Your apps > SDK setup and configuration (Config).
export const firebaseConfig = {
  apiKey: "AIzaSyDpQbx0kU0bWXd5cZS3ah1eEeplBW83xYw",
  authDomain: "qrlife-game-ranking.firebaseapp.com",
  projectId: "qrlife-game-ranking",
  appId: "1:557974802603:web:aaeb5a97210ebcf1bde7ee",
};

// While the placeholders are still here, the game hides the ranking UI and never touches the network.
export const rankingEnabled = !Object.values(firebaseConfig).some(v => /^YOUR_/.test(v));
