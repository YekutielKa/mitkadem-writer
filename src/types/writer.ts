import { z } from 'zod';

// === Request Schemas ===

export const BriefSchema = z
  .object({
    tenantId: z.string().min(1),
    brief: z.string().min(5, 'Brief must be at least 5 characters'),
    tone: z.string().optional(),
    audience: z.string().optional(),
    platform: z.string().optional(),
    // premium-01/task4c: arm-aware writer
    styleArm: z.string().optional(),
    topicArm: z.string().optional(),
    constraintsOverride: z.record(z.any()).optional(),
    language: z.string().optional(), // pw3/fix3: explicit language override
    // Sprint O Block 2 — caller declares the creative purpose. When
    // purpose === 'ads_creative', `language` is REQUIRED (HTTP 400 otherwise)
    // and the writer engages a post-generation script-coherence retry
    // (max 2 retries; 422 on failure). Other purposes (intro, content, …)
    // are unaffected.
    purpose: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.purpose === 'ads_creative' && (!data.language || data.language.trim() === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['language'],
        message: 'language_required',
      });
    }
  });
export type BriefInput = z.infer<typeof BriefSchema>;

export const RunSchema = z.object({
  taskId: z.string().uuid(),
  // Sprint FIX_CONTENT_CADENCE (A1) — when true, the caller (orchestrator under
  // CONTENT_CADENCE_V2_ENABLED) already owns the content_posts row, so the
  // writer MUST NOT insert its own anchor row (that was the orphan-leak source:
  // one orphan per /run, multiplied by the rewrite loop). Default false → legacy
  // behaviour (writer inserts the anchor), so production is unchanged until V2.
  skipContentPostInsert: z.boolean().optional(),
  // Optional: the owned row's id, echoed back in the response for traceability.
  contentPostId: z.string().uuid().optional(),
  // Sprint FIX_CONTENT_QUALITY — per-request override for grounded arm
  // templates (no "invent numbers" mandate). Undefined → falls back to the
  // WRITER_GROUNDED_ARMS_ENABLED env flag (default OFF). Lets us measure the
  // grounded prompt on the deployed service without flipping the prod flag.
  groundedArmsOverride: z.boolean().optional(),
});
export type RunInput = z.infer<typeof RunSchema>;

export const FeedbackSchema = z.object({
  tenantId: z.string().min(1),
  contentId: z.string().min(1),
  feedbackType: z.enum(['approved', 'edited', 'rejected', 'published']),
  score: z.number().min(1).max(5).optional(),
  comment: z.string().optional(),
  originalContent: z.string().optional(),
  editedContent: z.string().optional(),
  rejectionReason: z.string().optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackSchema>;

// === Response Types ===

export interface GeneratedPost {
  content: string;
  hashtags: string[];
  image_prompt: string;
  // Anti-slop (B4): set when all retry attempts exhausted and content still
  // fails validation. Route marks the task `needs_review` instead of
  // `pending_approval` so it never auto-publishes.
  needsReview?: boolean;
  needsReviewReason?: string;
}

export interface WriteTaskResult {
  id: string;
  tenantId: string;
  brief: string;
  tone: string | null;
  audience: string | null;
  status: string;
  content: string | null;
  createdAt: Date;
  updatedAt: Date;
  image_prompt?: string;
  hashtags?: string[];
}

// === Brand Profile from tenant-brain ===

export interface BrandProfile {
  businessType: string;
  businessName?: string;
  city?: string;
  country?: string;
  languages: string[];
  mainGoal?: string;
  targetAudience?: string;
  positioningStyle?: string;
  tagline?: string;
  uniqueValue?: string;
  preferredTone: string;
  approvedPosts: Array<{ content: string; channel: string }>;
}

// === Hints from insights ===

export interface WriterHints {
  tone?: string;
  style?: string;
  avoidPhrases?: string[];
  preferredPhrases?: string[];
  [key: string]: unknown;
}
