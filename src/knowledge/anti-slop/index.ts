/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * Anti-slop knowledge — language router.
 */
import { ANTI_SLOP_RU } from './ru';
import { ANTI_SLOP_HE } from './he';
import { ANTI_SLOP_EN } from './en';
import type { Language } from '../reference-captions';

export { ANTI_SLOP_RU, ANTI_SLOP_HE, ANTI_SLOP_EN };

export function getAntiSlopBlock(language: Language): string {
  switch (language) {
    case 'ru':
      return ANTI_SLOP_RU;
    case 'he':
      return ANTI_SLOP_HE;
    case 'en':
      return ANTI_SLOP_EN;
    default:
      return ANTI_SLOP_EN;
  }
}
