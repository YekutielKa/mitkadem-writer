const DEFAULTS: string[] = [
  (process.env.EVENTS_URL || '').replace(/\/$/, ''),
  'https://mitkadem-events-production.up.railway.app',
  'http://mitkadem-events:8050',
  'http://localhost:8050'
].filter(Boolean);

async function doFetch(url: string, opts: any): Promise<Response> {
  if (typeof fetch === 'function') {
    // @ts-ignore
    return fetch(url, opts);
  }
  const mod = await import('node-fetch');
  // @ts-ignore
  return (mod as any).default(url, opts);
}

async function postJSON(path: string, payload: any) {
  for (const base of DEFAULTS) {
    if (!base) continue;
    try {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (!res.ok) continue;
      try {
        return { ok: true, base, body: JSON.parse(text || '{}') };
      } catch {
        return { ok: true, base, body: { raw: text } };
      }
    } catch (_e) {
      // пробуем следующий base
    }
  }
  return { ok: false };
}

export async function logEvent(body: any) {
  return postJSON('/v1/events/log', body);
}

export async function reward(body: any) {
  return postJSON('/v1/rewards/apply', body);
}
