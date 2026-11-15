# デプロイ前セキュリティ設定（MUSELORA メール管理画面）

## 秘密情報の扱い
| 名前 | 種別 | 渡し方 |
|---|---|---|
| `JWT_SECRET` | GitHub **Secret** | ワークフローが一時ファイル（権限 600）に JSON で書き、`wrangler deploy --secrets-file` で Cloudflare の **Secret binding `jwt_secret`** として登録。`[vars]` や設定ファイルには入れない。ファイルは成功・失敗・キャンセルのいずれでも削除 |
| `CLOUDFLARE_API_TOKEN` | GitHub **Secret** | Wrangler を使うステップにだけ渡す（依存のインストールや第三者アクションには渡さない） |
| `CUSTOM_DOMAIN`、`DOMAIN`、`ADMIN`、`CLOUDFLARE_ACCOUNT_ID` | GitHub Variables | 公開してよい設定値。`CUSTOM_DOMAIN` は `mail.muselora.jp`（`muselora.jp` と `www` は拒否） |
| `D1_DATABASE_ID`、`KV_NAMESPACE_ID` | GitHub Variables（任意だが**推奨**） | 既存のリソースを ID で指定。未設定で名前の検索にも無い場合は、**作成せずに失敗**（`create_missing_resources` を有効にした場合だけ作成） |

アプリは従来どおり `env.jwt_secret` を参照します（バインディング名は変更なし）。

## 初期化 API
- 旧：`GET /api/init/<秘密鍵>`（秘密鍵が URL とアクセスログに残る）→ **廃止**
- 新：`POST /api/init`、ヘッダー `Authorization: Bearer <JWT_SECRET>`
  - 認証失敗、バインディング未設定：**401** `Unauthorized`（本文に秘密鍵を含めない。ログにも出さない）
  - 成功：200 `success`
- 手元で実行する場合は、秘密鍵をコマンドラインに書かず、標準入力から渡す：
  `printf 'header = "Authorization: Bearer %s"\n' "$JWT_SECRET" | curl -sS -K - -X POST https://mail.muselora.jp/api/init`

## デプロイ（手動のみ）
`main` への push では動きません。Actions → 「Deploy cloud-mail to Cloudflare Workers (manual)」→ Run workflow（ブランチ `main`、確認欄に `deploy-production`）。**このリポジトリの変更PRでは実行しないでください。**

## 初回デプロイ前の確認（Cloudflare ダッシュボード）
1. Workers & Pages：`cloud-mail`（Worker 名は `NAME`、未設定なら `cloud-mail`）が**まだ無い**こと。
2. D1：既存の `muselora-mail`（ID は Cloudflare 画面で確認）を使う。`D1_DATABASE_ID` Variable に ID を登録。新しい DB を作らない。
3. KV：既存の名前空間があるか確認し、あれば ID を `KV_NAMESPACE_ID` Variable に登録。無ければ、作成してよいと判断してから `create_missing_resources` を有効にして実行。
4. R2：使う場合だけ `R2_BUCKET_NAME` を登録（未設定なら R2 の設定は外れる）。
5. DNS：デプロイは `mail.muselora.jp` の Workers カスタムドメイン（DNS レコードと証明書）を**自動で作成**します。同名の既存レコードがあると失敗します。`muselora.jp` の既存サイトと MX は、このワークフローでは変更されません。メール受信に Email Routing を使う場合は MX の変更が別途必要です（要承認）。
6. API トークンの権限：Workers Scripts 編集、D1 編集、Workers KV 編集、対象ゾーンの Workers Routes（カスタムドメイン）。最小限にし、DNS 編集は付けない方針なら、カスタムドメインの作成に必要な権限が足りるか確認（足りなければ失敗するだけで、既存は変更されない）。

## iPhone Safari 確認項目（デプロイ後）
- `https://mail.muselora.jp/` が HTTPS で開き、証明書の警告が出ない。
- ログイン画面のパスワード入力でズームしない（入力欄 16px 以上）。ログイン後、受信一覧・メール表示が横スクロールなしで読める。
- 向きを変えても（縦・横）、レイアウトが崩れない。文字を拡大（200%）しても操作できる。
- `https://mail.muselora.jp/api/init` を Safari のアドレスバーで開く（GET）→ **200 `success` にならない**（404）。URL に秘密鍵を付けて開いても同じ。
- アドレスバーや履歴に、秘密鍵らしい文字列が残っていない。
- VoiceOver：ログインのフォームの各項目が読み上げられ、エラーが伝わる。
- 既存サイト（`https://muselora.jp/`）が従来どおり表示される。

## 秘密鍵を入れ替える（ローテーション）
過去に `GET /api/init/<秘密鍵>` を実際に呼んだことがある場合、その鍵は URL としてログに残っている可能性があります。新しい 32 文字以上の鍵を作って GitHub Secret を更新し、再度デプロイしてください（Secret binding は `--secrets-file` で上書きされます）。JWT を入れ替えると、既存のログイン状態は無効になります。
