# QR Life

Type some text and its QR code plays Conway's Game of Life.
文字を入力すると、そのQRコードがライフゲームになります。

**▶ Play: https://sasekazu.github.io/qrlife/**

- Type up to 14 bytes (small board) or 106 bytes (large board), then press ↵ Enter or ▶.
- Famous patterns (glider, pulsar, …) are detected and given a rarity rank of ★1–★5.
- Every new pattern scores points by its rank (1 / 3 / 9 / 27 / 81). A game lasts up to 1000 generations, or until the board settles into a cycle.
- One file, no build: `index.html` (Three.js is loaded from a CDN).
