import { getAiConfig } from "../commands/db.js";
import { commandLogger } from "./logger.js";

// ── Upstreams ──
export const KILO_CHAT_URL = "https://api.kilo.ai/api/gateway/chat/completions";

export function kiloHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer kilo-free",
  };
}

// ── Rate limit simples por jid (espelha pi-bansos: kilo 200/h) ──
const rateMap = new Map<string, { count: number; resetAt: number }>();
const KILO_LIMIT = 200;

function rateKey(jid: string): string {
  return `kilo:${jid}`;
}

export function checkRateLimit(jid: string): { ok: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const key = rateKey(jid);
  const entry = rateMap.get(key);
  if (!entry || entry.resetAt <= now) {
    rateMap.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return { ok: true, remaining: KILO_LIMIT - 1, resetMs: 60 * 60 * 1000 };
  }
  if (entry.count >= KILO_LIMIT) {
    return { ok: false, remaining: 0, resetMs: entry.resetAt - now };
  }
  entry.count++;
  return { ok: true, remaining: KILO_LIMIT - entry.count, resetMs: entry.resetAt - now };
}

// ── Modelos ──
// defaults mockados coerentes (testado: trava-língua não trunca com 1400)
// ask: reasoning leve + vision, não come 1k de thinking como stepfun
export const ASK_MODEL = "kilo-auto/free";
export const ASK_MAX_TOKENS = 1400;
export type BansosModel = {
  id: string;
  vision: boolean;
  reasoning: boolean;
  note: string;
};
export const BANSOS_ALIVE_18: BansosModel[] = [
  { id: "muse-spark-1.3-contributor-free", vision: true, reasoning: true, note: "responses 1M ctx" },
  { id: "muse-spark-1.2-contributor-free", vision: true, reasoning: true, note: "1M ctx" },
  { id: "mimo-v2.5-free", vision: true, reasoning: true, note: "200K" },
  { id: "ling-3.0-flash-fin-free", vision: false, reasoning: true, note: "262K" },
  { id: "big-pickle", vision: false, reasoning: true, note: "200K" },
  { id: "kilo-auto/free", vision: false, reasoning: false, note: "256K rápido s/ reasoning" },
  { id: "stepfun/step-3.7-flash:free", vision: true, reasoning: true, note: "vision 262K" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", vision: false, reasoning: true, note: "1M" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", vision: false, reasoning: true, note: "262K" },
  { id: "dots-studio/dots-3-note-preview:free", vision: true, reasoning: true, note: "512K mas vision 400" },
  { id: "cohere/north-mini-code:free", vision: false, reasoning: false, note: "code 256K" },
  { id: "poolside/laguna-xs-2.1:free", vision: false, reasoning: true, note: "262K" },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", vision: true, reasoning: true, note: "256K" },
  { id: "openrouter/free", vision: true, reasoning: false, note: "200K" },
  { id: "nvidia/nemotron-3.5-lightning:free", vision: false, reasoning: true, note: "1M" },
  { id: "nvidia/nemotron-3.5-content-safety:free", vision: true, reasoning: true, note: "128K" },
  { id: "inclusionai/ling-3.0-flash-sante:free", vision: false, reasoning: true, note: "262K" },
  { id: "inclusionai/ling-3.0-flash-fin:free", vision: false, reasoning: true, note: "262K" },
];

function getCurrentAskModel(): string {
  try {
    return getAiConfig("ask_model") ?? ASK_MODEL;
  } catch {
    return ASK_MODEL;
  }
}
function getCurrentVisionModel(): string {
  try {
    return getAiConfig("vision_model") ?? VISION_MODEL;
  } catch {
    return VISION_MODEL;
  }
}
export function getAskModel(): string { return getCurrentAskModel(); }
export function getVisionModel(): string { return getCurrentVisionModel(); }

export const ASK_TOKENS_MIN = 10;
export const ASK_TOKENS_MAX = 4000;
export const VISION_TOKENS_MIN = 100;
export const VISION_TOKENS_MAX = 8000;

export function getAskTokens(): number {
  try {
    const v = getAiConfig("ask_tokens");
    const n = v ? Number.parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return ASK_MAX_TOKENS;
    return Math.min(ASK_TOKENS_MAX, Math.max(ASK_TOKENS_MIN, n));
  } catch {
    return ASK_MAX_TOKENS;
  }
}
export function getVisionTokens(): number {
  try {
    const v = getAiConfig("vision_tokens");
    const n = v ? Number.parseInt(v, 10) : NaN;
    if (!Number.isFinite(n)) return VISION_MAX_TOKENS;
    return Math.min(VISION_TOKENS_MAX, Math.max(VISION_TOKENS_MIN, n));
  } catch {
    return VISION_MAX_TOKENS;
  }
}

export async function askBansos(prompt: string, maxTokens = getAskTokens()): Promise<{ text: string; model: string; usage?: unknown }> {
  const model = getCurrentAskModel();
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false,
  });

  const start = Date.now();
  const r = await fetch(KILO_CHAT_URL, {
    method: "POST",
    headers: kiloHeaders(),
    body,
    signal: AbortSignal.timeout(45_000),
  });
  const raw = await r.text();
  const elapsed = Date.now() - start;

  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    commandLogger.error({ type: "ai_event", action: "ask_invalid_json", status: r.status, raw: raw.slice(0, 1000) }, "kilo invalid json");
    throw new Error("IA resposta inválida. Tente novamente.");
  }

  const j = json as {
    choices?: Array<{ message?: { content?: string; reasoning?: string }; finish_reason?: string }>;
    usage?: unknown;
    error?: { message?: string };
  };

  if (!r.ok) {
    commandLogger.error({ type: "ai_event", action: "ask_api_error", status: r.status, body: j, raw: raw.slice(0, 1000) }, "kilo api error");
    throw new Error("IA indisponível no momento. Tente novamente.");
  }

  const rawContent = j.choices?.[0]?.message?.content ?? "";
  const content = rawContent.trim();
  const finish = j.choices?.[0]?.finish_reason;
  if (!content) {
    commandLogger.error({ type: "ai_event", action: "ask_empty_content", model, finish, raw: raw.slice(0, 2000) }, "kilo empty content");
    if (finish === "length") {
      // reasoning consumiu o limite e não sobrou pra content — retry automático com mais tokens (não culpa o user)
      if (maxTokens < ASK_TOKENS_MAX) {
        const retryTokens = Math.min(ASK_TOKENS_MAX, maxTokens + 1000);
        commandLogger.warn({ type: "ai_event", action: "ask_retry_length", model, from: maxTokens, to: retryTokens }, "retry ask on length");
        return askBansos(prompt, retryTokens);
      }
      throw new Error("Resposta truncada por limite de tokens.");
    }
    throw new Error("IA não retornou conteúdo. Tente reformular a pergunta.");
  }
  // se veio truncado mas tem conteúdo, entrega o que tem (não é erro) — só loga
  if (finish === "length" && content) {
    commandLogger.warn({ type: "ai_event", action: "ask_truncated", model, finish, contentLen: content.length }, "ask truncated but delivering");
  }

  commandLogger.info(
    { type: "ai_event", model, elapsed, finish: j.choices?.[0]?.finish_reason, usage: j.usage },
    "ask succeeded",
  );

  return { text: content, model, usage: j.usage };
}

// ── Vision ──
export const VISION_MODEL = "stepfun/step-3.7-flash:free";
export const VISION_MAX_TOKENS = 2500;
export const VISION_PROMPT_DEFAULT =
  "Descreva esta imagem em detalhes em português. Foque em: personagem, roupa, pose, expressões, cenário e texto visível. Seja factual e objetivo.";

export async function visionBansos(
  imageB64: string,
  mime: string,
  prompt: string,
): Promise<{ text: string; model: string; usage?: unknown }> {
  const model = getCurrentVisionModel();
  const maxTokens = getVisionTokens();
  const dataUrl = `data:${mime};base64,${imageB64}`;
  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: maxTokens,
    stream: false,
  });
  const start = Date.now();
  const r = await fetch(KILO_CHAT_URL, {
    method: "POST",
    headers: kiloHeaders(),
    body,
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await r.text();
  const elapsed = Date.now() - start;
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    commandLogger.error({ type: "ai_event", action: "vision_invalid_json", status: r.status, raw: raw.slice(0, 1000) }, "vision invalid json");
    throw new Error("Visão resposta inválida. Tente novamente.");
  }
  const j = json as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: unknown;
    error?: { message?: string };
  };
  if (!r.ok) {
    commandLogger.error({ type: "ai_event", action: "vision_api_error", status: r.status, body: j, raw: raw.slice(0, 1000) }, "vision api error");
    throw new Error("Visão indisponível no momento. Tente novamente.");
  }
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) {
    commandLogger.error({ type: "ai_event", action: "vision_empty_content", model, status: r.status, raw: raw.slice(0, 2000) }, "vision empty content");
    throw new Error("Visão não retornou conteúdo. Tente novamente com outra imagem ou prompt.");
  }
  commandLogger.info(
    { type: "ai_event", model, elapsed, status: r.status, usage: j.usage },
    "vision succeeded",
  );
  return { text, model, usage: j.usage };
}
