import { proto } from "baileys";

export type BotEvent = {
  type: "MessageReceived";
  message: proto.IWebMessageInfo;
};
