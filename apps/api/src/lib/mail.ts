import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env.js';
import { HttpError } from './http.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type Mailer = (m: Mail) => Promise<void>;

export function createTransport(e: Env) {
  return nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
  });
}

/** Sign-in subjects start with the code, so logs only get the subject with digits hidden. */
const safeSubject = (subject: string) => subject.replace(/\d{6}/g, '······');

/** Sends through SMTP when configured. Otherwise logs the email, so links still work in dev. */
export function createMailer(e: Env, log: FastifyBaseLogger): Mailer {
  if (!e.SMTP_HOST) {
    return async (m) => {
      log.warn({ to: m.to, subject: safeSubject(m.subject) }, `SMTP not configured. Email body:\n${m.text}`);
    };
  }
  const transport = createTransport(e);
  return async (m) => {
    try {
      const info = await transport.sendMail({ from: e.SMTP_FROM, ...m });
      log.info({ to: m.to, subject: safeSubject(m.subject), response: info.response }, 'Email sent');
    } catch (err) {
      log.error({ err, to: m.to, subject: safeSubject(m.subject) }, 'Email failed');
      throw new HttpError(502, "Couldn't send the email. Check the server's SMTP settings.");
    }
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function layout(heading: string, body: string, cta: string, url: string) {
  return `<!doctype html><html><body style="margin:0;background:#FAFAF8;font-family:Outfit,system-ui,sans-serif;color:#2B2621">
<div style="max-width:480px;margin:0 auto;padding:40px 24px">
<div style="font:italic 500 25px/1 Lora,Georgia,serif">Memento</div>
<h1 style="font:400 28px/1.2 Lora,Georgia,serif;margin:28px 0 12px">${esc(heading)}</h1>
<p style="font-size:15px;line-height:1.55;color:#6B6157">${body}</p>
<p style="margin:28px 0"><a href="${esc(url)}" style="display:inline-block;background:#B0592F;color:#fff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:600">${esc(cta)}</a></p>
<p style="font-size:13px;color:#6B6157">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(url)}</span></p>
</div></body></html>`;
}

export function inviteEmail(to: string, name: string, family: string, url: string): Mail {
  const body = `You're invited to the ${esc(family)} family library, ${esc(name)}. You can read every book on the shelf. The link works for 7 days.`;
  return {
    to,
    subject: `You're invited to the ${family} family library`,
    text: `Hi ${name},\n\nYou're invited to the ${family} family library on Memento. You can read every book on the shelf.\n\nJoin here (the link works for 7 days):\n${url}\n`,
    html: layout('Come see the family books', body, 'Join the library', url),
  };
}

export function magicLinkEmail(to: string, name: string, url: string, code: string): Mail {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const codeBlock = `<p style="margin:24px 0 8px;font-size:13px;color:#6B6157">Or type this code into Memento:</p>
<p style="margin:0;font:600 34px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;color:#2B2621">${spaced}</p>`;
  return {
    to,
    // The code up front lets phones offer it for autofill straight from the notification.
    subject: `${code} is your Memento sign-in code`,
    text: `Hi ${name},\n\nYour Memento sign-in code is ${spaced}.\n\nOr use this link to sign in:\n${url}\n\nBoth work once, for 15 minutes. If you didn't ask for them, you can ignore this email.\n`,
    html: layout(
      `Hi ${name}`,
      "Tap the button to sign in, or type the code below into the app. Both work once, for 15 minutes. If you didn't ask for them, you can ignore this email.",
      'Sign in',
      url,
    ).replace('<p style="font-size:13px;color:#6B6157">Or paste', `${codeBlock}\n<p style="font-size:13px;color:#6B6157;margin-top:24px">Or paste`),
  };
}

/** Tells the admin someone asked to join. */
export function accessRequestEmail(to: string, name: string, email: string, note: string, url: string): Mail {
  const noteHtml = note ? `<br><br>They wrote: <i>${esc(note)}</i>` : '';
  return {
    to,
    // The name is unchecked public input, so it stays out of the subject line.
    subject: 'Someone asked to join Memento',
    text: `${name} (${email}) asked to join the family library.${note ? `\n\nThey wrote: ${note}` : ''}\n\nApprove or decline in Editor's Desk → Family members:\n${url}\n`,
    html: layout(`${name} asked to join`, `${esc(name)} (${esc(email)}) asked to join the family library.${noteHtml}`, 'Review the request', url),
  };
}
