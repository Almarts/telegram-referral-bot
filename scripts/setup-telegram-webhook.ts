/**
 * Register the Telegram bot webhook with the production URL.
 *
 * Usage:
 *   npx tsx scripts/setup-telegram-webhook.ts [baseUrl]
 *
 * If baseUrl is omitted, reads DEPLOY_URL from env.
 */
import { parseEnv } from "@/lib/env";

async function main() {
  const env = parseEnv();

  const baseUrl = process.argv[2] || process.env.DEPLOY_URL;
  if (!baseUrl) {
    console.error("Usage: npx tsx scripts/setup-telegram-webhook.ts <baseUrl>");
    console.error("  or set DEPLOY_URL env var");
    process.exit(1);
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/tg/webhook`;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;

  const resp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        drop_pending_updates: true,
      }),
    },
  );

  const result = await resp.json();
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    console.error("Failed to set webhook:", result.description);
    process.exit(1);
  }

  console.log(`Webhook set: ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
