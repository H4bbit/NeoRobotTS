import { type WASocket } from "baileys";
import { commandController } from "../commands/controller.js";
import { type BotEvent } from "./types.js";

export async function dispatchEvent(sock: WASocket, event: BotEvent) {
  switch (event.type) {
    case "MessageReceived":
      await commandController(sock, event);
      break;
  }
}
