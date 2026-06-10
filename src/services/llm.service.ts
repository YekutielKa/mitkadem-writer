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
import { renderMarketAdvisory } from './r4-market-advisory';
import { getPrisma } from '../lib/prisma';
import {
  getRandomExamples,
  synthesizeBriefForExample,
  type Language,
} from '../knowledge/reference-captions';
import { getAntiSlopBlock } from '../knowledge/anti-slop';
import { buildHighBarFraming } from '../knowledge/audience-framing';
import { detectSlop, formatSlopRetryMessage, type SlopIssue } from './slop-detector';
import { sanitizeImagePromptLanguage } from './image-prompt-sanitizer';
import { validateBrandCoherence } from '../lib/brand-coherence-validator';
// Sprint O Block 2 — script-coherence detector. Used to verify Opus output
// matches the orchestrator-supplied target-audience language; mismatch
// triggers up to 2 dedicated retries with explicit correction (then 422).
import {
  detectDominantScript,
  langToScript,
  langFullNameRu,
  type ScriptDetection,
} from '../lib/script-detector';
// Sprint 26 — hashtag city-niche guardrail (closes Sprint 23 finding #7 partial).
import {
  getHashtagAllowlistForCity,
  filterHashtags,
  renderAllowlistHint,
  type HashtagAllowlist,
} from './hashtag-allowlist';

// FOUNDATION_FIX Sprint 5 — Mitkadem self-tenant skip-guard for brand-coherence
// validator. Self-tenant must NEVER be inspected/written by validator emit
// (DEC absolute; preserves byte-identical invariant).
const MITKADEM_SELF_TENANT_ID = 'e9efe9c9-fca4-4c38-9d68-c551e8bad4ae';

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
    // FOUNDATION_FIX Sprint 5 — defensive coherence check (non-blocking).
    // Skip Mitkadem self-tenant; emit warning event when issues > 0.
    if (profile && tenantId !== MITKADEM_SELF_TENANT_ID) {
      try {
        const coherence = validateBrandCoherence(profile);
        if (!coherence.coherent) {
          emitBrandCoherenceWarning(tenantId, coherence.issues, 'loadBrandProfile').catch(() => {
            // emit failure must NEVER block the load-path
          });
        }
      } catch (e: any) {
        logger.warn({ tenantId, error: e?.message }, '[brand-coherence] validator threw (non-blocking)');
      }
    }
    return profile;
  } catch (err: any) {
    logger.warn({ tenantId, error: err.message }, 'Failed to load brand profile');
    return null;
  }
}

async function emitBrandCoherenceWarning(
  tenantId: string,
  issues: ReturnType<typeof validateBrandCoherence>['issues'],
  loadSite: string,
): Promise<void> {
  const db = getPrisma();
  await db.$executeRawUnsafe(
    `INSERT INTO public.learning_events (id, tenant_id, source, event_type, input_data, output_data, outcome, severity, created_at)
     VALUES (gen_random_uuid()::text, $1, 'writer', 'agent.writer.brand_coherence_warning', $2::jsonb, NULL, 'neutral', 'warn', NOW())`,
    tenantId,
    JSON.stringify({ issues, loadSite }),
  );
}

// Sprint O Block 2 — emit a writer script-coherence learning_event.
// Never throws; emit-path failure must NOT mask the underlying script
// state (the caller's flow decides retry vs. throw separately).
type WriterScriptEventType =
  | 'writer_script_check_passed'
  | 'writer_script_mismatch_retry'
  | 'writer_language_mismatch_unrecoverable';
async function emitWriterScriptEvent(
  tenantId: string | null | undefined,
  eventType: WriterScriptEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getPrisma();
    const outcome = eventType === 'writer_script_check_passed' ? 'positive' : 'negative';
    const severity = eventType === 'writer_language_mismatch_unrecoverable' ? 'error'
      : eventType === 'writer_script_mismatch_retry' ? 'warn'
      : 'info';
    await db.$executeRawUnsafe(
      `INSERT INTO public.learning_events (id, tenant_id, source, event_type, input_data, output_data, outcome, severity, created_at)
       VALUES (gen_random_uuid()::text, $1, 'writer', $2, $3::jsonb, NULL, $4, $5, NOW())`,
      tenantId ?? null,
      eventType,
      JSON.stringify(payload),
      outcome,
      severity,
    );
  } catch (e: any) {
    logger.warn({ tenantId, eventType, error: e?.message }, '[sprint-o] writer script event emit failed (non-blocking)');
  }
}

// Sprint O Block 2 — typed error so the route handler can map to HTTP 422.
export class WriterLanguageMismatchUnrecoverableError extends Error {
  readonly code = 'writer_language_mismatch_unrecoverable';
  readonly attempts: number;
  readonly expectedLang: string;
  readonly expectedScript: string;
  readonly detected: ScriptDetection;
  constructor(opts: {
    attempts: number;
    expectedLang: string;
    expectedScript: string;
    detected: ScriptDetection;
  }) {
    super(
      `writer_language_mismatch_unrecoverable: expected=${opts.expectedScript} detected=${opts.detected.script} attempts=${opts.attempts}`,
    );
    this.attempts = opts.attempts;
    this.expectedLang = opts.expectedLang;
    this.expectedScript = opts.expectedScript;
    this.detected = opts.detected;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Language detection — rough heuristic from brand profile + brief content
// ─────────────────────────────────────────────────────────────────────────────
function detectLanguage(brief: string, profile: BrandProfile | null, explicit?: string | null): Language {
  // Sprint H \u2014 when caller passes explicit language (orchestrator's
  // multi-locale fan-out per Sprint H commission \u00A71.5), honor it first.
  // Brief-text + profile fallbacks were the legacy heuristic; they
  // produced wrong-language ads for masters whose brief had mixed RU/HE
  // samples but whose target-locale was the country primary.
  if (explicit) {
    const e = explicit.toLowerCase();
    if (e === 'he' || e === 'hebrew' || e === 'iw') return 'he';
    if (e === 'ru' || e === 'russian') return 'ru';
    if (e === 'en' || e === 'english') return 'en';
  }
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

// FOUNDATION_FIX Sprint 2 — robust LLM response parser.
// Why: LLMs frequently wrap JSON output in a markdown code fence (```json … ```).
// The previous greedy-regex + JSON.parse approach also leaked the raw fence-wrapped
// string to result.content whenever JSON.parse failed (e.g. truncated output, stray
// braces in Hebrew/RTL captions), surfacing literal markdown to real Instagram users.
// `ok=false` signals the caller a fallback occurred so it can break out of retry
// loops rather than churn on broken structured fields.
const FENCE_REGEX = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i;
const LEADING_FENCE_REGEX = /^```(?:json)?\s*\n?/i;
const TRAILING_FENCE_REGEX = /\n?```\s*$/;
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;
// Tertiary recovery for LLM-truncated output: extract just the "content"
// string field even when JSON is unterminated. Captures both the closed-quote
// case and the truncated-without-quote case.
const CONTENT_FIELD_REGEX = /"content"\s*:\s*"((?:\\.|[^"\\])*)/;

function recoverContentFromBrokenJson(text: string): string | null {
  const m = text.match(CONTENT_FIELD_REGEX);
  if (!m) return null;
  try {
    // Wrap the captured body and unescape via JSON.parse so escape sequences
    // (\n, \", \\, \uXXXX) materialize correctly.
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return null;
  }
}

export function extractPostFromLLMResponse(raw: string): { post: GeneratedPost; ok: boolean } {
  const empty: GeneratedPost = { content: '', hashtags: [], image_prompt: '' };
  if (!raw) return { post: empty, ok: false };

  let candidate = raw.trim();
  const fenceMatch = candidate.match(FENCE_REGEX);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
  } else {
    // Truncated/asymmetric fences (e.g. opening ```json without closing ```)
    // still leak markdown to the caption if not stripped here.
    candidate = candidate.replace(LEADING_FENCE_REGEX, '').replace(TRAILING_FENCE_REGEX, '').trim();
  }

  const objectMatch = candidate.match(JSON_OBJECT_REGEX);
  const jsonText = objectMatch ? objectMatch[0] : candidate;

  try {
    const parsed = JSON.parse(jsonText) as Partial<GeneratedPost>;
    if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
      const hashtags = Array.isArray(parsed.hashtags)
        ? parsed.hashtags.filter((h): h is string => typeof h === 'string')
        : [];
      const rawImagePrompt = typeof parsed.image_prompt === 'string' ? parsed.image_prompt : '';
      const { sanitized: image_prompt, mutated: imagePromptMutated } =
        sanitizeImagePromptLanguage(rawImagePrompt);
      if (imagePromptMutated) {
        logger.warn(
          { rawPreview: rawImagePrompt.slice(0, 120), cleanedPreview: image_prompt.slice(0, 120) },
          '[pw2] image_prompt language sanitized (RU/HE → EN)',
        );
      }
      return { post: { content: parsed.content, hashtags, image_prompt }, ok: true };
    }
  } catch (err) {
    logger.warn(
      { rawPreview: raw.slice(0, 200), err: (err as Error).message },
      '[pw2] extractPostFromLLMResponse JSON.parse failed — attempting tertiary recovery',
    );
  }

  // Tertiary fallback: regex-extract the content field even from malformed/truncated JSON.
  // This salvages the most-common LLM failure mode (max_tokens hit mid-string) without
  // surfacing literal {"content":"…"} or ```json wrappers to the caller.
  const recovered = recoverContentFromBrokenJson(candidate);
  if (recovered) {
    logger.warn(
      { rawPreview: raw.slice(0, 200), recoveredLen: recovered.length },
      '[pw2] recovered content via tertiary regex extraction (LLM output likely truncated)',
    );
    return {
      post: {
        content: recovered,
        hashtags: [],
        image_prompt: '',
        needsReview: true,
        needsReviewReason: 'parser_recovered_from_malformed_json',
      },
      ok: false,
    };
  }

  // Last-resort fallback: surface stripped text. Mark needsReview so this never
  // auto-publishes — the LLM clearly did not produce the expected schema.
  logger.warn(
    { rawPreview: raw.slice(0, 200) },
    '[pw2] LLM response did not match expected JSON shape — using stripped text as content (needsReview)',
  );
  return {
    post: {
      content: candidate,
      hashtags: [],
      image_prompt: '',
      needsReview: true,
      needsReviewReason: 'parser_no_json_match',
    },
    ok: false,
  };
}

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
  hashtagAllowlist?: HashtagAllowlist;
  // Sprint FIX_CONTENT_QUALITY — when true, arm fragments use their grounded
  // variant (no "invent numbers" mandate) + a factual-integrity backstop.
  groundedArms?: boolean;
}): string {
  const { tenantId, brand, language, armName, hashtagAllowlist, groundedArms } = opts;

  const sections: string[] = [];

  // 0. Sprint O Block 2 — language directive FIRST. Opus pays the most
  //    attention to the first instruction; pre-Sprint-O this directive
  //    lived deep in the final user message and Opus drifted to the
  //    brief body's dominant script (e.g. Hebrew copy reaching a Russian
  //    AdSet). Restated in Russian (operator language) so it survives
  //    translation in the LLM's internal reasoning trace.
  const langRu = langFullNameRu(language);
  const langScript = langToScript(language);
  const langScriptRu =
    langScript === 'cyrillic' ? 'кириллица'
    : langScript === 'hebrew' ? 'иврит (еврейское письмо)'
    : langScript === 'arabic' ? 'арабская вязь'
    : 'латиница';
  sections.push(
    [
      `ОБЯЗАТЕЛЬНО — ВЕСЬ ВЫХОД ТОЛЬКО НА ЯЗЫКЕ: ${langRu} (ISO 639-1 = ${language}; письменность: ${langScriptRu}).`,
      '',
      'НЕ смешивай языки. НЕ используй слова или фразы на других языках в полях content и hashtags.',
      'Если master picture / brand profile / brief написаны на другом языке — переведи смысл, не копируй текст дословно.',
      '',
      `Язык целевой аудитории (target audience language): ${language}`,
      'Язык мастера может отличаться от языка целевой аудитории. Следуй target audience language.',
      '',
      'Исключение только одно: поле image_prompt — всегда на английском (см. раздел Image prompt rules).',
    ].join('\n'),
  );
  sections.push('');

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
    sections.push(buildArmPromptFragment(armName, groundedArms === true));
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

LANGUAGE RULE (CRITICAL):
The image_prompt MUST be entirely in English, regardless of the caption's language. If the brand's businessType / niche / services contain non-English terms, translate them to English BEFORE composing the image_prompt:
- "косметология" → "cosmetology"; "тату"/"татуаж" → "tattoo"/"permanent makeup"; "маникюр" → "manicure"; "педикюр" → "pedicure"; "парикмахер" → "hair salon"; "массаж" → "massage"; "пилинг" → "peeling"; "брови" → "brows"; "ресницы" → "lashes"
- Hebrew "מספרה" → "hair salon"; "קוסמטיקה" → "cosmetology"; "מניקור" → "manicure"; "איפור" → "makeup"; "קעקוע" → "tattoo"
The image_prompt MUST contain ZERO Cyrillic and ZERO Hebrew characters. ASCII / Latin only.

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

  // 7. Hashtag allowlist (Sprint 26 — closes Sprint 23 finding #7 partial).
  //    Pre-LLM hint that bounds the hashtag-generation distribution. Post-filter
  //    is the empirical defense (see filterHashtags after LLM call).
  if (hashtagAllowlist) {
    sections.push(renderAllowlistHint(hashtagAllowlist));
    sections.push('');
  }

  // 8. Output format
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
  language: string; // pw3/fix4
  tone?: string;
  audience?: string;
  imageBrief?: string;
}): string {
  const { brief, enriched, language: msgLang, tone, audience, imageBrief } = opts;
  const sections: string[] = [];

  // pw3/fix3: brief topic OVERRIDES brand context
  sections.push('# IMPORTANT: Brief topic vs Brand context');
  sections.push('The BRIEF below describes WHAT to write about (the TOPIC).');
  sections.push('Your brand profile describes HOW to write (voice, tone, style).');
  sections.push('If the brief topic differs from your usual business — FOLLOW THE BRIEF TOPIC.');
  sections.push('');

  // Brand voice (for tone/style, NOT for topic)
  if (enriched.brand) {
    const b = enriched.brand;
    sections.push('# Бренд (голос и тон, НЕ тема)');
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

  // R4 USE-DATA A2 — researcher MARKET advisory (competitor price range / market
  // audience), rendered as a SEPARATE, clearly-labelled block with a hard
  // anti-leak guard. Flag-gated (default OFF → [] → prompt byte-for-byte) and
  // presence-gated. Market view for tone/positioning ONLY — never published as a
  // figure, never the master's own price.
  for (const line of renderMarketAdvisory(enriched.brand?.marketContext, getEnv().RESEARCH_USE_DATA_V2)) {
    sections.push(line);
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
    sections.push('Твой hook должен быть СОВЕРШЕННО другим — другая структура, другая интонация, другое первое слово.');
    sections.push('Запрещённые заходы (всегда, независимо от истории): Знаете почему, Как часто ты замечаешь, Хотите чтобы, Все мечтают.');
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

  // pw3/fix4: explicit language directive — Sonnet must see this clearly
  const langNames: Record<string, string> = { ru: 'Russian (русский)', he: 'Hebrew (עברית)', en: 'English' };
  const langName = langNames[msgLang] || msgLang;
  sections.push('# ЯЗЫК / LANGUAGE');
  sections.push(`Write this caption ENTIRELY in ${langName}. Every word of the caption must be in ${langName}. This is non-negotiable.`);
  sections.push('');

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
  hashtagAllowlist?: HashtagAllowlist;
  groundedArms?: boolean;
}): LLMMessage[] {
  const { tenantId, brief, enriched, brand, language, armName, tone, audience, imageBrief, hashtagAllowlist, groundedArms } = opts;

  const messages: LLMMessage[] = [];

  // 1. System prompt
  messages.push({
    role: 'system',
    content: buildSystemPrompt({ tenantId, brand, language, armName, hashtagAllowlist, groundedArms }),
  });

  // 2. Many-shot reference examples — conversation history.
  // SPRINT_COST_FIX: example count is the biggest input-token inflator (3 full
  // caption envelopes per call). Make it tunable (default 1) so the few-shot
  // budget is reversible; measured to hold caption pass-rate at 1 example.
  // Set WRITER_FEWSHOT_EXAMPLES=3 to restore the prior behaviour.
  const exampleArm: any = armName || 'any';
  const fewShotN = Math.max(0, Number(process.env.WRITER_FEWSHOT_EXAMPLES ?? 1));
  const examples = getRandomExamples(language, exampleArm, fewShotN);

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
    content: buildFinalUserMessage({ brief, enriched, language, tone, audience, imageBrief }),
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
  language?: string; // pw3/fix3: explicit language from request
  // Sprint O Block 2 — caller signals the creative purpose so the writer
  // knows which downstream checks to enforce. 'ads_creative' enables the
  // post-generation script-coherence retry loop (max 2 retries, then 422).
  // Absent / other values skip the gate (preserves intro/content paths).
  purpose?: string;
  // Sprint FIX_CONTENT_QUALITY — per-request override for grounded arm
  // templates. When undefined, falls back to WRITER_GROUNDED_ARMS_ENABLED env
  // (default OFF → legacy byte-identical prompt). When true, arm fragments use
  // their grounded variant + factual-integrity backstop. Used for measurement
  // without flipping the production env flag.
  groundedArms?: boolean;
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
  const language = detectLanguage(params.brief, profile, params.language);

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

  // Sprint 26 — hashtag allowlist sourced from BrandProfile.city. Used for
  // pre-LLM hint (in system prompt) и post-LLM filtering (after generation).
  const hashtagAllowlist: HashtagAllowlist | undefined = profile
    ? getHashtagAllowlistForCity(profile.city ?? null)
    : undefined;

  // Sprint FIX_CONTENT_QUALITY — resolve grounded-arms mode. Per-request
  // override wins; otherwise the env flag (default OFF → legacy prompt). Read
  // process.env directly (same precedent as WRITER_FEWSHOT_EXAMPLES) so the
  // env schema stays untouched and the change is fully reversible.
  const groundedArms =
    params.groundedArms ?? process.env.WRITER_GROUNDED_ARMS_ENABLED === 'true';

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
    hashtagAllowlist,
    groundedArms,
  });

  logger.info(
    {
      tenantId: params.tenantId,
      arm: armName,
      groundedArms,
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
        // FIX_BURN_2 (2026-06-08): regular caption generation moved Opus→Sonnet.
        // content_generation was the single biggest spend node ($88/7d, ×5 of
        // Sonnet). Measured on 5 varied Hannah briefs through the live gates:
        // sonnet-4-6 passed 5/5 (avg 0.90) vs opus-4-6 4/5 (avg 0.92) — equal/
        // better pass-rate, zero fabrications. Explicit so it's decoupled from
        // the hub default. Revert to opus if caption pass-rate regresses.
        model: 'claude-sonnet-4-6',
        input: { messages: attemptMessages },
        maxTokens: 1500,
        temperature: 0.85,
      },
      {
        Authorization: `Bearer ${signServiceToken()}`,
        'x-caller-service': 'writer',
        ...(params.tenantId ? { 'x-tenant-id': params.tenantId } : {}),
        'x-activity': 'content_generation',
      },
      { timeout: 60000 },
    );

    const output = data.output || '';
    const extracted = extractPostFromLLMResponse(output);
    result = extracted.post;
    if (!extracted.ok) break;

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
        '[pw2] arm validation failed after max attempts — flagging needs_review',
      );
      result.needsReview = true;
      result.needsReviewReason = `arm_validation_failed:${lastViolations.slice(0, 3).join('|')}`;
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
          model: 'claude-sonnet-4-6', // FIX_BURN_2: match primary caption model
          input: { messages: slopRetryMessages },
          maxTokens: 1500,
          temperature: 0.85,
        },
        {
          // SPRINT_COST_FIX: slop-retry was the one writer call missing caller
          // attribution → it fell into (unattributed) in the ledger. Tag it like
          // the primary + lang-retry calls so writer spend is fully accounted.
          Authorization: `Bearer ${signServiceToken()}`,
          'x-caller-service': 'writer',
          ...(params.tenantId ? { 'x-tenant-id': params.tenantId } : {}),
          'x-activity': 'content_generation',
        },
        { timeout: 60000 },
      );
      const retryOutput = retryData.output || '';
      const retryExtracted = extractPostFromLLMResponse(retryOutput);
      if (retryExtracted.ok) {
        const retryResult = retryExtracted.post;
        if (armName) {
          enforceArmConstraints(armName, retryResult);
        }
        // Check if retry actually improved things
        const retrySlopIssues = detectSlop(retryResult.content || '', language);
        const retryHighSeverity = retrySlopIssues.filter((i) => i.severity === 'high');
        if (retryHighSeverity.length === 0) {
          logger.info(
            { before: highSeverity.length, after: 0 },
            '[pw2-slop] retry cleared all HIGH severity, accepting',
          );
          result = retryResult;
        } else if (retryHighSeverity.length < highSeverity.length) {
          logger.warn(
            { before: highSeverity.length, after: retryHighSeverity.length },
            '[pw2-slop] retry improved but HIGH severity still present — flagging needs_review',
          );
          result = retryResult;
          result.needsReview = true;
          result.needsReviewReason = `slop_high_severity:${retryHighSeverity.map((i) => i.pattern).slice(0, 3).join('|')}`;
        } else {
          logger.warn(
            { before: highSeverity.length, after: retryHighSeverity.length },
            '[pw2-slop] retry did not improve — flagging needs_review',
          );
          result.needsReview = true;
          result.needsReviewReason = `slop_high_severity:${highSeverity.map((i) => i.pattern).slice(0, 3).join('|')}`;
        }
      } else {
        logger.warn('[pw2-slop] retry parse failed — flagging needs_review');
        result.needsReview = true;
        result.needsReviewReason = 'slop_retry_parse_failed';
      }
    } catch (e: any) {
      logger.warn({ error: e?.message }, '[pw2-slop] retry HTTP call failed — flagging needs_review');
      result.needsReview = true;
      result.needsReviewReason = 'slop_retry_http_failed';
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

  // ── Sprint 26 — hashtag post-LLM filter ──────────────────────────────────
  // Closes Sprint 23 finding #7 partial (#маникюрашкелон city-niche LLM-conflation
  // for Rishon-LeZion business). Forbidden conflations rejected; geo-neutral
  // niche-only tags + tenant-own-city tags accepted. On all-rejected → emit
  // `hashtag_generation_blocked` learning_event + fall back к geo-neutral subset.
  if (hashtagAllowlist && Array.isArray(result.hashtags) && result.hashtags.length > 0) {
    const filter = filterHashtags(result.hashtags, hashtagAllowlist);
    if (filter.rejected.length > 0) {
      logger.warn(
        {
          tenantId: params.tenantId,
          rejected: filter.rejected.slice(0, 10),
          accepted: filter.accepted,
          fallbackTriggered: filter.fallbackTriggered,
        },
        '[pw2-hashtag] hashtags rejected by allowlist (Sprint 26 city-niche guardrail)',
      );
      if (filter.fallbackTriggered && filter.fallbackTags) {
        try {
          const db = getPrisma();
          await db.$executeRawUnsafe(
            `INSERT INTO public.learning_events (id, tenant_id, source, event_type, input_data, output_data, outcome, severity, created_at)
             VALUES (gen_random_uuid()::text, $1, 'writer', 'hashtag_generation_blocked', $2::jsonb, NULL, 'negative', 'warn', NOW())`,
            params.tenantId ?? null,
            JSON.stringify({
              rejected: filter.rejected,
              fallbackTags: filter.fallbackTags,
              tenantCity: hashtagAllowlist.city,
              reason: 'all_candidates_rejected_by_allowlist',
            }),
          );
        } catch (e: any) {
          logger.warn(
            { error: e?.message, tenantId: params.tenantId },
            '[pw2-hashtag] hashtag_generation_blocked emit failed (non-fatal)',
          );
        }
        result.hashtags = filter.fallbackTags;
      } else {
        result.hashtags = filter.accepted;
      }
    } else {
      result.hashtags = filter.accepted;
    }
  }

  // ── Sprint O Block 2 — post-generation script coherence ──────────────────
  // Final outer gate: when the caller is the ads-launch creative path
  // (purpose='ads_creative') and supplied an explicit target language,
  // verify the dominant script of `result.content` matches the language's
  // writing system. Mismatch (or mixed/empty) triggers up to 2 dedicated
  // retries with explicit Russian-language correction. After 2nd retry
  // still fails → throw WriterLanguageMismatchUnrecoverableError, route
  // returns HTTP 422 — no creative reaches Meta.
  if (params.purpose === 'ads_creative' && params.language) {
    const expectedLang = params.language.toLowerCase();
    const expectedScript = langToScript(expectedLang);
    const expectedLangNameRu = langFullNameRu(expectedLang);
    const MAX_SCRIPT_RETRIES = 2;
    let attempts = 0;
    let detection = detectDominantScript(result.content || '');

    while (true) {
      const passed = detection.script === expectedScript && detection.confidence >= 0.7;
      if (passed) {
        await emitWriterScriptEvent(params.tenantId, 'writer_script_check_passed', {
          tenantId: params.tenantId,
          attempts,
          expectedLang,
          expectedScript,
          detected: { script: detection.script, confidence: detection.confidence, counts: detection.counts },
          contentSnippet: (result.content || '').slice(0, 160),
        });
        logger.info(
          {
            tenantId: params.tenantId,
            attempts,
            expectedLang,
            expectedScript,
            detected: detection.script,
            confidence: detection.confidence,
          },
          '[sprint-o] writer_script_check_passed',
        );
        break;
      }

      if (attempts >= MAX_SCRIPT_RETRIES) {
        await emitWriterScriptEvent(params.tenantId, 'writer_language_mismatch_unrecoverable', {
          tenantId: params.tenantId,
          attempts,
          expectedLang,
          expectedScript,
          detected: { script: detection.script, confidence: detection.confidence, counts: detection.counts },
          finalContentSnippet: (result.content || '').slice(0, 320),
        });
        logger.error(
          {
            tenantId: params.tenantId,
            attempts,
            expectedLang,
            expectedScript,
            detection,
          },
          '[sprint-o] writer_language_mismatch_unrecoverable',
        );
        throw new WriterLanguageMismatchUnrecoverableError({
          attempts,
          expectedLang,
          expectedScript,
          detected: detection,
        });
      }

      attempts++;
      await emitWriterScriptEvent(params.tenantId, 'writer_script_mismatch_retry', {
        tenantId: params.tenantId,
        attempt: attempts,
        expectedLang,
        expectedScript,
        detected: { script: detection.script, confidence: detection.confidence, counts: detection.counts },
        contentSnippet: (result.content || '').slice(0, 320),
      });
      logger.warn(
        {
          tenantId: params.tenantId,
          attempt: attempts,
          expectedLang,
          expectedScript,
          detection,
        },
        '[sprint-o] writer_script_mismatch_retry',
      );

      const detectedScriptUpper = detection.script.toUpperCase();
      const correctionMessage = [
        `YOUR PREVIOUS RESPONSE WAS IN ${detectedScriptUpper} script (letter counts: cyrillic=${detection.counts.cyrillic}, hebrew=${detection.counts.hebrew}, latin=${detection.counts.latin}, arabic=${detection.counts.arabic}, total=${detection.counts.total}).`,
        `THE TARGET LANGUAGE IS ${expectedLang.toUpperCase()} (${expectedLangNameRu}) WHICH USES ${expectedScript.toUpperCase()} script.`,
        `REWRITE THE ENTIRE COPY ONLY IN ${expectedLangNameRu} (${expectedLang}). DO NOT USE ANY OTHER LANGUAGE in the "content" and "hashtags" fields.`,
        'The "image_prompt" field stays in English per the system rules — only the user-facing copy and hashtags must be re-rendered in the target language.',
        'Preserve the SAME meaning, intent, hook, CTA, and structure as your previous answer — only the surface language changes.',
        'Return ONLY valid JSON in the same shape: { "content": "...", "hashtags": [...], "image_prompt": "..." }.',
      ].join('\n');

      const retryMessages: LLMMessage[] = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(result) },
        { role: 'user', content: correctionMessage },
      ];

      try {
        const retryData = await httpPost<LLMResponse>(
          url,
          {
            intent: 'quality',
            model: 'claude-sonnet-4-6', // FIX_BURN_2: language-coherence rewrite — Sonnet
            input: { messages: retryMessages },
            maxTokens: 4000,
            temperature: 0.6,
          },
          {
            Authorization: `Bearer ${signServiceToken()}`,
            'x-caller-service': 'writer',
            ...(params.tenantId ? { 'x-tenant-id': params.tenantId } : {}),
            'x-activity': 'content_generation',
          },
          { timeout: 60000 },
        );
        const retryOutput = retryData.output || '';
        const retryExtracted = extractPostFromLLMResponse(retryOutput);
        if (retryExtracted.ok) {
          result = retryExtracted.post;
        } else {
          logger.warn(
            { tenantId: params.tenantId, attempt: attempts },
            '[sprint-o] script-retry LLM response failed to parse; reusing previous result for next iteration',
          );
        }
      } catch (httpErr: any) {
        logger.warn(
          { tenantId: params.tenantId, attempt: attempts, error: httpErr?.message },
          '[sprint-o] script-retry HTTP call failed; will count this attempt and proceed',
        );
      }

      detection = detectDominantScript(result.content || '');
    }
  }

  return result;
}
