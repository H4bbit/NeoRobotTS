import P from "pino";
import os from "node:os";
import process from "node:process";

const logger = P({ level: "info" });

function getRuntimeInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    hostname: os.hostname(),
    uptime: process.uptime(),
  };
}

export function logCommand(event: {
  command: string;
  jid: string;
  isGroup: boolean;
  sender: string;
}) {
  const runtime = getRuntimeInfo();

  logger.info(
    {
      command: event.command,

      // contexto do chat
      jid: event.jid,
      isGroup: event.isGroup ? "group" : "private",

      // identidade do emissor
      sender: event.sender,

      // contexto da execução
      runtime,

      // tag útil pra filtragem em logs
      type: "command_event",
    },
    "command received",
  );
}
