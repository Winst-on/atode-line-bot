-- ============================================================
-- Atode LINE Bot - Supabase Schema
-- SupabaseのSQL Editorに貼り付けて実行してください
-- ============================================================

-- ユーザープロフィール
-- NOTE: Supabase Authを使わない（LINE Bot用の軽量版）
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- メモ
CREATE TABLE IF NOT EXISTS memos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  raw_input        TEXT NOT NULL,
  input_type       TEXT NOT NULL CHECK (input_type IN ('text', 'url')),
  ai_category      TEXT NOT NULL,
  ai_sub_category  TEXT DEFAULT '',
  ai_summary       TEXT DEFAULT '',
  ai_remind_strategy TEXT NOT NULL,
  source           TEXT DEFAULT 'line',
  is_archived      BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- リマインダースケジュール
CREATE TABLE IF NOT EXISTS reminders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id      UUID NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  channel      TEXT DEFAULT 'line',
  sent_at      TIMESTAMPTZ,
  feedback     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス（パフォーマンス）
CREATE INDEX IF NOT EXISTS idx_memos_user_id ON memos(user_id);
CREATE INDEX IF NOT EXISTS idx_memos_is_archived ON memos(is_archived);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled_at ON reminders(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reminders_sent_at ON reminders(sent_at);
CREATE INDEX IF NOT EXISTS idx_profiles_line_user_id ON profiles(line_user_id);

-- RLS（Row Level Security）は LINE Bot では不要なため無効化
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE memos DISABLE ROW LEVEL SECURITY;
ALTER TABLE reminders DISABLE ROW LEVEL SECURITY;

-- 動作確認用クエリ
-- SELECT * FROM profiles;
-- SELECT * FROM memos ORDER BY created_at DESC LIMIT 10;
-- SELECT * FROM reminders WHERE sent_at IS NULL ORDER BY scheduled_at;
