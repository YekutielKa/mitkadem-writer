import jwt from 'jsonwebtoken';

const LLM_HUB_URL = process.env.LLM_HUB_URL || 'https://mitkadem-llm-hub-production.up.railway.app';
const TENANT_BRAIN_URL = process.env.TENANT_BRAIN_URL || 'https://mitkadem-tenant-brain-production.up.railway.app';
const SERVICE_JWT_SECRET = process.env.SERVICE_JWT_SECRET!;

function mintLlmToken(): string {
  return jwt.sign(
    { sub: 'svc:writer', aud: 'internal', iss: 'mitkadem' },
    SERVICE_JWT_SECRET,
    { expiresIn: '5m' }
  );
}

export interface GeneratedPost {
  content: string;
  hashtags: string[];
  image_prompt: string;
}

interface BrandProfile {
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

/**
 * Загружает brand profile из tenant-brain
 */
async function loadBrandProfile(tenantId: string): Promise<BrandProfile | null> {
  try {
    const res = await fetch(`${TENANT_BRAIN_URL}/v1/brand/profile/${tenantId}`, {
      headers: {
        'Authorization': `Bearer ${mintLlmToken()}`,
      },
    });
    
    if (!res.ok) {
      console.log(`[brand-profile] Not found for tenant ${tenantId}`);
      return null;
    }
    
    return await res.json();
  } catch (error) {
    console.error(`[brand-profile] Failed to load:`, error);
    return null;
  }
}

/**
 * Строит персонализированный system prompt на основе brand profile
 */
function buildSystemPrompt(profile: BrandProfile | null): string {
  let basePrompt = 'You are an expert social media copywriter.';
  
  if (!profile) {
    return basePrompt + '\nWrite engaging posts that drive engagement.';
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

export async function generateContent(params: {
  tenantId?: string;
  brief: string;
  tone?: string;
  audience?: string;
  platform?: string;
  image_brief?: string;
}): Promise<GeneratedPost> {
  
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

  const token = mintLlmToken();
  const url = LLM_HUB_URL + '/v1/llm/generate';
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      input: prompt,
      max_tokens: 800,
      temperature: 0.7
    })
  });
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'LLM generation failed: ' + res.status);
  }
  
  const data = await res.json() as { output: string };
  const output = data.output || '';
  
  // Parse JSON from response
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: return content as-is if JSON parsing fails
    return {
      content: output,
      hashtags: [],
      image_prompt: ''
    };
  }
  
  return JSON.parse(jsonMatch[0]);
}
