# デプロイ手順 - 10分でAtode LINE Botを本番稼働させる

## 前提条件

- Node.js 18以上がインストール済み
- GitHubアカウント
- LINEアカウント（スマホ）

---

## Step 1: LINE Developerアカウントを作成（2分）

1. https://developers.line.biz/ にアクセス
2. LINEアカウントでログイン
3. 「プロバイダー作成」→ 任意の名前で作成
4. 「Messaging APIチャネル作成」→ 以下を入力:
   - チャネル種類: Messaging API
   - チャネル名: Atode（任意）
   - 業種: 個人
5. チャネル作成後、「Messaging API設定」タブを開く
6. **チャンネルシークレット**（Basic設定）と**チャンネルアクセストークン**（長期）をメモ

> ポイント: 「応答メッセージ」と「あいさつメッセージ」はOFFにすること（LINE公式マネージャーで設定）

---

## Step 2: Anthropic APIキーを取得（1分）

1. https://console.anthropic.com/ にアクセス
2. サインアップ（Googleアカウント可）
3. 「API Keys」→「Create Key」→ キーをメモ
4. 無料クレジット($5)が付与されるので課金設定不要

---

## Step 3: Supabaseプロジェクト作成（2分）

1. https://supabase.com/ にアクセス
2. 「Start your project」→ GitHubでサインイン
3. 「New project」→ 以下を入力:
   - Project name: atode-line-bot
   - Database password: 任意（メモしておく）
   - Region: Northeast Asia (Tokyo)
4. プロジェクト作成完了後、「Settings」→「API」を開く
5. **Project URL**と**anon public key**をメモ

### テーブル作成

6. 「SQL Editor」を開く
7. `schema.sql` の内容を全コピーして貼り付け → 「Run」クリック
8. 左のテーブルアイコンで `profiles`, `memos`, `reminders` が作成されたことを確認

---

## Step 4: Railwayにデプロイ（3分）

### 4-1: GitHubにコードをプッシュ

```bash
cd /path/to/line-bot
git init
git add .
git commit -m "initial commit"
# GitHubでリポジトリ作成後:
git remote add origin https://github.com/<your-username>/atode-line-bot.git
git push -u origin main
```

### 4-2: Railwayプロジェクト作成

1. https://railway.app/ にアクセス → GitHubでサインイン
2. 「New Project」→「Deploy from GitHub repo」
3. `atode-line-bot` を選択
4. 自動デプロイが始まる（1〜2分）

### 4-3: 環境変数を設定

Railwayのプロジェクト画面で「Variables」→「Raw Editor」に以下を貼り付け:

```
LINE_CHANNEL_SECRET=ここにStep1で取得した値
LINE_CHANNEL_ACCESS_TOKEN=ここにStep1で取得した値
ANTHROPIC_API_KEY=ここにStep2で取得した値
SUPABASE_URL=ここにStep3で取得した値
SUPABASE_KEY=ここにStep3で取得した値
PORT=3000
NODE_ENV=production
```

「Update Variables」→ 自動再デプロイ

### 4-4: デプロイURLを確認

「Settings」→「Domains」→「Generate Domain」でURLを生成。
例: `https://atode-line-bot-production.up.railway.app`

---

## Step 5: LINE WebhookにURLを設定（1分）

1. LINE Developers → チャネル → 「Messaging API設定」
2. 「Webhook URL」に以下を入力:
   ```
   https://atode-line-bot-production.up.railway.app/webhook
   ```
3. 「検証」ボタンをクリック → 「Success」と表示されればOK
4. 「Webhookの利用」をONに切り替え

---

## 動作確認

1. LINE Developersの「Messaging API設定」→「QRコード」でBotを友達追加
2. 「SONYのヘッドホン WH-1000XM5 欲しい」と送信
3. 「AIが分類中...」→ Flex Messageで「買い物カテゴリ / 3日後にリマインド」が返ってくればOK

---

## トラブルシューティング

### 「Webhook URL検証に失敗」

- RailwayのDeploysタブでビルドエラーがないか確認
- `/health` エンドポイントにアクセスして `{"status":"ok"}` が返るか確認

### 「応答が返ってこない」

Railwayのログを確認:
```
railway logs
```

### 「分類が遅い」

Claude Haikuは通常1秒以内に応答します。5秒以上かかる場合はAPI KEYを確認してください。

### ローカルテスト（ngrok）

```bash
npm install -g ngrok
npm run dev  # 別ターミナルで
ngrok http 3000
# 表示されたhttps URLをLINE Webhook URLに設定
```

---

## 本番運用のTips

### リマインドの確認

Supabaseの「Table Editor」→`reminders`テーブルで送信予定を確認できます。

### ログ監視

```bash
railway logs --tail
```

### スケーリング

- LINE無料プランは月200通プッシュ制限あり
- テストユーザー10〜20人なら問題なし
- 本格運用時はLINE有料プラン（月1.5万円〜）に移行

---

## 所要時間まとめ

| ステップ | 時間 |
|---------|------|
| LINE Developer設定 | 2分 |
| Anthropic APIキー取得 | 1分 |
| Supabaseセットアップ | 2分 |
| Railwayデプロイ | 3分 |
| Webhook設定・確認 | 1分 |
| **合計** | **約9分** |
