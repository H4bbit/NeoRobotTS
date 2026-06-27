import { type ParsedMessage } from "../messages/types.js";

export type BotEvent = {
  type: "MessageReceived";
  message: ParsedMessage;
};
