import { Client, FlexMessage, TextMessage, QuickReply } from "@line/bot-sdk";
import { Readable } from "stream";
import { Category, Memo } from "./types";

export const lineClient = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

const LINE_PUSH_RETRY_DELAYS_MS = [500, 1500, 3000];

/** メイン画面に常時表示するクイックリプライ */
export const MAIN_QUICK_REPLY: QuickReply = {
  items: [
    {
      type: "action",
      action: { type: "message", label: "📋 一覧", text: "一覧" },
    },
    {
      type: "action",
      action: { type: "message", label: "📖 ヘルプ", text: "help" },
    },
    {
      type: "action",
      action: { type: "message", label: "💬 感想を送る", text: "感想" },
    },
  ],
};

async function pushMessageWithRetry(
  userId: string,
  message: TextMessage | FlexMessage
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= LINE_PUSH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await lineClient.pushMessage(userId, message);
      return;
    } catch (error) {
      lastError = error;

      if (attempt === LINE_PUSH_RETRY_DELAYS_MS.length) {
        break;
      }

      const delayMs = LINE_PUSH_RETRY_DELAYS_MS[attempt];
      console.warn(
        `[line-client] pushMessage retry ${attempt + 1}/${LINE_PUSH_RETRY_DELAYS_MS.length} after error:`,
        error
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

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
export async function sendText(
  userId: string,
  text: string,
  withMenu = true
): Promise<void> {
  const message: TextMessage = { type: "text", text };
  if (withMenu) message.quickReply = MAIN_QUICK_REPLY;
  await pushMessageWithRetry(userId, message);
}

/**
 * メモ保存完了メッセージ（Flex Message）を送信
 */
export async function sendCategoryMenu(userId: string, memoId: string): Promise<void> {
  const categories: { category: Category; label: string }[] = [
    { category: "restaurant", label: "🍽️ 飲食店" },
    { category: "shopping", label: "🛍️ 買い物" },
    { category: "travel", label: "✈️ 旅行" },
    { category: "event", label: "🎭 イベント" },
    { category: "book", label: "📚 本・コンテンツ" },
    { category: "tool", label: "🛠️ ツール" },
    { category: "memo", label: "💡 メモ" },
  ];

  const message: TextMessage = {
    type: "text",
    text: "カテゴリを選んでください：",
    quickReply: {
      items: categories.map(({ category, label }) => ({
        type: "action",
        action: {
          type: "postback",
          label,
          data: `action=setCategory&memoId=${memoId}&category=${category}`,
          displayText: `${label}に変更`,
        },
      })),
    },
  };

  await pushMessageWithRetry(userId, message);
}

export async function sendMemoSaved(
  userId: string,
  category: Category,
  summary: string,
  remindDate: Date,
  memoId: string,
  imageUrl?: string | null,
  rawInput?: string
): Promise<void> {
  const categoryLabels: Record<Category, string> = {
    shopping: "🛍️ 買い物",
    event: "🎭 イベント",
    restaurant: "🍽️ 飲食店",
    book: "📚 本・コンテンツ",
    travel: "✈️ 旅行",
    tool: "🛠️ ツール",
    memo: "💡 メモ",
  };

  const label = categoryLabels[category];
  const remindStr = formatDate(remindDate);
  const isUrl = rawInput && /^https?:\/\//i.test(rawInput);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bubble: any = {
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
            { type: "text", text: "カテゴリ", size: "xs", color: "#888888", flex: 2 },
            { type: "text", text: label, size: "xs", flex: 3 },
          ],
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "リマインド", size: "xs", color: "#888888", flex: 2 },
            { type: "text", text: remindStr, size: "xs", flex: 3 },
          ],
        },
        ...(isUrl ? [{
          type: "button",
          action: { type: "uri", label: "🔗 URLを開く", uri: rawInput },
          style: "link",
          height: "sm",
          margin: "sm",
        }] : []),
      ],
    },
  };

  if (imageUrl) {
    bubble.hero = {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    };
  }

  const message: FlexMessage = {
    type: "flex",
    altText: `「${summary}」を保存しました`,
    contents: bubble,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "✏️ タイトル編集",
            data: `action=edit&memoId=${memoId}`,
            displayText: "タイトルを編集します",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "📂 カテゴリ変更",
            data: `action=changeCategoryMenu&memoId=${memoId}`,
            displayText: "カテゴリを変更します",
          },
        },
        ...MAIN_QUICK_REPLY.items,
      ],
    },
  };

  await pushMessageWithRetry(userId, message);
}

/**
 * メモ一覧をリスト形式のFlex Bubbleで送信
 * 1枚のバブルに全情報（サムネイル・URL・編集削除ボタン）を縦に並べる
 * 10件ごとにページ分割
 */
export async function sendMemoList(userId: string, memos: Memo[]): Promise<void> {
  if (memos.length === 0) {
    await sendText(userId, "📋 保存されているメモはありません。\n\nテキストやURLを送ってメモを追加してみてください！");
    return;
  }

  await sendText(userId, "📋 メモ一覧です。\n各メモの「✏️ 編集」でタイトル変更、「🗑️ 削除」で削除できます。", false);

  const categoryEmoji: Record<Category, string> = {
    shopping: "🛍️",
    event: "🎭",
    restaurant: "🍽️",
    book: "📚",
    travel: "✈️",
    tool: "🛠️",
    memo: "💡",
  };

  const PAGE_SIZE = 10;

  for (let pageStart = 0; pageStart < memos.length; pageStart += PAGE_SIZE) {
    const pageMemos = memos.slice(pageStart, pageStart + PAGE_SIZE);
    const pageEnd = pageStart + pageMemos.length;
    const headerText = memos.length <= PAGE_SIZE
      ? `全${memos.length}件`
      : `${pageStart + 1}〜${pageEnd}件目 / 全${memos.length}件`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [];

    pageMemos.forEach((memo, i) => {
      const isUrl = /^https?:\/\//i.test(memo.raw_input);
      const emoji = categoryEmoji[memo.ai_category as Category] || "📌";
      const summary = memo.ai_summary || memo.raw_input.substring(0, 25);

      // サムネイル or カテゴリ絵文字
      const iconContent = memo.image_url
        ? {
            type: "image",
            url: memo.image_url,
            size: "xs",
            aspectRatio: "1:1",
            aspectMode: "cover",
            flex: 0,
          }
        : {
            type: "text",
            text: emoji,
            size: "xl",
            flex: 0,
            align: "center",
          };

      const rowContents: object[] = [
        // タイトル行（サムネイル + テキスト）
        {
          type: "box",
          layout: "horizontal",
          spacing: "md",
          alignItems: "center",
          contents: [
            iconContent,
            {
              type: "box",
              layout: "vertical",
              flex: 1,
              contents: [
                {
                  type: "text",
                  text: summary,
                  size: "sm",
                  weight: "bold",
                  wrap: true,
                },
                {
                  type: "text",
                  text: `${emoji} ${formatDate(new Date(memo.created_at))}`,
                  size: "xxs",
                  color: "#888888",
                  margin: "xs",
                },
              ],
            },
          ],
        },
        // URLボタン（URLメモの場合）
        ...(isUrl ? [{
          type: "button",
          action: { type: "uri", label: "🔗 URLを開く", uri: memo.raw_input },
          style: "link",
          height: "sm",
          margin: "xs",
        }] : []),
        // 編集・削除ボタン
        {
          type: "box",
          layout: "horizontal",
          margin: "xs",
          contents: [
            {
              type: "button",
              action: {
                type: "postback",
                label: "✏️ 編集",
                data: `action=edit&memoId=${memo.id}`,
                displayText: "タイトルを編集します",
              },
              style: "link",
              height: "sm",
              flex: 1,
            },
            {
              type: "button",
              action: {
                type: "postback",
                label: "🗑️ 削除",
                data: `action=delete&memoId=${memo.id}`,
                displayText: "メモを削除しました",
              },
              style: "link",
              height: "sm",
              flex: 1,
              color: "#FF5551",
            },
          ],
        },
      ];

      rows.push({
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: rowContents,
      });

      // 区切り線（最後の行以外）
      if (i < pageMemos.length - 1) {
        rows.push({ type: "separator" });
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bubble: any = {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        backgroundColor: "#F8F8F8",
        contents: [
          {
            type: "text",
            text: `📋 メモ一覧  ${headerText}`,
            size: "xs",
            color: "#888888",
            weight: "bold",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "0px",
        contents: rows,
      },
    };

    await pushMessageWithRetry(userId, {
      type: "flex",
      altText: `📋 メモ一覧（${headerText}）`,
      contents: bubble,
    } as FlexMessage);
  }
}

/**
 * リマインドメッセージ（削除・スヌーズボタン付き）を送信
 */
export async function sendReminderWithActions(
  userId: string,
  messageText: string,
  memoId: string,
  reminderId: string,
  imageUrl?: string | null,
  rawInput?: string
): Promise<void> {
  const isUrl = rawInput && /^https?:\/\//i.test(rawInput);
  const hasImage = Boolean(imageUrl);

  const bodyContents: object[] = [
    {
      type: "text",
      text: messageText,
      wrap: true,
      size: "sm",
    },
  ];

  if (hasImage) {
    bodyContents.push({
      type: "text",
      text: "添付: 保存した画像を再表示しています",
      size: "xs",
      color: "#888888",
      wrap: true,
      margin: "md",
    });
  }

  if (isUrl) {
    bodyContents.push({
      type: "text",
      text: `元URL\n${truncateText(rawInput, 120)}`,
      size: "xs",
      color: "#888888",
      wrap: true,
      margin: "md",
    });
    bodyContents.push({
      type: "button",
      action: {
        type: "uri",
        label: "🔗 元のURLを開く",
        uri: rawInput,
      },
      style: "link",
      height: "sm",
      margin: "sm",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bubble: any = {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: bodyContents,
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
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
        {
          type: "button",
          action: {
            type: "postback",
            label: "✏️ タイトルを編集",
            data: `action=edit&memoId=${memoId}`,
            displayText: "タイトルを編集します",
          },
          style: "link",
          height: "sm",
        },
      ],
    },
  };

  if (imageUrl) {
    bubble.hero = {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
    };
  }

  const message: FlexMessage = {
    type: "flex",
    altText: messageText,
    contents: bubble,
  };

  await pushMessageWithRetry(userId, message);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
