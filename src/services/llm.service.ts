import { getEnv } from '../config/env';
import { signServiceToken } from '../lib/jwt';
import { httpPost, httpGet } from '../lib/http';
import { logger } from '../lib/logger';
import { GeneratedPost, BrandProfile } from '../types/writer';

/**
 * Загружает brand profile из tenant-brain
 */
export async function loadBrandProfile(tenantId: string): Promise<BrandProfile | null> {
  const env = getEnv();
  const url = `${env.TENANT_BRAIN_URL}/v1/brand/profile/${tenantId}`;

  try {
    const profile = await httpGet<BrandProfile>(url, {
      Authorization: `Bearer ${signServiceToken()}`,
    });
    return profile;
  } catch (err: any) {
    logger.warn({ tenantId, error: err.message }, 'Failed to load brand profile');
    return null;
  }
}

/**
 * Строит персонализированный system prompt на основе brand profile
 */
function buildSystemPrompt(profile: BrandProfile | null): string {
  if (!profile) {
    return 'You are an expert social media copywriter.\nWrite engaging posts that drive engagement.';
  }

  const parts: string[] = [
    `You are a professional SMM copywriter for a ${profile.businessType} business.`,
  ];

  if (profile.businessName) {
    parts.push(`Business name: "${profile.businessName}"`);
  }

  if (profile.city || profile.country) {
    parts.push(`Location: ${profile.city || ''}, ${profile.country || 'Israel'}`);
  }

  if (profile.languages?.length) {
    parts.push(`Languages: ${profile.languages.join(', ')}`);
  }

  if (profile.targetAudience) {
    parts.push(`Target audience: ${profile.targetAudience}`);
  }

  if (profile.positioningStyle) {
    parts.push(`Brand positioning: ${profile.positioningStyle}`);
  }

  if (profile.tagline) {
    parts.push(`Tagline: "${profile.tagline}"`);
  }

  if (profile.uniqueValue) {
    parts.push(`Unique value: ${profile.uniqueValue}`);
  }

  parts.push(`Tone: ${profile.preferredTone || 'professional and warm'}`);

  // Добавляем примеры одобренных постов (few-shot)
  if (profile.approvedPosts?.length > 0) {
    parts.push('\n--- APPROVED POST EXAMPLES (match this style) ---');
    profile.approvedPosts.slice(0, 3).forEach((post, i) => {
      parts.push(`Example ${i + 1}: ${post.content.slice(0, 200)}...`);
    });
  }

  return parts.join('\n');
}

interface GenerateParams {
  tenantId?: string;
  brief: string;
  tone?: string;
  audience?: string;
  platform?: string;
  image_brief?: string;
}

/**
 * Генерирует контент через LLM Hub
 */
export async function generateContent(params: GenerateParams): Promise<GeneratedPost> {
  const env = getEnv();

  // Загружаем brand profile если есть tenantId
  let profile: BrandProfile | null = null;
  if (params.tenantId) {
    profile = await loadBrandProfile(params.tenantId);
  }

  const systemPrompt = buildSystemPrompt(profile);

  const prompt = `${systemPrompt}

${params.tone ? 'Requested tone: ' + params.tone : ''}
${params.audience ? 'Target audience override: ' + params.audience : ''}
${params.platform ? 'Platform: ' + params.platform + ' (adjust length and style)' : ''}
${params.image_brief ? 'Image context: ' + params.image_brief : ''}

Rules:
- Match the language of the brief (Hebrew/Russian/English)
- Be concise and punchy
- Include relevant emojis
- End with a call-to-action

Return ONLY valid JSON with this structure:
{
  "content": "The post text with emojis",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "image_prompt": "Detailed English prompt for AI image generation. Include: style, colors, composition, lighting, mood. Format: professional photography/illustration style description."
}

The image_prompt must be:
- In ENGLISH only
- Detailed (style, colors, composition, lighting)
- Suitable for AI image generation (Midjourney/DALL-E style)
- Related to the post content

Write a social media post about: ${params.brief}`;

  const url = `${env.LLM_HUB_URL}/v1/llm/generate`;

  interface LLMResponse {
    output: string;
  }

  const data = await httpPost<LLMResponse>(
    url,
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      input: {
        messages: [{ role: 'user', content: prompt }],
        system: systemPrompt,
        max_tokens: 800,
        temperature: 0.7,
      },

    },
    {
      Authorization: `Bearer ${signServiceToken()}`,
    },
    { timeout: 60000 } // LLM может быть медленным
  );

  const output = data.output || '';

  // Parse JSON from response
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: return content as-is if JSON parsing fails
    return {
      content: output,
      hashtags: [],
      image_prompt: '',
    };
  }

  return JSON.parse(jsonMatch[0]);
}
