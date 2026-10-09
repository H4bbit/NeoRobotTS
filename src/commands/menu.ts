const HEADER = ["🤖 *NeoRobot*", "⤷ _bot by S3NP41_", ""].join("\n");

function getGeralText(): string {
  return [
    HEADER,
    "📌 *Geral*",
    "- `!ping` — testa o bot",
    "- `!menu` — este menu",
    "- `!boton` / `!botoff` — ativa/desativa no grupo",
    "",
    "🎨 *Figurinhas*",
    "- `!s` — foto/vídeo → sticker (≤10s)",
    "- `!toimg` — sticker → imagem",
    "- `!tovideo` — sticker animado → vídeo",
    "- `!tovideo2` — se o `!tovideo` falhar",
    "",
    "📚 *Mais menus*",
    "- `!menu admin` — comandos de admin",
    "- `!menu ai` — comandos de IA",
    "- `!menu dono` — comandos do dono",
    "",
    "⚡ _digite `!menu` pra ver de novo_",
  ].join("\n");
}

function getAdminText(): string {
  return [
    "🤖 *NeoRobot — Admin*",
    "",
    "- `!ban` (`!banir`, `!kick`) @user — remove",
    "- `!promote` (`!promover`, `!up`) / `!demote` (`!rebaixar`, `!down`) @user",
    "- `!abrir` (`!open`) / `!fechar` (`!close`) — grupo",
    "> só funciona em grupo, com o bot admin",
    "",
    "⚡ _`!menu` volta ao geral_",
  ].join("\n");
}

function getAiText(): string {
  return [
    "🤖 *NeoRobot — IA*",
    "",
    "- `!ask` <pergunta>",
    "- `!vision` [prompt] + imagem",
    "",
    "⚡ _`!menu` volta ao geral_",
  ].join("\n");
}

function getDonoText(): string {
  return [
    "🤖 *NeoRobot — Dono*",
    "",
    "- `!ailist` — lista modelos",
    "- `!iamodel` [<id> | vision <id> | reset] — troca modelo",
    "- `!aitokens` [<n> | vision <n> | reset] — ajusta tokens",
    "- `!aipv` on|off — libera/bloqueia IA no privado",
    "- `!reveal` — revela mensagem de visualização única (responda a mídia)",
    "> comandos de dono exigem o aparelho do dono",
    "",
    "⚡ _`!menu` volta ao geral_",
  ].join("\n");
}

export type MenuSection = "geral" | "admin" | "ai" | "dono";

export function normalizeMenuSection(raw?: string): MenuSection | null {
  if (!raw) return "geral";
  switch (raw.toLowerCase()) {
    case "admin":
      return "admin";
    case "ai":
      return "ai";
    case "dono":
      return "dono";
    default:
      return null;
  }
}

export function getMenuText(section?: string): string {
  switch (normalizeMenuSection(section) ?? "geral") {
    case "admin":
      return getAdminText();
    case "ai":
      return getAiText();
    case "dono":
      return getDonoText();
    default:
      return getGeralText();
  }
}

export function getMenuUsage(): string {
  return "Uso: `!menu` [admin | ai | dono]";
}
