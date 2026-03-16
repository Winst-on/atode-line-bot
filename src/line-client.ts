import { Client, FlexMessage, TextMessage } from "@line/bot-sdk";
import { Readable } from "stream";
import { Category, Memo } from "./types";

export const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

/**
 * LINEから画像をダウンロードしてBufferで返す
 */
export async function downloadImage(messageId: string): Promise<Buffer> {
  const stream = await lineClient.getMessageContent(messageId) as unknown as Readable;
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * テキストメッセージを送信
 */
export async function sendText(userId: string, text: string): Promise<void> {
  await lineClient.pushMessage(userId, {
    type: "text",
    text,
  });
}

/**
 * メモ保存完了メッセージ（Flex Message）を送信
 */
export async function sendMemoSaved(
  userId: string,
  category: Category,
  summary: string,
  remindDate: Date
): Promise<void> {
  const categoryLabels: Record<Category, string> = {
    shopping: "🛍️ 買い物",
    event: "🎭 イベント",
    restaurant: "🍽️ 飲食店",
    book: "📚 本・コンテンツ",
    travel: "✈️ 旅行",
    memo: "💡 メモ",
  };

  const label = categoryLabels[category];
  const remindStr = formatDate(remindDate);

  const message: FlexMessage = {
    type: "flex",
    altText: `「${summary}」を保存しました`,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4CAF50",
        paddingAll: "12px",
        contents: [
          {
            type: "text",
            text: "✅ メモを保存しました",
            color: "#FFFFFF",
            size: "sm",
            weight: "bold",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: summary || "（メモ）",
            size: "md",
            weight: "bold",
            wrap: true,
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "カテゴリ",
                size: "xs",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: label,
                size: "xs",
                flex: 3,
              },
            ],
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: "リマインド",
                size: "xs",
                color: "#888888",
                flex: 2,
              },
              {
                type: "text",
                text: remindStr,
                size: "xs",
                flex: 3,
              },
            ],
          },
        ],
      },
    },
  };

  await lineClient.pushMessage(userId, message);
}

/**
 * メモ一覧をFlexで送信（最大5件）
 */
export async function sendMemoList(userId: string, memos: Memo[]): Promise<void> {
  if (memos.length === 0) {
    await sendText(userId, "📋 保存されているメモはありません。\n\nテキストやURLを送ってメモを追加してみてください！");
    return;
  }

  const categoryEmoji: Record<Category, string> = {
    shopping: "🛍️",
    event: "🎭",
    restaurant: "🍽️",
    book: "📚",
    travel: "✈️",
    memo: "💡",
  };

  const displayMemos = memos.slice(0, 5);
  const bubbles = displayMemos.map((memo) => ({
    type: "bubble" as const,
    size: "micro" as const,
    body: {
      type: "box" as const,
      layout: "vertical" as const,
      spacing: "sm" as const,
      contents: [
        {
          type: "text" as const,
          text: `${categoryEmoji[memo.ai_category as Category] || "📌"} ${memo.ai_summary || memo.raw_input.substring(0, 20)}`,
          size: "sm" as const,
          weight: "bold" as const,
          wrap: true,
        },
        {
          type: "text" as const,
          text: formatDate(new Date(memo.created_at)),
          size: "xxs" as const,
          color: "#888888",
        },
      ],
    },
  }));

  const flexMessage: FlexMessage = {
    type: "flex",
    altText: `メモ一覧（${memos.length}件）`,
    contents: {
      type: "carousel",
      contents: bubbles,
    },
  };

  await lineClient.pushMessage(userId, flexMessage);

  if (memos.length > 5) {
    await sendText(userId, `他に ${memos.length - 5} 件のメモがあります。`);
  }
}

/**
 * リマインドメッセージ（削除・スヌーズボタン付き）を送信
 */
export async function sendReminderWithActions(
  userId: string,
  messageText: string,
  memoId: string,
  reminderId: string
): Promise<void> {
  const message: FlexMessage = {
    type: "flex",
    altText: messageText,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: messageText,
            wrap: true,
            size: "sm",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "🗑️ 削除",
              data: `action=delete&memoId=${memoId}&reminderId=${reminderId}`,
              displayText: "このメモを削除しました",
            },
            style: "secondary",
            height: "sm",
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "🔁 1週間後にまた",
              data: `action=snooze&memoId=${memoId}`,
              displayText: "1週間後にもう一度リマインドします",
            },
            style: "primary",
            height: "sm",
            color: "#4CAF50",
          },
        ],
      },
    },
  };

  await lineClient.pushMessage(userId, message);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}
