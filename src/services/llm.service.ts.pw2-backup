import { getWriterKnowledge } from '../knowledge/writer-knowledge';
import { getEnv } from '../config/env';
import { signServiceToken } from '../lib/jwt';
import { httpPost, httpGet } from '../lib/http';
import { logger } from '../lib/logger';
import { GeneratedPost, BrandProfile } from '../types/writer';
import {
  STYLE_ARMS,
  isStyleArmName,
  buildArmPromptFragment,
  validateAgainstArm,
  buildRetryFragment,
  type StyleArmName,
} from './arm-templates';
// premium-01/module-a: brief enrichment
import { enrichBrief } from './brief-enricher';
import type { EnrichedBrief } from '../types/enriched-brief';
import { getPrisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Brand profile loader
// ─────────────────────────────────────────────────────────────────────────────
export async function loadBrandProfile(tenantId: string): Promise<BrandProfile | null> {
  const env = getEnv();
  const url = `${env.TENANT_BRAIN_URL}/v1/brand/profile/${tenantId}`;
  try {
    const profile = await httpGet<BrandProfile>(url, {
      Authorization: `Bearer ${signServiceToken()}`,
    });
    return profile;
  } catch (err: any) {
    logger.warn({ tenantId, error: err.message }, 'Failed to load brand profile');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt builder
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(profile: BrandProfile | null): string {
  const writerKnowledge = getWriterKnowledge();

  if (!profile) {
    return writerKnowledge
      ? `You are an expert social media copywriter specializing in service businesses.\n\n=== COPYWRITING KNOWLEDGE BASE ===\n${writerKnowledge.slice(0, 4000)}\n=== END KNOWLEDGE ===\n\nWrite engaging posts that drive bookings.`
      : 'You are an expert social media copywriter.\nWrite engaging posts that drive engagement.';
  }

  const parts: string[] = [
    `You are a professional Instagram copywriter for a ${profile.businessType} business.`,
  ];

  if (writerKnowledge) {
    parts.push('\n=== COPYWRITING EXPERTISE (follow these rules and patterns) ===');
    parts.push(writerKnowledge.slice(0, 4000));
    parts.push('=== END EXPERTISE ===\n');
  }

  if (profile.businessName) parts.push(`Business name: "${profile.businessName}"`);
  if (profile.city || profile.country) {
    parts.push(`Location: ${[profile.city, profile.country].filter(Boolean).join(', ')}`);
  }
  if (profile.languages?.length) parts.push(`Languages: ${profile.languages.join(', ')}`);
  if (profile.targetAudience) parts.push(`Target audience: ${profile.targetAudience}`);
  if (profile.positioningStyle) parts.push(`Brand positioning: ${profile.positioningStyle}`);
  if (profile.tagline) parts.push(`Tagline: "${profile.tagline}"`);
  if (profile.uniqueValue) parts.push(`Unique value: ${profile.uniqueValue}`);
  parts.push(`Tone: ${profile.preferredTone || 'professional and warm'}`);

  if (profile.approvedPosts?.length > 0) {
    parts.push('\n--- APPROVED POST EXAMPLES (match this style) ---');
    profile.approvedPosts.slice(0, 3).forEach((post, i) => {
      parts.push(`Example ${i + 1}: ${post.content.slice(0, 200)}...`);
    });
  }

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate params
// ─────────────────────────────────────────────────────────────────────────────
interface GenerateParams {
  tenantId?: string;
  brief: string;
  tone?: string;
  audience?: string;
  platform?: string;
  image_brief?: string;
  styleArm?: string;
  topicArm?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic post-generation enforcement
//
// Some constraints are mechanical (count, presence/absence) and can be enforced
// in code far more reliably than by trusting the LLM. We do that here BEFORE
// the validator runs, so the validator only catches semantic violations.
// ─────────────────────────────────────────────────────────────────────────────
const EMOJI_REGEX_GLOBAL =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/gu;

function enforceArmConstraints(arm: StyleArmName, result: GeneratedPost): void {
  const c = STYLE_ARMS[arm];

  // 1. Truncate hashtags array to max (Sonnet overshoots "5-10" → 15-20)
  if (c.hashtags?.max !== undefined && Array.isArray(result.hashtags)) {
    if (result.hashtags.length > c.hashtags.max) {
      const before = result.hashtags.length;
      result.hashtags = result.hashtags.slice(0, c.hashtags.max);
      logger.info(
        { arm, before, after: result.hashtags.length },
        '[arm-enforcement] hashtags truncated to max',
      );
    }
  }

  // 2. Strip emoji from caption if forbidden
  if (c.emoji === 'forbidden' && result.content) {
    const stripped = result.content.replace(EMOJI_REGEX_GLOBAL, '');
    if (stripped !== result.content) {
      result.content = stripped.replace(/  +/g, ' ').trim();
      logger.info({ arm }, '[arm-enforcement] emoji stripped from caption');
    }
  }

  // 3. Strip inline hashtags from caption if hashtags forbidden (max=0)
  if (c.hashtags?.max === 0 && result.content) {
    const stripped = result.content.replace(/#\w+/g, '').replace(/  +/g, ' ').trim();
    if (stripped !== result.content) {
      result.content = stripped;
      logger.info({ arm }, '[arm-enforcement] inline hashtags stripped from caption');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal prompt body — NO hardcoded counts that conflict with arms
// ─────────────────────────────────────────────────────────────────────────────
function buildUniversalPromptBody(nicheLabel: string, ownerRole: string): string {
  return `=== ПРАВИЛА ТЕКСТА (PREMIUM COPYWRITING) ===

ПЕРВАЯ СТРОКА — это 80% успеха поста. Она должна ОСТАНОВИТЬ скролл.
Техники для первой строки:
- Интрига: "Она пришла с ногтями после другого мастера... и я всё поняла"
- Вопрос-боль: "${nicheLabel} не держится? Знакомо?"
- Провокация: "Хватит переплачивать за ${nicheLabel} который не держится"
- Факт: "3-4 недели без сколов. Не обещание — стандарт"
- Эмоция: "Когда клиент присылает фото через 3 недели"

НЕ ИСПОЛЬЗУЙ банальные первые строки:
- ❌ "Хотите красивый ${nicheLabel}?"
- ❌ "Милые девочки..."
- ❌ "Вам нравится..."

СТРУКТУРА ПОСТА:
1. Hook (первая строка) — останавливает скролл
2. Развитие — боль/решение/история (2-3 предложения)
3. Конкретика — цена/время/результат
4. CTA — чёткий призыв к действию (если style arm не запрещает)

СТИЛЬ:
- Match the language of the brief (Hebrew/Russian/English)
- Короткие абзацы, 1-2 предложения каждый
- Прямота и конкретика, не лей воду
- НИКОГДА не используй слово "ахла"
- Пиши как подруга-профи, не как рекламный буклет

NOTE ON LENGTH/EMOJI/HASHTAGS/CTA:
The STYLE ARM block above (if present) is the AUTHORITATIVE source for these
parameters. If anything in this prompt conflicts with the style arm, the
STYLE ARM WINS — no exceptions.

=== ПРАВИЛА IMAGE_PROMPT (CRITICAL — GEMINI/IMAGEN) ===

image_prompt — это промпт для AI-генерации фотореалистичного изображения.
Промпт ДОЛЖЕН быть детально проработан.

ОБЯЗАТЕЛЬНЫЕ ЭЛЕМЕНТЫ КАЖДОГО ПРОМПТА:
1. "Photorealistic" — ВСЕГДА первое слово
2. АНАТОМИЯ РУК (если в кадре): "exactly ONE left hand and ONE right hand, each with exactly 5 fingers, natural hand anatomy, realistic finger proportions"
3. ЛОГИКА СЦЕНЫ: описывай как реальный фотограф — что где стоит, откуда свет, что видит камера. Кактус рядом с кофе = нелогично. Продумай каждый предмет.
4. "CRITICAL: NO text, NO letters, NO words, NO logos, NO watermarks, NO brand names on the image"
5. КОНКРЕТНЫЕ ЦВЕТА: не "красивый цвет", а "dusty rose", "deep burgundy", "soft lavender"
6. ОСВЕЩЕНИЕ: "soft natural daylight from window" или "warm studio lighting with ring light"
7. КАМЕРА: "Shot on 85mm lens, shallow depth of field" или "overhead flat-lay, even lighting"
8. ФОРМАТ: "square 1080x1080, Instagram-optimized"
9. "Mediterranean warm tone color palette"

РАЗНООБРАЗИЕ СЦЕН (КРИТИЧНО — не повторять одно и то же!):
- Крупный план продукта/результата на фактурной поверхности
- Результат работы в красивом антураже
- Процесс работы (${ownerRole} в работе)
- Рабочее место мастера
- Lifestyle: продукт в естественном окружении
- Детали крупным планом
- Сезонные мотивы

ЗАПРЕЩЕНО В ПРОМПТАХ:
- Несколько пар рук (если не процесс работы мастер+клиент)
- Нелогичные сочетания предметов
- Нереалистичные позы пальцев
- Текст на изображении (ни на каком языке)
- Фон который отвлекает от главного объекта

Return ONLY valid JSON with this structure:
{
  "content": "The post text — STRICTLY following the STYLE ARM constraints",
  "hashtags": ["hashtag1", "hashtag2"],
  "image_prompt": "Photorealistic... [full detailed prompt following ALL rules above]"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// premium-01/module-a: build premium fragment from EnrichedBrief
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build the premium prompt fragment that injects anti-repetition + audience
 * intelligence + winning hooks into the generation prompt.
 *
 * Section ordering matters — Sonnet pays more attention to constraints early
 * in the prompt. We put forbidden things FIRST, then guidance, then examples.
 */
function buildPremiumFragment(enriched: EnrichedBrief): string {
  const sections: string[] = [];

  // ── ANTI-REPETITION (highest priority — what NOT to do) ──────────────────
  if (enriched.antiRep && enriched.antiRep.recentHooks.length > 0) {
    const ar = enriched.antiRep;
    sections.push('=== ANTI-REPETITION (CRITICAL — last posts of THIS account) ===');

    if (ar.forbiddenFirstWords.length > 0) {
      sections.push(
        `FORBIDDEN first words (you used these recently): ${ar.forbiddenFirstWords.join(', ')}`,
      );
      sections.push('Your hook MUST start with a different word.');
    }

    if (ar.overusedTechniques.length > 0) {
      sections.push(
        `OVERUSED hook techniques (do NOT use these again): ${ar.overusedTechniques.join(', ')}`,
      );
      const allTechniques = [
        'pattern_interrupt',
        'specific_number',
        'sensory_detail',
        'contradiction',
        'story',
        'provocation',
        'quote',
        'question',
        'statement',
      ];
      const allowed = allTechniques.filter((t) => !ar.overusedTechniques.includes(t));
      sections.push(`Use one of these instead: ${allowed.join(', ')}`);
    }

    if (ar.recentTopicKeywords.length > 0) {
      sections.push(
        `Recent topic keywords (avoid leaning on these): ${ar.recentTopicKeywords.slice(0, 12).join(', ')}`,
      );
    }

    sections.push('Last 5 hooks (do NOT paraphrase or echo any of them):');
    ar.recentHooks.slice(0, 5).forEach((h, i) => {
      sections.push(`  ${i + 1}. [${h.hookTechnique}] "${h.hookText.slice(0, 100)}"`);
    });
    sections.push('=== END ANTI-REPETITION ===');
    sections.push('');
  }

  // ── AUDIENCE INTELLIGENCE (what works for THIS account's audience) ───────
  if (enriched.audience && !enriched.audience.coldStart) {
    const a = enriched.audience;
    sections.push('=== AUDIENCE INTELLIGENCE (real engagement data) ===');
    sections.push(
      `Posts analyzed: ${a.postsAnalyzed}. Average engagement rate: ${(a.avgEngagementRate * 100).toFixed(2)}%`,
    );

    if (a.preferHints.length > 0) {
      sections.push('PROVEN to work for this audience:');
      a.preferHints.slice(0, 5).forEach((h) => {
        const conf = h.confidence >= 0.7 ? 'HIGH' : h.confidence >= 0.4 ? 'MEDIUM' : 'LOW';
        sections.push(
          `  + ${h.dimension}=${h.bucket} (${conf} confidence, ${h.sampleSize} posts)`,
        );
      });
    }

    if (a.avoidHints.length > 0) {
      sections.push('PROVEN to underperform for this audience:');
      a.avoidHints.slice(0, 5).forEach((h) => {
        const conf = h.confidence >= 0.7 ? 'HIGH' : h.confidence >= 0.4 ? 'MEDIUM' : 'LOW';
        sections.push(
          `  - ${h.dimension}=${h.bucket} (${conf} confidence, ${h.sampleSize} posts)`,
        );
      });
    }

    if (a.winningHooks.length > 0) {
      sections.push('TOP performing hooks from this account (study the technique, NOT the wording):');
      a.winningHooks.slice(0, 3).forEach((h, i) => {
        sections.push(
          `  ${i + 1}. [${h.technique || 'unknown'}, ${(h.engagementRate * 100).toFixed(2)}% er, ${h.impressions} impr]`,
        );
        sections.push(`     "${h.hookText}"`);
      });
    }
    sections.push('=== END AUDIENCE INTELLIGENCE ===');
    sections.push('');
  } else if (enriched.audience?.coldStart) {
    sections.push('// Audience: cold start (insufficient data) — use general best practices');
    sections.push('');
  }

  return sections.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────
export async function generateContent(params: GenerateParams): Promise<GeneratedPost> {
  const env = getEnv();

  let profile: BrandProfile | null = null;
  if (params.tenantId) {
    profile = await loadBrandProfile(params.tenantId);
  }

  const systemPrompt = buildSystemPrompt(profile);
  const armName: StyleArmName | null = isStyleArmName(params.styleArm) ? params.styleArm : null;
  const armFragment = armName ? buildArmPromptFragment(armName) : '';

  const nicheLabel = profile?.businessType || 'specialist';
  const ownerRole = 'мастер';

  const universalBody = buildUniversalPromptBody(nicheLabel, ownerRole);

  // premium-01/module-a: enrich the brief with anti-rep + audience layers
  let premiumFragment = '';
  if (params.tenantId) {
    try {
      const enriched = await enrichBrief({
        tenantId: params.tenantId,
        rawBrief: params.brief,
        styleArm: params.styleArm,
        topicArm: params.topicArm,
        prisma: getPrisma(),
      });
      premiumFragment = buildPremiumFragment(enriched);
    } catch (e: any) {
      logger.warn({ tenantId: params.tenantId, error: e?.message }, '[module-a] enrichment failed (non-blocking)');
    }
  }

  // Section ordering: arm constraints → premium fragment → universal body → brief
  // Premium fragment goes BEFORE universal body so anti-rep takes priority over generic rules
  const prompt = `${systemPrompt}

${armFragment}

${premiumFragment}

${params.tone ? 'Requested tone: ' + params.tone : ''}
${params.audience ? 'Target audience override: ' + params.audience : ''}
${params.platform ? 'Platform: ' + params.platform + ' (adjust style)' : ''}
${params.image_brief ? 'Image context: ' + params.image_brief : ''}

${universalBody}

Write a social media post about: ${params.brief}`;

  const url = `${env.LLM_HUB_URL}/v1/llm/generate`;

  interface LLMResponse {
    output: string;
  }

  // Arm-aware retry loop: 1 attempt without arm, 2 with arm
  const MAX_ATTEMPTS = armName ? 2 : 1;
  let result: GeneratedPost = { content: '', hashtags: [], image_prompt: '' };
  let lastViolations: string[] = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const attemptPrompt =
      attempt > 0 && armName
        ? prompt + '\n\n' + buildRetryFragment(armName, lastViolations)
        : prompt;

    const data = await httpPost<LLMResponse>(
      url,
      {
        intent: 'quality',
        input: {
          messages: [{ role: 'user', content: attemptPrompt }],
          system: systemPrompt,
          max_tokens: 1200,
          temperature: 0.8,
        },
      },
      {
        Authorization: `Bearer ${signServiceToken()}`,
      },
      { timeout: 60000 }
    );

    const output = data.output || '';
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      result = { content: output, hashtags: [], image_prompt: '' };
      break;
    }
    result = JSON.parse(jsonMatch[0]) as GeneratedPost;

    if (!armName) break;

    // Deterministic enforcement first (mechanical fixes), then validate
    enforceArmConstraints(armName, result);

    const validation = validateAgainstArm(armName, result.content || '', result.hashtags);
    if (validation.ok) {
      logger.info(
        { arm: armName, attempt: attempt + 1, len: (result.content || '').length },
        '[arm-validation] passed',
      );
      break;
    }

    lastViolations = validation.violations;
    if (attempt + 1 >= MAX_ATTEMPTS) {
      logger.warn(
        { arm: armName, violations: lastViolations, len: (result.content || '').length },
        '[arm-validation] failed after max attempts, accepting anyway (non-blocking)',
      );
    } else {
      logger.warn(
        { arm: armName, violations: lastViolations },
        '[arm-validation] failed, retrying',
      );
    }
  }

  return result;
}
