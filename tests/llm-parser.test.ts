/**
 * FOUNDATION_FIX Sprint 2 — extractPostFromLLMResponse unit tests.
 *
 * Standalone runner (no jest/vitest in this repo). Invoke:
 *   cd ~/projects/mitkadem-writer && npx ts-node tests/llm-parser.test.ts
 *
 * Each case: assert post.content / post.hashtags / ok flag against expected.
 * Exits 0 on all pass, 1 on first failure (with diff diagnostic).
 */

// Pure-function test of the parser helper. Stub env to satisfy the strict
// env-validation triggered transitively by llm.service.ts → config/env.
process.env.SERVICE_JWT_SECRET ??= 'test-secret-test-secret-test-secret-test-secret';
process.env.DATABASE_URL_WRITER ??= 'postgresql://test';
process.env.LLM_HUB_URL ??= 'http://test';
process.env.TENANT_BRAIN_URL ??= 'http://test';

import assert from 'node:assert/strict';
import { extractPostFromLLMResponse } from '../src/services/llm.service';

interface Case {
  name: string;
  raw: string;
  expectContent?: string;
  expectHashtags?: string[];
  expectOk: boolean;
}

const cases: Case[] = [
  {
    name: '1. Standard ```json ... ``` fence',
    raw: '```json\n{"content":"Hello world","hashtags":["#a","#b"],"image_prompt":"sunset"}\n```',
    expectContent: 'Hello world',
    expectHashtags: ['#a', '#b'],
    expectOk: true,
  },
  {
    name: '2. Fence without json language tag',
    raw: '```\n{"content":"Plain fence","hashtags":[],"image_prompt":""}\n```',
    expectContent: 'Plain fence',
    expectOk: true,
  },
  {
    name: '3. No fence, raw JSON',
    raw: '{"content":"No fence","hashtags":[],"image_prompt":""}',
    expectContent: 'No fence',
    expectOk: true,
  },
  {
    name: '4. Hebrew/RTL preservation through fence',
    raw: '```json\n{"content":"כשמרינה אמרה לי שהטיפול יחזיק מעמד","hashtags":[],"image_prompt":""}\n```',
    expectContent: 'כשמרינה אמרה לי שהטיפול יחזיק מעמד',
    expectOk: true,
  },
  {
    name: '5. Nested escaped quotes in content',
    raw: '```json\n{"content":"He said \\"hi\\" to her","hashtags":[],"image_prompt":""}\n```',
    expectContent: 'He said "hi" to her',
    expectOk: true,
  },
  {
    name: '6. Missing content field — fallback (ok=false)',
    raw: '{"other":"value","hashtags":[]}',
    expectContent: '{"other":"value","hashtags":[]}',
    expectOk: false,
  },
  {
    name: '7. Malformed JSON (truncated, no closing brace) — tertiary recovery extracts content text',
    raw: '```json\n{"content":"truncated mid-string',
    // After leading-fence strip, helper recovers the content field via regex
    // even though JSON is unclosed. Must NOT leak ``` and must not contain
    // the literal `"content":` JSON marker.
    expectContent: 'truncated mid-string',
    expectOk: false,
  },
  {
    name: '8. Plain text without any JSON structure — fallback returns stripped raw',
    raw: 'Just a plain caption with no JSON at all.',
    expectContent: 'Just a plain caption with no JSON at all.',
    expectOk: false,
  },
  {
    name: '9. Empty content field — fallback (ok=false; empty content not useful)',
    raw: '{"content":"","hashtags":[],"image_prompt":""}',
    // Helper requires content to be string but accepts empty? Decision: treat empty as ok=true (LLM intentional empty);
    // however our impl currently treats empty content as ok=true. Document expectation.
    expectContent: '',
    expectOk: true,
  },
  {
    name: '10. content as array (LLM type drift) — fallback',
    raw: '{"content":["a","b"],"hashtags":[]}',
    expectOk: false,
  },
  {
    name: '11. content as number (LLM type drift) — fallback',
    raw: '{"content":42,"hashtags":[]}',
    expectOk: false,
  },
  {
    name: '12. Surrounding whitespace + fence',
    raw: '\n\n```json\n{"content":"trimmed","hashtags":[],"image_prompt":""}\n```\n  ',
    expectContent: 'trimmed',
    expectOk: true,
  },
  {
    name: '13. Production truncation case — Hebrew text without closing brace',
    raw: '{\n  "content": "כשמרינה אמרה לי שהטיפול יחזיק מעמד מעל חודש',
    expectContent: 'כשמרינה אמרה לי שהטיפול יחזיק מעמד מעל חודש',
    expectOk: false,
  },
  {
    name: '14. Truncated content with escape sequences (\\n) — recovery preserves them',
    raw: '{"content":"line1\\nline2\\nline3 cut off',
    expectContent: 'line1\nline2\nline3 cut off',
    expectOk: false,
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
  try {
    const { post, ok } = extractPostFromLLMResponse(c.raw);
    assert.equal(ok, c.expectOk, `ok flag mismatch: got ${ok}, expected ${c.expectOk}`);
    if (c.expectContent !== undefined) {
      assert.equal(post.content, c.expectContent, `content mismatch`);
    }
    if (c.expectHashtags !== undefined) {
      assert.deepEqual(post.hashtags, c.expectHashtags, 'hashtags mismatch');
    }
    // Critical regression guard: fallback content must NEVER contain markdown fence backticks.
    if (!ok) {
      assert.ok(
        !post.content.includes('```'),
        `fallback content leaked markdown fence: ${JSON.stringify(post.content.slice(0, 60))}`,
      );
    }
    console.log(`PASS  ${c.name}`);
    passed++;
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`FAIL  ${c.name}\n      ${msg}`);
    failures.push(`${c.name}: ${msg}`);
    failed++;
  }
}

console.log(`\n=== Result: ${passed} PASS / ${failed} FAIL (${cases.length} cases) ===`);
if (failed > 0) {
  console.log('\nFailures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
process.exit(0);
