import { execSync } from "child_process";
const token = "vcp_1MgYgGEF1rXet9y2tJGFwuu1nbQXyyxPBNTNS4XwDNMDsTuv2H1dZ7h3";
const result = execSync(
  `npx vercel --prod --token="${token}"`,
  { cwd: "C:/Users/marts/projects/telegram-referral-bot-main", maxBuffer: 1024 * 1024, timeout: 120_000, encoding: "utf8" }
);
console.log(result);
