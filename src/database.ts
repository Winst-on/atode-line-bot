import { createClient } from "@supabase/supabase-js";
import { Category, ClassificationResult, Memo, Profile, ReminderWithMemo } from "./types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

// ===== Profile（ユーザー）操作 =====

export async function getOrCreateProfile(lineUserId: string): Promise<Profile> {
  // 既存ユーザーを検索
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("line_user_id", lineUserId)
    .single();

  if (existing) return existing as Profile;

  // 新規ユーザー作成
  const { data, error } = await supabase
    .from("profiles")
    .insert({ line_user_id: lineUserId })
    .select()
    .single();

  if (error) throw new Error(`Failed to create profile: ${error.message}`);
  return data as Profile;
}

// ===== Memo操作 =====

export async function uploadImage(buffer: Buffer, filename: string, contentType = "image/jpeg"): Promise<string | null> {
  const { error } = await supabase.storage
    .from("memo-images")
    .upload(filename, buffer, { contentType, upsert: false });
  if (error) {
    console.error("[database] Image upload failed:", error.message);
    return null;
  }
  const { data } = supabase.storage.from("memo-images").getPublicUrl(filename);
  return data.publicUrl;
}

export async function saveMemo(
  userId: string,
  rawInput: string,
  inputType: "text" | "url",
  classification: ClassificationResult,
  imageUrl?: string | null
): Promise<Memo> {
  const { data, error } = await supabase
    .from("memos")
    .insert({
      user_id: userId,
      raw_input: rawInput,
      input_type: inputType,
      ai_category: classification.category,
      ai_sub_category: classification.sub_category,
      ai_summary: classification.summary,
      ai_remind_strategy: classification.remind_strategy,
      source: "line",
      is_archived: false,
      image_url: imageUrl ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save memo: ${error.message}`);
  return data as Memo;
}

export async function getMemosByUser(userId: string): Promise<Memo[]> {
  const { data, error } = await supabase
    .from("memos")
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to get memos: ${error.message}`);
  return (data || []) as Memo[];
}

export async function archiveMemo(memoId: string): Promise<void> {
  const { error } = await supabase
    .from("memos")
    .update({ is_archived: true })
    .eq("id", memoId);

  if (error) throw new Error(`Failed to archive memo: ${error.message}`);
}

export async function updateMemoCategory(memoId: string, category: string): Promise<void> {
  const { error } = await supabase
    .from("memos")
    .update({ ai_category: category })
    .eq("id", memoId);

  if (error) throw new Error(`Failed to update memo category: ${error.message}`);
}

export async function renameMemo(memoId: string, newSummary: string): Promise<void> {
  const { error } = await supabase
    .from("memos")
    .update({ ai_summary: newSummary })
    .eq("id", memoId);

  if (error) throw new Error(`Failed to rename memo: ${error.message}`);
}

export async function setPendingRename(profileId: string, memoId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ pending_rename_memo_id: memoId })
    .eq("id", profileId);

  if (error) throw new Error(`Failed to set pending rename: ${error.message}`);
}

export async function clearPendingRename(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ pending_rename_memo_id: null })
    .eq("id", profileId);

  if (error) throw new Error(`Failed to clear pending rename: ${error.message}`);
}

export async function setPendingFeedback(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ pending_feedback: true })
    .eq("id", profileId);

  if (error) throw new Error(`Failed to set pending feedback: ${error.message}`);
}

export async function clearPendingFeedback(profileId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ pending_feedback: false })
    .eq("id", profileId);

  if (error) throw new Error(`Failed to clear pending feedback: ${error.message}`);
}

export async function saveFeedbackMessage(profileId: string, message: string): Promise<void> {
  const { error } = await supabase
    .from("feedback")
    .insert({ profile_id: profileId, message });

  if (error) throw new Error(`Failed to save feedback: ${error.message}`);
}

// ===== Reminder操作 =====

export async function scheduleReminderAt(memoId: string, scheduledAt: Date): Promise<void> {
  const { error } = await supabase
    .from("reminders")
    .insert({
      memo_id: memoId,
      scheduled_at: scheduledAt.toISOString(),
      channel: "line",
      sent_at: null,
    });
  if (error) throw new Error(`Failed to schedule reminder: ${error.message}`);
}

export async function scheduleReminder(memoId: string, scheduledAt: Date): Promise<void> {
  const { error } = await supabase
    .from("reminders")
    .insert({
      memo_id: memoId,
      scheduled_at: scheduledAt.toISOString(),
      channel: "line",
      sent_at: null,
    });

  if (error) throw new Error(`Failed to schedule reminder: ${error.message}`);
}

// 未送信で送信時刻を過ぎたリマインダーを取得
export async function getPendingReminders(): Promise<ReminderWithMemo[]> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("reminders")
    .select(`
      *,
      memos (
        *,
        profiles (*)
      )
    `)
    .is("sent_at", null)
    .lte("scheduled_at", now)
    .limit(50); // 1回の処理上限

  if (error) throw new Error(`Failed to get pending reminders: ${error.message}`);
  return (data || []) as ReminderWithMemo[];
}

export async function markReminderSent(reminderId: string): Promise<void> {
  const { error } = await supabase
    .from("reminders")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", reminderId);

  if (error) throw new Error(`Failed to mark reminder sent: ${error.message}`);
}

export async function saveFeedback(reminderId: string, feedback: string): Promise<void> {
  const { error } = await supabase
    .from("reminders")
    .update({ feedback })
    .eq("id", reminderId);

  if (error) throw new Error(`Failed to save feedback: ${error.message}`);
}

// 今日のユーザー別送信済みリマインド数を取得（1日3件上限チェック用）
export async function getTodayReminderCount(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { count, error } = await supabase
    .from("reminders")
    .select("*, memos!inner(user_id)", { count: "exact", head: true })
    .eq("memos.user_id", userId)
    .not("sent_at", "is", null)
    .gte("sent_at", today.toISOString())
    .lt("sent_at", tomorrow.toISOString());

  if (error) return 0;
  return count || 0;
}

export { supabase };
