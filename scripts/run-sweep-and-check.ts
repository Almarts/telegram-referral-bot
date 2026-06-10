import "dotenv/config";

async function main() {
  const secret = process.env.CRON_SECRET!;
  const baseUrl = "https://telegram-referral-bot-gules.vercel.app";
  
  // 1) Sweep
  console.log("=== SWEEP ===");
  const r1 = await fetch(`${baseUrl}/api/cron/sweep`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  console.log(`Status: ${r1.status}`);
  console.log(await r1.text());
  
  // 2) Check paid invoices after sweep
  console.log("\n=== DEBUG (after sweep) ===");
  const r2 = await fetch(`${baseUrl}/api/debug`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const d = await r2.json();
  
  // Show unpaid invoices
  const paid = d.paidInvoices || [];
  const unswept = paid.filter((inv: any) => !inv.swept);
  console.log(`Unswept invoices: ${unswept.length}`);
  for (const inv of unswept) {
    console.log(`  ${inv.id?.slice(0,8)} amount=${inv.amountUsdt} derivIndex=${inv.derivIndex} deposit=${inv.depositAddress}`);
  }
  
  console.log(`\nCold wallet USDT: ${d.coldWallet?.usdt}`);
}

main().catch(console.error);
