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
import { enrichBrief } from './brief-enricher';
import type { EnrichedBrief } from '../types/enriched-brief';
import { getPrisma } from '../lib/prisma';
import {
  getRandomExamples,
  synthesizeBriefForExample,
  type Language,
} from '../knowledge/reference-captions';
import { getAntiSlopBlock } from '../knowledge/anti-slop';
import { buildHighBarFraming } from '../knowledge/audience-framing';
import { detectSlop, formatSlopRetryMessage, type SlopIssue } from './slop-detector';

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
// Language detection — rough heuristic from brand profile + brief content
// ─────────────────────────────────────────────────────────────────────────────
function detectLanguage(brief: string, profile: BrandProfile | null): Language {
  // Hebrew script detection
  if (/[\u0590-\u05FF]/.test(brief)) return 'he';
  // Cyrillic detection
  if (/[\u0400-\u04FF]/.test(brief)) return 'ru';
  // Profile fallback
  if (profile?.languages?.length) {
    const first = profile.languages[0]?.toLowerCase();
    if (first === 'he' || first === 'hebrew' || first === 'iw') return 'he';
    if (first === 'ru' || first === 'russian') return 'ru';
  }
  return 'en';
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic post-generation enforcement (mechanical safety net)
// ─────────────────────────────────────────────────────────────────────────────
const EMOJI_REGEX_GLOBAL =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/gu;

function enforceArmConstraints(arm: StyleArmName, result: GeneratedPost): void {
  const c = STYLE_ARMS[arm];

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

  if (c.emoji === 'forbidden' && result.content) {
    const stripped = result.content.replace(EMOJI_REGEX_GLOBAL, '');
    if (stripped !== result.content) {
      result.content = stripped.replace(/  +/g, ' ').trim();
      logger.info({ arm }, '[arm-enforcement] emoji stripped from caption');
    }
  }

  if (c.hashtags?.max === 0 && result.content) {
    const stripped = result.content.replace(/#\w+/g, '').replace(/  +/g, ' ').trim();
    if (stripped !== result.content) {
      result.content = stripped;
      logger.info({ arm }, '[arm-enforcement] inline hashtags stripped from caption');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Premium Writer 2.0 — system prompt
//
// System prompt now contains ONLY stable instructions:
//   - High-bar audience framing (per tenant)
//   - Anti-slop block (per language)
//   - Style arm constraints
//   - Image-prompt rules
//   - Output format
//
// Brand voice details, anti-rep, audience hints all moved to the FINAL user
// message where Claude pays the most attention.
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(opts: {
  tenantId: string;
  brand: BrandProfile | null;
  language: Language;
  armName: StyleArmName | null;
}): string {
  const { tenantId, brand, language, armName } = opts;

  const sections: string[] = [];

  // 1. Role + identity
  sections.push(
    'You are a premium Instagram copywriter. You write captions that read like editorial journalism, not like marketing brochures. Your work is the difference between a brand that gets unfollowed and a brand that gets shared.',
  );
  sections.push('');

  // 2. High-bar audience framing
  sections.push(buildHighBarFraming(tenantId, brand));
  sections.push('');

  // 3. Anti-slop block (language-specific)
  sections.push(getAntiSlopBlock(language));
  sections.push('');

  // 4. Style arm constraints
  if (armName) {
    sections.push(buildArmPromptFragment(armName));
    sections.push('');
  }

  // 5. Self-awareness about distributional convergence (Anthropic technique)
  sections.push(
    `# About your own tendencies

You tend to converge toward generic, "on-distribution" outputs. In Russian Instagram beauty captions, this creates what users call AI slop: phrases like "это не случайность, а результат", generic CTAs like "запишитесь и оцените", abstract nouns like "залог стойкости". This is distributional convergence — you sample from the high-probability center of training data, which is dominated by mediocre marketing copy.

The reference examples in this conversation show you OUT of that center. Match their voice. Match their concreteness. Match their refusal to sell. Their authors are real humans with real personalities — your output should be indistinguishable from theirs.

A premium caption describes CONCRETE things in CONCRETE words. Numbers, names, objects, moments in time. Abstractions are slop.`,
  );
  sections.push('');

  // 6. Image prompt rules (kept from previous version — they work)
  sections.push(`# Image prompt rules (Gemini/Imagen)

The image_prompt field is a prompt for AI image generation. It must be detailed:

REQUIRED ELEMENTS:
1. "Photorealistic" — ALWAYS the first word
2. HAND ANATOMY (if hands in frame): "exactly ONE left hand and ONE right hand, each with exactly 5 fingers, natural anatomy"
3. SCENE LOGIC: describe like a real photographer — what is where, where the light comes from, what the camera sees
4. "CRITICAL: NO text, NO letters, NO words, NO logos, NO watermarks on the image"
5. SPECIFIC COLORS: not "beautiful color", but "dusty rose", "deep burgundy"
6. LIGHTING: "soft natural daylight from window" or "warm studio lighting"
7. CAMERA: "Shot on 85mm lens, shallow depth of field" or "overhead flat-lay"
8. FORMAT: "square 1080x1080, Instagram-optimized"

FORBIDDEN: multiple pairs of hands (unless master+client process), illogical object combinations, unrealistic finger poses, text on image.`);
  sections.push('');

  // 7. Output format
  sections.push(`# Output format

Return ONLY valid JSON with this exact structure (no markdown wrapping, no preamble):
{
  "content": "The caption text. Premium copy following all rules above. The first sentence is the hook — it determines whether the reader keeps reading or scrolls past.",
  "hashtags": ["hashtag1", "hashtag2"],
  "image_prompt": "Photorealistic ... [full detailed prompt]"
}`);

  return sections.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Premium Writer 2.0 — final user message
//
// This is where the CRITICAL dynamic information lives:
//   - The actual brief
//   - Brand voice details (extracted from BrandProfile)
//   - Anti-repetition (recent hooks, forbidden first words)
//   - Audience intelligence (winning patterns)
//
// Claude attention is highest on user messages — putting it here is the
// architectural pivot from Module A v1.
// ─────────────────────────────────────────────────────────────────────────────
function buildFinalUserMessage(opts: {
  brief: string;
  enriched: EnrichedBrief;
  tone?: string;
  audience?: string;
  imageBrief?: string;
}): string {
  const { brief, enriched, tone, audience, imageBrief } = opts;
  const sections: string[] = [];

  // Brand voice (was in system prompt before, now in user message for attention)
  if (enriched.brand) {
    const b = enriched.brand;
    sections.push('# Бренд для этого поста');
    if (b.businessName) sections.push(`Название: ${b.businessName}`);
    if (b.businessType) sections.push(`Тип: ${b.businessType}`);
    if (b.city || b.country) {
      sections.push(`Локация: ${[b.city, b.country].filter(Boolean).join(', ')}`);
    }
    if (b.targetAudience) sections.push(`Целевая аудитория: ${b.targetAudience}`);
    if (b.positioningStyle) sections.push(`Позиционирование: ${b.positioningStyle}`);
    if (b.tagline) sections.push(`Слоган: "${b.tagline}"`);
    if (b.uniqueValue) sections.push(`Уникальная ценность: ${b.uniqueValue}`);
    if (b.preferredTone) sections.push(`Тон: ${b.preferredTone}`);
    sections.push('');
  }

  // Anti-repetition — CRITICAL, must be in user message for attention
  if (enriched.antiRep && enriched.antiRep.recentHooks.length > 0) {
    const ar = enriched.antiRep;
    sections.push('# Что НЕ повторять (последние посты этого аккаунта)');

    if (ar.forbiddenFirstWords.length > 0) {
      sections.push(
        `Первые слова которые ты использовал недавно: ${ar.forbiddenFirstWords.join(', ')}.`,
      );
      sections.push('Начни этот hook с другого слова.');
    }

    if (ar.overusedTechniques.length > 0) {
      sections.push(
        `Техники hooks которые ты переиспользовал (>40% последних постов): ${ar.overusedTechniques.join(', ')}.`,
      );
      const allTechniques = [
        'specific_sensory_detail',
        'verbatim_quote',
        'myth_busting',
        'uncomfortable_question',
        'single_person_transformation',
        'actionable_secret',
        'temporal_anchor',
        'specific_number',
        'physical_observation',
      ];
      const allowed = allTechniques.filter((t) => !ar.overusedTechniques.includes(t));
      sections.push(`Используй вместо: ${allowed.slice(0, 5).join(', ')}.`);
    }

    sections.push('');
    sections.push('Последние 5 hooks этого аккаунта:');
    ar.recentHooks.slice(0, 5).forEach((h, i) => {
      sections.push(`${i + 1}. "${h.hookText.slice(0, 100)}"`);
    });
    sections.push('');
    sections.push('Твой hook должен быть СОВЕРШЕННО другим — другая структура, другая интонация, другое первое слово.
Запрещённые заходы (всегда, независимо от истории): "Знаете почему", "Как часто ты замечаешь", "Хотите чтобы", "Все мечтают".');
    sections.push('');
  }

  // Audience intelligence — what works for THIS account's audience
  if (enriched.audience && !enriched.audience.coldStart) {
    const a = enriched.audience;
    sections.push('# Что работает для этой аудитории (real engagement data)');
    sections.push(
      `Постов проанализировано: ${a.postsAnalyzed}. Средний engagement rate: ${(a.avgEngagementRate * 100).toFixed(2)}%`,
    );

    if (a.preferHints.length > 0) {
      const top = a.preferHints.slice(0, 3);
      sections.push(
        `PROVEN to work: ${top.map((h) => `${h.dimension}=${h.bucket}`).join(', ')}`,
      );
    }

    if (a.winningHooks.length > 0) {
      sections.push('Топовые hooks этого аккаунта (изучи технику, не дословный текст):');
      a.winningHooks.slice(0, 3).forEach((h, i) => {
        sections.push(
          `${i + 1}. [${h.technique || 'unknown'}, er ${(h.engagementRate * 100).toFixed(2)}%] "${h.hookText.slice(0, 100)}"`,
        );
      });
    }
    sections.push('');
  }

  // Optional overrides
  if (tone) {
    sections.push(`Запрошенный тон: ${tone}`);
  }
  if (audience) {
    sections.push(`Аудитория override: ${audience}`);
  }
  if (imageBrief) {
    sections.push(`Контекст изображения: ${imageBrief}`);
  }
  if (tone || audience || imageBrief) {
    sections.push('');
  }

  // The actual brief — last so it has the most attention
  sections.push('# Brief для этого поста');
  sections.push(brief);
  sections.push('');
  sections.push('Напиши caption в premium стиле как в reference examples выше. Выдай ТОЛЬКО валидный JSON, без markdown wrapping.');

  return sections.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Many-shot conversation builder — the core of Premium Writer 2.0
// ─────────────────────────────────────────────────────────────────────────────
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function buildMessages(opts: {
  tenantId: string;
  brief: string;
  enriched: EnrichedBrief;
  brand: BrandProfile | null;
  language: Language;
  armName: StyleArmName | null;
  tone?: string;
  audience?: string;
  imageBrief?: string;
}): LLMMessage[] {
  const { tenantId, brief, enriched, brand, language, armName, tone, audience, imageBrief } = opts;

  const messages: LLMMessage[] = [];

  // 1. System prompt
  messages.push({
    role: 'system',
    content: buildSystemPrompt({ tenantId, brand, language, armName }),
  });

  // 2. Many-shot reference examples — conversation history
  const exampleArm: any = armName || 'any';
  const examples = getRandomExamples(language, exampleArm, 3);

  for (const example of examples) {
    messages.push({
      role: 'user',
      content: synthesizeBriefForExample(example),
    });
    // Wrap example caption in the same JSON envelope the model is expected
    // to produce — this teaches the format AND the content style at once.
    messages.push({
      role: 'assistant',
      content: JSON.stringify({
        content: example.caption,
        hashtags: [],
        image_prompt: 'Photorealistic close-up of a manicured hand resting on a textured surface, soft natural daylight, 85mm lens shallow depth of field, dusty rose color palette, square 1080x1080, NO text, NO logos.',
      }),
    });
  }

  // 3. Final user message — the real brief + critical dynamic context
  messages.push({
    role: 'user',
    content: buildFinalUserMessage({ brief, enriched, tone, audience, imageBrief }),
  });

  return messages;
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
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────
export async function generateContent(params: GenerateParams): Promise<GeneratedPost> {
  const env = getEnv();

  // 1. Load brand profile
  let profile: BrandProfile | null = null;
  if (params.tenantId) {
    profile = await loadBrandProfile(params.tenantId);
  }

  // 2. Resolve arm + language
  const armName: StyleArmName | null = isStyleArmName(params.styleArm) ? params.styleArm : null;
  const language = detectLanguage(params.brief, profile);

  // 3. Enrich brief (Module A — anti-rep + audience layers)
  let enriched: EnrichedBrief;
  if (params.tenantId) {
    try {
      enriched = await enrichBrief({
        tenantId: params.tenantId,
        rawBrief: params.brief,
        styleArm: params.styleArm,
        topicArm: params.topicArm,
        language,
        prisma: getPrisma(),
      });
    } catch (e: any) {
      logger.warn({ tenantId: params.tenantId, error: e?.message }, '[pw2] enrichment failed, using minimal brief');
      enriched = {
        rawBrief: params.brief,
        tenantId: params.tenantId,
        brand: null,
        antiRep: null,
        audience: null,
        enrichedAt: new Date(),
        layersLoaded: { brand: false, antiRep: false, audience: false },
        cacheHit: false,
      };
    }
  } else {
    enriched = {
      rawBrief: params.brief,
      tenantId: '',
      brand: null,
      antiRep: null,
      audience: null,
      enrichedAt: new Date(),
      layersLoaded: { brand: false, antiRep: false, audience: false },
      cacheHit: false,
    };
  }

  // 4. Build many-shot conversation
  const messages = buildMessages({
    tenantId: params.tenantId || '',
    brief: params.brief,
    enriched,
    brand: profile,
    language,
    armName,
    tone: params.tone,
    audience: params.audience,
    imageBrief: params.image_brief,
  });

  logger.info(
    {
      tenantId: params.tenantId,
      arm: armName,
      language,
      messageCount: messages.length,
      systemBytes: messages[0].content.length,
      finalUserBytes: messages[messages.length - 1].content.length,
      antiRepHooks: enriched.antiRep?.recentHooks.length ?? 0,
      coldStart: enriched.audience?.coldStart,
    },
    '[pw2] generation start',
  );

  // 5. Call llm-hub with the full message array
  const url = `${env.LLM_HUB_URL}/v1/llm/generate`;

  interface LLMResponse {
    output: string;
  }

  // Premium Writer 2.0 retry loop:
  //   - Up to 2 attempts with arm constraints (validation)
  //   - PLUS one additional retry if slop detector finds HIGH-severity issues
  //   - Total maximum: 3 LLM calls per post
  const MAX_ARM_ATTEMPTS = armName ? 2 : 1;
  let result: GeneratedPost = { content: '', hashtags: [], image_prompt: '' };
  let lastViolations: string[] = [];
  let slopRetryUsed = false;

  for (let attempt = 0; attempt < MAX_ARM_ATTEMPTS; attempt++) {
    // For retry, append a feedback message asking to fix violations
    let attemptMessages = messages;
    if (attempt > 0 && armName && lastViolations.length > 0) {
      attemptMessages = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(result) },
        { role: 'user', content: buildRetryFragment(armName, lastViolations) },
      ];
    }

    const data = await httpPost<LLMResponse>(
      url,
      {
        intent: 'quality',
        input: { messages: attemptMessages },
        maxTokens: 1500,
        temperature: 0.85,
      },
      { Authorization: `Bearer ${signServiceToken()}` },
      { timeout: 60000 },
    );

    const output = data.output || '';
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      result = { content: output, hashtags: [], image_prompt: '' };
      break;
    }
    try {
      result = JSON.parse(jsonMatch[0]) as GeneratedPost;
    } catch (e) {
      logger.warn({ output: output.slice(0, 200) }, '[pw2] JSON parse failed, using raw output');
      result = { content: output, hashtags: [], image_prompt: '' };
      break;
    }

    if (!armName) break;

    // Deterministic enforcement
    enforceArmConstraints(armName, result);

    // Validate arm constraints
    const validation = validateAgainstArm(armName, result.content || '', result.hashtags);
    if (validation.ok) {
      logger.info(
        { arm: armName, attempt: attempt + 1, len: (result.content || '').length },
        '[pw2] arm validation passed',
      );
      break;
    }

    lastViolations = validation.violations;
    if (attempt + 1 >= MAX_ARM_ATTEMPTS) {
      logger.warn(
        { arm: armName, violations: lastViolations },
        '[pw2] arm validation failed after max attempts, accepting anyway',
      );
    } else {
      logger.warn({ arm: armName, violations: lastViolations }, '[pw2] arm validation failed, retrying');
    }
  }

  // ── Slop detection layer ────────────────────────────────────────────────
  // After arm validation, run slop detector. If HIGH severity issues found,
  // trigger ONE additional retry with explicit slop feedback. This is the
  // 3rd layer of defense against distributional convergence.
  const slopIssues: SlopIssue[] = detectSlop(result.content || '', language);
  const highSeverity = slopIssues.filter((i) => i.severity === 'high');

  if (highSeverity.length > 0 && !slopRetryUsed) {
    slopRetryUsed = true;
    logger.warn(
      {
        tenantId: params.tenantId,
        arm: armName,
        slopCount: highSeverity.length,
        patterns: highSeverity.map((i) => i.pattern),
      },
      '[pw2-slop] HIGH severity slop detected, triggering retry',
    );

    const slopRetryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: JSON.stringify(result) },
      { role: 'user', content: formatSlopRetryMessage(slopIssues) },
    ];

    try {
      const retryData = await httpPost<LLMResponse>(
        url,
        {
          intent: 'quality',
          input: { messages: slopRetryMessages },
          maxTokens: 1500,
          temperature: 0.85,
        },
        { Authorization: `Bearer ${signServiceToken()}` },
        { timeout: 60000 },
      );
      const retryOutput = retryData.output || '';
      const retryJsonMatch = retryOutput.match(/\{[\s\S]*\}/);
      if (retryJsonMatch) {
        try {
          const retryResult = JSON.parse(retryJsonMatch[0]) as GeneratedPost;
          if (armName) {
            enforceArmConstraints(armName, retryResult);
          }
          // Check if retry actually improved things
          const retrySlopIssues = detectSlop(retryResult.content || '', language);
          const retryHighSeverity = retrySlopIssues.filter((i) => i.severity === 'high');
          if (retryHighSeverity.length < highSeverity.length) {
            logger.info(
              {
                before: highSeverity.length,
                after: retryHighSeverity.length,
              },
              '[pw2-slop] retry improved, accepting new result',
            );
            result = retryResult;
          } else {
            logger.warn(
              { before: highSeverity.length, after: retryHighSeverity.length },
              '[pw2-slop] retry did not improve, keeping original',
            );
          }
        } catch (e) {
          logger.warn({ error: (e as Error).message }, '[pw2-slop] retry JSON parse failed');
        }
      }
    } catch (e: any) {
      logger.warn({ error: e?.message }, '[pw2-slop] retry HTTP call failed');
    }
  } else if (slopIssues.length > 0) {
    // Medium-only or already retried — log but don't block
    logger.info(
      {
        tenantId: params.tenantId,
        slopCount: slopIssues.length,
        patterns: slopIssues.map((i) => i.pattern),
      },
      '[pw2-slop] medium-severity slop detected (logged, not blocking)',
    );
  }

  return result;
}
