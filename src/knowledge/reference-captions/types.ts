/**
 * Premium Writer 3.0 — Reference caption types.
 * Extended interface supporting 93 real captions from research.
 */

export type Language = 'ru' | 'he' | 'en';

export type StyleArm =
  | 'short_punchy'
  | 'educational_long'
  | 'question_hook'
  | 'testimonial'
  | 'before_after'
  | 'tip_short'
  | 'manifesto'
  | 'origin_story'
  | 'brand_voice'
  | 'craft_philosophy'
  | 'anti_pattern'
  | 'any';

export interface ReferenceCaption {
  id: string;
  source: string;
  sourceUrl?: string;
  author?: string;
  platform: string;
  language: Language;
  niche: string;
  styleArm: string;
  hookTechnique: string;
  caption: string;
  whyItWorks: string;
  notablePhrases: string[];
  universalTechniques: string[];
  applicabilityToMitkadem?: string;
  wordCount: number;
  emojiCount: number;
  hashtagCount: number;
  hasCta: boolean;
  ctaType?: string;
}
