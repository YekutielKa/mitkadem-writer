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

REQUIRED:
- One concrete moment, place, object, or tactile detail
- Hook that stops the scroll on its own
- Payoff that reveals what the moment means (implicit, not stated)

FORBIDDEN:
- Abstract nouns ("result", "quality", "approach", "technique")
- "It's not X, it's Y" construction
- Generic brochure-speak
- Anything that could fit on a company homepage verbatim

The writer has many-shot examples of this style for the target niche.
Generalize from those examples — do not copy their vocabulary.`,
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
2. The surprising truth with SPECIFIC technical details — numbers, brands, measurements, timings
3. Vivid metaphor that makes the technical accessible to a layperson
4. Empowering takeaway for the reader (not a sales pitch)

REQUIRED:
- Concrete numbers (time, size, count, percentage)
- Named materials, techniques, or tools (not generic categories)
- One grounding metaphor that a 10-year-old could understand

FORBIDDEN:
- Generic descriptors ("professional", "maximally careful", "premium quality")
- Abstract benefits without mechanism ("lasts longer", "looks better")
- Sales-pitch endings ("book now for best results")

The writer has many-shot examples of this style for the target niche.
Generalize the structure, not the subject matter.`,
  },
  question_hook: {
    minChars: 250,
    maxChars: 450,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'must open with a provocative or uncomfortable question',
    description: `Medium length. First sentence = question that makes reader STOP and think. Not a rhetorical "Do you know why" — a real uncomfortable question.

STRUCTURE:
1. Question that challenges the reader personally (1 sentence)
2. Surprising answer with concrete NUMBERS (2-3 sentences)
3. Proof, example, or evidence
4. Specific, actionable CTA

REQUIRED:
- Question that forces the reader to count, remember, or feel discomfort
- Numbers in the answer (money spent, hours wasted, frequency, percentage)
- Ending CTA with a specific verb and object

FORBIDDEN:
- Rhetorical openers ("Do you know why", "Ever wondered", "Have you noticed")
- Questions with obvious answers
- Vague CTAs ("learn more", "contact us")

The writer has many-shot examples of this style for the target niche.`,
  },
  testimonial: {
    minChars: 300,
    maxChars: 600,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'direct quote from a specific client with their profession and context',
    description: `Client story. Opens with VERBATIM quote. Client has a NAME, PROFESSION, SPECIFIC situation.

STRUCTURE:
1. Direct quote from client (in "quotes" or «guillemets») — first sentence
2. Who this person is (name, profession, life context — never "one of our clients")
3. What specifically was done (named technique, materials, timeline)
4. Human moment at the end (humor, emotion, ongoing relationship)

REQUIRED:
- First-person client quote as the opening
- Named individual with profession or life situation
- Specific measurable detail about the work done
- Human, not-corporate closing (a joke, an ongoing dynamic, a small moment)

FORBIDDEN:
- "One of our clients", "a customer said", or any anonymized framing
- Generic testimonial phrasing ("amazing results", "highly recommend")
- Endings that read like a sales pitch

The writer has many-shot examples of this style for the target niche.`,
  },
  before_after: {
    minChars: 250,
    maxChars: 500,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'single person transformation story with timeline',
    description: `Transformation of ONE specific person over TIME. Not the formula "before: X, after: Y" — a story with milestones.

STRUCTURE:
1. Person's name + situation BEFORE (specific problem, profession, emotion)
2. Timeline with real milestones (first visit, three weeks, two months, half a year)
3. Specific measurable change (numbers, not adjectives)
4. Empowering close that invites the reader to see themselves in the story

REQUIRED:
- A named individual (not "a client")
- At least two time markers in the progression
- At least one measurable, concrete change (size, number, frequency)
- Emotional arc from struggle to confidence

FORBIDDEN:
- "Before / After" formula without narrative
- Adjective-only descriptions of change ("better", "amazing", "transformed")
- Anonymous or composite clients

The writer has many-shot examples of this style for the target niche.`,
  },
  tip_short: {
    maxChars: 300,
    emoji: 'optional',
    hashtags: { max: 0 },
    cta: 'forbidden',
    description: `A tip is actionable knowledge the reader applies THEMSELVES, FOR FREE, AT HOME. It is NOT a service description. It is NOT an ad. It is a useful FACT.

REQUIRED STRUCTURE:
1. Concrete technical fact (one line)
2. HOW this fact works physically, chemically, or mechanically (brief explanation)
3. WHAT the reader should actually do (specific action item)

REQUIRED:
- The tip must be useful even if the reader never becomes a customer
- Named mechanism (temperature, chemistry, technique) behind the fact
- Clear action the reader can take today without buying anything

FORBIDDEN:
- Mentioning your own brand, salon, studio, or name
- Ending with a booking CTA
- Describing "what we do" or "our service"
- Generic benefits ("guarantees quality", "premium materials")
- Textbook-style sentences — write like a knowledgeable friend over coffee

VOICE:
- Conversational, warm, slightly cheeky is fine
- Short sentences, one idea at a time
- Not a manual, not a lecture, not a brochure

The writer has many-shot examples of this style for the target niche.`,
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
