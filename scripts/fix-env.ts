import "dotenv/config";

const VERCEL_TOKEN = require("fs").readFileSync(".vercel-token", "utf-8").trim();
const PROJECT = "prj_DYW9SrpR5DJDAWjc06bCJu2KlHEA";
const API = "https://api.vercel.com";

const LOCAL = require("fs").readFileSync(".env.local", "utf-8");
const LOCAL_UPSTASH = LOCAL.match(/UPSTASH_REDIS_REST_TOKEN=(.+)/)?.[1]?.trim();
const LOCAL_SECRET = LOCAL.match(/TELEGRAM_WEBHOOK_SECRET=(.+)/)?.[1]?.trim();

const AUTH = { headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" } };

async function main() {
  console.log("Local Upstash token:", LOCAL_UPSTASH?.substring(0, 15) + "...");
  console.log("Local webhook secret:", LOCAL_SECRET?.substring(0, 10) + "...");

  // Get existing envs
  const envRes = await fetch(`${API}/v10/projects/${PROJECT}/env`, AUTH);
  const envs = (await envRes.json()).envs;

  // Fix UPSTASH_REDIS_REST_TOKEN
  const upstashEnv = envs.find(e => e.key === "UPSTASH_REDIS_REST_TOKEN");
  if (upstashEnv) {
    await fetch(`${API}/v10/projects/${PROJECT}/env/${upstashEnv.id}`, {
      method: "DELETE", headers: AUTH.headers,
    });
    console.log("Deleted old UPSTASH_REDIS_REST_TOKEN");
  }
  const newUp = await fetch(`${API}/v10/projects/${PROJECT}/env`, {
    method: "POST", headers: AUTH.headers,
    body: JSON.stringify({
      key: "UPSTASH_REDIS_REST_TOKEN",
      value: LOCAL_UPSTASH,
      target: ["production"],
      type: "encrypted",
    }),
  });
  const upRes = await newUp.json();
  console.log("UPSTASH_REDIS_REST_TOKEN updated:", upRes.created?.id);

  // Fix TELEGRAM_WEBHOOK_SECRET
  const secretEnv = envs.find(e => e.key === "TELEGRAM_WEBHOOK_SECRET");
  if (secretEnv) {
    await fetch(`${API}/v10/projects/${PROJECT}/env/${secretEnv.id}`, {
      method: "DELETE", headers: AUTH.headers,
    });
    console.log("Deleted old TELEGRAM_WEBHOOK_SECRET");
  }
  const newSec = await fetch(`${API}/v10/projects/${PROJECT}/env`, {
    method: "POST", headers: AUTH.headers,
    body: JSON.stringify({
      key: "TELEGRAM_WEBHOOK_SECRET",
      value: LOCAL_SECRET,
      target: ["production"],
      type: "encrypted",
    }),
  });
  const secRes = await newSec.json();
  console.log("TELEGRAM_WEBHOOK_SECRET updated:", secRes.created?.id);

  // Redeploy
  console.log("Redeploying...");
  const exec = require("child_process").execSync;
  const out = exec(`npx vercel deploy --token "${VERCEL_TOKEN}" --prod --yes`, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
  }).toString();
  
  // Get the final URL
  const lines = out.split("\n");
  const urlLine = lines.find(l => l.includes("https://telegram-referral-bot-gules.vercel.app"));
  console.log("Deploy complete!");
  
  // Re-set webhook with correct secret
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  const whRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://telegram-referral-bot-gules.vercel.app/api/tg/webhook",
      secret_token: LOCAL_SECRET,
      max_connections: 40,
    }),
  });
  const whData = await whRes.json();
  console.log("Webhook re-set:", whData.ok ? "OK" : whData.description);
}

main().catch(console.error);
