# cloud-mail 本番デプロイ手順（iPhone Safari から・MUSELORA 用）

状態：**手順書のみ。まだデプロイしていません。** 次のどの操作も、あなたの承認で、1つずつ実行します。`mail.muselora.jp`（管理画面）を作るのが目的で、`muselora.jp`（既存サイト）は変更しません。

## 0. 前提の確認

| 項目 | 種類 | 状態（あなたの報告） | 備考 |
|---|---|---|---|
| `JWT_SECRET` | GitHub **Secret** | 登録済み | **32文字以上**。値は GitHub 上で後から読めません（§3 の管理者登録で必要。保存していなければ §3-0） |
| `CLOUDFLARE_API_TOKEN` | GitHub **Secret** | 登録済み | 権限は下の表 |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | 登録済み | |
| `CUSTOM_DOMAIN` | Variable | 登録済み | **`mail.muselora.jp`**（`muselora.jp` と `www` はワークフローが拒否） |
| `DOMAIN` | Variable | 登録済み | メールのドメインの JSON 配列、例 `["muselora.jp"]` |
| `ADMIN` | Variable | 登録済み | 管理者のメールアドレス（例 `contact@muselora.jp`）。**受信できるアドレス**にする |
| `KV_NAMESPACE_ID` | Variable | 登録済み | ワークフローが、**アカウント内に実在するか**を確認する（無ければ失敗） |
| `D1_DATABASE_NAME` / `D1_DATABASE_ID` | Variable | 未設定でよい | 既定は `muselora-mail`（Cloudflare に存在、テーブル0件、確認済み）を名前で再利用 |
| `R2_BUCKET_NAME` | Variable | 未設定でよい | 未設定なら、添付は KV に保存（大きい添付・多数の受信には不向き） |

**API トークンに必要な権限**（Cloudflare → My Profile → API Tokens でトークンを開いて確認。**トークンの値は表示・共有しない**）：

| 権限 | 理由 |
|---|---|
| Account → Workers Scripts：**Edit** | Worker のデプロイ・Cron（毎時 `0 * * * *`）・Secret |
| Account → Workers KV Storage：**Read**（以上） | `wrangler kv namespace list` で `KV_NAMESPACE_ID` の実在を確認 |
| Account → D1：**Read**（以上） | `wrangler d1 list` で `muselora-mail` を検索 |
| Zone（`muselora.jp`）→ **Workers Routes：Edit** | カスタムドメイン `mail.muselora.jp` の追加（Cloudflare の文書：Custom Domain の追加・変更は、そのゾーンの Workers Routes Write が必要） |
| 新規 Worker の作成 | `cloud-mail` はまだ存在しない。新規作成には、Workers の「Admin」相当の権限が要る（文書の表） |

**DNS の編集権限は付けない方針**です。カスタムドメインの DNS レコードは、Cloudflare が自動で作ります。権限が足りなければ、デプロイが失敗するだけで、既存のものは変わりません。

アカウントの状態（読み取りで確認済み、2026-11-15）：Worker `cloud-mail` は**未作成**。D1 `muselora-mail` は存在（空）。Cron は他の Worker で2個使用中（無料プランの上限5個。このデプロイで3個目）。`mail.muselora.jp` のカスタムドメインは未作成。**KV・DNS・R2・Email Routing・Pages は、トークンの権限で読めず、未確認**です。

## 1. PR #2 をマージする（あなたの承認）

PR #2 は Draft のままで、`main` が `de05033`、PR の先端が `04985fa` で変わっていません（確認済み）。デプロイするワークフローは `main` から実行するため、**マージが先**です。
1. iPhone Safari で <https://github.com/noriyuki1113/cloud-mail/pull/2> を開く。
2. 内容（Files changed）を確認し、**Ready for review** → **Merge pull request**（Create a merge commit）→ Confirm。

## 2. 手動デプロイ（iPhone Safari）

1. `github.com/noriyuki1113/cloud-mail` → **Actions** → 左の一覧の「**🚀 Deploy cloud-mail to Cloudflare Workers (manual)**」→ **Run workflow**（画面右。狭い画面では、アドレスバー左の「ぁあ」→「デスクトップ用 Web サイトを表示」にすると押しやすい）。
2. 入力：**Branch: main**／`confirm` に **`deploy-production`**（この文字列でないと、ジョブは実行されない）／`create_missing_resources` は **オフのまま**（KV・D1 を新規作成しない）。**Run workflow** を押す。
3. 実行の詳細を開き、各ステップを見る。**次の順に、緑になる**はず：
   `Build front end (no credentials)` → `Set up environment` → `Set up KV database` → `Set up D1 database` → `Prepare secrets file` → `Start deployment` → `Initialize database` → `Remove secrets file`。
4. 失敗したときの読み方：

| 表示 | 原因と対応 |
|---|---|
| `CUSTOM_DOMAIN must be a sub-domain…` / `must not be the apex or www` | Variable の値の誤り。`mail.muselora.jp` に直す |
| `KV_NAMESPACE_ID does not match any KV namespace` | ID の誤り、またはトークンに KV の Read がない |
| `D1 database 'muselora-mail' was not found` | `D1_DATABASE_NAME` の誤り、またはトークンに D1 の Read がない |
| `JWT_SECRET must be at least 32 characters` | Secret が短い。長い値に更新（§3-0） |
| `A request to the Cloudflare API … failed` / `No access` | トークンの権限不足（上の表）。**Workers Routes Edit** が無い場合など |
| カスタムドメインの作成で「already in use / exists」 | `mail` の DNS レコードがすでにある。Cloudflare の DNS 画面で `mail` を確認して、不要なら削除（要承認）。**自動では上書きしない** |
| `Initialize database` が `HTTP 401` | Secret の `JWT_SECRET` と、デプロイされた Secret binding が一致しない。再実行 |
| `Initialize database` が、繰り返し 000・404・5xx | DNS・証明書の反映待ち。数分おいて再実行（最大6回は自動で再試行） |

5. **成功後に起きること**（影響）：Worker `cloud-mail` の作成、`mail.muselora.jp` の DNS レコードと証明書の自動作成（`muselora.jp` 本体と MX は**変更されない**）、Cron（毎時）の登録、D1 `muselora-mail` にテーブル作成（初期化 API）、新規 DB なので**公開の新規登録は閉**。
6. デプロイの直後に、**§3 の管理者登録を行う**（それまで、管理者のアドレスは誰も取得できないが、早く確定する）。

## 3. 初回管理者登録（安全な方法）

**管理者アドレス（`ADMIN`）は、公開の登録画面では作れません**（登録が開いていても。OAuth でも）。作成には、デプロイの秘密鍵（`JWT_SECRET`）を `Authorization: Bearer` に付けた、**1回限りの**登録リクエストが必要です（ブラウザの登録画面からは作れません）。

**3-0. `JWT_SECRET` の値**：GitHub は値を後から見せません。パスワードマネージャー等に**保存していない場合**は、新しい32文字以上の値（記号は `"` と `\` を避ける）を作って GitHub の Secret を更新し（Settings → Secrets and variables → Actions → `JWT_SECRET` → Update）、**§2 を再実行**してください（Secret binding が上書きされ、既存のログインは無効になる。まだ誰もログインしていないので影響なし）。

**3-A. PC がある場合（推奨）** — `doc/predeploy-security.md` の手順（`read -rs` で鍵とパスワードを入力→標準入力から curl へ。コマンドラインに値が出ない）。

**3-B. iPhone だけの場合（ショートカット App。動作は、私は実機で確認していません）**
1. ショートカット App → 新規ショートカット。次の順にアクションを追加：
   - 「入力を要求」（テキスト）：メッセージ `JWT_SECRET` → 結果に名前 `secret`。
   - 「入力を要求」（テキスト）：メッセージ `管理者のパスワード（12文字以上）` → 名前 `pw`。
   - 「URL の内容を取得」：URL `https://mail.muselora.jp/api/register`、方法 **POST**、ヘッダ：`Authorization` ＝ `Bearer ` ＋ `secret`、`Content-Type` ＝ `application/json`、本文の種類 **JSON**：`email` ＝ `ADMIN` と同じアドレス、`password` ＝ `pw`。
   - 「結果を表示」。
2. **値はショートカットの中に保存しない**（毎回「入力を要求」で入れる）。実行後、ショートカットは**削除**する。入力は画面に見えるので、周りに人がいない場所で行う。
3. 結果が `{"code":200,…}` なら成功。`unauthorized`（403）なら鍵の不一致、`isRegAccount` なら登録済み。
4. 登録後、<https://mail.muselora.jp/> でログインして確認。パスワードは長いものにする（アプリ側は6文字以上のみ）。

**登録後の確認**：新規登録は閉のまま（設定画面で、必要になるまで開かない）。`https://mail.muselora.jp/api/init` を Safari で開いても（GET）、成功しない（404）。

## 4. メールの受信（Email Routing）— **DNS・MX の変更。事前の説明と承認が必要**

`contact@muselora.jp` で受信するには、Cloudflare の Email Routing を `muselora.jp` に設定します。**Email Routing の有効化は、`muselora.jp` の DNS に、次のレコードを追加します**（Cloudflare の文書）：

| 追加されるもの | 内容 |
|---|---|
| MX ×3（`muselora.jp`） | `route1/2/3.mx.cloudflare.net`（Cloudflare の受信サーバー） |
| TXT（SPF） | `v=spf1 include:_spf.mx.cloudflare.net ~all`（**SPF がすでにあれば自動では書かれず、手動で統合が必要**） |
| TXT（DKIM） | `cf2024-1._domainkey.muselora.jp` |

**影響と注意**
- **公開 DNS への問い合わせ（2026-11-15）で確認：`muselora.jp` に MX も SPF の TXT もない**（既存のメールサービスはない）。したがって、有効化しても、**既存のメールへの影響はありません**。`mail.muselora.jp` の A／AAAA／CNAME も**存在しない**（`cloud-mail` のカスタムドメインと競合しない）。`cf2024-1._domainkey`・`_dmarc` もなく、Email Routing は未有効です。Email Routing の既存ルールは、権限の都合で読めていません（有効でないため、無いはずです）。
- すでに別の MX（Google Workspace など）がある場合は、Email Routing と同時には使えません（現在は該当なし）。
- 有効化の直後は、**ルールのないアドレス宛のメールは「Address does not exist」で拒否**され、送信者に再試行されません。**ルールを先に作ってから**（または直後に）有効化します。
- ルール：Email Routing → Routing rules → **Catch-all**（または `contact@muselora.jp` のアドレス）→ Action **Send to a Worker** → `cloud-mail` → Save。
- cloud-mail は、**アカウントのあるアドレス宛だけ**を受け付ける（初期値：宛先なしは拒否）。`ADMIN` のアドレスのアカウントが、§3 で作られていること。
- 受信テスト：別のメール（Gmail など）から `contact@muselora.jp` に送り、`https://mail.muselora.jp/` の受信箱に届くことを確認。**これが確認できるまで、`data/site/operator.json` には、この連絡先を入れない**（art-atlas-japan 側の方針）。
- 添付は、R2 未設定のため KV に保存される（小さい添付のみ想定）。送信（返信）には、別途 Resend 等の設定が必要で、**受信だけなら不要**。

### 4-2. `contact@muselora.jp` の受信箱を作る（`ADMIN` が `admin@muselora.jp` の場合。公開登録は開かない）

cloud-mail は、**アカウント（受信箱）のあるアドレス宛のメールだけ**を保存します（初期値：宛先なしは拒否）。`contact@muselora.jp` は、**管理者のアカウントに追加する**形で作ります（ソースで確認：`POST /account/add` は、ログイン済みのユーザーが、自分のユーザーに別のアドレスを追加する機能で、**公開の新規登録とは別**。ログインが必要で、アドレスのドメインが `DOMAIN` に含まれることを検査する）。
1. §3 で `admin@muselora.jp` を登録し、`https://mail.muselora.jp/` に**管理者でログイン**する。
2. アカウント（メールアドレス）の追加の画面で、**`contact@muselora.jp`** を追加する（画面の名称は版により異なる）。**公開の新規登録（設定の「登録」）は開かない**（閉のまま）。
   - 追加できないとき（「アカウントの追加が無効」）は、設定画面で「アカウントの追加」と「複数アカウント」が**有効**になっているかを確認（新規データベースの初期値は、どちらも有効）。追加の認証（Turnstile）は、初期値で無効。
3. Email Routing のルール（§4）：**`contact@muselora.jp` → Send to a Worker → `cloud-mail`**。Catch-all は有効にしない（`contact@` だけを受ける）。
4. **受信テスト**：別のメール（Gmail など）から `contact@muselora.jp` に件名つきで送る → 管理者でログインした受信箱の、`contact@muselora.jp` のアカウントに届くことを確認。届かないとき：(a) Email Routing の MX が有効か（DNS 画面）、(b) ルールが Active か、(c) Worker `cloud-mail` が選ばれているか、(d) `contact@muselora.jp` のアカウントが存在するか、(e) 設定で「受信」が閉になっていないか、の順に確認。
5. **これが確認できるまで、MUSELORA の `operator.json` に連絡先を入れない。** 確認できたら、その旨を伝えてください（私が `operator.json` の PR を作ります）。

## 5. ロールバック

| 何を戻すか | 方法 |
|---|---|
| メールの受信を止める | Email Routing の Catch-all／ルールを **Disable**（DNS の MX は残る。残すと、拒否されるメールが出る）。完全に戻すなら、Email Routing を無効化して、追加された MX・TXT を削除（要承認） |
| 管理画面を止める | Cloudflare → Workers & Pages → `cloud-mail` → Settings → **Domains & Routes** で `mail.muselora.jp` を削除。または Worker を削除（Cron も消える）。D1 `muselora-mail` と KV のデータは残る |
| 以前のバージョンに戻す | Workers → `cloud-mail` → Deployments → 前のバージョンを選んで Rollback（初回デプロイの場合は戻す先がない。上の「止める」を使う） |
| 鍵の入れ替え | §3-0 |

## 6. 変更されないもの
`muselora.jp` と `www` の既存サイト、Cloudflare Pages の設定、MUSELORA のコード・データ、他の Worker、他の D1。`mail.muselora.jp` 以外の DNS は、§4 を承認するまで変更されない。

## 7. このセッションでの確認結果（2026-11-15）
- PR #2：Draft、`main`＝`de05033`、先端＝`04985fa`、マージ可否 clean（変更なし）。
- `pnpm run test:unit` 38件合格、`--frozen-lockfile` 可、YAML の構文、`pnpm audit --prod`（hono の指摘なし。残りは PR #2 の本文のとおり）。
- GitHub Secrets・Variables の**値は読んでいません**（名前の登録は、あなたの報告による）。**実際のデプロイは未実施**。
