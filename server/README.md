# iConnect authentication API

This service provides email/password registration, email verification codes through Resend, PostgreSQL-backed sessions, login, profile updates, and logout. It binds to `127.0.0.1:10000` by default and is intended to sit behind an HTTPS reverse proxy.

## Requirements

- Node.js 20 or newer
- PostgreSQL 14 or newer
- A Resend API key and a sender address verified with Resend for production email delivery

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET`, and `OTP_HASH_SECRET`. Generate the two secrets independently with `openssl rand -base64 48`.
2. Create the local PostgreSQL database and user, then set `DATABASE_URL`.
3. Install packages with `npm install`.
4. Run `npm run db:migrate`.
5. In one terminal run `npm run dev:api`; in another run `npm run dev`.
6. In development without `RESEND_API_KEY`, the API prints verification codes to its local terminal. This transport is disabled in production.

The Vite development server proxies `/api` to `127.0.0.1:10000`. Production should serve the frontend and reverse-proxy `/api` to the same loopback address, over HTTPS. Public web traffic uses HTTPS port 443; do not expose backend port 10000 directly to the internet. Set `APP_ORIGIN` to the exact public frontend origin. `TRUST_PROXY=1` assumes exactly one trusted reverse proxy.

## Vercel frontend with a VPS API

The Vercel deployment URL can be `APP_ORIGIN` (for example, `https://your-project.vercel.app`). The API still needs a public HTTPS hostname on the VPS, such as `api.example.com`, with DNS pointing to the VPS and a valid TLS certificate. The Vercel rewrite connects to this hostname on standard HTTPS port 443; Nginx forwards internally to `127.0.0.1:10000`. Add an API rewrite before the existing SPA catch-all in `vercel.json`:

```json
{
  "source": "/api/:path*",
  "destination": "https://api.example.com/api/:path*"
}
```

Replace `api.example.com` with the actual HTTPS API hostname. This keeps browser requests same-origin at Vercel while forwarding them to the API. Do not expose port 10000 directly to the internet; Nginx or another trusted HTTPS reverse proxy should forward to `127.0.0.1:10000`.

## Production environment

Set `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT`, `APP_ORIGIN=https://iconnect-mu.vercel.app`, `DATABASE_URL`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SESSION_MAX_AGE_DAYS`, and `TRUST_PROXY` in the server's environment file or secret manager. Keep `.env` out of source control and never put Resend or session secrets in `VITE_*` variables.

The migration is idempotent and can be run with `npm run db:migrate`. The API also applies the base schema on startup. It does not configure PostgreSQL, DNS, Nginx, TLS, backups, or a process supervisor.
