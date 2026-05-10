/**
 * FOUNDATION_FIX Sprint 5 — BrandProfile coherence validator (defensive layer).
 *
 * Why: BrandProfile is the canonical source-of-truth for tenant brand identity
 * (per MITKADEM_PROGRAM/05_BRAND_IDENTITY_SOURCE_OF_TRUTH.md). The Discovery wizard
 * is the canonical write-path; direct DB seeds (test tenants per DEC_102) bypass
 * the wizard's per-topic gates and can leave the row in an internally inconsistent
 * state. This validator runs at read-time on every BrandProfile load, surfaces
 * incoherence as a `learning_event` warning, and is **non-blocking** — the
 * downstream load-path proceeds unconditionally.
 *
 * Tenant-agnostic: rules apply universally to BrandProfile content; no per-tenant
 * special-casing inside the validator. Call sites are responsible for skip-guarding
 * the Mitkadem self-tenant (`e9efe9c9-fca4-4c38-9d68-c551e8bad4ae`) — the validator
 * itself stays pure and deterministic on profile content.
 *
 * Defensive: input may be partial / NULL / missing fields (raw SQL `$queryRaw<any[]>`
 * returns may return undefined for absent columns). Each check tolerates missing
 * inputs and returns no issue rather than throwing.
 */

/**
 * Subset of BrandProfile fields the validator inspects. Defined locally rather
 * than imported because mb loads BrandProfile via raw SQL into plain objects
 * (no shared TypeScript interface across services).
 */
export interface BrandProfileLike {
  businessName?: string | null;
  businessType?: string | null;
  city?: string | null;
  country?: string | null;
  languages?: string[] | null;
  targetAudience?: string | null;
  positioningStyle?: string | null;
  tagline?: string | null;
  uniqueValue?: string | null;
  preferredTone?: string | null;
  rawOnboardingState?: Record<string, unknown> | null;
}

export interface BrandCoherenceIssue {
  field: string;
  severity: 'warn' | 'info';
  detail: string;
}

export interface BrandCoherenceResult {
  coherent: boolean;
  issues: BrandCoherenceIssue[];
}

const CYRILLIC_OR_HEBREW = /[Ѐ-ӿ֐-׿]/;

// Tenant-agnostic semantic-cluster pairs. Extend the map (NAME_NICHE_CONFLICTS)
// when new business-vertical conflicts are surfaced — each entry is an
// (nameRegex, nicheRegex, label) triple. Match → emit issue.
const NAME_NICHE_CONFLICTS: Array<{ nameRegex: RegExp; nicheRegex: RegExp; label: string }> = [
  {
    // Marina conflict #2: name="Marina Nails" implies manicure; niche says cosmetology+tattoo
    nameRegex: /\b(?:nails?|manicure|маникюр)\b/i,
    nicheRegex: /(?:косметолог|тату|tattoo|cosmetolog|piercing|пирсинг)/i,
    label: 'name suggests nail/manicure but businessType lists cosmetology/tattoo/piercing',
  },
  {
    // Symmetric: name says hair/салон but niche says nails
    nameRegex: /\b(?:hair|salon|парикмахер|barber)\b/i,
    nicheRegex: /(?:маникюр|nails?|tattoo|тату)/i,
    label: 'name suggests hair/barber but businessType lists nails/tattoo',
  },
];

// Bilingual-marker substrings inside rawOnboardingState (case-insensitive).
const BILINGUAL_MARKERS = [
  'двух языках',
  'обоих языках',
  'оба языка',
  'bilingual',
  'на двух',
  'и иврит',
  'и русск',
  'иврит и',
  'русск и',
];

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Walk an arbitrary object/array tree and collect string values up to a bounded
 * depth. Used to inspect rawOnboardingState (jsonb) for bilingual markers
 * without imposing a brittle schema assumption.
 */
function collectStringsBounded(node: unknown, depth: number, out: string[]): void {
  if (depth <= 0 || out.length > 256) return;
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStringsBounded(child, depth - 1, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const child of Object.values(node)) collectStringsBounded(child, depth - 1, out);
  }
}

function checkBusinessTypeLeak(profile: BrandProfileLike, issues: BrandCoherenceIssue[]): void {
  const businessType = safeString(profile.businessType);
  if (!businessType) return;
  if (CYRILLIC_OR_HEBREW.test(businessType)) {
    issues.push({
      field: 'businessType',
      severity: 'warn',
      detail:
        'non-Latin chars in businessType (Discovery wizard SHOULD have translated к canonical English; downstream image-prompt sanitizer will defend, but upstream BrandProfile is incoherent)',
    });
  }
}

function checkNameNicheMismatch(profile: BrandProfileLike, issues: BrandCoherenceIssue[]): void {
  const name = safeString(profile.businessName);
  const niche = safeString(profile.businessType);
  if (!name || !niche) return;
  for (const rule of NAME_NICHE_CONFLICTS) {
    if (rule.nameRegex.test(name) && rule.nicheRegex.test(niche)) {
      issues.push({
        field: 'businessName×businessType',
        severity: 'warn',
        detail: rule.label,
      });
      return; // one mismatch label is enough; avoid double-counting
    }
  }
}

function checkLanguagePosture(profile: BrandProfileLike, issues: BrandCoherenceIssue[]): void {
  const languages = Array.isArray(profile.languages) ? profile.languages : [];
  if (languages.length !== 1) return; // only single-language declarations conflict с bilingual markers
  const raw = profile.rawOnboardingState;
  if (!raw || typeof raw !== 'object') return;
  const strings: string[] = [];
  collectStringsBounded(raw, 6, strings);
  const hay = strings.join(' \n ').toLowerCase();
  for (const marker of BILINGUAL_MARKERS) {
    if (hay.includes(marker)) {
      issues.push({
        field: 'languages×rawOnboardingState',
        severity: 'warn',
        detail: `BrandProfile.languages declares single language [${languages[0]}] but onboarding state contains bilingual marker "${marker}"`,
      });
      return;
    }
  }
}

function checkRequiredNullability(profile: BrandProfileLike, issues: BrandCoherenceIssue[]): void {
  const businessType = safeString(profile.businessType);
  const targetAudience = safeString(profile.targetAudience);
  if (businessType && !targetAudience) {
    issues.push({
      field: 'targetAudience',
      severity: 'info',
      detail:
        'targetAudience NULL while businessType present — suggests partial onboarding (Discovery wizard topic incomplete OR direct DB seed bypass)',
    });
  }
}

/**
 * Run all coherence checks on a BrandProfile. Pure / deterministic / tenant-agnostic.
 *
 * Throws? No — every check tolerates missing/null fields and returns
 * unconditionally. The internal try/catch wrapper guards against unforeseen
 * throws from regex or jsonb traversal on degenerate input.
 */
export function validateBrandCoherence(profile: BrandProfileLike | null | undefined): BrandCoherenceResult {
  const issues: BrandCoherenceIssue[] = [];
  if (!profile || typeof profile !== 'object') {
    return { coherent: true, issues };
  }
  try {
    checkBusinessTypeLeak(profile, issues);
    checkNameNicheMismatch(profile, issues);
    checkLanguagePosture(profile, issues);
    checkRequiredNullability(profile, issues);
  } catch {
    // Defense-in-depth: if any check throws unexpectedly (e.g. malformed jsonb),
    // return whatever issues accumulated. NEVER let validator failures block
    // the downstream load-path.
  }
  return {
    coherent: issues.length === 0,
    issues,
  };
}
