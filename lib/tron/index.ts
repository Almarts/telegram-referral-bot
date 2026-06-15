import type { TronService } from "./types";
import { createFakeTron } from "./fake";
import { createRealTron } from "./real";
import { getEnv } from "@/lib/env";

let _tron: TronService | null = null;
let _testOverride: TronService | null = null;

export function getTron(): TronService {
  if (_testOverride) return _testOverride;
  if (!_tron) {
    if (process.env.TRON_FAKE === "1") {
      _tron = createFakeTron();
    } else {
      _tron = createRealTron({
        apiKey: getEnv().TRONGRID_API_KEY,
      });
    }
  }
  return _tron;
}

export function __setTronForTesting(svc: TronService): void {
  _testOverride = svc;
}

export function __resetTronForTesting(): void {
  _testOverride = null;
  _tron = null;
}

export type { TronService, UsdtTransfer, Signer } from "./types";
