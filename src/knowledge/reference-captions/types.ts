/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * Reference caption type used by the many-shot prompt builder.
 *
 * Each reference caption is a curated example of premium copy that
 * Sonnet should learn to imitate via conversation-history few-shot.
 */

export type Language = 'ru' | 'he' | 'en';

export type StyleArm =
  | 'short_punchy'
  | 'educational_long'
  | 'question_hook'
  | 'testimonial'
  | 'before_after'
  | 'tip_short'
  | 'any';

export interface ReferenceCaption {
  source: string;
  language: Language;
  style_arm: StyleArm;
  hook_technique: string;
  caption: string;
  techniques_used: string[];
  why_it_works: string;
  word_count: number;
  hashtag_count: number;
}
