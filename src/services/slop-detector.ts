/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * Slop detector — deterministic regex-based detection of Russian AI-slop
 * signatures captured from analyzing failed Sonnet 4 outputs on Marina Nails.
 *
 * Architecture: this is the third layer of defense after
 *   1. Positive examples (reference captions, conversation history)
 *   2. Anti-slop knowledge block (system prompt instructions)
 *   3. Slop detector (this file) — catches what slipped through layers 1-2
 *
 * If detected, the writer triggers ONE additional retry with explicit
 * "you violated these patterns" feedback. If retry also fails, accept
 * with a warning log (never block the publishing pipeline).
 */

export interface SlopIssue {
  pattern: string;
  match: string;
  severity: 'high' | 'medium';
  fix: string;
}

interface SlopRule {
  name: string;
  // Use a function so each call gets a fresh regex (avoid /g state bugs)
  test: () => RegExp;
  severity: 'high' | 'medium';
  fix: string;
}

const RU_SLOP_RULES: SlopRule[] = [
  // ── HIGH severity: signature LLM patterns ───────────────────────────────
  {
    name: 'не_X_а_Y',
    // "это не [word], а [word]" — the canonical LLM cliche
    // Variants: "не [word] — а [word]", "не [word], это [word]"
    test: () =>
      /\b(это\s+)?не\s+[а-яё]+(?:[\s,]|\s+[—-]\s+)+(а|это)\s+[а-яё]+/iu,
    severity: 'high',
    fix: 'Перепиши hook конкретной сценой или сенсорной деталью. Никаких "это не X, а Y".',
  },
  {
    name: 'не_случайность',
    test: () => /\bне\s+(случайность|сказка|фантазия|магия|удача|чудо)\b/iu,
    severity: 'high',
    fix: 'Это slop signature. Замени на конкретный факт или сцену.',
  },
  {
    name: 'залог_stuff',
    test: () => /\bзалог\s+[а-яё]+(сти|ия|та)\b/iu,
    severity: 'high',
    fix: 'Замени "залог [абстракции]" на конкретный материал/число/действие.',
  },
  {
    name: 'результат_правильной',
    test: () => /\bрезультат\s+правильн[аоы][гй]о?\s+(техник|подход|работ)/iu,
    severity: 'high',
    fix: 'Замени на конкретное действие с числом или брендом.',
  },
  {
    name: 'generic_cta_zapishis',
    test: () =>
      /\b(запиш(и|ите)сь|записывайтесь)\s+(и\s+)?(оцените|узнайте|почувствуйте|убедитесь)\b/iu,
    severity: 'high',
    fix: 'Замени generic CTA на specific actionable ask ("напиши слово ДИЗАЙН в Direct").',
  },
  {
    name: 'doverte_professionalam',
    test: () => /\bдоверьте\s+(свои\s+)?(ногти|волосы|кожу|красоту)\s+профессионалам\b/iu,
    severity: 'high',
    fix: 'Шаблонная фраза. Удали или замени личным заявлением мастера.',
  },

  // ── MEDIUM severity: generic abstractions ───────────────────────────────
  {
    name: 'professionalniy_podhod',
    test: () => /\bпрофессиональн[аоы][йг][оа]?\s+(подход|стандарт|уровень|сервис)\b/iu,
    severity: 'medium',
    fix: 'Замени абстракцию на конкретный пример (бренд материалов, длительность процедуры).',
  },
  {
    name: 'kachestvo_i_komfort',
    test: () => /\bкачеств[оа]\s+и\s+комфорт/iu,
    severity: 'medium',
    fix: 'Замени на конкретную деталь.',
  },
  {
    name: 'vash_stil',
    test: () => /\bваш(ему?|им)?\s+(стил[ьею]|ритм[ау]?\s+жизни|индивидуальност)/iu,
    severity: 'medium',
    fix: 'Замени "ваш стиль" на конкретное описание реальной клиентки.',
  },
  {
    name: 'preobrazhenie',
    test: () => /\bваш[еа]\s+преображени[ея]/iu,
    severity: 'medium',
    fix: 'Маркетинговый штамп. Удали или замени конкретной историей.',
  },
  {
    name: 'noviy_uroven',
    test: () => /\bновый\s+уровень\b/iu,
    severity: 'medium',
    fix: 'Generic phrase. Замени конкретикой.',
  },
  {
    name: 'unikalnaya_tehnika',
    test: () => /\bуникальн(ая|ой)\s+(техник|методик|подход)/iu,
    severity: 'medium',
    fix: 'Замени "уникальная X" на конкретное название техники или этап работы.',
  },
  {
    name: 'istinnaya_elegantnost',
    test: () => /\bистинн(ая|ой|ую)\s+элегантност/iu,
    severity: 'medium',
    fix: 'Маркетинговый штамп. Удали.',
  },
  {
    name: 'banal_opening_znaete_li',
    test: () => /^знаете\s+ли\s+вы/iu,
    severity: 'medium',
    fix: 'Банальный заход. Начни с конкретного момента, места или прямой речи.',
  },
  {
    name: 'banal_opening_kazhdaya_zhenshchina',
    test: () => /^каждая\s+женщина\s+заслужива/iu,
    severity: 'medium',
    fix: 'Банальный заход. Начни конкретно.',
  },
];

/**
 * Detect AI-slop signatures in a Russian caption. Returns array of issues
 * (empty if clean). HIGH severity issues should trigger immediate retry,
 * MEDIUM severity are warnings.
 */
export function detectSlopRu(caption: string): SlopIssue[] {
  if (!caption) return [];
  const issues: SlopIssue[] = [];
  for (const rule of RU_SLOP_RULES) {
    const regex = rule.test();
    const match = caption.match(regex);
    if (match) {
      issues.push({
        pattern: rule.name,
        match: match[0],
        severity: rule.severity,
        fix: rule.fix,
      });
    }
  }
  return issues;
}

/**
 * Language router. Hebrew/English get empty until native rules are added.
 */
export function detectSlop(caption: string, language: 'ru' | 'he' | 'en'): SlopIssue[] {
  if (language === 'ru') return detectSlopRu(caption);
  // TODO Premium 02: HE rules from native speaker, EN universal rules
  return [];
}

/**
 * Format slop issues as a retry message body that explains to Sonnet what
 * to fix and how. Used by the writer's retry loop.
 */
export function formatSlopRetryMessage(issues: SlopIssue[]): string {
  const high = issues.filter((i) => i.severity === 'high');
  const medium = issues.filter((i) => i.severity === 'medium');

  const lines: string[] = [];
  lines.push('Твой предыдущий ответ содержит AI-slop сигнатуры. Перепиши caption полностью.');
  lines.push('');

  if (high.length > 0) {
    lines.push('## КРИТИЧНЫЕ нарушения (high severity):');
    high.forEach((issue, i) => {
      lines.push(`${i + 1}. Pattern "${issue.pattern}" — найдено: "${issue.match}"`);
      lines.push(`   Что делать: ${issue.fix}`);
    });
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push('## Slop tendencies (medium severity):');
    medium.forEach((issue, i) => {
      lines.push(`${i + 1}. "${issue.match}" — ${issue.fix}`);
    });
    lines.push('');
  }

  lines.push(
    'Перепиши caption так чтобы НИ ОДНА из этих фраз не появилась. Используй конкретные числа, имена, моменты времени, физические детали. Reference examples в начале conversation показывают правильный стиль — match их voice.',
  );
  lines.push('');
  lines.push('Верни ТОЛЬКО валидный JSON с новым caption в поле "content".');

  return lines.join('\n');
}
