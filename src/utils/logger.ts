import P from "pino";
import os from "node:os";

export const logger = P({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    pid: process.pid,
    hostname: os.hostname(),
  },
});

export const dbLogger = logger.child({ module: "db" });
export const commandLogger = logger.child({ module: "command" });
export const webpLogger = logger.child({ module: "webp" });
export const stickerLogger = logger.child({ module: "sticker" });
