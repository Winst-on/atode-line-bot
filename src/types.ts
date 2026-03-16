// カテゴリ定義
export type Category =
  | "shopping"    // 買い物・グッズ
  | "event"       // 映画・展覧会・イベント
  | "restaurant"  // レストラン・カフェ
  | "book"        // 本・動画・コンテンツ
  | "travel"      // 旅行・お出かけ
  | "memo";       // アイデア・その他メモ

// リマインド戦略
export type RemindStrategy =
  | "cooling_period"  // 3日後（買い物の衝動買い防止）
  | "before_deadline" // 期限前（イベント）
  | "weekend"         // 週末（飲食店）
  | "periodic"        // 定期（本・コンテンツ）
  | "long_holiday"    // 長期休暇前（旅行）
  | "weekly";         // 週次（メモ）

// Claude APIのレスポンス型
export interface ClassificationResult {
  category: Category;
  sub_category: string;
  summary: string;
  remind_strategy: RemindStrategy;
  confidence: number; // 0.0 ~ 1.0
}

// Supabase テーブル型
export interface Profile {
  id: string;
  line_user_id: string;
  created_at: string;
}

export interface Memo {
  id: string;
  user_id: string;
  raw_input: string;
  input_type: "text" | "url";
  ai_category: Category;
  ai_sub_category: string;
  ai_summary: string;
  ai_remind_strategy: RemindStrategy;
  source: "line";
  is_archived: boolean;
  created_at: string;
}

export interface Reminder {
  id: string;
  memo_id: string;
  scheduled_at: string;
  channel: "line";
  sent_at: string | null;
  feedback: string | null;
  created_at: string;
  // JOIN結果
  memos?: Memo;
}

// リマインドメッセージ用の拡張型
export interface ReminderWithMemo extends Reminder {
  memos: Memo & {
    profiles: Profile;
  };
}
