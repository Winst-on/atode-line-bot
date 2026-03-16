import Anthropic from "@anthropic-ai/sdk";
import { Category, ClassificationResult, RemindStrategy } from "./types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// ドメインベースの高速事前判定（API呼び出しを節約）
const DOMAIN_RULES: Record<string, { category: Category; strategy: RemindStrategy }> = {
  "amazon.co.jp": { category: "shopping", strategy: "cooling_period" },
  "amazon.com": { category: "shopping", strategy: "cooling_period" },
  "rakuten.co.jp": { category: "shopping", strategy: "cooling_period" },
  "mercari.com": { category: "shopping", strategy: "cooling_period" },
  "yahoo.co.jp/shopping": { category: "shopping", strategy: "cooling_period" },
  "tabelog.com": { category: "restaurant", strategy: "weekend" },
  "retty.me": { category: "restaurant", strategy: "weekend" },
  "hotpepper.jp": { category: "restaurant", strategy: "weekend" },
  "gurunavi.com": { category: "restaurant", strategy: "weekend" },
  "netflix.com": { category: "book", strategy: "periodic" },
  "youtube.com": { category: "book", strategy: "periodic" },
  "spotify.com": { category: "book", strategy: "periodic" },
  "amazon.co.jp/dp": { category: "book", strategy: "periodic" },
  "booklive.jp": { category: "book", strategy: "periodic" },
  "ebookjapan.yahoo.co.jp": { category: "book", strategy: "periodic" },
  "booking.com": { category: "travel", strategy: "long_holiday" },
  "jalan.net": { category: "travel", strategy: "long_holiday" },
  "ikyu.com": { category: "travel", strategy: "long_holiday" },
  "airbnb.com": { category: "travel", strategy: "long_holiday" },
};

function getDomainCategory(url: string): { category: Category; strategy: RemindStrategy } | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");
    const fullPath = hostname + urlObj.pathname;

    for (const [domain, result] of Object.entries(DOMAIN_RULES)) {
      if (fullPath.startsWith(domain) || hostname === domain) {
        return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

const CLASSIFICATION_PROMPT = `あなたはメモ分類AIです。ユーザーが送ったテキストやURLを以下の6カテゴリに分類してください。

【カテゴリ一覧】
- shopping: 商品・グッズ・欲しいもの（Amazonリンク、「欲しい」「気になる商品」等）
- event: 映画・展覧会・ライブ・イベント（期限のあるもの）
- restaurant: レストラン・カフェ・飲食店（食べ物・お店）
- book: 本・漫画・動画・音楽・記事・コンテンツ（読む・観る・聴く系）
- travel: 旅行・観光地・お出かけスポット（行きたい場所）
- memo: 上記に当てはまらないアイデア・メモ・その他

【リマインド戦略】
- cooling_period: 3日後（買い物の衝動買い確認）
- before_deadline: 期限の1週間前・3日前・前日（イベント系）
- weekend: 次の週末（飲食店）
- periodic: 1週間後、その後月1回（コンテンツ系）
- long_holiday: 次の連休前（旅行）
- weekly: 1週間後、その後月1回（メモ）

以下のJSONのみを返してください（説明文不要）:
{
  "category": "カテゴリ名",
  "sub_category": "より詳細な分類（例: 家電, イタリアン, SF映画 等）",
  "summary": "15文字以内の要約",
  "remind_strategy": "リマインド戦略",
  "confidence": 0.0から1.0の数値
}`;

export async function classifyMemo(input: string): Promise<ClassificationResult> {
  // URLの場合はドメイン事前判定
  if (isUrl(input)) {
    const domainResult = getDomainCategory(input);
    if (domainResult) {
      console.log(`[classifier] Domain-based classification: ${domainResult.category}`);
      return {
        category: domainResult.category,
        remind_strategy: domainResult.strategy,
        sub_category: "",
        summary: input.substring(0, 50),
        confidence: 0.95,
      };
    }
  }

  // Claude Haiku APIで分類
  try {
    const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
    const message = await anthropic.messages.create({
      model: model as any,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `${CLASSIFICATION_PROMPT}\n\n【分類対象】\n${input}`,
        },
      ],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";

    // JSON部分を抽出してパース
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const result = JSON.parse(jsonMatch[0]) as ClassificationResult;

    // バリデーション
    const validCategories: Category[] = ["shopping", "event", "restaurant", "book", "travel", "memo"];
    if (!validCategories.includes(result.category)) {
      result.category = "memo";
    }

    console.log(`[classifier] AI classification: ${result.category} (confidence: ${result.confidence})`);
    return result;
  } catch (error) {
    console.error("[classifier] Classification failed, using fallback:", error);
    // フォールバック: memoカテゴリ
    return {
      category: "memo",
      sub_category: "その他",
      summary: input.substring(0, 15),
      remind_strategy: "weekly",
      confidence: 0.0,
    };
  }
}
