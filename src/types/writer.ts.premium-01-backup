import { z } from 'zod';

// === Request Schemas ===

export const BriefSchema = z.object({
  tenantId: z.string().min(1),
  brief: z.string().min(5, 'Brief must be at least 5 characters'),
  tone: z.string().optional(),
  audience: z.string().optional(),
  platform: z.string().optional(),
});
export type BriefInput = z.infer<typeof BriefSchema>;

export const RunSchema = z.object({
  taskId: z.string().uuid(),
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
