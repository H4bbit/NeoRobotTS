import { randomUUID } from "node:crypto";
import { commandLogger } from "./logger.js";

// ── Upstreams ──
export const UPSTREAM = "https://opencode.ai/zen";
export const API_OPENCODE = `${UPSTREAM}/v1`;
export const KILO_CHAT_URL = "https://api.kilo.ai/api/gateway/chat/completions";

const OPENCODE_USER_AGENT = "opencode/latest/1.14.50/cli";
const OPENCODE_SESSION = randomUUID();

export function opencodeHeaders(): Record<string, string> {
  return {
    "User-Agent": OPENCODE_USER_AGENT,
    "x-opencode-client": "cli",
    "x-opencode-project": "default",
    "x-opencode-session": OPENCODE_SESSION,
    "x-opencode-request": randomUUID(),
    "Content-Type": "application/json",
  };
}

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
export const ASK_MODEL = "kilo-auto/free";
export const ASK_MAX_TOKENS = 600;
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
  { id: "kilo-auto/free", vision: false, reasoning: false, note: "256K s/ reasoning" },
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
    const { getAiConfig } = require("../commands/db.js") as typeof import("../commands/db.js");
    return getAiConfig("ask_model") ?? ASK_MODEL;
  } catch {
    return ASK_MODEL;
  }
}
function getCurrentVisionModel(): string {
  try {
    const { getAiConfig } = require("../commands/db.js") as typeof import("../commands/db.js");
    return getAiConfig("vision_model") ?? VISION_MODEL;
  } catch {
    return VISION_MODEL;
  }
}
export function getAskModel(): string { return getCurrentAskModel(); }
export function getVisionModel(): string { return getCurrentVisionModel(); }

export async function askBansos(prompt: string, maxTokens = ASK_MAX_TOKENS): Promise<{ text: string; model: string; usage?: unknown }> {
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
    throw new Error(`kilo invalid json ${r.status}: ${raw.slice(0, 500)}`);
  }

  const j = json as {
    choices?: Array<{ message?: { content?: string; reasoning?: string }; finish_reason?: string }>;
    usage?: unknown;
    error?: { message?: string };
  };

  if (!r.ok) {
    const msg = j.error?.message ?? raw.slice(0, 800);
    throw new Error(`kilo ${r.status}: ${msg}`);
  }

  const content = j.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error(`kilo empty content finish=${j.choices?.[0]?.finish_reason} raw=${raw.slice(0, 800)}`);

  commandLogger.info(
    { type: "ai_event", model, elapsed, finish: j.choices?.[0]?.finish_reason, usage: j.usage },
    "ask succeeded",
  );

  return { text: content, model, usage: j.usage };
}

// ── Vision ──
export const VISION_MODEL = "muse-spark-1.2-contributor-free";
export const VISION_MAX_TOKENS = 2500;
export const VISION_PROMPT_DEFAULT =
  "Descreva esta imagem em detalhes em português. Foque em: personagem, roupa, pose, expressões, cenário e texto visível. Seja factual e objetivo.";

export async function visionBansos(
  imageB64: string,
  mime: string,
  prompt: string,
): Promise<{ text: string; model: string; usage?: unknown }> {
  const model = getCurrentVisionModel();
  const dataUrl = `data:${mime};base64,${imageB64}`;
  const body = JSON.stringify({
    model,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: dataUrl },
        ],
      },
    ],
    max_output_tokens: VISION_MAX_TOKENS,
    stream: false,
  });
  const start = Date.now();
  const r = await fetch(`${API_OPENCODE}/responses`, {
    method: "POST",
    headers: opencodeHeaders(),
    body,
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await r.text();
  const elapsed = Date.now() - start;
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`vision invalid json ${r.status}: ${raw.slice(0, 800)}`);
  }
  const j = json as {
    output_text?: string;
    output?: Array<{ type: string; content?: Array<{ text?: string }> }>;
    status?: string;
    usage?: unknown;
    error?: { message?: string };
  };
  if (!r.ok) throw new Error(`vision ${r.status}: ${j.error?.message ?? raw.slice(0, 800)}`);
  const text =
    j.output_text ?? j.output?.find((x) => x.type === "message")?.content?.[0]?.text ?? "";
  if (!text) throw new Error(`vision empty status=${j.status} raw=${raw.slice(0, 800)}`);
  commandLogger.info(
    { type: "ai_event", model, elapsed, status: j.status, usage: j.usage },
    "vision succeeded",
  );
  return { text, model, usage: j.usage };
}
