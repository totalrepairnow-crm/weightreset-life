

import OpenAI from "openai";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
const MIME_TO_EXT = Object.freeze({
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/caf": "caf",
  "audio/x-caf": "caf",
});

const EXT_TO_MIME = Object.freeze({
  m4a: "audio/m4a",
  mp4: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  caf: "audio/caf",
});

const ACCEPTED_EXTENSIONS = new Set(Object.keys(EXT_TO_MIME));

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeMime(raw) {
  return String(raw || "").trim().toLowerCase();
}

function extFromName(name) {
  const file = String(name || "").trim().toLowerCase();
  const match = file.match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : "";
}

function sanitizeBaseName(name) {
  const cleaned = String(name || "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "audio";
}

function resolveUploadFile(form) {
  const candidates = ["file", "audio", "blob", "recording"];
  for (const key of candidates) {
    const value = form.get(key);
    if (value && typeof value.arrayBuffer === "function") {
      return { field: key, file: value };
    }
  }
  return null;
}

function resolveAudioMeta(fileLike) {
  const mime = normalizeMime(fileLike?.type);
  const name = String(fileLike?.name || "");
  const extByMime = MIME_TO_EXT[mime] || "";
  const extByName = extFromName(name);
  const ext = extByMime || extByName;

  if (!ext || !ACCEPTED_EXTENSIONS.has(ext)) {
    return { ok: false };
  }

  const filename = `${sanitizeBaseName(name)}.${ext}`;
  const contentType = EXT_TO_MIME[ext] || mime || "application/octet-stream";
  return { ok: true, filename, contentType, ext };
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

    const uploaded = resolveUploadFile(form);
    if (!uploaded) {
      return json(400, {
        ok: false,
        error:
          "No audio file found. Send multipart/form-data with field 'file' (preferred) or 'audio'.",
      });
    }

    const audioFile = uploaded.file;
    const size = Number(audioFile?.size || 0);
    if (!Number.isFinite(size) || size <= 0) {
      return json(400, {
        ok: false,
        error: "The audio file is empty.",
      });
    }

    if (size > MAX_AUDIO_BYTES) {
      return json(400, {
        ok: false,
        error: `Audio file too large (${Math.round(size / 1024 / 1024)} MB). Max allowed is ${Math.round(
          MAX_AUDIO_BYTES / 1024 / 1024
        )} MB.`,
      });
    }

    const meta = resolveAudioMeta(audioFile);
    if (!meta.ok) {
      return json(400, {
        ok: false,
        error:
          "Unsupported audio format. Supported MIME types: audio/m4a, audio/mp4, audio/x-m4a, audio/wav, audio/aac, audio/caf.",
      });
    }

    const buf = Buffer.from(await audioFile.arrayBuffer());

    const client = new OpenAI({ apiKey });

    // Re-wrap into a File so OpenAI SDK can consume it reliably
    const fileForOpenAI = new File([buf], meta.filename, {
      type: meta.contentType,
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
        input_field: uploaded.field,
      },
    });
  } catch (err) {
    const msg = err?.message || String(err);
    const low = String(msg).toLowerCase();
    const status = Number(err?.status || err?.statusCode || 0);

    if (
      status === 400 ||
      low.includes("unrecognized file format") ||
      low.includes("invalid file format") ||
      low.includes("unsupported")
    ) {
      return json(400, {
        ok: false,
        error:
          "The STT provider rejected the audio format. Use m4a/mp4/wav when possible (from Expo Recording: HIGH_QUALITY usually outputs m4a).",
        details: msg,
      });
    }

    return json(500, { ok: false, error: msg });
  }
}
