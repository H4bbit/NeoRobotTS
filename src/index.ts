import { Boom } from "@hapi/boom";
import NodeCache from "@cacheable/node-cache";
import P from "pino";
import fs from "node:fs";

import {
  makeWASocket,
  type CacheStore,
  type WAMessageContent,
  type WAMessageKey,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
} from "baileys";

import { useSQLiteAuthState } from "./auth/sqliteAuth.js";
import { parseMessage } from "./messages/parser.js";
import { dispatchEvent } from "./events/dispatcher.js";

const logger = P({ level: "silent" });
const msgRetryCounterCache = new NodeCache() as CacheStore;

async function getMessage(
  key: WAMessageKey,
): Promise<WAMessageContent | undefined> {
  return proto.Message.fromObject({});
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const startSock = async () => {
  // 🔴 RESET FORÇADO (evita estado corrompido no Termux)
  if (process.env.FORCE_RESET === "true") {
    console.log("🧹 Resetando auth state...");
    fs.rmSync("./data/auth", { recursive: true, force: true });
  }

  const { state, saveCreds } = await useSQLiteAuthState(
    "./data/auth/whatsapp.sqlite",
  );

  const { version } = await fetchLatestBaileysVersion();

  console.log(`\n🤖 Bot Iniciado (Baileys v${version.join(".")})`);

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    getMessage,
  });

  sock.ev.process(async (events) => {
    if (events["creds.update"]) {
      await saveCreds();
    }

    if (events["connection.update"]) {
      const { connection, lastDisconnect } = events["connection.update"];

      if (connection === "close") {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !==
          DisconnectReason.loggedOut;

        if (shouldReconnect) {
          startSock();
        }
      }

      if (connection === "open") {
        console.log("✅ WhatsApp conectado com sucesso!");
      }
    }

    if (events["messages.upsert"]) {
      const { messages, type } = events["messages.upsert"];
      if (type !== "notify") return;

      for (const msg of messages) {
        const parsed = parseMessage(msg);
        if (!parsed) continue;
        await dispatchEvent(sock, {
          type: "MessageReceived",
          message: parsed,
        });
      }
    }
  });

  // 🔐 Pairing
  if (!sock.authState.creds.registered) {
    console.log("\n⚠️ Aparelho não registrado.");

    await sleep(3000);

    const phoneNumber = (process.env.WHATSAPP_PHONE_NUMBER || "").replace(
      /\D/g,
      "",
    );

    if (!phoneNumber) {
      console.log("❌ WHATSAPP_PHONE_NUMBER não definido");
      return;
    }

    try {
      await sock.waitForSocketOpen();

      const code = await sock.requestPairingCode(phoneNumber, undefined);

      console.log(
        `\n✅ CÓDIGO DE PAREAMENTO: ${code?.match(/.{1,4}/g)?.join("-")}`,
      );

      console.log(
        "Vá em: Aparelhos Conectados > Conectar com número de telefone\n",
      );
    } catch (err) {
      console.error("Erro no pairing:", err);
      process.exit(1);
    }
  }
};

startSock();
