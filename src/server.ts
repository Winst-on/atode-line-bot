/**
 * Atode LINE Bot サーバー
 *
 * エンドポイント:
 *   POST /webhook  - LINE Messaging APIのWebhook受信
 *   GET  /health   - ヘルスチェック
 */

import "dotenv/config";
import express from "express";
import { middleware, WebhookEvent, MessageEvent, TextEventMessage, PostbackEvent } from "@line/bot-sdk";
import { classifyMemo, classifyImage } from "./classifier";
import {
  getOrCreateProfile,
  saveMemo,
  getMemosByUser,
  scheduleReminder,
  archiveMemo,
  scheduleReminderAt,
  uploadImage,
  renameMemo,
  setPendingRename,
  clearPendingRename,
} from "./database";
import { sendText, sendMemoSaved, sendMemoList, downloadImage } from "./line-client";
import { calcReminderDates } from "./reminder-scheduler";

// スケジューラーを同プロセスで起動
import "./scheduler";

const app = express();
const PORT = process.env.PORT || 3000;

// LINE Middlewareの設定
const lineMiddleware = middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

// ヘルスチェック
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// LINE Webhook
app.post("/webhook", lineMiddleware, async (req, res) => {
  // LINE SDKにすぐ200を返す（タイムアウト防止）
  res.sendStatus(200);

  const events: WebhookEvent[] = req.body.events;
  await Promise.all(events.map(handleEvent));
});

async function handleEvent(event: WebhookEvent): Promise<void> {
  if (event.type === "postback") {
    await handlePostback(event as PostbackEvent);
    return;
  }
  if (event.type !== "message") return;
  const userId = event.source.userId!;

  try {
    if (event.message.type === "image") {
      await handleImageSave(userId, event.message.id);
      return;
    }

    if (event.message.type !== "text") {
      await sendText(userId, "テキスト・URL・画像を送ってください。\nコマンド一覧: 「一覧」「help」");
      return;
    }

    const messageEvent = event as MessageEvent;
    const textMessage = messageEvent.message as TextEventMessage;
    const text = textMessage.text.trim();

    // タイトル変更待ち状態のチェック（他のコマンドより先に処理）
    const profile = await getOrCreateProfile(userId);
    if (profile.pending_rename_memo_id) {
      await handleRenameComplete(userId, profile.id, profile.pending_rename_memo_id, text);
      return;
    }

    if (text === "一覧" || text === "リスト" || text === "list") {
      await handleListCommand(userId);
      return;
    }

    if (text === "help" || text === "ヘルプ") {
      await handleHelpCommand(userId);
      return;
    }

    if (text === "テスト" && process.env.TEST_MODE === "true") {
      await handleTestReminder(userId);
      return;
    }

    await handleMemoSave(userId, text);
  } catch (error) {
    console.error(`[server] Error handling event for user ${userId}:`, error);
    await sendText(userId, "エラーが発生しました。しばらくしてからもう一度お試しください。");
  }
}

async function handleMemoSave(userId: string, input: string): Promise<void> {
  // 「AIが分類中...」の応答（体験向上）
  await sendText(userId, "📝 AIが分類中...");

  // ユーザー取得・作成
  const profile = await getOrCreateProfile(userId);

  // URLかテキストかを判定
  const inputType = /^https?:\/\//i.test(input) ? "url" : "text";

  // AI分類
  const classification = await classifyMemo(input);

  // DB保存
  const memo = await saveMemo(profile.id, input, inputType, classification);

  // リマインド日時を計算してスケジュール
  const reminderDates = calcReminderDates(
    classification.category,
    classification.remind_strategy
  );

  for (const date of reminderDates) {
    await scheduleReminder(memo.id, date);
  }

  // 保存完了メッセージを送信
  await sendMemoSaved(
    userId,
    classification.category,
    classification.summary || input.substring(0, 20),
    reminderDates[0],
    null,
    input
  );
}

async function handlePostback(event: PostbackEvent): Promise<void> {
  const userId = event.source.userId!;
  const params = new URLSearchParams(event.postback.data);
  const action = params.get("action");
  const memoId = params.get("memoId");

  if (!memoId) return;

  try {
    if (action === "delete") {
      await archiveMemo(memoId);
      await sendText(userId, "🗑️ メモを削除しました。");
    } else if (action === "snooze") {
      const snoozeDate = new Date();
      snoozeDate.setDate(snoozeDate.getDate() + 7);
      snoozeDate.setHours(20, 0, 0, 0);
      await scheduleReminderAt(memoId, snoozeDate);
      await sendText(userId, "🔁 1週間後にもう一度リマインドします。");
    } else if (action === "edit") {
      const profile = await getOrCreateProfile(userId);
      await setPendingRename(profile.id, memoId);
      await sendText(userId, "✏️ 新しいタイトルを送ってください。\n（キャンセルするには「キャンセル」と送ってください）");
    }
  } catch (error) {
    console.error(`[server] Postback error:`, error);
  }
}

async function handleRenameComplete(
  userId: string,
  profileId: string,
  memoId: string,
  newTitle: string
): Promise<void> {
  await clearPendingRename(profileId);

  if (newTitle === "キャンセル") {
    await sendText(userId, "キャンセルしました。");
    return;
  }

  await renameMemo(memoId, newTitle);
  await sendText(userId, `✅ タイトルを「${newTitle}」に変更しました。`);
}

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_MAGIC: Record<string, Buffer> = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
};

function detectImageFormat(buf: Buffer): string | null {
  for (const [fmt, magic] of Object.entries(ALLOWED_IMAGE_MAGIC)) {
    if (buf.slice(0, magic.length).equals(magic)) return fmt;
  }
  return null;
}

async function handleTestReminder(userId: string): Promise<void> {
  const profile = await getOrCreateProfile(userId);
  const memos = await getMemosByUser(profile.id);
  if (memos.length === 0) {
    await sendText(userId, "⚠️ テスト用のメモがありません。先に何かメモを保存してください。");
    return;
  }
  const latestMemo = memos[0];
  const reminderDate = new Date(Date.now() + 60 * 1000); // 1分後
  await scheduleReminderAt(latestMemo.id, reminderDate);
  await sendText(userId, `🧪 テスト: 「${latestMemo.ai_summary || latestMemo.raw_input.substring(0, 20)}」のリマインドを1分後に設定しました。`);
}

async function handleImageSave(userId: string, messageId: string): Promise<void> {
  await sendText(userId, "🖼️ 画像を解析中...");

  const profile = await getOrCreateProfile(userId);
  const imageBuffer = await downloadImage(messageId);

  // サイズチェック（5MB上限）
  if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
    await sendText(userId, "⚠️ 画像サイズが大きすぎます（上限5MB）。\n小さい画像を送ってください。");
    return;
  }

  // フォーマットチェック（JPEG・PNGのみ）
  const fmt = detectImageFormat(imageBuffer);
  if (!fmt) {
    await sendText(userId, "⚠️ 対応していない画像形式です。\nJPEGまたはPNG形式の画像を送ってください。");
    return;
  }

  const ext = fmt === "png" ? "png" : "jpg";
  const contentType = fmt === "png" ? "image/png" : "image/jpeg";

  // Supabase Storageにアップロード
  const filename = `${profile.id}/${Date.now()}.${ext}`;
  const imageUrl = await uploadImage(imageBuffer, filename, contentType);

  const classification = await classifyImage(imageBuffer);
  const memo = await saveMemo(profile.id, "[画像メモ]", "text", classification, imageUrl);
  const reminderDates = calcReminderDates(classification.category, classification.remind_strategy);
  for (const date of reminderDates) {
    await scheduleReminder(memo.id, date);
  }

  await sendMemoSaved(userId, classification.category, classification.summary || "画像メモ", reminderDates[0], imageUrl);
}

async function handleListCommand(userId: string): Promise<void> {
  const profile = await getOrCreateProfile(userId);
  const memos = await getMemosByUser(profile.id);
  await sendMemoList(userId, memos);
}

async function handleHelpCommand(userId: string): Promise<void> {
  const helpText = `📖 Atode の使い方

【メモの保存】
気になるテキストやURLをそのまま送ってください。
AIが自動で分類し、最適なタイミングでリマインドします。

【カテゴリ】
🛍️ 買い物 → 3日後・2週間後にリマインド
🎭 イベント → 1週間後・3週間後
🍽️ 飲食店 → 次の金曜日・2週間後の金曜
📚 本・コンテンツ → 1週間後・1ヶ月後
✈️ 旅行 → 1ヶ月後・3ヶ月後
💡 メモ → 1週間後・1ヶ月後

【コマンド】
「一覧」 → 保存したメモを表示
「help」 → このヘルプを表示

気になるものをどんどん送ってね！`;

  await sendText(userId, helpText);
}

app.listen(PORT, () => {
  console.log(`[server] Atode LINE Bot started on port ${PORT}`);
  console.log(`[server] Webhook URL: http://localhost:${PORT}/webhook`);
});

export default app;
