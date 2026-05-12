/**
 * HASHTAG ALLOWLIST — Sprint 26 (writer-local port).
 *
 * Closes Sprint 23 finding #7 partial (`#маникюрашкелон` city-niche LLM-conflation
 * mechanism) on the writer pipeline. Mirror of marketing-brain's
 * `src/services/tenant-hashtags/` Sprint 26 baseline.
 *
 * Sprint 27 cleanup: extract canonical implementation к FrontendSpec.hashtagConfig
 * in marketing-brain side; writer either fetches via API OR is itself absorbed
 * into the brain. Either way, THIS FILE is а Sprint-26-co-located baseline that
 * must be deleted in Sprint 27 to avoid double-maintenance drift.
 *
 * Pure logic only — same shape as `marketing-brain/src/services/tenant-hashtags`.
 * Tenant context = BrandProfile.city (already loaded by `loadBrandProfile`).
 */

export interface HashtagForbiddenConflation {
  pattern: string;
  reason: string;
}

export interface HashtagAllowlist {
  city: string | null;
  allowedNicheTags: string[];
  allowedCityTags: string[];
  forbiddenConflations: HashtagForbiddenConflation[];
  source: 'writer-local-baseline-sprint26';
}

export interface HashtagFilterResult {
  accepted: string[];
  rejected: Array<{ tag: string; reasonDetail: string }>;
  fallbackTriggered: boolean;
  fallbackTags?: string[];
}

const SPRINT26_BASELINE_NICHE_TAGS: string[] = [
  '#маникюр',
  '#педикюр',
  '#гельлак',
  '#гель_лак',
  '#shellac',
  '#nailart',
  '#nail_art',
  '#nails',
  '#beauty',
  '#красота',
  '#уходзаногтями',
  '#маникюрсалон',
  '#дизайнногтей',
  '#מניקור',
  '#פדיקור',
  "#לק_ג'ל",
  '#יופי',
  '#manicure',
  '#pedicure',
  '#gelpolish',
  '#beautysalon',
];

const IL_CITY_TRANSLIT_VARIANTS: Record<string, string[]> = {
  'тель-авив': ['тельавив', 'тель_авив', 'telaviv', 'tel_aviv'],
  'тельавив': ['тельавив', 'тель_авив', 'telaviv'],
  'иерусалим': ['иерусалим', 'jerusalem'],
  'хайфа': ['хайфа', 'haifa'],
  'ашкелон': ['ашкелон', 'ашкилон', 'ashkelon'],
  'ашдод': ['ашдод', 'ashdod'],
  'нетания': ['нетания', 'netanya'],
  'натания': ['натания'],
  'беэр-шева': ['беэршева', 'beersheva'],
  'беэршева': ['беэршева', 'beersheva'],
  'ришон-лецион': ['ришонлецион', 'rishonlezion', 'rishon_lezion'],
  'ришонлецион': ['ришонлецион', 'rishonlezion'],
  'ришон ле-цион': ['ришонлецион', 'rishonlezion'],
  'петах-тиква': ['петахтиква', 'petahtikva'],
  'холон': ['холон', 'holon'],
  'бат-ям': ['батъям', 'batyam', 'bat_yam'],
  'рамат-ган': ['раматган', 'ramatgan'],
  'герцлия': ['герцлия', 'herzliya'],
  'кфар-саба': ['кфарсаба', 'kfarsaba'],
  'реховот': ['реховот', 'rehovot'],
  'модиин': ['модиин', 'modiin'],
  'эйлат': ['эйлат', 'eilat'],
};

const NICHE_CONFLATION_SUBSTRINGS = [
  'маникюр',
  'педикюр',
  'manicure',
  'pedicure',
  'nails',
  'beauty',
  'мастер',
  'мастерманикюра',
];

function normaliseCityKey(s: string | null | undefined): string {
  if (!s) return '';
  // NFC keeps precomposed Cyrillic letters (NFD + diacritic-strip would
  // corrupt 'й' → 'и'). Same fix as mb tenant-hashtags.
  return s.toLowerCase().normalize('NFC').replace(/[\s_'\-—]+/g, '');
}

function cityVariants(rawCity: string): string[] {
  const out = new Set<string>();
  out.add(normaliseCityKey(rawCity));
  for (const [key, variants] of Object.entries(IL_CITY_TRANSLIT_VARIANTS)) {
    if (normaliseCityKey(key) === normaliseCityKey(rawCity)) {
      for (const v of variants) out.add(normaliseCityKey(v));
    }
    for (const v of variants) {
      if (normaliseCityKey(v) === normaliseCityKey(rawCity)) {
        out.add(normaliseCityKey(key));
        for (const v2 of variants) out.add(normaliseCityKey(v2));
      }
    }
  }
  out.delete('');
  return Array.from(out);
}

function buildAllowedCityTags(rawCity: string): string[] {
  const variants = cityVariants(rawCity);
  const out = new Set<string>();
  for (const variant of variants) {
    for (const niche of ['маникюр', 'педикюр', 'manicure', 'pedicure', 'nails']) {
      out.add(`#${niche}${variant}`);
      out.add(`#${niche}_${variant}`);
      out.add(`#${niche}-${variant}`);
    }
    out.add(`#${variant}`);
  }
  return Array.from(out);
}

function buildForbiddenConflations(rawCity: string): HashtagForbiddenConflation[] {
  const tenantCityKeys = new Set(cityVariants(rawCity));
  const out: HashtagForbiddenConflation[] = [];
  for (const [canonicalCity, variants] of Object.entries(IL_CITY_TRANSLIT_VARIANTS)) {
    const cityKeys = new Set<string>();
    cityKeys.add(normaliseCityKey(canonicalCity));
    for (const v of variants) cityKeys.add(normaliseCityKey(v));
    let isTenantOwn = false;
    for (const k of cityKeys) if (tenantCityKeys.has(k)) isTenantOwn = true;
    if (isTenantOwn) continue;
    for (const cityKey of cityKeys) {
      if (!cityKey) continue;
      for (const niche of NICHE_CONFLATION_SUBSTRINGS) {
        out.push({
          pattern: `${niche}${cityKey}`,
          reason: `${niche}+${canonicalCity} conflation for non-${canonicalCity} tenant (tenant.city=${rawCity})`,
        });
      }
    }
  }
  return out;
}

export function getHashtagAllowlistForCity(city: string | null | undefined): HashtagAllowlist {
  return {
    city: city ?? null,
    allowedNicheTags: [...SPRINT26_BASELINE_NICHE_TAGS],
    allowedCityTags: city ? buildAllowedCityTags(city) : [],
    forbiddenConflations: city ? buildForbiddenConflations(city) : [],
    source: 'writer-local-baseline-sprint26',
  };
}

export function filterHashtags(
  candidates: string[],
  allowlist: HashtagAllowlist,
): HashtagFilterResult {
  const accepted: string[] = [];
  const rejected: Array<{ tag: string; reasonDetail: string }> = [];

  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (!tag) continue;
    const key = normaliseCityKey(tag.replace(/^#+/, ''));

    let blocked: HashtagForbiddenConflation | null = null;
    for (const fc of allowlist.forbiddenConflations) {
      if (key.includes(normaliseCityKey(fc.pattern))) {
        blocked = fc;
        break;
      }
    }
    if (blocked) {
      rejected.push({ tag, reasonDetail: `forbidden_conflation: ${blocked.reason}` });
      continue;
    }

    const inNiche = allowlist.allowedNicheTags.some(
      (t) => normaliseCityKey(t.replace(/^#+/, '')) === key,
    );
    const inCity = allowlist.allowedCityTags.some(
      (t) => normaliseCityKey(t.replace(/^#+/, '')) === key,
    );
    if (inNiche || inCity) {
      accepted.push(tag);
      continue;
    }

    const hasNiche = NICHE_CONFLATION_SUBSTRINGS.some((n) => key.includes(normaliseCityKey(n)));
    let hasOtherCity = false;
    for (const [city, variants] of Object.entries(IL_CITY_TRANSLIT_VARIANTS)) {
      const cityKeys = [normaliseCityKey(city), ...variants.map(normaliseCityKey)];
      if (cityKeys.some((c) => c && key.includes(c))) {
        const tenantOwn = allowlist.allowedCityTags.some((tag2) => {
          const tagKey = normaliseCityKey(tag2.replace(/^#+/, ''));
          return cityKeys.some((c) => c && tagKey.includes(c));
        });
        if (!tenantOwn) {
          hasOtherCity = true;
          break;
        }
      }
    }
    if (hasNiche && hasOtherCity) {
      rejected.push({ tag, reasonDetail: 'heuristic_city_niche_conflation (city not tenant.city)' });
      continue;
    }
    if (hasNiche) {
      accepted.push(tag);
      continue;
    }

    rejected.push({ tag, reasonDetail: 'not_in_allowlist' });
  }

  if (accepted.length === 0 && candidates.length > 0) {
    return {
      accepted,
      rejected,
      fallbackTriggered: true,
      fallbackTags: allowlist.allowedNicheTags.slice(0, 5),
    };
  }
  return { accepted, rejected, fallbackTriggered: false };
}

export function renderAllowlistHint(allowlist: HashtagAllowlist): string {
  const lines: string[] = [];
  lines.push('# HASHTAG ALLOWLIST (Sprint 26 — single source of truth)');
  if (allowlist.allowedCityTags.length > 0) {
    lines.push(`Allowed city-tags (tenant city ${allowlist.city ?? '—'}):`);
    lines.push(`  ${allowlist.allowedCityTags.slice(0, 6).join(' ')}`);
  }
  lines.push('Allowed niche tags (geo-neutral):');
  lines.push(`  ${allowlist.allowedNicheTags.slice(0, 8).join(' ')}`);
  if (allowlist.forbiddenConflations.length > 0) {
    lines.push('FORBIDDEN city-niche conflations (DO NOT emit):');
    const sample = allowlist.forbiddenConflations.slice(0, 4).map((f) => `#${f.pattern}`);
    lines.push(`  e.g. ${sample.join(' ')} (city must match tenant.city — anything else is forbidden)`);
  }
  return lines.join('\n');
}

export const _internals = {
  normaliseCityKey,
  cityVariants,
  buildAllowedCityTags,
  buildForbiddenConflations,
};
