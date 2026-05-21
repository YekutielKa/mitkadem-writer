/**
 * SCRIPT DETECTOR — Sprint O Block 2 (2026-05-21).
 *
 * Pure helper that classifies a piece of LLM-generated text by its dominant
 * Unicode script. Used by the writer's post-generation language-coherence
 * retry loop to detect when Opus drifted from the requested target language
 * (e.g. produced Hebrew copy when the AdSet was Russian).
 *
 * Reads only the input string — no DB, no IO, no side effects.
 *
 * Script ranges follow the Unicode Standard:
 *   - Cyrillic:  U+0400–U+04FF + U+0500–U+052F (Cyrillic Supplement)
 *   - Hebrew:    U+0590–U+05FF
 *   - Arabic:    U+0600–U+06FF
 *   - Latin:     U+0041–U+005A, U+0061–U+007A (Basic Latin letters)
 *                + U+00C0–U+024F (Latin-1 Supplement + Extended-A/B letters)
 *
 * Digits, punctuation, whitespace, emoji, and other non-letter code points
 * are excluded from `total`. They do not push the classification toward
 * any script.
 */

export type ScriptName = 'cyrillic' | 'hebrew' | 'latin' | 'arabic' | 'mixed' | 'empty';

export interface ScriptDetection {
  script: ScriptName;
  /** Ratio of dominant-script letters to total-letters, 0..1. */
  confidence: number;
  counts: {
    cyrillic: number;
    hebrew: number;
    latin: number;
    arabic: number;
    total: number;
  };
}

/** Threshold above which one script is considered dominant. */
const DOMINANCE_THRESHOLD = 0.7;

export function detectDominantScript(text: string): ScriptDetection {
  let cyrillic = 0;
  let hebrew = 0;
  let latin = 0;
  let arabic = 0;

  if (text) {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Cyrillic + Cyrillic Supplement
      if (code >= 0x0400 && code <= 0x052f) {
        cyrillic++;
      } else if (code >= 0x0590 && code <= 0x05ff) {
        hebrew++;
      } else if (code >= 0x0600 && code <= 0x06ff) {
        arabic++;
      } else if (
        (code >= 0x0041 && code <= 0x005a) ||
        (code >= 0x0061 && code <= 0x007a) ||
        (code >= 0x00c0 && code <= 0x024f)
      ) {
        latin++;
      }
    }
  }

  const total = cyrillic + hebrew + latin + arabic;
  const counts = { cyrillic, hebrew, latin, arabic, total };

  if (total === 0) {
    return { script: 'empty', confidence: 0, counts };
  }

  let dominant: ScriptName = 'mixed';
  let max = 0;
  if (cyrillic > max) {
    dominant = 'cyrillic';
    max = cyrillic;
  }
  if (hebrew > max) {
    dominant = 'hebrew';
    max = hebrew;
  }
  if (latin > max) {
    dominant = 'latin';
    max = latin;
  }
  if (arabic > max) {
    dominant = 'arabic';
    max = arabic;
  }

  const confidence = max / total;
  if (confidence >= DOMINANCE_THRESHOLD) {
    return { script: dominant, confidence, counts };
  }
  return { script: 'mixed', confidence, counts };
}

/**
 * Map ISO-639-1 language codes to their primary writing script.
 * Covers every language present in Sprint H's country-languages registry
 * (`mitkadem-marketing-brain/src/lib/country-languages.ts`).
 */
export function langToScript(lang: string): 'cyrillic' | 'hebrew' | 'latin' | 'arabic' {
  const l = (lang || '').toLowerCase();
  if (l === 'he' || l === 'iw' || l === 'hebrew') return 'hebrew';
  if (l === 'ru' || l === 'russian' || l === 'uk' || l === 'ukrainian') return 'cyrillic';
  if (l === 'ar' || l === 'arabic') return 'arabic';
  // en, es, de, fr, ca and the generic-fallback all use Latin.
  return 'latin';
}

/**
 * Human-readable language name in Russian (the master-facing UI language
 * for most Mitkadem tenants). Used to construct the retry prompt that
 * tells Opus which language to output.
 */
export function langFullNameRu(lang: string): string {
  const l = (lang || '').toLowerCase();
  if (l === 'he' || l === 'iw' || l === 'hebrew') return 'иврит';
  if (l === 'ru' || l === 'russian') return 'русский';
  if (l === 'ar' || l === 'arabic') return 'арабский';
  if (l === 'en' || l === 'english') return 'английский';
  if (l === 'uk' || l === 'ukrainian') return 'украинский';
  if (l === 'de' || l === 'german') return 'немецкий';
  if (l === 'fr' || l === 'french') return 'французский';
  if (l === 'es' || l === 'spanish') return 'испанский';
  if (l === 'ca' || l === 'catalan') return 'каталонский';
  return l;
}
