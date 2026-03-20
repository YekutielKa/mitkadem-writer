/**
 * WRITER KNOWLEDGE LOADER
 * Loads WRITER_BRAIN.md and extracts relevant sections for LLM prompts.
 */
import * as fs from 'fs';
import * as path from 'path';

let _cached: string | null = null;

function loadBrain(): string {
  if (_cached) return _cached;
  try {
    const filePath = path.join(__dirname, 'WRITER_BRAIN.md');
    _cached = fs.readFileSync(filePath, 'utf-8');
    console.log(`[writer-knowledge] Loaded ${_cached.split('\n').length} lines`);
  } catch (err) {
    console.error('[writer-knowledge] Failed to load WRITER_BRAIN.md:', err);
    _cached = '';
  }
  return _cached;
}

/**
 * Returns RULES + key templates for system prompt.
 * Trimmed to ~4000 chars to fit context window efficiently.
 */
export function getWriterKnowledge(): string {
  const brain = loadBrain();
  if (!brain) return '';

  const sections: string[] = [];

  // Section 1: Rules (MUST DO + MUST NOT DO)
  const rules = brain.match(/(# РАЗДЕЛ 1: ЖЕЛЕЗНЫЕ ПРАВИЛА WRITER[\s\S]*?)(?=# РАЗДЕЛ 2:|$)/);
  if (rules) sections.push(rules[1].trim());

  // Section 3.1: Hook formulas (compact)
  const hooks = brain.match(/(## 3\.1 Hook[\s\S]*?)(?=## 3\.2|$)/);
  if (hooks) sections.push(hooks[1].trim());

  // Section 3.3: CTA formulas (compact)
  const ctas = brain.match(/(## 3\.3 CTA[\s\S]*?)(?=## 3\.4|$)/);
  if (ctas) sections.push(ctas[1].trim());

  // Section 6: Anti-patterns
  const anti = brain.match(/(# РАЗДЕЛ 6: АНТИПАТТЕРНЫ[\s\S]*?)(?=# РАЗДЕЛ 7:|# РАЗДЕЛ 8:|$)/);
  if (anti) sections.push(anti[1].trim());

  return sections.join('\n\n---\n\n');
}

/**
 * Returns templates for a specific post type.
 */
export function getTypeTemplates(postType: string): string {
  const brain = loadBrain();
  if (!brain) return '';

  const typeMap: Record<string, string> = {
    'portfolio': '2\\.1 PORTFOLIO',
    'educational': '2\\.2 EDUCATIONAL',
    'testimonial': '2\\.3 TESTIMONIAL',
    'behind_scenes': '2\\.4 BEHIND THE SCENES',
    'promo': '2\\.5 PROMO',
    'personal_story': '2\\.6 PERSONAL STORY',
  };

  const pattern = typeMap[postType] || typeMap['portfolio'];
  const regex = new RegExp(`(## ${pattern}[\\s\\S]*?)(?=## 2\\.|# РАЗДЕЛ 3|$)`);
  const match = brain.match(regex);
  return match ? match[1].trim() : '';
}
