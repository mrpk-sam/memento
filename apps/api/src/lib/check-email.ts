// Checks the server's email settings: logs in to SMTP, then sends a test email to ADMIN_EMAIL.
// In the container: docker exec memento node dist/lib/check-email.js
import { env } from '../env.js';
import { createTransport } from './mail.js';

const e = env();
if (!e.SMTP_HOST) {
  console.log('SMTP_HOST is not set in .env, so the app prints emails in its log instead of sending them.');
  process.exit(1);
}
console.log(`Connecting to ${e.SMTP_HOST}:${e.SMTP_PORT} as ${e.SMTP_USER ?? '(no user)'}…`);
const t = createTransport(e);
try {
  await t.verify();
  console.log('SMTP login OK. Sending a test email…');
  const info = await t.sendMail({ from: e.SMTP_FROM, to: e.ADMIN_EMAIL, subject: 'Memento test email', text: 'This test from your Memento server shows that email works. You can delete it.' });
  console.log(`Sent to ${e.ADMIN_EMAIL}. Server replied: ${info.response}`);
  console.log('If it is not in your inbox, check Spam and All Mail.');
} catch (err) {
  console.log('Email failed:', (err as Error).message);
  process.exit(1);
}
