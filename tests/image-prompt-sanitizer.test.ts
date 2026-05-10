/**
 * FOUNDATION_FIX Sprint 4 — sanitizeImagePromptLanguage unit tests.
 *
 * Standalone runner (matches tests/llm-parser.test.ts pattern):
 *   cd ~/projects/mitkadem-writer && npx ts-node tests/image-prompt-sanitizer.test.ts
 */

import assert from 'node:assert/strict';
import { sanitizeImagePromptLanguage } from '../src/services/image-prompt-sanitizer';

interface Case {
  name: string;
  input: string;
  expectSanitized: string;
  expectMutated: boolean;
}

const cases: Case[] = [
  {
    name: '1. Marina production literal — "косметология, тату" RU niche labels translated',
    input: 'Behind the scenes professional workspace, косметология, тату at work, authentic atmosphere, NO text NO letters NO words NO logos on image',
    expectSanitized: 'Behind the scenes professional workspace, cosmetology, tattoo at work, authentic atmosphere, NO text NO letters NO words NO logos on image',
    expectMutated: true,
  },
  {
    name: '2. All-English image_prompt — passes through unchanged (no mutation)',
    input: 'Photorealistic close-up of a manicured hand, soft natural daylight, 85mm lens, NO text NO logos',
    expectSanitized: 'Photorealistic close-up of a manicured hand, soft natural daylight, 85mm lens, NO text NO logos',
    expectMutated: false,
  },
  {
    name: '3. Capitalized Russian niche — "Косметология" → "cosmetology" (case-insensitive)',
    input: 'Professional Косметология studio, premium aesthetic',
    expectSanitized: 'Professional cosmetology studio, premium aesthetic',
    expectMutated: true,
  },
  {
    name: '4. Hebrew niche term — "מספרה" → "hair salon"',
    input: 'Professional מספרה interior, modern Tel Aviv aesthetic',
    expectSanitized: 'Professional hair salon interior, modern Tel Aviv aesthetic',
    expectMutated: true,
  },
  {
    name: '5. Mixed RU + HE in same prompt — both translated',
    input: 'Premium косметология and קוסמטיקה workspace, soft lighting',
    expectSanitized: 'Premium cosmetology and cosmetology workspace, soft lighting',
    expectMutated: true,
  },
  {
    name: '6. Russian inflection on mapped root — "парикмахерская" → "hair salon" (substring match + suffix strip)',
    input: 'Professional парикмахерская workspace, clean style',
    expectSanitized: 'Professional hair salon workspace, clean style',
    expectMutated: true,
  },
  {
    name: '6b. Truly unknown Russian word — stripped via Cyrillic-run fallback',
    input: 'Modern фотостудия environment, premium feel',
    expectSanitized: 'Modern environment, premium feel',
    expectMutated: true,
  },
  {
    name: '7. Empty string — handled gracefully',
    input: '',
    expectSanitized: '',
    expectMutated: false,
  },
  {
    name: '8. Multiple terms via comma — "маникюр, педикюр, тату" → all translated',
    input: 'Premium service: маникюр, педикюр, тату in one studio',
    expectSanitized: 'Premium service: manicure, pedicure, tattoo in one studio',
    expectMutated: true,
  },
  {
    name: '9. Cyrillic-only string — entirely stripped',
    input: 'красота и стиль',
    expectSanitized: '',
    expectMutated: true,
  },
  {
    name: '10. "TaTToo" English-Latin — preserved (no Cyrillic match)',
    input: 'Tattoo studio with photorealistic lighting',
    expectSanitized: 'Tattoo studio with photorealistic lighting',
    expectMutated: false,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  try {
    const { sanitized, mutated } = sanitizeImagePromptLanguage(c.input);
    assert.equal(sanitized, c.expectSanitized, `[${c.name}] sanitized mismatch`);
    assert.equal(mutated, c.expectMutated, `[${c.name}] mutated mismatch`);
    console.log(`PASS  ${c.name}`);
    pass++;
  } catch (err) {
    console.log(`FAIL  ${c.name}`);
    console.log(`  ${(err as Error).message}`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
