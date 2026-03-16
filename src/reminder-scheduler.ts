import { Category, RemindStrategy } from "./types";

/**
 * カテゴリ・戦略に基づいてリマインド日時を計算する
 */
export function calcReminderDates(
  category: Category,
  strategy: RemindStrategy,
  createdAt: Date = new Date()
): Date[] {
  const dates: Date[] = [];

  switch (strategy) {
    case "cooling_period": {
      // 買い物: 3日後、2週間後、1ヶ月後（夜20時）
      dates.push(addDaysAt(createdAt, 3, 20, 0));
      dates.push(addDaysAt(createdAt, 14, 20, 0));
      dates.push(addDaysAt(createdAt, 30, 20, 0));
      break;
    }

    case "before_deadline": {
      // イベント: 保存1週間後に「まだ気になりますか？」（朝9時）
      // ※ 本来は期限から逆算するが、MVPでは保存日基準の固定タイミング
      dates.push(addDaysAt(createdAt, 7, 9, 0));
      dates.push(addDaysAt(createdAt, 21, 9, 0));
      break;
    }

    case "weekend": {
      // 飲食店: 次の金曜日の昼12時、さらに2週間後の金曜日
      const nextFriday = getNextWeekday(createdAt, 5); // 5 = 金曜
      nextFriday.setHours(12, 0, 0, 0);
      dates.push(nextFriday);

      const secondFriday = new Date(nextFriday);
      secondFriday.setDate(secondFriday.getDate() + 14);
      dates.push(secondFriday);
      break;
    }

    case "periodic": {
      // 本・コンテンツ: 1週間後の夜20時、1ヶ月後
      dates.push(addDaysAt(createdAt, 7, 20, 0));
      dates.push(addDaysAt(createdAt, 30, 20, 0));
      break;
    }

    case "long_holiday": {
      // 旅行: 1ヶ月後の朝9時（シンプル化）
      dates.push(addDaysAt(createdAt, 30, 9, 0));
      dates.push(addDaysAt(createdAt, 90, 9, 0));
      break;
    }

    case "weekly":
    default: {
      // メモ・その他: 1週間後の夜20時、1ヶ月後
      dates.push(addDaysAt(createdAt, 7, 20, 0));
      dates.push(addDaysAt(createdAt, 30, 20, 0));
      break;
    }
  }

  return dates;
}

function addDaysAt(base: Date, days: number, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function getNextWeekday(base: Date, weekday: number): Date {
  // weekday: 0=日, 1=月, ..., 5=金, 6=土
  const d = new Date(base);
  const current = d.getDay();
  const diff = (weekday - current + 7) % 7 || 7; // 同日でも次の週
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * カテゴリ別のリマインドメッセージを生成
 */
export function buildReminderMessage(
  category: Category,
  summary: string,
  rawInput: string,
  reminderCount: number // 何回目のリマインドか（1始まり）
): string {
  const displayText = summary || rawInput.substring(0, 30);

  const templates: Record<Category, string[]> = {
    shopping: [
      `🛍️ 「${displayText}」\nまだ気になってますか？\n\n衝動買いを防ぐための3日間が経ちました。\n今でも欲しいなら、それは本当に必要なものかも！`,
      `🛍️ 「${displayText}」\n2週間経ちました。\nまだ欲しいなら買いどきかも？`,
      `🛍️ 「${displayText}」\n1ヶ月経ちましたが、まだ気になりますか？`,
    ],
    event: [
      `🎭 「${displayText}」\n行く予定はありますか？\n\nまだ間に合います。チェックしてみて！`,
      `🎭 「${displayText}」\nそろそろ申し込み・予約の時期かも？`,
    ],
    restaurant: [
      `🍽️ 「${displayText}」\n今週末はここに行ってみませんか？\n\n素敵な週末を！`,
      `🍽️ 「${displayText}」\n2週間前に気になってたお店。\n今週末どうですか？`,
    ],
    book: [
      `📚 「${displayText}」\nまだ読んでいない / 観ていないですか？\n\n今週末のお楽しみに！`,
      `📚 「${displayText}」\n1ヶ月が経ちました。そろそろいかがですか？`,
    ],
    travel: [
      `✈️ 「${displayText}」\n気になっていた旅先。\n次の連休に計画してみませんか？`,
      `✈️ 「${displayText}」\n旅行の計画、立てましたか？`,
    ],
    memo: [
      `💡 「${displayText}」\n1週間前のメモです。\n何か進展しましたか？`,
      `💡 「${displayText}」\n1ヶ月前のアイデア。棚卸しの時間かも？`,
    ],
  };

  const msgs = templates[category];
  const idx = Math.min(reminderCount - 1, msgs.length - 1);
  return msgs[idx] || msgs[0];
}
