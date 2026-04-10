/**
 * SMART PHASE PREMIUM 01 — Task 4b
 * Style arm definitions, constraints, prompt fragments, validators.
 *
 * Design notes:
 *   - Style arms are ORTHOGONAL to topic arms (carousel_before_after etc).
 *     A topic answers "what is the post about", a style answers "how is it
 *     formatted". Variability across styles is what feeds recomputeHints.
 *   - Constraints are validated AFTER LLM generation. On failure → 1 retry
 *     with explicit feedback in the prompt. On second failure → log warn
 *     and accept anyway (never block the publish pipeline).
 */

export type StyleArmName =
  | 'short_punchy'
  | 'educational_long'
  | 'question_hook'
  | 'testimonial'
  | 'before_after'
  | 'tip_short'

export interface ArmConstraints {
  minChars?: number
  maxChars?: number
  emoji?: 'forbidden' | 'required' | 'optional'
  hashtags?: { min?: number; max?: number }
  cta?: 'forbidden' | 'required' | 'optional'
  hookStyle?: string
  description: string
}

export const STYLE_ARMS: Record<StyleArmName, ArmConstraints> = {
  short_punchy: {
    maxChars: 200,
    emoji: 'forbidden',
    hashtags: { max: 0 },
    cta: 'optional',
    description: `Ultra-short sensory snapshot. One concrete scene or moment. No emoji, no hashtags.

STRUCTURE: Hook (concrete image) → Payoff (what it means) in under 200 chars total.

GOOD EXAMPLE:
"Покрытие, которое не сдаётся. Три недели, ежедневные перчатки в Ихилов, ни одного скола."

BAD EXAMPLE (generic brochure):
"3-4 недели без сколов — не удача, а результат аппаратного маникюра с авторским дизайном."

ЗАПРЕЩЕНО: абстракции ("результат техники", "залог стойкости"), конструкция "не X, а Y".
Используй: конкретный момент, место, объект, тактильную деталь.`,
  },
  educational_long: {
    minChars: 500,
    maxChars: 700,
    emoji: 'required',
    cta: 'required',
    hashtags: { min: 5, max: 10 },
    description: `Long-form educational post that TEACHES something specific the audience didn't know. 500-700 chars. 2-3 emoji. CTA at end. 5-10 hashtags.

STRUCTURE:
1. Myth or common misconception (1-2 sentences)
2. The surprising truth with SPECIFIC technical details (numbers, brands, measurements)
3. Vivid metaphor that makes the technical accessible
4. Empowering takeaway for the reader (not a sales pitch)

GOOD EXAMPLE:
"Все думают что для долгого маникюра главное — гель-лак. Это неправда. Самый стойкий маникюр зависит от того что происходит за 4 минуты ДО нанесения — матировка 240 грит, обезжиривание двукратное. Дорогой гель-лак на плохой подготовке — это обои на сырой стене."

BAD EXAMPLE:
"Аппаратная техника позволяет работать максимально аккуратно. Вместе с профессиональной базой покрытие сохраняет блеск и прочность на долгий срок."

ЗАПРЕЩЕНО: "профессиональная база", "максимально аккуратно", "сохраняет блеск". Назови КОНКРЕТНЫЙ материал, КОНКРЕТНУЮ технику, КОНКРЕТНОЕ время.`,
  },
  question_hook: {
    minChars: 250,
    maxChars: 400,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'must open with a provocative or uncomfortable question',
    description: `Medium length. First sentence = question that makes reader STOP and think. Not a rhetorical "Знаете почему" — a real uncomfortable question.

STRUCTURE:
1. Question that challenges (1 sentence)
2. Surprising answer with NUMBERS (2-3 sentences)
3. Concrete proof or example
4. Specific CTA ("напиши слово X в Direct")

GOOD EXAMPLE:
"Сколько раз в этом году ты переделывала маникюр потому что он не дожил до следующей записи? Среднее число у моих новых клиенток: 7 раз за полгода. Это около 1400 шекелей в год."

BAD EXAMPLE:
"Знаете, почему маникюр часто не держится? Всё дело в технике и материалах."

ЗАПРЕЩЕНО: "Знаете почему/что/как" — это банальный hook. Начни с вопроса который ЗАСТАВЛЯЕТ считать, вспоминать, чувствовать дискомфорт.`,
  },
  testimonial: {
    minChars: 300,
    maxChars: 600,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'direct quote from a specific client with their profession and context',
    description: `Client story. Opens with VERBATIM quote. Client has a NAME, PROFESSION, SPECIFIC situation.

STRUCTURE:
1. Direct quote from client (in «кавычках» or "quotes") — first sentence
2. Who this person is (profession, life context — NOT "одна клиентка")
3. What specifically was done (technique, materials, timeline)
4. Human moment at the end (humor, emotion, ongoing relationship)

GOOD EXAMPLE:
"«Я кажется впервые за пять лет не помню когда делала ногти». Алина — медсестра в Ихилов, 12 часов в перчатках. Мы попробовали трёхслойную базу Kodi с просушкой между слоями. Сейчас она пишет раз в месяц — проверяет что я не зазналась."

BAD EXAMPLE:
"«Мой маникюр держится уже 3 недели» — так говорит наша клиентка. Аппаратная техника и трёхслойное нанесение дают стойкий результат."

ЗАПРЕЩЕНО: "наша клиентка", "одна из клиенток" — дай ИМЯ и ПРОФЕССИЮ. "Стойкий результат" — абстракция, назови конкретный срок и ситуацию.`,
  },
  before_after: {
    minChars: 250,
    maxChars: 500,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'single person transformation story with timeline',
    description: `Transformation of ONE specific person over TIME. Not formula "до: X, после: Y" — a story with milestones.

STRUCTURE:
1. Person's name + situation BEFORE (specific problem, profession, emotion)
2. Timeline with milestones (first visit, 3 weeks later, 2 months later)
3. Specific measurable change (not "сияние", but "ногти отросли на 1.5мм")
4. Empowering close (if you think it's impossible — she thought so too)

GOOD EXAMPLE:
"Маша пришла в феврале. Хайтек, презентации каждую среду, ногти 2мм — грызла. Первый визит — восстанавливающее покрытие без иллюзий. Через три недели ногти +1.5мм. К маю — нормальная длина. К июлю — попросила дизайн."

BAD EXAMPLE:
"До: сколы и потёртости. После: ровное покрытие и сияние без потерь."

ЗАПРЕЩЕНО: формула "До/После" без истории. Должна быть КОНКРЕТНАЯ история ОДНОГО человека с ВРЕМЕННОЙ шкалой.`,
  },
  tip_short: {
    maxChars: 300,
    emoji: 'optional',
    hashtags: { max: 0 },
    cta: 'forbidden',
    description: `Tip = actionable знание которое читатель применит САМ, БЕСПЛАТНО, ДОМА. Это НЕ описание услуги. Это НЕ реклама. Это полезный FACT.

ОБЯЗАТЕЛЬНАЯ СТРУКТУРА:
1. Конкретный technical fact (одна строка)
2. КАК этот fact работает физически/химически (объяснение)
3. ЧТО конкретно делать читателю (action item)

ПРАВИЛЬНЫЙ TIP:
"Гель-лак трескается чаще не от носки, а от перепада температур. Горячая вода при мытье посуды → холодные руки на воздухе → микротрещины в покрытии. Перчатки при мытье — самое скучное что ты можешь сделать для маникюра. И самое эффективное."

НЕПРАВИЛЬНЫЙ TIP (реклама, не tip):
"Аппаратный маникюр с авторским градиентом в Marina Nails держится 3-4 недели без сколов. Премиальные материалы гарантируют стойкость."

ЗАПРЕЩЕНО:
❌ Упоминать своё имя/салон/бренд
❌ Заканчивать призывом записаться
❌ Описывать "что мы делаем"
❌ "гарантирует стойкость", "премиальные материалы"

ВИДИШЬ РАЗНИЦУ? Tip = fact + физика + action. Реклама = описание услуги + абстракция.
Ты пишешь TIP, а не рекламу.`,
  },
}

export function isStyleArmName(value: string | null | undefined): value is StyleArmName {
  return !!value && value in STYLE_ARMS
}

/**
 * Build a strict constraint block to inject into the system prompt.
 * The wording is intentionally directive — LLMs respect "MUST"/"FORBIDDEN".
 */
export function buildArmPromptFragment(arm: StyleArmName): string {
  const c = STYLE_ARMS[arm]
  const lines: string[] = []
  lines.push(`=== STYLE ARM: ${arm} (STRICT — VIOLATIONS WILL BE REJECTED) ===`)
  lines.push(c.description)
  lines.push('')
  lines.push('HARD CONSTRAINTS:')
  if (c.minChars !== undefined) lines.push(`- Caption MUST be at least ${c.minChars} characters`)
  if (c.maxChars !== undefined) lines.push(`- Caption MUST be at most ${c.maxChars} characters (this is a hard ceiling)`)
  if (c.emoji === 'forbidden') lines.push('- ABSOLUTELY NO EMOJI in the caption')
  if (c.emoji === 'required') lines.push('- Caption MUST contain at least 2 emoji integrated naturally')
  if (c.hashtags?.max === 0) lines.push('- ZERO hashtags. Do not output any "#" symbol in the caption.')
  if (c.hashtags?.min) lines.push(`- At least ${c.hashtags.min} hashtags at the end of the caption`)
  if (c.hashtags?.max && c.hashtags.max > 0) lines.push(`- No more than ${c.hashtags.max} hashtags`)
  if (c.cta === 'forbidden') lines.push('- NO call-to-action. Pure value, no asks.')
  if (c.cta === 'required') lines.push('- MUST end with a clear, specific call-to-action (book/DM/click)')
  if (c.hookStyle) lines.push(`- Opening style: ${c.hookStyle}`)
  // premium-01/task4-fix-a: hook diversity — forbid verbatim brief opening
  lines.push('- The first sentence MUST NOT be a literal copy of the brief topic. Re-frame it: a hook, an angle, an emotion — never the same wording the brief uses.')
  lines.push('=== END STYLE ARM ===')
  return lines.join('\n')
}

export interface ValidationResult {
  ok: boolean
  violations: string[]
}

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/u

// premium-01/task4-fix-e: stem-based CTA matching — catches natural Russian
// inflections (пиши/пишите/напиши, приходи/приходите, позвон/звоните, etc.)
const CTA_REGEX =
  /(запис|пиш|напиш|приход|позвон|звон|брон|заказ|купи|кликни|жми|шапке|оставь|оставить заявк|book|booking|dm\b|direct|директ|whatsapp|link in bio|swipe|message me|тор\b|תור|להזמין|לקבוע)/i

export function validateAgainstArm(
  arm: StyleArmName,
  caption: string,
  // premium-01/task4-fix-a: writer returns hashtags as a separate field;
  // count them together with any inline ones in the caption.
  hashtags?: string[] | null,
): ValidationResult {
  const c = STYLE_ARMS[arm]
  const violations: string[] = []
  // premium-01/task4-fix-e: length means prose body, NOT body+hashtags.
  // Strip inline #tags before measuring so educational_long (max 700) isn't
  // failed by Sonnet appending 9 hashtags worth ~100 chars at the end.
  const proseBody = caption.replace(/#\w+/g, '').trim()
  const len = proseBody.length

  if (c.minChars !== undefined && len < c.minChars) {
    violations.push(`length ${len} < min ${c.minChars} (prose body, hashtags excluded)`)
  }
  if (c.maxChars !== undefined && len > c.maxChars) {
    violations.push(`length ${len} > max ${c.maxChars} (prose body, hashtags excluded)`)
  }

  const hasEmoji = EMOJI_REGEX.test(caption)
  if (c.emoji === 'forbidden' && hasEmoji) violations.push('emoji forbidden but found')
  if (c.emoji === 'required' && !hasEmoji) violations.push('emoji required but absent')

  const inlineHashtagCount = (caption.match(/#\w+/g) || []).length
  const fieldHashtagCount = Array.isArray(hashtags) ? hashtags.length : 0
  const hashtagCount = inlineHashtagCount + fieldHashtagCount
  if (c.hashtags?.max !== undefined && hashtagCount > c.hashtags.max) {
    violations.push(`hashtags ${hashtagCount} > max ${c.hashtags.max}`)
  }
  if (c.hashtags?.min !== undefined && hashtagCount < c.hashtags.min) {
    violations.push(`hashtags ${hashtagCount} < min ${c.hashtags.min}`)
  }

  const hasCta = CTA_REGEX.test(caption)
  if (c.cta === 'forbidden' && hasCta) violations.push('CTA forbidden but detected')
  if (c.cta === 'required' && !hasCta) violations.push('CTA required but absent')

  return { ok: violations.length === 0, violations }
}

export function buildRetryFragment(arm: StyleArmName, violations: string[]): string {
  return [
    '⚠️ YOUR PREVIOUS ATTEMPT VIOLATED THESE STYLE ARM CONSTRAINTS:',
    ...violations.map((v) => `  - ${v}`),
    `Re-generate the caption strictly following the ${arm} arm rules above. No deviations.`,
  ].join('\n')
}
