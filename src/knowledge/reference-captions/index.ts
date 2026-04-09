/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * Reference caption library — root index.
 *
 * Provides getRandomExamples() for the many-shot prompt builder.
 * Selection priority:
 *   1. Captions matching (language, arm) exactly
 *   2. Fallback: any caption in same language
 *   3. Final fallback: any caption (English)
 */
import { RU_CAPTIONS } from './ru';
import { HE_CAPTIONS } from './he';
import { EN_CAPTIONS } from './en';
import type { ReferenceCaption, Language, StyleArm } from './types';

export type { ReferenceCaption, Language, StyleArm };

export const ALL_CAPTIONS: ReferenceCaption[] = [
  ...RU_CAPTIONS,
  ...HE_CAPTIONS,
  ...EN_CAPTIONS,
];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick N reference captions for the many-shot prompt.
 *
 * Strategy:
 *   1. Try exact (language, arm) match
 *   2. If fewer than N, fall back to all captions in the language
 *   3. If still fewer than N, return what we have (no English mixing —
 *      cross-language examples confuse Sonnet's voice matching)
 */
export function getRandomExamples(
  language: Language,
  arm: StyleArm,
  n: number = 3,
): ReferenceCaption[] {
  const exactMatch = ALL_CAPTIONS.filter(
    (c) => c.language === language && c.style_arm === arm,
  );

  if (exactMatch.length >= n) {
    return shuffle(exactMatch).slice(0, n);
  }

  // Fall back to all captions in the same language
  const sameLanguage = ALL_CAPTIONS.filter((c) => c.language === language);
  if (sameLanguage.length >= n) {
    // Put exact matches first, then fill with others from same language
    const others = sameLanguage.filter((c) => c.style_arm !== arm);
    return [...shuffle(exactMatch), ...shuffle(others)].slice(0, n);
  }

  // Last resort: return what we have in the language (do NOT mix languages)
  return shuffle(sameLanguage);
}

/**
 * Synthesize a fake user-message brief that could plausibly have produced
 * the given reference caption. Used in many-shot conversation history so
 * Sonnet sees realistic (brief → premium caption) pairs.
 */
export function synthesizeBriefForExample(example: ReferenceCaption): string {
  const armDescriptions: Record<string, string> = {
    short_punchy: 'короткий, ёмкий, без воды',
    educational_long: 'обучающий, длинный, с конкретикой',
    question_hook: 'с открытием через вопрос',
    testimonial: 'история одного клиента, прямая речь',
    before_after: 'трансформация одного человека во времени',
    tip_short: 'короткий полезный совет, не реклама',
    any: 'свободный стиль',
  };
  const styleDesc = armDescriptions[example.style_arm] || 'свободный стиль';

  if (example.language === 'ru') {
    return `Напиши Instagram caption для премиум маникюрного салона в Тель-Авиве. Стиль: ${styleDesc}. Тема: качество и стойкость покрытия. Аудитория: занятые женщины 30-45 с высоким доходом.`;
  }
  if (example.language === 'he') {
    return `כתבי כיתוב לאינסטגרם לסטודיו מניקור פרימיום בתל אביב. סגנון: ${styleDesc}. נושא: איכות ועמידות. קהל: נשים עסוקות בנות 30-45.`;
  }
  return `Write an Instagram caption for a premium nail studio in Tel Aviv. Style: ${styleDesc}. Topic: quality and durability of the manicure. Audience: busy professional women 30-45.`;
}
