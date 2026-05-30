import type { TronService } from "./types";
import { createFakeTron } from "./fake";
import { createRealTron } from "./real";
import { getEnv } from "@/lib/env";

let _tron: TronService | null = null;
let _testOverride: TronService | null = null;

/**
 * Return the current TronService.
 *
 * - When `process.env.TRON_FAKE === "1"`, creates an in-memory fake (no TRON
 *   network access). Useful for local dev / CI without real TRON keys.
 * - Otherwise creates a real TronService backed by @scure/bip32 HD derivation
 *   and the TronGrid REST API.
 * - During tests, use __setTronForTesting / __resetTronForTesting to inject a
 *   fake or mock.
 */
export function getTron(): TronService {
  if (_testOverride) return _testOverride;
  if (!_tron) {
    if (process.env.TRON_FAKE === "1") {
      _tron = createFakeTron();
    } else {
      _tron = createRealTron({
        xprv: getEnv().TRON_DEPOSIT_XPRV,
        hotPk: getEnv().TRON_HOT_WALLET_PK,
        apiKey: getEnv().TRONGRID_API_KEY,
      });
    }
  }
  return _tron;
}

/** Inject a fake instance for testing. */
export function __setTronForTesting(svc: TronService): void {
  _testOverride = svc;
}

/** Reset to default state. Call in afterEach. */
export function __resetTronForTesting(): void {
  _testOverride = null;
  _tron = null;
}

export type { TronService, UsdtTransfer, Signer } from "./types";
