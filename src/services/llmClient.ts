import jwt from 'jsonwebtoken';

const LLM_HUB_URL = process.env.LLM_HUB_URL || 'https://mitkadem-llm-hub-production.up.railway.app';
const SERVICE_JWT_SECRET = process.env.SERVICE_JWT_SECRET || 'dev-service-123';

function mintLlmToken(): string {
  return jwt.sign(
    { sub: 'svc:writer', aud: 'internal', iss: 'mitkadem' },
    SERVICE_JWT_SECRET,
    { expiresIn: '5m' }
  );
}

export async function generateContent(params: {
  brief: string;
  tone?: string;
  audience?: string;
  platform?: string;
}): Promise<string> {
  const prompt = `You are an expert social media copywriter.
Write engaging posts that drive engagement.
Language: Match the language of the brief (Hebrew/Russian/English).
${params.tone ? 'Tone: ' + params.tone : ''}
${params.audience ? 'Target audience: ' + params.audience : ''}
${params.platform ? 'Platform: ' + params.platform + ' (adjust length and style)' : ''}

Rules:
- Be concise and punchy
- Include relevant emojis
- End with a call-to-action
- Add 3-5 relevant hashtags

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
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(function() { return {}; });
    throw new Error((err as any).error || 'LLM generation failed: ' + res.status);
  }

  const data = await res.json() as { output: string };
  return data.output;
}

