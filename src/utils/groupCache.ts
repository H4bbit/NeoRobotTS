import NodeCache from "@cacheable/node-cache";
import type { GroupMetadata } from "baileys";

export const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false });

export async function getCachedGroupMetadata(
  sock: { groupMetadata: (jid: string) => Promise<GroupMetadata> },
  jid: string,
): Promise<GroupMetadata> {
  const cached = groupCache.get(jid) as GroupMetadata | undefined;
  if (cached) return cached;
  const fresh = await sock.groupMetadata(jid);
  groupCache.set(jid, fresh);
  return fresh;
}
