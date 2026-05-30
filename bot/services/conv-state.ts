import { getKv } from "@/lib/kv";

const PREFIX = "conv:";
const DEFAULT_TTL = 300; // 5 minutes

export async function setConvState(
  tgUserId: bigint,
  state: string,
  ttl = DEFAULT_TTL,
): Promise<void> {
  await getKv().set(`${PREFIX}${tgUserId}`, state, { ex: ttl });
}

export async function getConvState(tgUserId: bigint): Promise<string | null> {
  return getKv().get(`${PREFIX}${tgUserId}`);
}

export async function clearConvState(tgUserId: bigint): Promise<void> {
  await getKv().del(`${PREFIX}${tgUserId}`);
}
