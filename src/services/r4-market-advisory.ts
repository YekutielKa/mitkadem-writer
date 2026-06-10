/**
 * R4 USE-DATA A2 (writer follow-up) — pure renderer for the researcher MARKET
 * advisory block in the content brief.
 *
 * Dependency-free (no env / prisma / network) so OFF = byte-for-byte is provable
 * by unit test with the flag passed as a parameter. Mirrors the marketing-brain
 * `r4-market-context.ts` / `r4-search-right.ts` pure-helper pattern.
 *
 * 🔴 ANTI-LEAK (the whole point of this follow-up): the market price range is a
 * positioning/tone signal for the copywriter LLM ONLY. It must NEVER be published
 * as a concrete competitor figure, and the market range must NEVER be presented
 * as THIS business's price. The block therefore ALWAYS carries an explicit
 * instruction to that effect. RYNOCHNOE ≠ SOBSTVENNOE.
 */

export interface MarketAdvisory {
  avgPrices?: string | null;
  targetAudience?: string | null;
}

/**
 * Render the market advisory as prompt lines. Returns [] (→ nothing appended →
 * prompt byte-for-byte) when:
 *   - the flag is off, OR
 *   - marketContext is absent, OR
 *   - BOTH advisory fields are empty.
 *
 * When at least one field is present, the returned block is ALWAYS labelled as a
 * MARKET reference and ALWAYS ends with the no-publish / not-our-price guard.
 */
export function renderMarketAdvisory(
  marketContext: MarketAdvisory | null | undefined,
  flagOn: boolean,
): string[] {
  if (!flagOn || !marketContext) return [];
  const avgPrices =
    typeof marketContext.avgPrices === 'string' && marketContext.avgPrices.trim()
      ? marketContext.avgPrices.trim()
      : null;
  const targetAudience =
    typeof marketContext.targetAudience === 'string' && marketContext.targetAudience.trim()
      ? marketContext.targetAudience.trim()
      : null;
  if (!avgPrices && !targetAudience) return [];

  const lines: string[] = [];
  lines.push('# РЫНОЧНЫЙ ОРИЕНТИР (справочно — для позиционирования/тона, НЕ для публикации)');
  if (avgPrices) {
    lines.push(`• Диапазон цен по рынку (конкуренты): ${avgPrices}`);
  }
  if (targetAudience) {
    lines.push(`• Аудитория рынка (рыночный взгляд): ${targetAudience}`);
  }
  // 🔴 Hard anti-leak guard — ALWAYS present whenever the block renders.
  lines.push(
    '⚠️ Это рыночный ориентир для угла и тона. НЕ публикуй конкретные цены конкурентов в посте. ' +
      'НЕ выдавай рыночный диапазон за цену этого бизнеса. Цены и услуги мастера — отдельно и главнее.',
  );
  lines.push('');
  return lines;
}
