// Update TRON_COLD_WALLET_ADDRESS env var on Vercel

const TOKEN = '***';
const PROJECT = 'telegram-referral-bot';

async function vercelApi(method, p, body) {
  const url = `https://api.vercel.com${p}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  console.log(method, p, '->', res.status, JSON.stringify(data).slice(0, 200));
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// Update the cold address env var (ID from listing)
await vercelApi('PATCH', `/v10/projects/${PROJECT}/env/tMcMkrE1gq8y22CF`, {
  value: 'TRHUJ6KtbavBx1CtuXwenYurbZHMW1zPhE',
  target: ['production'],
});

// Now do a fresh deployment to pick up the new env
console.log('\nTriggering redeployment...');
const depl = await vercelApi('POST', `/v13/deployments`, {
  name: PROJECT,
  deploymentId: null,
  target: 'production',
  projectSettings: { framework: 'nextjs' },
  files: [], // empty = latest source from git
  forceNew: true,
});
console.log('Deploy result:', depl.url, depl.id?.slice(0,12)+'...');
