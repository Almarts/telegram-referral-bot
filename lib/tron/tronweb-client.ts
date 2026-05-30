import { TronWeb } from "tronweb";

export function getTronWeb(apiKey?: string): TronWeb {
  return new TronWeb({
    fullHost: "https://api.trongrid.io",
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
  });
}
