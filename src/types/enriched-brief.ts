/**
 * SMART PHASE PREMIUM 01 — Module A
 * Strict contract for the EnrichedBrief object passed into the LLM call.
 *
 * Three layers of enrichment, each independently optional:
 *   1. brand     — voice, examples, banned words from tenant-brain
 *   2. antiRep   — recent hooks/CTAs/topics this tenant already used
 *   3. audience  — winning patterns from this tenant's own engagement data
 *
 * If any layer fails to load, the writer degrades gracefully — the layer
 * is set to null and the prompt builder skips it.
 */

export interface BrandLayer {
  businessName?: string;
  businessType?: string;
  city?: string;
  country?: string;
  languages?: string[];
  targetAudience?: string;
  positioningStyle?: string;
  tagline?: string;
  uniqueValue?: string;
  preferredTone?: string;
  bannedWords?: string[];
  signatureFacts?: string[];
  approvedExamples?: Array<{ content: string; channel?: string }>;
}

export interface RecentHookSummary {
  hookText: string;
  hookFirstWord: string;
  hookTechnique: string;
  hookTopicKeywords: string[];
  ageDays: number;
}

export interface AntiRepetitionLayer {
  recentHooks: RecentHookSummary[];
  // Aggregated quick-reject lists for the prompt
  forbiddenFirstWords: string[];      // first words used in last 5 posts
  overusedTechniques: string[];       // techniques used >40% of last 10 posts
  recentTopicKeywords: string[];      // topic keywords from last 5 posts
}

export interface AudienceLayer {
  // From recomputeHints / ServiceHint table — even inactive ones, but with
  // confidence reflecting whether recomputeHints trusted them
  preferHints: Array<{
    dimension: string;        // 'hour' | 'day' | 'length' | 'topic' | 'arm'
    bucket: string;           // 'noon' | 'morning' | 'monday' | ...
    confidence: number;       // 0-1
    sampleSize: number;
  }>;
  avoidHints: Array<{
    dimension: string;
    bucket: string;
    confidence: number;
    sampleSize: number;
  }>;
  // Top winning hooks from this tenant's own past posts (engagement_rate sorted)
  winningHooks: Array<{
    hookText: string;
    engagementRate: number;   // 0-1
    impressions: number;
    technique: string | null;
  }>;
  // Aggregate engagement baseline for sanity context
  postsAnalyzed: number;
  avgEngagementRate: number;  // 0-1
  // Brief mode flag — true when we have <3 posts with real metrics, all
  // winning patterns are unreliable
  coldStart: boolean;
}

export interface EnrichedBrief {
  rawBrief: string;
  tenantId: string;
  styleArm?: string;
  topicArm?: string;
  language?: string;

  brand: BrandLayer | null;
  antiRep: AntiRepetitionLayer | null;
  audience: AudienceLayer | null;

  // Diagnostics
  enrichedAt: Date;
  layersLoaded: {
    brand: boolean;
    antiRep: boolean;
    audience: boolean;
  };
  cacheHit: boolean;
}
