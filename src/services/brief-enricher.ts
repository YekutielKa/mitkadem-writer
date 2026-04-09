/**
 * SMART PHASE PREMIUM 01 — Module A
 * Brief enrichment service.
 *
 * Pipeline (all layers non-blocking, graceful degradation):
 *   raw brief → loadBrand → loadAntiRep → loadAudience → EnrichedBrief
 *
 * Each layer wrapped in try/catch. On failure: layer = null, layersLoaded[X] = false.
 * The prompt builder later treats null layers as "skip this section".
 *
 * Cache: in-process Map keyed by tenantId, TTL 30 minutes.
 * Invalidated on demand via invalidateEnrichmentCache(tenantId).
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { loadBrandProfile } from './llm.service';
import { getRecentHooks, classifyHookTechnique, extractTopicKeywords } from './hook-history.service';
import type {
  EnrichedBrief,
  BrandLayer,
  AntiRepetitionLayer,
  AudienceLayer,
  RecentHookSummary,
} from '../types/enriched-brief';

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 30 * 60 * 1000;
interface CacheEntry {
  enriched: EnrichedBrief;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(tenantId: string): string {
  return `enrich:${tenantId}:v1`;
}

export function invalidateEnrichmentCache(tenantId: string): void {
  cache.delete(cacheKey(tenantId));
}

function getCached(tenantId: string): EnrichedBrief | null {
  const entry = cache.get(cacheKey(tenantId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey(tenantId));
    return null;
  }
  return entry.enriched;
}

function setCached(tenantId: string, enriched: EnrichedBrief): void {
  cache.set(cacheKey(tenantId), {
    enriched,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: Brand
// ─────────────────────────────────────────────────────────────────────────────
async function loadBrandLayer(tenantId: string): Promise<BrandLayer | null> {
  try {
    const profile = await loadBrandProfile(tenantId);
    if (!profile) return null;
    return {
      businessName: profile.businessName,
      businessType: profile.businessType,
      city: profile.city,
      country: profile.country,
      languages: profile.languages,
      targetAudience: profile.targetAudience,
      positioningStyle: profile.positioningStyle,
      tagline: profile.tagline,
      uniqueValue: profile.uniqueValue,
      preferredTone: profile.preferredTone,
      bannedWords: [],          // Premium 02: extract from brand profile
      signatureFacts: [],       // Premium 02: extract recurring facts
      approvedExamples: profile.approvedPosts || [],
    };
  } catch (e: any) {
    logger.warn({ tenantId, error: e?.message }, '[enricher] brand layer failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: Anti-repetition
// ─────────────────────────────────────────────────────────────────────────────
async function loadAntiRepLayer(
  prisma: PrismaClient,
  tenantId: string,
): Promise<AntiRepetitionLayer | null> {
  try {
    const recent = await getRecentHooks(prisma, tenantId, 10);
    if (recent.length === 0) {
      return {
        recentHooks: [],
        forbiddenFirstWords: [],
        overusedTechniques: [],
        recentTopicKeywords: [],
      };
    }

    const now = Date.now();
    const recentHooks: RecentHookSummary[] = recent.map((r) => ({
      hookText: r.hookText,
      hookFirstWord: r.hookFirstWord,
      hookTechnique: r.hookTechnique || 'statement',
      hookTopicKeywords: r.hookTopicKeywords || [],
      ageDays: Math.floor((now - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
    }));

    // First words from last 5 posts
    const last5 = recentHooks.slice(0, 5);
    const forbiddenFirstWords = Array.from(
      new Set(last5.map((h) => h.hookFirstWord).filter(Boolean)),
    );

    // Techniques used >40% of last 10 posts
    const techniqueCounts = new Map<string, number>();
    for (const h of recentHooks) {
      techniqueCounts.set(h.hookTechnique, (techniqueCounts.get(h.hookTechnique) || 0) + 1);
    }
    const threshold = Math.max(1, Math.floor(recentHooks.length * 0.4));
    const overusedTechniques = Array.from(techniqueCounts.entries())
      .filter(([, count]) => count >= threshold)
      .map(([technique]) => technique);

    // Topic keywords from last 5 posts (deduped)
    const recentTopicKeywords = Array.from(
      new Set(last5.flatMap((h) => h.hookTopicKeywords)),
    ).slice(0, 20);

    return {
      recentHooks,
      forbiddenFirstWords,
      overusedTechniques,
      recentTopicKeywords,
    };
  } catch (e: any) {
    logger.warn({ tenantId, error: e?.message }, '[enricher] anti-rep layer failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3: Audience
// ─────────────────────────────────────────────────────────────────────────────
interface ServiceHintRow {
  hintType: string;
  hintKey: string;
  hintValue: any;
  confidence: number;
  basedOnPosts: number | null;
  active: boolean;
}

interface WinningHookRow {
  caption: string;
  impressions: number;
  engagements: number;
}

async function loadAudienceLayer(
  prisma: PrismaClient,
  tenantId: string,
): Promise<AudienceLayer | null> {
  try {
    // 1. Pull ALL ServiceHints for this tenant — even inactive ones.
    //    Inactive hints reflect "recomputeHints not yet confident", but the
    //    direction is still useful if we downgrade confidence accordingly.
    const hints = await prisma.$queryRawUnsafe<ServiceHintRow[]>(
      `
      SELECT "hintType", "hintKey", "hintValue", confidence, "basedOnPosts", active
      FROM public."ServiceHint"
      WHERE "tenantId" = $1
      ORDER BY confidence DESC, "basedOnPosts" DESC NULLS LAST
      LIMIT 50
      `,
      tenantId,
    );

    const preferHints: AudienceLayer['preferHints'] = [];
    const avoidHints: AudienceLayer['avoidHints'] = [];

    for (const h of hints) {
      const dimension =
        (h.hintValue && typeof h.hintValue === 'object' && (h.hintValue.dimension as string)) ||
        h.hintKey.split(':')[0] ||
        'unknown';
      const bucket =
        (h.hintValue && typeof h.hintValue === 'object' && (h.hintValue.bucket as string)) ||
        h.hintKey.split(':')[1] ||
        h.hintKey;
      const sampleSize =
        (h.hintValue && typeof h.hintValue === 'object' && (h.hintValue.sampleSize as number)) ||
        h.basedOnPosts ||
        0;
      // Inactive hints get half confidence
      const confidence = h.active ? h.confidence : h.confidence * 0.5;

      const row = { dimension, bucket, confidence, sampleSize };
      if (h.hintType === 'prefer') preferHints.push(row);
      else if (h.hintType === 'avoid') avoidHints.push(row);
    }

    // 2. Winning hooks: top 5 posts by engagement_rate where impressions > 0
    const winningRows = await prisma.$queryRawUnsafe<WinningHookRow[]>(
      `
      SELECT caption, impressions, engagements
      FROM public.content_posts
      WHERE tenant_id = $1
        AND impressions > 0
        AND caption IS NOT NULL
      ORDER BY (engagements::numeric / NULLIF(impressions, 0)) DESC NULLS LAST,
               impressions DESC
      LIMIT 5
      `,
      tenantId,
    );

    const winningHooks: AudienceLayer['winningHooks'] = winningRows.map((r) => {
      // Extract first sentence as the hook representation
      const firstLine = (r.caption || '').split('\n')[0].slice(0, 130);
      return {
        hookText: firstLine,
        engagementRate: r.impressions > 0 ? r.engagements / r.impressions : 0,
        impressions: r.impressions,
        technique: classifyHookTechnique(firstLine),
      };
    });

    // 3. Baseline from TenantLearning
    const tlRows = await prisma.$queryRawUnsafe<Array<{ postsAnalyzed: number; avgEngagement: number }>>(
      `
      SELECT "postsAnalyzed", "avgEngagement"
      FROM public."TenantLearning"
      WHERE "tenantId" = $1
      LIMIT 1
      `,
      tenantId,
    );
    const tl = tlRows[0] || { postsAnalyzed: 0, avgEngagement: 0 };

    // Cold start: <3 posts with real metrics → all winning patterns unreliable
    const realMetricsCount = winningRows.length;
    const coldStart = realMetricsCount < 3;

    return {
      preferHints,
      avoidHints,
      winningHooks,
      postsAnalyzed: tl.postsAnalyzed,
      avgEngagementRate: tl.avgEngagement,
      coldStart,
    };
  } catch (e: any) {
    logger.warn({ tenantId, error: e?.message }, '[enricher] audience layer failed');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────
export interface EnrichBriefParams {
  tenantId: string;
  rawBrief: string;
  styleArm?: string;
  topicArm?: string;
  language?: string;
  prisma: PrismaClient;
  bypassCache?: boolean;
}

export async function enrichBrief(params: EnrichBriefParams): Promise<EnrichedBrief> {
  // Cache check
  if (!params.bypassCache) {
    const cached = getCached(params.tenantId);
    if (cached) {
      return {
        ...cached,
        rawBrief: params.rawBrief,
        styleArm: params.styleArm,
        topicArm: params.topicArm,
        language: params.language,
        cacheHit: true,
      };
    }
  }

  // Parallel load all 3 layers
  const [brand, antiRep, audience] = await Promise.all([
    loadBrandLayer(params.tenantId),
    loadAntiRepLayer(params.prisma, params.tenantId),
    loadAudienceLayer(params.prisma, params.tenantId),
  ]);

  const enriched: EnrichedBrief = {
    rawBrief: params.rawBrief,
    tenantId: params.tenantId,
    styleArm: params.styleArm,
    topicArm: params.topicArm,
    language: params.language,
    brand,
    antiRep,
    audience,
    enrichedAt: new Date(),
    layersLoaded: {
      brand: brand !== null,
      antiRep: antiRep !== null,
      audience: audience !== null,
    },
    cacheHit: false,
  };

  setCached(params.tenantId, enriched);

  logger.info(
    {
      tenantId: params.tenantId,
      layersLoaded: enriched.layersLoaded,
      antiRepHooks: antiRep?.recentHooks.length ?? 0,
      overusedTechniques: antiRep?.overusedTechniques ?? [],
      audienceColdStart: audience?.coldStart,
      preferHintsCount: audience?.preferHints.length ?? 0,
      winningHooksCount: audience?.winningHooks.length ?? 0,
    },
    '[enricher] brief enriched',
  );

  return enriched;
}

// Re-export topic keyword extractor for use by other modules
export { extractTopicKeywords };
