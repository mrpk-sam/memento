# Security

## Reporting a problem

Please don't open a public issue for a security problem. Use GitHub's private reporting instead: the **Security** tab of this repository → **Report a vulnerability**.

Say what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a week.

## How Memento protects your data

- Sign-in is by single-use email link or 6-digit code. There are no passwords to leak.
- Sessions are random tokens in an httpOnly cookie. Only their SHA-256 hash is stored.
- Every API route checks the session and the person's permissions on the server.
- Book PINs are argon2id hashes, with 5 tries per 10 minutes per person per book.
- The AI API key is encrypted at rest (AES-256-GCM) and never sent to the browser.
- Images are re-encoded on upload, which strips EXIF data such as GPS location.
- Pages get a strict Content Security Policy, and writes from other sites are refused.

## Running it safely

- Use long random values for `SESSION_SECRET` and `ENCRYPTION_KEY` (see `.env.example`).
- Put the app behind an HTTPS reverse proxy, and set `TRUST_PROXY` to match it. Don't expose port 3000 to anything but the proxy.
- Set up SMTP. Without it, sign-in links are written to the server log, and anyone who can read the log can sign in.
- Keep the MinIO bucket private.
