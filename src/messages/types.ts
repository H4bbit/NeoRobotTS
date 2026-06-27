import { proto } from "baileys";

export type ParsedMessage = proto.IWebMessageInfo & {
  key: NonNullable<proto.IWebMessageInfo["key"]>;
  message: NonNullable<proto.IWebMessageInfo["message"]>;
};
