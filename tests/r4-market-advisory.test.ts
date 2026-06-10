/**
 * R4 USE-DATA A2 — unit tests for the MARKET advisory renderer.
 *
 * Standalone runner (no jest/vitest in this repo). Invoke:
 *   cd ~/projects/mitkadem-writer && npx ts-node tests/r4-market-advisory.test.ts
 *
 * Covers naryad cases (б) render-present, (в) anti-leak instruction invariant,
 * (д) all-OFF → byte-for-byte (empty). Exits 0 on all pass, 1 on first failure.
 */
import { renderMarketAdvisory } from '../src/services/r4-market-advisory';

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const MC = { avgPrices: '250–400₪ по рынку', targetAudience: 'женщины 25–45, Тель-Авив' };
const NO_PUBLISH = 'НЕ публикуй конкретные цены конкурентов';
const NOT_OUR_PRICE = 'НЕ выдавай рыночный диапазон за цену этого бизнеса';

// ── (б) ON + marketContext → advisory block PRESENT, explicitly MARKET-labelled ──
{
  const out = renderMarketAdvisory(MC, true).join('\n');
  check('(б) block present when flag ON + data', out.length > 0);
  check('(б) explicitly labelled РЫНОЧНЫЙ ОРИЕНТИР', out.includes('РЫНОЧНЫЙ ОРИЕНТИР'));
  check('(б) labelled "НЕ для публикации"', out.includes('НЕ для публикации'));
  check('(б) carries avgPrices', out.includes('250–400₪ по рынку'));
  check('(б) carries market targetAudience', out.includes('женщины 25–45'));
}

// ── (в) anti-leak instruction INVARIANT — always present whenever block renders ──
{
  const both = renderMarketAdvisory(MC, true).join('\n');
  check('(в) both-fields: no-publish guard', both.includes(NO_PUBLISH));
  check('(в) both-fields: not-our-price guard', both.includes(NOT_OUR_PRICE));

  const priceOnly = renderMarketAdvisory({ avgPrices: '300₪', targetAudience: null }, true).join('\n');
  check('(в) price-only: no-publish guard still present', priceOnly.includes(NO_PUBLISH));
  check('(в) price-only: not-our-price guard still present', priceOnly.includes(NOT_OUR_PRICE));

  const audOnly = renderMarketAdvisory({ avgPrices: null, targetAudience: 'молодые мамы' }, true).join('\n');
  check('(в) audience-only: no-publish guard still present', audOnly.includes(NO_PUBLISH));
  check('(в) audience-only: not-our-price guard still present', audOnly.includes(NOT_OUR_PRICE));
}

// ── (д) all-OFF / no data → [] (prompt byte-for-byte) ──
{
  check('(д) flag OFF + data → []', renderMarketAdvisory(MC, false).length === 0);
  check('(д) flag ON + null → []', renderMarketAdvisory(null, true).length === 0);
  check('(д) flag ON + undefined → []', renderMarketAdvisory(undefined, true).length === 0);
  check('(д) flag ON + both fields empty → []', renderMarketAdvisory({ avgPrices: '', targetAudience: '  ' }, true).length === 0);
  check('(д) flag ON + whitespace price, null aud → []', renderMarketAdvisory({ avgPrices: '   ', targetAudience: null }, true).length === 0);
}

if (failures > 0) {
  console.error(`\n✗ ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all R4 market-advisory renderer tests passed');
