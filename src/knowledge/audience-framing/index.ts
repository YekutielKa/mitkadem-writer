/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * High-bar audience framing builder.
 *
 * Pushes Sonnet out of distributional convergence toward a specific
 * premium target. Inspired by Anthropic's frontend research:
 *   "Including phrases like 'museum quality' pushed designs toward
 *    a particular visual convergence" (anthropic.com/engineering/harness-design)
 *
 * Sprint WAVE_B3 — the per-tenant hardcode (`if tenantId === MARINA_TENANT_ID`
 * → a hand-written Russian "Marina Nails / Neve Tzedek / €65+" blob) is removed.
 * It was a cross-tenant brand/market/language leak of exactly the LOCKED #40
 * class: one tenant's brand, price band and language pinned into a builder that
 * runs for every tenant. Framing is now ALWAYS derived from the caller's
 * BrandProfile — the tenant's own profile is the single source of truth.
 * Premium 02: full auto-generation from BrandProfile (in progress here).
 */
import type { BrandProfile } from '../../types/writer';

/**
 * High-bar framing derived from the tenant's BrandProfile. Uses profile fields
 * to substitute context; no tenant-specific branches. Premium 02: richer
 * auto-generation from the full profile.
 */
function buildProfileFraming(brand: BrandProfile | null): string {
  if (!brand) {
    return `# Качественный bar

Caption должен звучать как письмо подруги-эксперта, не как реклама. Конкретика, специфичность, личный голос. Generic marketing copy — это failure.`;
  }
  const businessName = brand.businessName || 'этот бренд';
  const businessType = brand.businessType || 'specialist';
  const city = brand.city || '';
  const audience = brand.targetAudience || 'требовательная аудитория';

  return `# Кто читает этот пост

${businessName} — ${businessType}${city ? ` в ${city}` : ''}.

Целевая аудитория: ${audience}.

Эта аудитория презирает generic marketing copy. Они мгновенно распознают рекламные шаблоны. Они уважают конкретность, специфичность, профессиональную глубину.

# Что должно получиться

Caption должен звучать как письмо подруги-эксперта, не как объявление. Если caption можно представить опубликованным в журнале — это premium. Если он звучит как рекламная вывеска — это failure.

# Качественный bar

Лучшие представители ниши пишут captions которые читаются как редакторская колонка. Будь на этом уровне.
`;
}

/**
 * Public entry — high-bar framing from the tenant's BrandProfile.
 */
export function buildHighBarFraming(brand: BrandProfile | null): string {
  return buildProfileFraming(brand);
}
