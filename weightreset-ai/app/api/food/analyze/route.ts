import OpenAI from 'openai';

// Ensure this route is always dynamic (no caching / static optimization).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type AnalyzeRequest = {
  imageBase64?: string; // raw base64 (no data: prefix)
  imageUrl?: string; // full URL or data URL
  mimeType?: string; // e.g. image/jpeg
  locale?: 'es' | 'en';
  context?: string; // optional user context (e.g., "desayuno", "etiqueta nutricional")
};

function jsonFromModelText(raw: string) {
  // Try to extract the first JSON object in the response.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = raw.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function getApiKey() {
  return process.env.OPENAI_API_KEY;
}

function getModel() {
  return process.env.OPENAI_MODEL || 'gpt-4.1-mini';
}

export async function GET() {
  // Quick browser check: /api/food/analyze
  const apiKey = getApiKey();
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'Missing OPENAI_API_KEY on the server.' },
      { status: 500 }
    );
  }
  return Response.json({ ok: true, model: getModel() });
}

export async function POST(req: Request) {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      return Response.json(
        { ok: false, error: 'Missing OPENAI_API_KEY on the server.' },
        { status: 500 }
      );
    }

    const body = (await req.json()) as AnalyzeRequest;

    const mimeType = body.mimeType || 'image/jpeg';
    const locale = body.locale || 'es';

    let imageUrl: string | undefined = body.imageUrl;
    if (!imageUrl && body.imageBase64) {
      imageUrl = `data:${mimeType};base64,${body.imageBase64}`;
    }

    if (!imageUrl) {
      return Response.json(
        { ok: false, error: 'Provide imageUrl or imageBase64.' },
        { status: 400 }
      );
    }

    // If we received a remote URL (http/https), download it server-side and convert to a data URL.
    // This avoids failures when OpenAI cannot fetch the URL (hotlink protection, blocked user-agent, etc.).
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const res = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) WeightResetAI/1.0',
          Accept: 'image/*,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        return Response.json(
          { ok: false, error: `${res.status} Error while downloading ${imageUrl}.` },
          { status: 502 }
        );
      }

      const contentType = res.headers.get('content-type') || mimeType;
      const buf = Buffer.from(await res.arrayBuffer());
      const b64 = buf.toString('base64');
      imageUrl = `data:${contentType};base64,${b64}`;
    }

    // Create OpenAI client ONLY after confirming env.
    const client = new OpenAI({ apiKey });

    // Prompt: return strict JSON only
    const prompt =
      locale === 'es'
        ? `Analiza la imagen (comida o etiqueta). Devuelve SOLO JSON válido (sin texto extra) con esta forma:
{
  "items": [{"name": string, "qty": string|null, "calories": number|null, "protein_g": number|null, "carbs_g": number|null, "fat_g": number|null, "confidence": number}],
  "total": {"calories": number|null, "protein_g": number|null, "carbs_g": number|null, "fat_g": number|null},
  "notes": string,
  "source": "photo"|"label"
}
Reglas: confidence 0..1. Si no puedes estimar algún valor pon null. Si es etiqueta, prioriza los valores de la etiqueta.`
        : `Analyze the image (food or nutrition label). Return ONLY valid JSON (no extra text) with this shape:
{
  "items": [{"name": string, "qty": string|null, "calories": number|null, "protein_g": number|null, "carbs_g": number|null, "fat_g": number|null, "confidence": number}],
  "total": {"calories": number|null, "protein_g": number|null, "carbs_g": number|null, "fat_g": number|null},
  "notes": string,
  "source": "photo"|"label"
}
Rules: confidence 0..1. Use null when unknown. If it's a label, prefer label numbers.`;

    const userContext = (body.context || '').trim();
    const fullPrompt = userContext
      ? `${prompt}\n\nContexto del usuario: ${userContext}`
      : prompt;

    const model = getModel();

    const resp = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: fullPrompt },
            { type: 'input_image', image_url: imageUrl },
          ],
        },
      ],
    });

    // The JS SDK exposes `output_text` for convenience; keep a fallback extraction.
    const text =
      // @ts-expect-error: output_text is present in the OpenAI Responses API SDK
      (resp.output_text as string | undefined) ||
      (Array.isArray((resp as any).output)
        ? (resp as any).output
            .flatMap((o: any) => o.content || [])
            .filter((c: any) => c.type === 'output_text')
            .map((c: any) => c.text)
            .join('\n')
        : '');

    const parsed = jsonFromModelText(text) || null;
    if (!parsed) {
      return Response.json(
        {
          ok: false,
          error: 'Model did not return valid JSON.',
          raw: text,
        },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, data: parsed });
  } catch (err: any) {
    const msg = err?.message || 'Unknown error';
    const status =
      msg.includes('Error while downloading') ||
      msg.includes('Model did not return valid JSON')
        ? 502
        : 500;

    return Response.json(
      {
        ok: false,
        error: msg,
      },
      { status }
    );
  }
}
