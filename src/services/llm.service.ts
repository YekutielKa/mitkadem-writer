import { getWriterKnowledge } from '../knowledge/writer-knowledge';
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
  // Load writer expertise knowledge base
  const writerKnowledge = getWriterKnowledge();

  if (!profile) {
    return writerKnowledge
      ? `You are an expert social media copywriter specializing in service businesses.\n\n=== COPYWRITING KNOWLEDGE BASE ===\n${writerKnowledge.slice(0, 4000)}\n=== END KNOWLEDGE ===\n\nWrite engaging posts that drive bookings.`
      : 'You are an expert social media copywriter.\nWrite engaging posts that drive engagement.';
  }

  const parts: string[] = [
    `You are a professional Instagram copywriter for a ${profile.businessType} business.`,
  ];

  // Inject knowledge base
  if (writerKnowledge) {
    parts.push('\n=== COPYWRITING EXPERTISE (follow these rules and patterns) ===');
    parts.push(writerKnowledge.slice(0, 4000));
    parts.push('=== END EXPERTISE ===\n');
  }

  if (profile.businessName) {
    parts.push(`Business name: "${profile.businessName}"`);
  }

  if (profile.city || profile.country) {
    parts.push(`Location: ${[profile.city, profile.country].filter(Boolean).join(', ')}`);
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

  // Tenant-specific variables for prompt universalization
  const nicheLabel = profile?.businessType || 'specialist';
  const ownerRole = 'мастер';

  const prompt = `${systemPrompt}

${params.tone ? 'Requested tone: ' + params.tone : ''}
${params.audience ? 'Target audience override: ' + params.audience : ''}
${params.platform ? 'Platform: ' + params.platform + ' (adjust length and style)' : ''}
${params.image_brief ? 'Image context: ' + params.image_brief : ''}

=== ПРАВИЛА ТЕКСТА (PREMIUM COPYWRITING) ===

ПЕРВАЯ СТРОКА — это 80% успеха поста. Она должна ОСТАНОВИТЬ скролл.
Техники для первой строки:
- Интрига: "Она пришла с ногтями после другого мастера... и я всё поняла"
- Вопрос-боль: "${nicheLabel} не держится? Знакомо?"
- Провокация: "Хватит переплачивать за ${nicheLabel} который не держится"
- Факт: "3-4 недели без сколов. Не обещание — стандарт"
- Эмоция: "Когда клиентка присылает фото через 3 недели 🤍"

НЕ ИСПОЛЬЗУЙ банальные первые строки:
- ❌ "Хотите красивый ${nicheLabel}?"
- ❌ "Милые девочки..."
- ❌ "Вам нравится..."

СТРУКТУРА ПОСТА:
1. Hook (первая строка) — останавливает скролл
2. Развитие — боль/решение/история (2-3 предложения)
3. Конкретика — цена/время/результат
4. CTA — чёткий призыв к действию
5. Хэштеги — 5-10 штук

СТИЛЬ:
- Match the language of the brief (Hebrew/Russian/English)
- Короткие абзацы, 1-2 предложения каждый
- Эмодзи умеренно (2-3 на пост)
- Прямота и конкретика, не лей воду
- НИКОГДА не используй слово "ахла"
- Пиши как подруга-профи, не как рекламный буклет

=== ПРАВИЛА IMAGE_PROMPT (CRITICAL — GEMINI/IMAGEN) ===

image_prompt — это промпт для AI-генерации фотореалистичного изображения.
Промпт ДОЛЖЕН быть детально проработан. AI генерирует красиво, но тупой — ему надо всё разжевать.

ОБЯЗАТЕЛЬНЫЕ ЭЛЕМЕНТЫ КАЖДОГО ПРОМПТА:
1. "Photorealistic" — ВСЕГДА первое слово
2. АНАТОМИЯ РУК: "exactly ONE left hand and ONE right hand, each with exactly 5 fingers, natural hand anatomy, realistic finger proportions"
3. ЛОГИКА СЦЕНЫ: описывай как реальный фотограф — что где стоит, откуда свет, что видит камера. Кактус рядом с кофе = нелогично. Продумай каждый предмет.
4. "CRITICAL: NO text, NO letters, NO words, NO logos, NO watermarks, NO brand names on the image"
5. КОНКРЕТНЫЕ ЦВЕТА: не "красивый цвет", а "dusty rose", "deep burgundy", "soft lavender"
6. ОСВЕЩЕНИЕ: "soft natural daylight from window" или "warm studio lighting with ring light"
7. КАМЕРА: "Shot on 85mm lens, shallow depth of field" или "overhead flat-lay, even lighting"
8. ФОРМАТ: "square 1080x1080, Instagram-optimized"
9. "Mediterranean warm tone color palette"

РАЗНООБРАЗИЕ СЦЕН (КРИТИЧНО — не повторять одно и то же!):
- Крупный план ногтей на мраморной поверхности с кофе
- Руки с маникюром держат букет цветов
- Процесс работы (${ownerRole} в чёрных перчатках)
- Рабочее место мастера (белый стол, ring light, инструменты)
- Lifestyle: руки на руле авто, с сумочкой, с бокалом
- Детали: стразы крупным планом, градиент, French
- Сезонные: осенние листья + тёплые тона, весенние цветы + пастель

ЗАПРЕЩЕНО В ПРОМПТАХ:
- Несколько пар рук (если не процесс работы мастер+клиент)
- Нелогичные сочетания предметов
- Нереалистичные позы пальцев
- Текст на изображении (ни на каком языке)
- Фон который отвлекает от ногтей

Return ONLY valid JSON with this structure:
{
  "content": "The post text with emojis, hook first line, CTA at the end",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "image_prompt": "Photorealistic... [full detailed prompt following ALL rules above]"
}

Write a social media post about: ${params.brief}`;

  const url = `${env.LLM_HUB_URL}/v1/llm/generate`;

  interface LLMResponse {
    output: string;
  }

  const data = await httpPost<LLMResponse>(
    url,
    {
      intent: 'quality',
      input: {
        messages: [{ role: 'user', content: prompt }],
        system: systemPrompt,
        max_tokens: 1200,
        temperature: 0.8,
      },

    },
    {
      Authorization: `Bearer ${signServiceToken()}`,
    },
    { timeout: 60000 }
  );

  const output = data.output || '';

  // Parse JSON from response
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      content: output,
      hashtags: [],
      image_prompt: '',
    };
  }

  return JSON.parse(jsonMatch[0]);
}
