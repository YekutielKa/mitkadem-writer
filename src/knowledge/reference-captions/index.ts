/**
 * Premium Writer 3.0 — Reference caption library index.
 * 93 real captions from research across 9+ niches.
 *
 * getExamples() replaces PW2's getRandomExamples() with niche-aware retrieval.
 */
import { BEAUTY_CAPTIONS } from './captions/beauty';
import { FOOD_CAPTIONS } from './captions/food';
import { PROFESSIONAL_CAPTIONS } from './captions/professional';
import { TECH_SAAS_CAPTIONS } from './captions/tech_saas';
import type { ReferenceCaption, Language, StyleArm } from './types';

export type { ReferenceCaption, Language, StyleArm };

export const ALL_CAPTIONS: ReferenceCaption[] = [
  ...BEAUTY_CAPTIONS,
  ...FOOD_CAPTIONS,
  ...PROFESSIONAL_CAPTIONS,
  ...TECH_SAAS_CAPTIONS,
];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const NICHE_MAP: Record<string, string> = {
  // Beauty
  'nail_studio': 'beauty',
  'hair_salon': 'beauty',
  'brows_lashes': 'beauty',
  'makeup_artist': 'beauty',
  'cosmetologist': 'beauty',
  // Food
  'restaurant': 'food',
  'cafe': 'food',
  'bakery': 'food',
  // Fitness
  'personal_trainer': 'fitness',
  'yoga_studio': 'fitness',
  'gym': 'fitness',
  // Health
  'dentist': 'health',
  'therapist': 'health',
  'psychologist': 'health',
  // Creative
  'photographer': 'creative',
  'interior_designer': 'creative',
  'graphic_designer': 'creative',
  // Professional
  'lawyer': 'professional',
  'accountant': 'professional',
  'consultant': 'professional',
  // Tech
  'saas': 'tech_saas',
  'ai_startup': 'tech_saas',
  'tech_company': 'tech_saas',
};

export function mapNicheToCategory(niche: string): string {
  return NICHE_MAP[niche] || 'universal';
}

/**
 * Retrieve reference captions for many-shot prompting.
 *
 * Priority:
 *   1. Exact niche + language + arm
 *   2. Same niche + language (any arm)
 *   3. Universal patterns in same language
 *   4. Same niche any language (cross-language)
 *   5. Universal any language
 */
export function getExamples(params: {
  niche: string;
  language: Language;
  arm?: string;
  n?: number;
}): ReferenceCaption[] {
  const { niche, language, arm, n = 4 } = params;
  const category = mapNicheToCategory(niche);

  // 1. Try exact match: niche + language
  let pool = ALL_CAPTIONS.filter(
    (c) => c.niche === category && c.language === language,
  );

  // Filter by arm if specified and enough matches
  if (arm && arm !== 'any') {
    const armMatch = pool.filter((c) => c.styleArm === arm);
    if (armMatch.length >= 2) pool = armMatch;
  }

  // 2. If pool too small — add universal patterns in same language
  if (pool.length < n) {
    const universal = ALL_CAPTIONS.filter(
      (c) => c.niche === 'universal' && c.language === language,
    );
    pool = [...pool, ...universal];
  }

  // 3. If still too small — add same niche any language
  if (pool.length < n) {
    const anyLang = ALL_CAPTIONS.filter((c) => c.niche === category);
    const ids = new Set(pool.map((c) => c.id));
    const extra = anyLang.filter((c) => !ids.has(c.id));
    pool = [...pool, ...extra];
  }

  // 4. If STILL too small — add universal any language
  if (pool.length < n) {
    const ids = new Set(pool.map((c) => c.id));
    const extra = ALL_CAPTIONS.filter(
      (c) => c.niche === 'universal' && !ids.has(c.id),
    );
    pool = [...pool, ...extra];
  }

  return shuffle(pool).slice(0, n);
}

/**
 * Synthesize a brief for a reference caption example.
 * Niche-aware (not hardcoded "маникюрный салон" like PW2).
 */
export function synthesizeBriefForExample(
  example: ReferenceCaption,
  tenantNiche?: string,
): string {
  const nicheLabel = tenantNiche || example.niche;
  const armDesc: Record<string, string> = {
    short_punchy: 'короткий, ёмкий, без воды',
    educational_long: 'обучающий, длинный, с конкретикой',
    question_hook: 'с открытием через вопрос',
    testimonial: 'история одного клиента, прямая речь',
    before_after: 'трансформация одного человека во времени',
    tip_short: 'короткий полезный совет, не реклама',
    manifesto: 'философия / манифест бренда',
    origin_story: 'история основателя / как началось',
    brand_voice: 'голос бренда / позиционирование',
    craft_philosophy: 'философия ремесла',
    any: 'свободный стиль',
  };
  const style = armDesc[example.styleArm] || 'свободный стиль';

  if (example.language === 'ru') {
    return `Напиши Instagram caption для премиум ${nicheLabel} бренда. Стиль: ${style}. Аудитория: требовательные клиенты с высоким доходом.`;
  }
  if (example.language === 'he') {
    return `כתבי כיתוב לאינסטגרם למותג פרימיום בתחום ${nicheLabel}. סגנון: ${style}. קהל: לקוחות תובעניים עם הכנסה גבוהה.`;
  }
  return `Write a premium Instagram caption for a ${nicheLabel} brand. Style: ${style}. Audience: discerning high-income clients.`;
}

// Backwards compatibility alias for PW2 code that uses getRandomExamples
export function getRandomExamples(
  language: Language,
  arm: StyleArm | string,
  n: number = 3,
): ReferenceCaption[] {
  return getExamples({ niche: 'universal', language, arm, n });
}
