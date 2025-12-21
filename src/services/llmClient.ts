const LLM_HUB_URL = process.env.LLM_HUB_URL || 'https://mitkadem-llm-hub-production.up.railway.app';

export async function generateContent(params: {
  brief: string;
  tone?: string;
  audience?: string;
  platform?: string;
  serviceJwt: string;
}): Promise<string> {
  const systemPrompt = `You are an expert social media copywriter.
Write engaging posts that drive engagement.
Language: Match the language of the brief (Hebrew/Russian/English).
${params.tone ? `Tone: ${params.tone}` : ''}
${params.audience ? `Target audience: ${params.audience}` : ''}
${params.platform ? `Platform: ${params.platform} (adjust length and style)` : ''}

Rules:
- Be concise and punchy
- Include relevant emojis
- End with a call-to-action
- Add 3-5 relevant hashtags`;

  const res = await fetch(`${LLM_HUB_URL}/v1/llm/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.serviceJwt}`
    },
    body: JSON.stringify({
      provider: 'anthropic',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Write a social media post about: ${params.brief}` }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || `LLM generation failed: ${res.status}`);
  }

  const data = await res.json() as { text: string };
  return data.text;
}
