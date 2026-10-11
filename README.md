# QR Game of Life

*A QR Game of Life Challenge*

Type some text and its QR code plays Conway's Game of Life.
文字を入力すると、そのQRコードがライフゲームになります。

**▶ Play: https://sasekazu.github.io/qr-game-of-life/**

**⚔ Battle (2 players, side by side): https://sasekazu.github.io/qr-game-of-life/battle.html**

Both pages have a Solo / Battle switch under the title to move between the modes.

- Type up to 106 bytes, then press ↵ Enter or ▶.
- Famous patterns (glider, pulsar, …) are detected and given a rarity rank of ★1–★5.
- Every new pattern scores points by its rank (1 / 3 / 9 / 27 / 81). A game lasts 1000 generations, or ends earlier once the board only repeats itself.
- The result screen has a "Share on X" button and a copy button. The post holds only the score, board size, best pattern, #QRGameOfLife and the top-page URL: never the text you typed (the same text always gives the same score), nor the QR code.
- Optional online ranking (Firebase Firestore, anonymous sign-in): see [RANKING.md](RANKING.md). It stays hidden until `firebase-config.js` is filled in.
- No build: `index.html` is one file (Three.js is loaded from a CDN); `battle.html` uses `engine.js` (the same QR, pattern and scoring rules).
