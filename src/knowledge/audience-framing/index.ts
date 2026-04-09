/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * High-bar audience framing builder.
 *
 * Pushes Sonnet out of distributional convergence toward a specific
 * premium target. Inspired by Anthropic's frontend research:
 *   "Including phrases like 'museum quality' pushed designs toward
 *    a particular visual convergence" (anthropic.com/engineering/harness-design)
 *
 * Premium 01: hardcoded template for Marina + variable substitution for
 * other tenants. Premium 02: full auto-generation from BrandProfile.
 */
import type { BrandProfile } from '../../types/writer';

const MARINA_TENANT_ID = 'f1f2c818-d360-441c-8700-20b7213b35e1';

/**
 * Marina-specific high-bar framing — written by hand based on real context:
 *  - District: Neve Tzedek (premium Tel Aviv)
 *  - Audience: tech/finance women 28-45, €4k+/mo, multilingual
 *  - Positioning: technical mastery + editorial aesthetic
 */
function buildMarinaFraming(): string {
  return `# Кто читает этот пост

Marina Nails — премиум nail studio в Неве-Цедек, Тель-Авив.

Целевая аудитория этого поста — женщины 28-45 лет, hi-tech и финансы, доход €4k+/месяц, многоязычные. Они читают The Cut, ужинают в Norman, носят COS и Acne, покупают свечи в Aesop. Они платят €65+ за маникюр потому что для них важно эстетическое впечатление, не цена.

ЭТО НЕ ОБЫЧНЫЕ ЧИТАТЕЛИ INSTAGRAM:
- Они презирают generic marketing copy
- Они мгновенно распознают рекламную брошюру и unfollow
- Они уважают конкретность, специфичность, профессиональную глубину
- Они любят когда мастер показывает себя как личность, а не как "салон"

# Что должно получиться

Caption должен звучать как письмо подруги-эксперта, не как объявление салона.

Тест: если этот caption можно представить опубликованным в журнале Vogue или прочитанным вслух за чашкой кофе у Café Noir — это premium. Если он звучит как рекламная вывеска или email рассылка — это failure.

Marina конкурирует с другими топовыми салонами Тель-Авива. Generic captions = mediocre brand. Каждый caption — это решение клиентки записаться или unfollow.

# Качественный bar

Лучший nail-салон Лондона (DryBy), Парижа (Manucurist), Москвы (Chillihouse) — пишет captions которые читаются как редакторская колонка журнала. Marina должна быть на этом уровне. Не на уровне "стандартного маникюрного салона из района".
`;
}

/**
 * Generic high-bar framing for non-Marina tenants. Uses BrandProfile fields
 * to substitute context. Premium 02: replace with full auto-generation.
 */
function buildGenericFraming(brand: BrandProfile | null): string {
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
 * Public entry — picks the right framing for the tenant.
 */
export function buildHighBarFraming(
  tenantId: string,
  brand: BrandProfile | null,
): string {
  if (tenantId === MARINA_TENANT_ID) {
    return buildMarinaFraming();
  }
  return buildGenericFraming(brand);
}
