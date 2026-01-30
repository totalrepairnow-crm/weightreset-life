

import OpenAI from "openai";

export const runtime = "nodejs";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, {
        ok: false,
        error:
          "Missing OPENAI_API_KEY. Set it in your environment (.env.local) and restart the server.",
      });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return json(400, {
        ok: false,
        error:
          "Expected multipart/form-data with an audio file field named 'audio' (or 'file').",
      });
    }

    const form = await req.formData();
    const locale = String(form.get("locale") || "es-MX");
    const language = String(
      form.get("language") || (locale.startsWith("es") ? "es" : "")
    );

    // Accept common field names
    const audioAny = form.get("audio") || form.get("file") || form.get("blob");

    if (!audioAny || typeof audioAny.arrayBuffer !== "function") {
      return json(400, {
        ok: false,
        error:
          "No audio file found. Send multipart/form-data with a file field named 'audio'.",
      });
    }

    const audioFile = audioAny;
    const buf = Buffer.from(await audioFile.arrayBuffer());

    const client = new OpenAI({ apiKey });

    // Re-wrap into a File so OpenAI SDK can consume it reliably
    const fileForOpenAI = new File([buf], audioFile.name || "audio.m4a", {
      type: audioFile.type || "audio/m4a",
    });

    const transcription = await client.audio.transcriptions.create({
      file: fileForOpenAI,
      model: "whisper-1",
      ...(language ? { language } : {}),
    });

    const text = (transcription && transcription.text) ? String(transcription.text) : "";

    return json(200, {
      ok: true,
      data: {
        text,
        locale,
        language: language || null,
      },
    });
  } catch (err) {
    const msg = err?.message || String(err);
    return json(500, { ok: false, error: msg });
  }
}