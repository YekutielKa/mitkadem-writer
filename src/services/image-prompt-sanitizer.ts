/**
 * FOUNDATION_FIX Sprint 4 — image_prompt language sanitizer.
 *
 * Why: BrandProfile.businessType (e.g. "Косметология, Тату") is injected raw
 * into the LLM user message. Sonnet then echoes Russian niche labels into the
 * image_prompt JSON field. Imagen/Flux quality degrades significantly on
 * non-English prompts. This is a post-parse safety net — translates known
 * RU/HE niche terms to English first, then strips any residual Cyrillic /
 * Hebrew runs as fallback.
 */

const NICHE_RU_TO_EN: Record<string, string> = {
  'косметология': 'cosmetology',
  'татуаж': 'permanent makeup',
  'татуировка': 'tattoo',
  'тату': 'tattoo',
  'маникюр': 'manicure',
  'педикюр': 'pedicure',
  'парикмахер': 'hair salon',
  'стрижка': 'haircut',
  'окрашивание': 'hair coloring',
  'массаж': 'massage',
  'эпиляция': 'hair removal',
  'депиляция': 'depilation',
  'пилинг': 'peeling',
  'чистка': 'facial cleansing',
  'визаж': 'makeup',
  'мейкап': 'makeup',
  'брови': 'brows',
  'ресницы': 'lashes',
  'ламинирование': 'lamination',
};

const NICHE_HE_TO_EN: Record<string, string> = {
  'מספרה': 'hair salon',
  'קוסמטיקה': 'cosmetology',
  'מניקור': 'manicure',
  'פדיקור': 'pedicure',
  'איפור': 'makeup',
  'קעקוע': 'tattoo',
};

const CYRILLIC_RUN = /[Ѐ-ӿ]+(?:[\s,'\-./"]+[Ѐ-ӿ]+)*/gu;
const HEBREW_RUN = /[֐-׿]+(?:[\s,'\-./"]+[֐-׿]+)*/gu;

export function sanitizeImagePromptLanguage(raw: string): { sanitized: string; mutated: boolean } {
  if (!raw || typeof raw !== 'string') return { sanitized: raw, mutated: false };
  let out = raw;
  for (const [ru, en] of Object.entries(NICHE_RU_TO_EN)) out = out.replace(new RegExp(ru, 'giu'), en);
  for (const [he, en] of Object.entries(NICHE_HE_TO_EN)) out = out.replace(new RegExp(he, 'giu'), en);
  out = out.replace(CYRILLIC_RUN, '').replace(HEBREW_RUN, '');
  out = out.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/  +/g, ' ').replace(/^[ ,]+|[ ,]+$/g, '').trim();
  return { sanitized: out, mutated: out !== raw };
}
