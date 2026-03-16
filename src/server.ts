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

    if (text === "一覧" || text === "リスト" || text === "list") {
      await handleListCommand(userId);
      return;
    }

    if (text === "help" || text === "ヘルプ") {
      await handleHelpCommand(userId);
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
    reminderDates[0] // 最初のリマインド日時を表示
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
    }
  } catch (error) {
    console.error(`[server] Postback error:`, error);
  }
}

async function handleImageSave(userId: string, messageId: string): Promise<void> {
  await sendText(userId, "🖼️ 画像を解析中...");

  const profile = await getOrCreateProfile(userId);
  const imageBuffer = await downloadImage(messageId);

  // Supabase Storageにアップロード
  const filename = `${profile.id}/${Date.now()}.jpg`;
  const imageUrl = await uploadImage(imageBuffer, filename);

  const classification = await classifyImage(imageBuffer);
  const memo = await saveMemo(profile.id, "[画像メモ]", "text", classification, imageUrl);
  const reminderDates = calcReminderDates(classification.category, classification.remind_strategy);
  for (const date of reminderDates) {
    await scheduleReminder(memo.id, date);
  }

  await sendMemoSaved(userId, classification.category, classification.summary || "画像メモ", reminderDates[0]);
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
