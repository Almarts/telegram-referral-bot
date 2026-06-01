const { execSync } = require('child_process');
const path = require('path');

const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error('ERROR: Set VERCEL_TOKEN env var');
  process.exit(1);
}

const result = execSync(
  `npx vercel deploy --prod --token "${token}"`,
  { cwd: path.resolve(__dirname, '..'), timeout: 300000, stdio: 'inherit' }
);
