import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFakeTron } from "./fake";
import { getTron, __setTronForTesting, __resetTronForTesting } from "./index";

function makeSigner() {
  return { address: "FAKE", sign: async () => ({ txId: "0xdeadbeef" }) };
}

describe("createFakeTron", () => {
  let tron: ReturnType<typeof createFakeTron>;

  beforeEach(() => {
    tron = createFakeTron();
  });

  describe("deriveDepositAddress", () => {
    it("returns T-prefixed address that varies by index", () => {
      const a0 = tron.deriveDepositAddress(0);
      const a1 = tron.deriveDepositAddress(1);
      expect(a0.address).toMatch(/^T/);
      expect(a0.address).not.toBe(a1.address);
    });

    it("is deterministic per index", () => {
      expect(tron.deriveDepositAddress(5).address).toBe(
        tron.deriveDepositAddress(5).address,
      );
    });
  });

  describe("signerForIndex", () => {
    it("address matches deriveDepositAddress for the same index", () => {
      const addr = tron.deriveDepositAddress(3);
      const signer = tron.signerForIndex(3);
      expect(signer.address).toBe(addr.address);
    });

    it("sign() returns a txId", async () => {
      const signer = tron.signerForIndex(0);
      const result = await signer.sign({});
      expect(result.txId).toMatch(/^0x/);
    });
  });

  describe("hotSigner", () => {
    it("has H-prefixed address", () => {
      const signer = tron.hotSigner();
      expect(signer.address).toMatch(/^H/);
    });

    it("sign() works", async () => {
      const signer = tron.hotSigner();
      const result = await signer.sign({});
      expect(result.txId).toMatch(/^0x/);
    });
  });

  describe("usdtBalance / __setUsdtBalance", () => {
    it("defaults to 0.000000", async () => {
      expect(await tron.usdtBalance("T000")).toBe("0.000000");
    });

    it("returns value set by controls", async () => {
      tron.controls.__setUsdtBalance("T001", "100.500000");
      expect(await tron.usdtBalance("T001")).toBe("100.500000");
    });
  });

  describe("sendUsdt", () => {
    it("debits from and credits to balances", async () => {
      tron.controls.__setUsdtBalance("FROM", "100.000000");

      const { txHash } = await tron.sendUsdt({
        fromAddress: "FROM",
        toAddress: "TO",
        amount: "30.000000",
        signer: makeSigner(),
      });

      expect(txHash).toMatch(/^0x/);
      expect(await tron.usdtBalance("FROM")).toBe("70.000000");
      expect(await tron.usdtBalance("TO")).toBe("30.000000");
    });

    it("credits to address with no prior balance", async () => {
      tron.controls.__setUsdtBalance("FROM", "10.000000");

      await tron.sendUsdt({
        fromAddress: "FROM", toAddress: "NEW", amount: "5.000000",
        signer: makeSigner(),
      });

      expect(await tron.usdtBalance("NEW")).toBe("5.000000");
    });

    it("increments sendUsdtCount", async () => {
      expect(tron.controls.__sendUsdtCount).toBe(0);
      await tron.sendUsdt({
        fromAddress: "A", toAddress: "B", amount: "1.000000",
        signer: makeSigner(),
      });
      expect(tron.controls.__sendUsdtCount).toBe(1);
    });

    it("allows negative balance (does not enforce overdraft for tests)", async () => {
      // fromAddress has no balance set -> defaults to 0
      await tron.sendUsdt({
        fromAddress: "BROKE", toAddress: "RICH", amount: "100.000000",
        signer: makeSigner(),
      });
      expect(await tron.usdtBalance("BROKE")).toBe("-100.000000");
    });

    it("each send produces a unique tx hash", async () => {
      const r1 = await tron.sendUsdt({
        fromAddress: "A", toAddress: "B", amount: "1.000000",
        signer: makeSigner(),
      });
      const r2 = await tron.sendUsdt({
        fromAddress: "A", toAddress: "B", amount: "1.000000",
        signer: makeSigner(),
      });
      expect(r1.txHash).not.toBe(r2.txHash);
    });
  });

  describe("listUsdtTransfersTo / __injectTransfer", () => {
    it("returns injected confirmed transfers", async () => {
      tron.controls.__injectTransfer("DEST", {
        txHash: "0x1", from: "SRC", to: "DEST",
        amountUsdt: "50.000000",
        blockTimestamp: Math.floor(Date.now() / 1000) - 100,
        confirmed: true,
      });

      const transfers = await tron.listUsdtTransfersTo("DEST");
      expect(transfers).toHaveLength(1);
      expect(transfers[0].amountUsdt).toBe("50.000000");
      expect(transfers[0].txHash).toBe("0x1");
    });

    it("filters by sinceMs", async () => {
      const now = Date.now();
      tron.controls.__injectTransfer("DEST", {
        txHash: "0x1", from: "S", to: "DEST",
        amountUsdt: "1.000000",
        blockTimestamp: Math.floor((now - 200_000) / 1000),
        confirmed: true,
      });
      tron.controls.__injectTransfer("DEST", {
        txHash: "0x2", from: "S", to: "DEST",
        amountUsdt: "2.000000",
        blockTimestamp: Math.floor((now - 50_000) / 1000),
        confirmed: true,
      });

      const recent = await tron.listUsdtTransfersTo("DEST", {
        sinceMs: now - 100_000,
      });
      expect(recent).toHaveLength(1);
      expect(recent[0].amountUsdt).toBe("2.000000");
    });

    it("filters out unconfirmed transfers", async () => {
      tron.controls.__injectTransfer("DEST", {
        txHash: "0x1", from: "S", to: "DEST",
        amountUsdt: "1.000000",
        blockTimestamp: Math.floor(Date.now() / 1000),
        confirmed: false,
      });

      const transfers = await tron.listUsdtTransfersTo("DEST");
      expect(transfers).toHaveLength(0);
    });

    it("honors limit option", async () => {
      for (let i = 0; i < 5; i++) {
        tron.controls.__injectTransfer("DEST", {
          txHash: `0x${i}`, from: "S", to: "DEST",
          amountUsdt: `${i + 1}.000000`,
          blockTimestamp: 1000 + i,
          confirmed: true,
        });
      }

      const transfers = await tron.listUsdtTransfersTo("DEST", { limit: 2 });
      expect(transfers).toHaveLength(2);
      expect(transfers[0].amountUsdt).toBe("4.000000");  // second-highest timestamp
      expect(transfers[1].amountUsdt).toBe("5.000000");  // highest timestamp
    });

    it("returns empty array for unknown address", async () => {
      const transfers = await tron.listUsdtTransfersTo("UNKNOWN");
      expect(transfers).toEqual([]);
    });
  });

  describe("sendTrx / trxBalanceSun", () => {
    it("debits and credits TRX balances", async () => {
      tron.controls.__setTrxBalance("FROM", 10_000_000n);

      await tron.sendTrx({
        fromAddress: "FROM", toAddress: "TO",
        amountSun: 3_000_000n,
        signer: makeSigner(),
      });

      expect(await tron.trxBalanceSun("FROM")).toBe(7_000_000n);
      expect(await tron.trxBalanceSun("TO")).toBe(3_000_000n);
    });

    it("defaults TRX balance to 0 for new addresses", async () => {
      expect(await tron.trxBalanceSun("NEW")).toBe(0n);
    });

    it("increments sendTrxCount", async () => {
      expect(tron.controls.__sendTrxCount).toBe(0);
      await tron.sendTrx({
        fromAddress: "A", toAddress: "B", amountSun: 1n,
        signer: makeSigner(),
      });
      expect(tron.controls.__sendTrxCount).toBe(1);
    });
  });

  describe("controls isolation", () => {
    it("two createFakeTron() instances do not share state", async () => {
      const a = createFakeTron();
      const b = createFakeTron();

      a.controls.__setUsdtBalance("ADDR", "100.000000");
      expect(await b.usdtBalance("ADDR")).toBe("0.000000");
    });
  });
});

describe("singleton wiring (getTron / __setTronForTesting)", () => {
  afterEach(() => {
    __resetTronForTesting();
  });

  it("getTron returns a default fake", () => {
    const svc = getTron();
    expect(svc.deriveDepositAddress).toBeInstanceOf(Function);
  });

  it("__setTronForTesting overrides getTron", () => {
    const override = createFakeTron();
    __setTronForTesting(override);
    expect(getTron()).toBe(override);
  });

  it("__resetTronForTesting clears override and creates fresh default", () => {
    const override = createFakeTron();
    __setTronForTesting(override);
    __resetTronForTesting();
    const afterReset = getTron();
    expect(afterReset.deriveDepositAddress).toBeInstanceOf(Function);
  });
});
