/**
 * リマインダースケジューラー
 *
 * このスクリプトはcronで毎時実行する（例: 0 * * * * node dist/scheduler.js）
 * または node-cronを使ってserver.tsと同プロセスで動かす
 */

import "dotenv/config";
import cron from "node-cron";
import {
  getPendingReminders,
  markReminderSent,
  getTodayReminderCount,
} from "./database";
import { sendReminderWithActions } from "./line-client";
import { buildReminderMessage } from "./reminder-scheduler";
import { Category } from "./types";

const DAILY_LIMIT = 3; // 1ユーザーあたり1日のリマインド上限

async function processReminders(): Promise<void> {
  console.log(`[scheduler] Starting reminder processing at ${new Date().toISOString()}`);

  // 現在時刻が8:00〜21:00の間のみ実行（静寂時間チェック）
  const hour = new Date().getHours();
  if (hour < 8 || hour >= 21) {
    console.log(`[scheduler] Quiet hours (${hour}:xx), skipping`);
    return;
  }

  let processed = 0;
  let skipped = 0;

  try {
    const pendingReminders = await getPendingReminders();
    console.log(`[scheduler] Found ${pendingReminders.length} pending reminders`);

    for (const reminder of pendingReminders) {
      const memo = reminder.memos;
      if (!memo || !memo.profiles) {
        console.warn(`[scheduler] Reminder ${reminder.id} has no memo/profile data`);
        continue;
      }

      const lineUserId = memo.profiles.line_user_id;
      const userId = memo.user_id;

      // 1日の上限チェック
      const todayCount = await getTodayReminderCount(userId);
      if (todayCount >= DAILY_LIMIT) {
        console.log(`[scheduler] User ${userId} has reached daily limit (${todayCount}/${DAILY_LIMIT}), skipping`);
        skipped++;
        continue;
      }

      // アーカイブ済みのメモはスキップ
      if (memo.is_archived) {
        await markReminderSent(reminder.id); // 送信済みとしてマーク（再処理を防ぐ）
        continue;
      }

      // リマインドメッセージを生成して送信
      try {
        // 何回目のリマインドかを計算（sent_atがある同一メモのリマインド数+1）
        const reminderCount = 1; // シンプル化: MVPでは常に1回目として扱う

        const message = buildReminderMessage(
          memo.ai_category as Category,
          memo.ai_summary,
          memo.raw_input,
          reminderCount
        );

        await sendReminderWithActions(lineUserId, message, memo.id, reminder.id);
        await markReminderSent(reminder.id);

        console.log(`[scheduler] Sent reminder ${reminder.id} to user ${lineUserId}`);
        processed++;
      } catch (sendError) {
        console.error(`[scheduler] Failed to send reminder ${reminder.id}:`, sendError);
      }
    }
  } catch (error) {
    console.error("[scheduler] Error processing reminders:", error);
  }

  console.log(`[scheduler] Done. Processed: ${processed}, Skipped: ${skipped}`);
}

// 毎時00分に実行
cron.schedule("0 * * * *", processReminders, {
  timezone: "Asia/Tokyo",
});

console.log("[scheduler] Cron scheduler started. Running every hour at :00");

// 起動時に一度実行（デバッグ用）
if (process.env.RUN_ONCE === "true") {
  processReminders().then(() => {
    console.log("[scheduler] One-time run complete");
    process.exit(0);
  });
}
