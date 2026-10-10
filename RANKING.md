# オンラインランキングのセットアップ

`index.html` のゲームは Firebase（匿名認証 + Cloud Firestore）でオンランキングを持てます。
`firebase-config.js` がプレースホルダのままなら、ランキングのUIは一切表示されず、通信もしません（ゲームは今まで通り動きます）。

## 仕組み

- ゲーム終了時に名前を入力して「登録」を押すと、`rankings/{small|large}/scores/{uid}` に `{ name, score, createdAt }` を保存します。
- ドキュメントIDが匿名認証の uid なので、**1ユーザー・1盤面につき1件**（自己ベストだけ）です。クライアントは既存の記録より高いときだけ書き込み、Rules 側でも「新スコア > 旧スコア」を強制します。
- 盤面（small / large）ごとに別のランキングです。上位10件を表示します。
- Firebase SDK（CDN）は終了時かランキングを開いたときに遅延ロードします。読み込み失敗・オフライン・無料枠超過のいずれでもゲームは止まらず、メッセージが出るだけです。

## 公開前にやること

1. **Web アプリの設定値を貼る**
   Firebase コンソール > プロジェクトの設定 > 全般 > マイアプリ（`</>` ウェブアプリを追加）> SDK の設定と構成 > 「構成」。
   出てきた `apiKey` / `authDomain` / `projectId` / `appId` を [firebase-config.js](firebase-config.js) に貼ります。この値は秘密情報ではありません（ブラウザに配信されます）。守るのは Rules と下の API キー制限です。

2. **Security Rules を反映する**（どちらか）
   - コンソール: Firestore Database > ルール に [firestore.rules](firestore.rules) の中身を貼って「公開」。
   - CLI: `npm i -g firebase-tools` → `firebase login` → `firebase use <プロジェクトID>` → `firebase deploy --only firestore:rules`
   - 「ルールのプレイグラウンド」で次を確かめておくと安心です（パスは `/rankings/small/scores/<uid>`）。
     - 他人の uid のドキュメントへの create / update が拒否される
     - `score` が 10001 や小数・文字列だと拒否される
     - 既存より低い `score` への update が拒否される
     - delete が拒否される

3. **承認済みドメインを確認する**
   Authentication > 設定 > 承認済みドメインに `sasekazu.github.io` があることを確認（`localhost` は最初から入っています）。

4. **匿名認証と Firestore が有効か確認する**
   Authentication > Sign-in method で「匿名」が有効、Firestore Database が作成済み（本番モード）であること。

5. **API キーを制限する**（推奨）
   [Google Cloud コンソール](https://console.cloud.google.com/apis/credentials) > 該当プロジェクトの「Browser key」
   - アプリケーションの制限: HTTP リファラー → `https://sasekazu.github.io/*`（ローカル確認用に `http://localhost:*/*` も）
   - API の制限: Identity Toolkit API と Cloud Firestore API（Token Service API が必要になる場合もあります）
   App Check は現段階では入れていません。

## ローカルでの動作確認

main に公開しなくても、ブランチ上でローカルサーバーを立てれば確認できます（Firebase は `localhost` を最初から許可しています）。

```bash
python -m http.server 8123
```

`http://localhost:8123/index.html` を開き、1ゲーム最後まで遊んで名前を登録 →
Firebase コンソール > Firestore に `rankings/small/scores/<uid>` ができていれば成功です。

## 無料枠（Spark）について

1日あたり読み取り 5万 / 書き込み 2万 が目安です。ランキング表示は1回10読み取りで、同じ盤面は30秒キャッシュします。
超過すると Firestore がエラーを返すだけで、ゲーム自体は動きます。

## 限界（把握しておくこと）

- スコアはブラウザ側で計算されるため、**開発者ツールから範囲内（0〜10000）の好きな値を送ることは防げません**。Rules が防ぐのは「他人の記録の改ざん・削除」「形式や範囲の不正」「日時の偽装」「スコアを下げる更新」です。厳密に防ぐにはサーバー側での検証（Cloud Functions など、Blaze プランが必要）が要ります。
- 匿名ユーザーは、ブラウザのサイトデータを消す・別の端末や別ブラウザを使うと別人になります（自己ベストも別枠になります）。
- 同点の順位は Firestore の並び（ドキュメントID順）で、先着順ではありません。
- 名前はそのまま公開されます。表示は `textContent` なので HTML としては解釈されません。
