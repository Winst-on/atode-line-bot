# Atode LINE Bot

気になるものをLINEに送るだけで、AIが自動分類してベストなタイミングでリマインドしてくれるBotです。

## 技術スタック

| 役割 | 採用技術 | 理由 |
|------|---------|------|
| Webhookサーバー | **Railway (Node.js)** | Procfile1行でデプロイ完了。常時稼働で無料枠あり |
| データベース | **Supabase (PostgreSQL)** | 無料・セットアップ5分・後の本開発でそのまま使える |
| スケジューラー | **node-cron（同プロセス）** | 追加インフラ不要。毎時実行で1日3件上限制御 |
| AI分類 | **Claude Haiku (claude-haiku-4-5-20251001)** | 1件あたり約0.05〜0.1円。6カテゴリ分類 |

## セットアップ（5ステップ）

### Step 1: リポジトリをクローンして依存関係をインストール

```bash
git clone <this-repo>
cd line-bot
npm install
```

### Step 2: 環境変数を設定

```bash
cp .env.example .env
```

`.env` を開いて以下を入力（取得方法は `DEPLOY.md` 参照）:

```
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

### Step 3: Supabaseにテーブルを作成

Supabase Dashboard → SQL Editor で `schema.sql` の内容を貼り付けて実行。

### Step 4: ローカルで動作確認

```bash
npm run dev
```

別ターミナルでngrokを起動:

```bash
ngrok http 3000
```

表示された `https://xxxx.ngrok.io/webhook` をLINE DevelopersのWebhook URLに設定。

### Step 5: Railwayにデプロイ（本番）

```bash
# Railway CLIでデプロイ
npm install -g @railway/cli
railway login
railway init
railway up
```

RailwayのダッシュボードでEnvironment Variablesを設定し、生成されたURLをLINE Webhookに設定。

→ **完了！LINEでBotにメッセージを送ると動きます**

## 使い方

| 送信内容 | 動作 |
|---------|------|
| テキスト・URL | AIがカテゴリ分類してメモ保存 |
| `一覧` | 保存したメモ一覧を表示 |
| `help` | 使い方を表示 |

## カテゴリとリマインドタイミング

| カテゴリ | 例 | リマインド |
|---------|-----|-----------|
| 🛍️ 買い物 | 「SONYのヘッドホン欲しい」 | 3日後・2週間後・1ヶ月後（夜20時） |
| 🎭 イベント | 「国立新美術館のマティス展」 | 1週間後・3週間後（朝9時） |
| 🍽️ 飲食店 | 「渋谷の○○ラーメン」 | 次の金曜日・2週間後の金曜（昼12時） |
| 📚 本・コンテンツ | 「思考の整理学読みたい」 | 1週間後・1ヶ月後（夜20時） |
| ✈️ 旅行 | 「しまなみ海道行きたい」 | 1ヶ月後・3ヶ月後（朝9時） |
| 💡 メモ | アイデア・その他 | 1週間後・1ヶ月後（夜20時） |

## ディレクトリ構成

```
line-bot/
├── src/
│   ├── server.ts          # Expressサーバー + LINE Webhookハンドラ
│   ├── classifier.ts      # Claude Haiku APIによる分類ロジック
│   ├── database.ts        # Supabase操作（CRUD）
│   ├── line-client.ts     # LINE Messaging API送信ラッパー
│   ├── reminder-scheduler.ts  # リマインド日時計算・メッセージ生成
│   ├── scheduler.ts       # node-cronでの定期実行
│   └── types.ts           # TypeScript型定義
├── schema.sql             # Supabaseテーブル定義
├── package.json
├── tsconfig.json
├── railway.json           # Railwayデプロイ設定
├── Procfile               # プロセス定義
├── .env.example
├── README.md
└── DEPLOY.md              # 詳細デプロイ手順
```

## コスト概算

| 項目 | 月額 |
|------|------|
| Railway（無料枠） | $0〜$5 |
| Supabase（無料枠） | $0 |
| Claude Haiku（100件/月） | 約$0.01 |
| LINE Messaging API（200通まで） | 無料 |
| **合計** | **ほぼ$0** |
