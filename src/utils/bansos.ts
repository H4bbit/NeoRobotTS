import { randomBytes } from "node:crypto";
import { getAiConfig } from "../commands/db.js";
import { commandLogger } from "./logger.js";

// ── Upstreams ──
export const UPSTREAM = "https://opencode.ai/zen";
export const API_OPENCODE = `${UPSTREAM}/v1`;
export const KILO_CHAT_URL = "https://api.kilo.ai/api/gateway/chat/completions";

export function kiloHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer kilo-free",
  };
}

// ── OpenCode Zen free-tier fingerprint (mirrors pi-bansos 0.4.10) ──
// Public client imitation: no secrets, talks direct to opencode.ai.
// Missing any gate (UA, Bearer public, desktop/global, ses_ shape,
// tool quartet, stream:true) → 403 FreeTierError.
const OPENCODE_UA = "opencode/1.18.31";
const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"] as const;
export const OPENCODE_RESPONSES_MODELS: ReadonlySet<string> = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);

let lastSessionTs = 0;
let sessionCounter = 0;

function unstableRandom(): string {
  const bytes = randomBytes(14);
  let out = "";
  for (let i = 0; i < 14; i++) {
    const b = bytes[i] ?? 0;
    out += BASE62[b % 62] ?? "0";
  }
  return out;
}

function timeHexFrom(value: bigint): string {
  return Array.from({ length: 6 }, (_, i) =>
    Number((value >> BigInt(40 - 8 * i)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("");
}

function generateSessionId(timestamp = Date.now()): string {
  if (timestamp !== lastSessionTs) {
    lastSessionTs = timestamp;
    sessionCounter = 0;
  }
  sessionCounter++;
  const current = BigInt(timestamp) * 0x1000n + BigInt(sessionCounter);
  return `ses_${timeHexFrom(~current)}${unstableRandom()}`;
}

function generateRequestId(timestamp = Date.now()): string {
  const current = BigInt(timestamp) * 0x1000n + 1n;
  return `msg_${timeHexFrom(current)}${unstableRandom()}`;
}

// One stable session per process — shape must match OPENCODE_SESSION_RE.
const OPENCODE_SESSION = generateSessionId();
if (!OPENCODE_SESSION_RE.test(OPENCODE_SESSION)) {
  throw new Error("opencode session id generation failed shape check");
}

export function opencodeHeaders(): Record<string, string> {
  return {
    "User-Agent": OPENCODE_UA,
    Authorization: "Bearer public",
    "x-opencode-client": "desktop",
    "x-opencode-project": "global",
    "x-opencode-session": OPENCODE_SESSION,
    "x-opencode-request": generateRequestId(),
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
}

function toolNameOf(tool: unknown): string {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  const t = tool as Record<string, unknown>;
  const fn =
    t.function && typeof t.function === "object" && !Array.isArray(t.function)
      ? (t.function as Record<string, unknown>)
      : null;
  const raw = typeof t.name === "string" ? t.name : typeof fn?.name === "string" ? fn.name : "";
  return raw.trim();
}

function ensureChatFingerprintTools(body: Record<string, unknown>): void {
  const present = new Set<string>();
  if (!Array.isArray(body.tools)) body.tools = [];
  const tools = body.tools as unknown[];
  for (const tool of tools) {
    const name = toolNameOf(tool);
    if (name) present.add(name);
  }
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (present.has(name)) continue;
    tools.push({
      type: "function",
      function: {
        name,
        description: `OpenCode built-in ${name} tool`,
        parameters: { type: "object", properties: {} },
      },
    });
  }
}

function ensureResponsesFingerprintTools(body: Record<string, unknown>): void {
  const present = new Set<string>();
  if (!Array.isArray(body.tools)) body.tools = [];
  const tools = body.tools as unknown[];
  for (const tool of tools) {
    const name = toolNameOf(tool);
    if (name) present.add(name);
  }
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (present.has(name)) continue;
    tools.push({
      type: "function",
      name,
      description: `OpenCode built-in ${name} tool`,
      parameters: { type: "object", properties: {} },
    });
  }
}

function sanitizeResponsesItems(body: Record<string, unknown>): void {
  if (!Array.isArray(body.input)) return;
  const input = body.input as unknown[];
  body.input = input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    const it = item as Record<string, unknown>;
    // Drop prior-turn reasoning: pooled Bearer public cannot decrypt
    // encrypted_content across rotated Console accounts (400).
    if (it.type === "reasoning") return false;
    delete it.encrypted_content;
    delete it.reasoning_encrypted_content;
    return true;
  });
}

/** Rewrite OpenCode free-tier request body to pass Zen client fingerprint gates. */
export function transformOpencodeBody(body: Record<string, unknown>): Record<string, unknown> {
  // Gate: stream:false → 403 even with valid UA/session/tools.
  body.stream = true;
  const model = typeof body.model === "string" ? body.model : "";
  if (OPENCODE_RESPONSES_MODELS.has(model) || model.includes("muse-spark")) {
    if (body.max_output_tokens === undefined) {
      if (typeof body.max_completion_tokens === "number")
        body.max_output_tokens = body.max_completion_tokens;
      else if (typeof body.max_tokens === "number") body.max_output_tokens = body.max_tokens;
    }
    delete body.max_tokens;
    delete body.max_completion_tokens;
    body.store = false;
    ensureResponsesFingerprintTools(body);
    sanitizeResponsesItems(body);
  } else {
    ensureChatFingerprintTools(body);
  }
  return body;
}

type SseChoice = { delta?: { content?: unknown }; message?: { content?: unknown } };
type SseOutputItem = { content?: Array<{ text?: unknown }> };
type SsePayload = {
  choices?: SseChoice[];
  output_text?: unknown;
  delta?: { text?: unknown };
  output?: SseOutputItem[];
};

function sseTextOf(value: unknown): string {
  return typeof value === "string" && value ? value : "";
}

/** Join text from a stream:true SSE response (chat/completions and responses shapes). */
export function extractStreamText(sseText: string): string {
  const out: string[] = [];
  for (const line of sseText.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const j = JSON.parse(payload) as SsePayload;
      out.push(sseTextOf(j.choices?.[0]?.delta?.content));
      out.push(sseTextOf(j.choices?.[0]?.message?.content));
      out.push(sseTextOf(j.output_text));
      out.push(sseTextOf(j.delta?.text));
      for (const item of j.output ?? []) {
        for (const c of item.content ?? []) out.push(sseTextOf(c.text));
      }
    } catch {
      // non-JSON SSE line (event:, comments) — skip
    }
  }
  return out.join("");
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
  {
    id: "muse-spark-1.3-contributor-free",
    vision: true,
    reasoning: true,
    note: "responses 1M ctx",
  },
  { id: "muse-spark-1.2-contributor-free", vision: true, reasoning: true, note: "1M ctx" },
  { id: "mimo-v2.5-free", vision: true, reasoning: true, note: "200K" },
  { id: "ling-3.0-flash-fin-free", vision: false, reasoning: true, note: "262K" },
  { id: "big-pickle", vision: false, reasoning: true, note: "200K" },
  { id: "kilo-auto/free", vision: false, reasoning: false, note: "256K rápido s/ reasoning" },
  { id: "stepfun/step-3.7-flash:free", vision: true, reasoning: true, note: "vision 262K" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", vision: false, reasoning: true, note: "1M" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", vision: false, reasoning: true, note: "262K" },
  {
    id: "dots-studio/dots-3-note-preview:free",
    vision: true,
    reasoning: true,
    note: "512K mas vision 400",
  },
  { id: "cohere/north-mini-code:free", vision: false, reasoning: false, note: "code 256K" },
  { id: "poolside/laguna-xs-2.1:free", vision: false, reasoning: true, note: "262K" },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    vision: true,
    reasoning: true,
    note: "256K",
  },
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
export function getAskModel(): string {
  return getCurrentAskModel();
}
export function getVisionModel(): string {
  return getCurrentVisionModel();
}

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

export async function askBansos(
  prompt: string,
  maxTokens = getAskTokens(),
): Promise<{ text: string; model: string; usage?: unknown }> {
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
    commandLogger.error(
      { type: "ai_event", action: "ask_invalid_json", status: r.status, raw: raw.slice(0, 1000) },
      "kilo invalid json",
    );
    throw new Error("IA resposta inválida. Tente novamente.");
  }

  const j = json as {
    choices?: Array<{ message?: { content?: string; reasoning?: string }; finish_reason?: string }>;
    usage?: unknown;
    error?: { message?: string };
  };

  if (!r.ok) {
    commandLogger.error(
      {
        type: "ai_event",
        action: "ask_api_error",
        status: r.status,
        body: j,
        raw: raw.slice(0, 1000),
      },
      "kilo api error",
    );
    throw new Error("IA indisponível no momento. Tente novamente.");
  }

  const rawContent = j.choices?.[0]?.message?.content ?? "";
  const content = rawContent.trim();
  const finish = j.choices?.[0]?.finish_reason;
  if (!content) {
    commandLogger.error(
      { type: "ai_event", action: "ask_empty_content", model, finish, raw: raw.slice(0, 2000) },
      "kilo empty content",
    );
    if (finish === "length") {
      // reasoning consumiu o limite e não sobrou pra content — retry automático com mais tokens (não culpa o user)
      if (maxTokens < ASK_TOKENS_MAX) {
        const retryTokens = Math.min(ASK_TOKENS_MAX, maxTokens + 1000);
        commandLogger.warn(
          { type: "ai_event", action: "ask_retry_length", model, from: maxTokens, to: retryTokens },
          "retry ask on length",
        );
        return askBansos(prompt, retryTokens);
      }
      throw new Error("Resposta truncada por limite de tokens.");
    }
    throw new Error("IA não retornou conteúdo. Tente reformular a pergunta.");
  }
  // se veio truncado mas tem conteúdo, entrega o que tem (não é erro) — só loga
  if (finish === "length" && content) {
    commandLogger.warn(
      { type: "ai_event", action: "ask_truncated", model, finish, contentLen: content.length },
      "ask truncated but delivering",
    );
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
    commandLogger.error(
      {
        type: "ai_event",
        action: "vision_invalid_json",
        status: r.status,
        raw: raw.slice(0, 1000),
      },
      "vision invalid json",
    );
    throw new Error("Visão resposta inválida. Tente novamente.");
  }
  const j = json as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: unknown;
    error?: { message?: string };
  };
  if (!r.ok) {
    commandLogger.error(
      {
        type: "ai_event",
        action: "vision_api_error",
        status: r.status,
        body: j,
        raw: raw.slice(0, 1000),
      },
      "vision api error",
    );
    throw new Error("Visão indisponível no momento. Tente novamente.");
  }
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) {
    commandLogger.error(
      {
        type: "ai_event",
        action: "vision_empty_content",
        model,
        status: r.status,
        raw: raw.slice(0, 2000),
      },
      "vision empty content",
    );
    throw new Error("Visão não retornou conteúdo. Tente novamente com outra imagem ou prompt.");
  }
  commandLogger.info(
    { type: "ai_event", model, elapsed, status: r.status, usage: j.usage },
    "vision succeeded",
  );
  return { text, model, usage: j.usage };
}
