import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import * as cheerio from "cheerio";
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
  "github.com": { category: "tool", strategy: "same_day" },
  "producthunt.com": { category: "tool", strategy: "same_day" },
  "notion.so": { category: "tool", strategy: "same_day" },
  "figma.com": { category: "tool", strategy: "same_day" },
  "zapier.com": { category: "tool", strategy: "same_day" },
  "claude.ai": { category: "tool", strategy: "same_day" },
  "chatgpt.com": { category: "tool", strategy: "same_day" },
  "openai.com": { category: "tool", strategy: "same_day" },
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

// スクレイピングをブロックするためスキップするドメインリスト
const SKIP_FETCH_DOMAINS = ["twitter.com", "x.com", "t.co", "instagram.com", "tiktok.com"];

async function fetchUrlMeta(url: string): Promise<{ content: string | null; ogImage: string | null }> {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");
    if (SKIP_FETCH_DOMAINS.some((d) => hostname.includes(d))) return { content: null, ogImage: null };

    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 5,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
      },
    });
    const $ = cheerio.load(res.data as string);
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      "";
    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      "";
    const ogImageRaw =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      null;
    // 相対URLを絶対URLに変換
    let ogImage: string | null = null;
    if (ogImageRaw) {
      ogImage = ogImageRaw.startsWith("http") ? ogImageRaw : new URL(ogImageRaw, url).href;
    }
    const content = [title, description].filter(Boolean).join(" / ").substring(0, 200);
    return { content: content || null, ogImage: ogImage || null };
  } catch (e: any) {
    console.log(`[classifier] fetchUrlMeta failed: ${e?.message || e}`);
    return { content: null, ogImage: null };
  }
}

export async function fetchOgImage(url: string): Promise<string | null> {
  const { ogImage } = await fetchUrlMeta(url);
  console.log(`[classifier] fetchOgImage result: ${ogImage ? ogImage.substring(0, 80) : "null"}`);
  return ogImage;
}

export async function classifyImage(imageBuffer: Buffer): Promise<ClassificationResult> {
  try {
    const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
    const message = await (anthropic.messages.create as any)({
      model,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBuffer.toString("base64"),
              },
            },
            {
              type: "text",
              text: `${CLASSIFICATION_PROMPT}\n\n【分類対象】\n上記の画像の内容をメモとして分類してください。画像に含まれるテキストや情報を読み取って分類してください。`,
            },
          ],
        },
      ],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const result = JSON.parse(jsonMatch[0]) as ClassificationResult;
    const validCategories: Category[] = ["shopping", "event", "restaurant", "book", "travel", "tool", "memo"];
    if (!validCategories.includes(result.category)) result.category = "memo";

    console.log(`[classifier] Image classification: ${result.category}`);
    return result;
  } catch (error) {
    console.error("[classifier] Image classification failed:", error);
    return {
      category: "memo",
      sub_category: "画像メモ",
      summary: "画像メモ",
      remind_strategy: "weekly",
      confidence: 0.0,
    };
  }
}

const CLASSIFICATION_PROMPT = `あなたはメモ分類AIです。ユーザーが送ったテキストやURLを以下の7カテゴリに分類してください。

【カテゴリ一覧】
- shopping: 商品・グッズ・欲しいもの（Amazonリンク、「欲しい」「気になる商品」等）
- event: 映画・展覧会・ライブ・イベント（期限のあるもの）
- restaurant: レストラン・カフェ・飲食店（食べ物・お店）
- book: 本・漫画・動画・音楽・記事・コンテンツ（読む・観る・聴く系）
- travel: 旅行・観光地・お出かけスポット（行きたい場所）
- tool: ツール・サービス・アプリ・AIの使い方・プロダクト（試したい・使いたい系）
- memo: 上記に当てはまらないアイデア・メモ・その他

【重要ルール】
InstagramリールやTikTokなどSNSの投稿URLは「tool」ではなく、投稿内容（飲食店・ショッピング・旅行など）で分類すること。URLのみで内容が判断できない場合は「memo」を使う。

【リマインド戦略】
- cooling_period: 翌日・3日後・2週間後・1ヶ月後（買い物）
- before_deadline: 次の金曜・2週間後の金曜（イベント）
- weekend: 翌日・次の金曜・2週間後の金曜（飲食店）
- periodic: 翌日・3日後・1週間後・1ヶ月後（コンテンツ）
- long_holiday: 1週間後・1ヶ月後・3ヶ月後（旅行）
- same_day: 当日夜・3日後・1週間後・1ヶ月後（ツール・AI系）
- weekly: 翌日・3日後・1週間後・1ヶ月後（メモ）

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

  // URLの場合はページタイトル・説明文を取得してからAIに渡す
  let classifyTarget = input;
  if (isUrl(input)) {
    const { content: urlContent } = await fetchUrlMeta(input);
    if (urlContent) {
      classifyTarget = `${urlContent}\n（URL: ${input}）`;
      console.log(`[classifier] Fetched URL content: ${urlContent.substring(0, 50)}...`);
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
          content: `${CLASSIFICATION_PROMPT}\n\n【分類対象】\n${classifyTarget}`,
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
    const validCategories: Category[] = ["shopping", "event", "restaurant", "book", "travel", "tool", "memo"];
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
