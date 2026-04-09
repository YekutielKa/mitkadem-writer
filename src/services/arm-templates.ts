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
    description:
      'Ultra-short, punchy statement. One thought, one line break max. No emoji, no hashtags. Hook + payoff in under 200 characters total.',
  },
  educational_long: {
    minChars: 500,
    maxChars: 700,
    emoji: 'required',
    cta: 'required',
    hashtags: { min: 5, max: 10 },
    description:
      'Long-form educational post. Teach something the audience does not know. 500-700 chars total. 2-3 emoji integrated naturally. End with a clear CTA. Include 5-10 relevant hashtags at the end.',
  },
  question_hook: {
    minChars: 250,
    maxChars: 400,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'must open with a direct question to the reader',
    description:
      'Medium length. The very first sentence MUST be a question that addresses the reader directly. 250-400 chars. Build curiosity in line 1, give the answer in lines 2-4. End with CTA.',
  },
  testimonial: {
    minChars: 300,
    maxChars: 600,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'first-person customer voice or quoted client story',
    description:
      'Customer testimonial or success story. Written in first-person ("My client said...") or as a direct quote. 300-600 chars. Specific details, not generic praise. End with subtle CTA.',
  },
  before_after: {
    minChars: 250,
    maxChars: 500,
    emoji: 'optional',
    cta: 'required',
    hookStyle: 'before/after framing',
    description:
      'Before/after transformation framing. Describe the "before" state in 1-2 sentences, then the "after". 250-500 chars. End with CTA inviting the reader to start their own transformation.',
  },
  tip_short: {
    maxChars: 300,
    emoji: 'optional',
    hashtags: { max: 0 },
    cta: 'forbidden',
    description:
      'A single useful tip the audience can apply today. Up to 300 chars. No CTA — pure value. No hashtags. May use 0-1 emoji.',
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

const CTA_REGEX =
  /(запиши|записать|book|booking|dm\b|direct|whatsapp|жми|шапке|link in bio|кликни|оставь|оставить заявк|swipe|message me|написать)/i

export function validateAgainstArm(
  arm: StyleArmName,
  caption: string,
  // premium-01/task4-fix-a: writer returns hashtags as a separate field;
  // count them together with any inline ones in the caption.
  hashtags?: string[] | null,
): ValidationResult {
  const c = STYLE_ARMS[arm]
  const violations: string[] = []
  const len = caption.length

  if (c.minChars !== undefined && len < c.minChars) {
    violations.push(`length ${len} < min ${c.minChars}`)
  }
  if (c.maxChars !== undefined && len > c.maxChars) {
    violations.push(`length ${len} > max ${c.maxChars}`)
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
