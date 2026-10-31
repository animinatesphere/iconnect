# iConnect API

This service uses Python, FastAPI, and PostgreSQL for email/password registration, Resend email verification codes, sessions, profile updates, persistent social text posts, likes, comments, follows, and private direct messages.

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

## Social feed API

All social routes require a verified, signed-in account and use the existing secure session cookie:

- `GET /api/social/posts?limit=50` lists the newest posts (1–100 per request).
- `POST /api/social/posts` creates a text post (`{"text":"..."}`, up to 500 characters).
- `GET /api/social/posts/{post_id}` returns a post with its current like and comment counts.
- `PUT /api/social/posts/{post_id}/like` sets the signed-in user's like state (`{"liked":true|false}`); repeating the same request is safe.
- `GET /api/social/posts/{post_id}/comments?limit=100` lists comments (1–200 per request).
- `POST /api/social/posts/{post_id}/comments` creates a comment (`{"text":"..."}`, up to 280 characters).

Post creation, likes, and comments are rate-limited per client IP. `GET /api/social/posts?following_only=true` limits results to authors the current user follows. The current social composer and feed display these database-backed records; illustrative sample posts and browser-only demo interactions remain separate. Photo and video uploads are not implemented.

## People API

All people routes require a verified account and omit private email addresses. Profiles must have both account privacy options enabled to appear:

- `GET /api/people?query=design&limit=50` searches verified profiles by name, username, or interest prefix. Search is optional; limits are 1–100.
- `GET /api/people?following_only=true` lists accounts the signed-in user follows.
- `PUT /api/people/{person_id}/follow` sets follow state (`{"following":true|false}`); repeating the same request is safe.
- `PUT /api/auth/preferences` updates the signed-in user's discovery choices (`{"profile_visible":true,"discoverable":true}`); `GET /api/auth/me` returns the current values.

Responses include public bio/interests, follow counts, and whether the current account follows that person. Follow state is stored in PostgreSQL.
The same privacy preferences also control whether an account appears in message recipient search or can receive a new conversation.

## Job Hub API

All job routes require a verified, signed-in account:

- `GET /api/jobs?query=design&location=remote&workplace_type=remote&view=all` searches listings. `view` can be `all`, `saved`, `applied`, or `mine`; results include the signed-in user's save/application state.
- `POST /api/jobs` publishes a listing with title, company, location, employment type, workplace type (`remote`, `hybrid`, or `onsite`), summary, and description.
- `PUT /api/jobs/{job_id}/save` sets saved state (`{"saved":true|false}`); repeating the same request is safe.
- `POST /api/jobs/{job_id}/applications` submits an optional cover letter. Duplicate applications do not create duplicate records, and listing owners cannot apply to their own roles.
- `GET /api/jobs/{job_id}/applications` lists applicants only for the owner of that listing. Applicant email addresses are not returned.

Listings, saved roles, and applications are stored in PostgreSQL. Listings are visible to signed-in members as soon as they're published; moderation, CV uploads, and employer application-status updates are not implemented. Members should verify listing details before sharing sensitive information.

## Direct messaging API

All messaging routes require a verified account and return only participants' public names and usernames (never email addresses):

- `GET /api/messages/users?query=bo` searches verified accounts by name or username prefix.
- `GET /api/messages/conversations` lists the signed-in user's conversations and unread counts.
- `POST /api/messages/conversations` opens or creates a private one-to-one conversation (`{"recipient_id":"<user-id>"}`).
- `GET /api/messages/conversations/{conversation_id}/messages?limit=100` loads messages and marks incoming messages as read.
- `POST /api/messages/conversations/{conversation_id}/messages` sends a text message (`{"text":"..."}`, up to 2,000 characters).

Message sending is rate-limited per client IP. Every read and write verifies conversation membership. The inbox refreshes an open conversation periodically; attachments, message deletion, voice/video calls, and push delivery are not implemented. Sample conversations remain local illustrative content.

## Production domains

- Frontend: `https://www.iconnectdworld.com` on Vercel.
- API: `https://api.iconnectdworld.com` on the VPS, with an `A` record pointing to `203.161.49.3`.
- Vercel rewrites `/api/*` to the API hostname. Nginx terminates HTTPS and proxies to `127.0.0.1:10000`.

The Vercel rewrite must only be deployed after the API hostname has DNS, a working TLS certificate, and a running backend. DNS records do not specify ports.

## Production environment

Set `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT=10000`, `APP_ORIGIN=https://www.iconnectdworld.com`, `DATABASE_URL`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SESSION_MAX_AGE_DAYS=7`, and `TRUST_PROXY=1` in the VPS environment. Keep secrets out of source control and never put them in `VITE_*` variables.

On the VPS, create the environment with `python3 -m venv server/.venv`, install runtime packages with `server/.venv/bin/pip install -r server/requirements.txt`, and run `npm run db:migrate`. Run the API with `server/.venv/bin/uvicorn server.app.main:app --host 127.0.0.1 --port 10000`. The migration creates the account, verification-code, session, social feed, messaging, follow, and job tables idempotently. The API does not configure PostgreSQL, DNS, Nginx, TLS, backups, or a process supervisor.
