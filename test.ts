import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const LEXIA_DEMO_URL = "https://married-john-lance-fellow.trycloudflare.com/webhook/inbound";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json();
    console.log("Webhook received:", JSON.stringify(payload).slice(0, 300));

    const message = payload.message ?? {};
    const contactMessage = message.contact_message ?? {};
    const phoneRaw = extractPhoneNumber(payload);
    const channel = (message.channel_identity?.channel ?? "WHATSAPP").toLowerCase();

    const textMsg = contactMessage.text_message;
    const mediaMsg = contactMessage.media_message;

    let transcript = "";

    if (textMsg?.text) {
      transcript = textMsg.text;
      console.log(`Text message: ${transcript.slice(0, 100)}`);
    } else if (mediaMsg?.url) {
      console.log(`Audio message received, downloading...`);
      const { bytes, contentType } = await downloadAudio(mediaMsg.url);
      const ext = getAudioExtension(contentType, mediaMsg.url);
      console.log(`Audio: ${bytes.length} bytes, type: ${contentType}`);
      transcript = await transcribeWithWhisper(bytes, ext, contentType);
      console.log(`Transcript: ${transcript.slice(0, 200)}`);
    } else {
      console.log("No text/audio content, ignoring");
      return new Response(JSON.stringify({ status: "ignored" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!transcript) {
      return new Response(JSON.stringify({ status: "empty_transcript" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Forward vers Lexia CRM Demo ──────────────────────────────
    console.log(`Forwarding to Lexia CRM: ${LEXIA_DEMO_URL}`);
    const fwdResp = await fetch(LEXIA_DEMO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, phone: phoneRaw, channel }),
    });
    console.log(`Lexia CRM response: ${fwdResp.status}`);

    return new Response(JSON.stringify({ status: "forwarded", transcript: transcript.slice(0, 100) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Webhook error:", (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// --- Extract phone number from Sinch payload ---
function extractPhoneNumber(payload: Record<string, unknown>): string {
  try {
    const message = payload.message as Record<string, unknown> | undefined;
    if (message) {
      const channelIdentity = message.channel_identity as Record<string, unknown> | undefined;
      if (channelIdentity) return (channelIdentity.identity as string) ?? "";
    }
    return (payload.contact_id as string) ?? "unknown";
  } catch {
    return "unknown";
  }
}

// --- Download audio from Sinch URL ---
async function downloadAudio(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Audio download failed (${resp.status})`);
  const contentType = resp.headers.get("content-type") ?? "audio/ogg";
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return { bytes, contentType };
}

// --- Get file extension ---
function getAudioExtension(contentType: string, url: string): string {
  if (url.endsWith(".m4a") || contentType.includes("mp4")) return "m4a";
  if (url.endsWith(".amr") || contentType.includes("amr")) return "amr";
  return "oga";
}

// --- Transcribe with OpenAI Whisper ---
async function transcribeWithWhisper(audioBytes: Uint8Array, ext: string, contentType: string): Promise<string> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

  const formData = new FormData();
  const blob = new Blob([audioBytes], { type: contentType });
  formData.append("file", blob, `audio.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", "fr");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Whisper failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return data.text || "";
}
