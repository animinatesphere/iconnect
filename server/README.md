# iConnect authentication API

This service uses Python, FastAPI, and PostgreSQL for email/password registration, Resend email verification codes, sessions, profile updates, and logout.

## Requirements

- Python 3.9 or newer
- PostgreSQL 14 or newer
- A Resend API key and a sender address verified with Resend for production email delivery

## Local setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET`, and `OTP_HASH_SECRET`. Generate the two secrets independently with `openssl rand -base64 48`.
2. Create the local PostgreSQL database and user, then set `DATABASE_URL`.
3. Create and activate a virtual environment: `python3 -m venv server/.venv` and `source server/.venv/bin/activate`.
4. Install dependencies with `pip install -r server/requirements-dev.txt`.
5. Run `npm run db:migrate`.
6. In one terminal run `npm run dev:api`; in another run `npm run dev`.
7. Without `RESEND_API_KEY`, development codes are logged only to the API terminal.

The API listens on `127.0.0.1:10000` by default. Production traffic should use HTTPS through Nginx on port 443, with Nginx forwarding privately to `127.0.0.1:10000`. Do not expose port 10000 to the internet. Set `APP_ORIGIN` to the exact public frontend origin. `TRUST_PROXY=1` assumes one trusted reverse proxy.

## Production domains

- Frontend: `https://www.iconnectdworld.com` on Vercel.
- API: `https://api.iconnectdworld.com` on the VPS, with an `A` record pointing to `203.161.49.3`.
- Vercel rewrites `/api/*` to the API hostname. Nginx terminates HTTPS and proxies to `127.0.0.1:10000`.

The Vercel rewrite must only be deployed after the API hostname has DNS, a working TLS certificate, and a running backend. DNS records do not specify ports.

## Production environment

Set `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT=10000`, `APP_ORIGIN=https://www.iconnectdworld.com`, `DATABASE_URL`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SESSION_MAX_AGE_DAYS=7`, and `TRUST_PROXY=1` in the VPS environment. Keep secrets out of source control and never put them in `VITE_*` variables.

On the VPS, create the environment with `python3 -m venv server/.venv`, install runtime packages with `server/.venv/bin/pip install -r server/requirements.txt`, and run `npm run db:migrate`. Run the API with `server/.venv/bin/uvicorn server.app.main:app --host 127.0.0.1 --port 10000`. The migration creates the account, verification-code, and session tables idempotently. The API does not configure PostgreSQL, DNS, Nginx, TLS, backups, or a process supervisor.
