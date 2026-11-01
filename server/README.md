# iConnect API

This service uses Python, FastAPI, and PostgreSQL for email/password registration, designed Resend email verification codes, sessions, profile updates, persistent social posts with photo galleries, likes, bookmarks, comments, follows, and private direct messages.

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

The API listens on `127.0.0.1:10000` by default. Production traffic should use HTTPS through Nginx on port 443, with Nginx forwarding privately to `127.0.0.1:10000`. Do not expose port 10000 to the internet. Set `APP_ORIGIN` to the exact public frontend origin. `TRUST_PROXY=1` assumes one trusted reverse proxy. Uploaded images are optimized to WebP and stored in `ICONNECT_MEDIA_DIR` (default: `./uploads` relative to the repository root); use a persistent directory and make it writable by the API service account.

## Social feed API

All social routes require a verified, signed-in account and use the existing secure session cookie:

- `GET /api/social/posts?limit=50` lists the newest posts (1–100 per request).
- `POST /api/social/posts` creates a text post with up to five `image_urls` (`{"text":"...","image_urls":["/api/media/images/<id>.webp"]}`, up to 500 characters).
- `PUT /api/social/posts/{post_id}` updates a post's text and image URLs; only its author can edit it.
- `DELETE /api/social/posts/{post_id}` permanently deletes a post and its dependent likes, bookmarks, and comments; only its author can delete it.
- `GET /api/social/posts/{post_id}` returns a post with its current like and comment counts.
- `GET /api/social/posts?bookmarked_only=true` lists the signed-in user's saved posts; each returned post includes `bookmarkedByMe`.
- `PUT /api/social/posts/{post_id}/bookmark` sets saved state (`{"bookmarked":true|false}`); repeating the same request is safe.
- `PUT /api/social/posts/{post_id}/like` sets the signed-in user's like state (`{"liked":true|false}`); repeating the same request is safe.
- `GET /api/social/posts/{post_id}/comments?limit=100` lists comments (1–200 per request).
- `POST /api/social/posts/{post_id}/comments` creates a comment (`{"text":"..."}`, up to 280 characters); an optional `parent_comment_id` replies to a top-level comment on that post. Replies are limited to one level.

`POST /api/media/images` accepts one authenticated JPEG, PNG, or WebP image (maximum 4 MB and 20 megapixels); uploaded files are validated, resized, and stored as WebP. The web app automatically optimizes larger selected photos before upload. Image files are stored on the API host in `ICONNECT_MEDIA_DIR` (default: `./uploads` relative to the repository root), not in PostgreSQL; production should point this variable at a persistent VPS directory and make it writable by the API service account. Images are served to signed-in members at the returned URL. Upload controls are available for posts, profile photos, private-message attachments, iBuy products, local listings, community covers, and job/company photos. Post creation, likes, comments, bookmarks, and image uploads are rate-limited per client IP. `GET /api/social/posts?following_only=true` limits results to authors the current user follows. Stories and video uploads are not implemented.

- `PUT /api/auth/profile/photo` updates or removes the signed-in member's photo (`{"image_url":"/api/media/images/<id>.webp"}` or `{"image_url":null}`).

## iBuy marketplace API

All marketplace routes require a verified account:

- `GET /api/marketplace/products?query=lamp&category=Home&limit=50` lists published member products. Search is optional, category can be `Style`, `Tech`, `Home`, or `Other`, and limits are 1–100.
- `POST /api/marketplace/products` publishes a listing with `name`, `category`, integer `price` in NGN, `stock`, `description`, and up to five `image_urls` (plus optional legacy HTTPS `image_url`).
- `GET /api/marketplace/products/{product_id}` returns a published product and the seller’s public name and username.

Listings and image galleries are stored in PostgreSQL, with uploaded image files in `ICONNECT_MEDIA_DIR`. Signed-in members can list products from iBuy; allowlisted admins sign in at `/admin/login` and can use “Open iBuy to list a product” in the admin portal. Buyers can message a seller through the private messaging API. iBuy does not currently process payments, place orders, or arrange delivery; buyers and sellers must confirm those details directly.

## Local marketplace API

All local marketplace routes require a verified account:

- `GET /api/local-marketplace/listings?category=Homes&query=apartment&location=Lagos&limit=50` lists published member listings. `category` can be `Homes`, `Services`, or `Farm`; each filter is optional and `limit` is 1–100.
- `POST /api/local-marketplace/listings` publishes a listing with `category`, `title`, `price`, `location`, `detail`, `description`, and an optional HTTPS or uploaded-image `image_url`.
- `GET /api/local-marketplace/listings/{listing_id}` returns a published listing and the provider’s public name and username.

Listings are stored in PostgreSQL. Members can message a provider through private messaging. Payments, bookings, external social account connections, and delivery are not implemented; members must confirm those details directly.

## People API

All people routes require a verified account and omit private email addresses. Profiles must have both account privacy options enabled to appear:

- `GET /api/people?query=design&limit=50` searches verified profiles by name, username, or interest prefix. Search is optional; limits are 1–100.
- `GET /api/people?following_only=true` lists accounts the signed-in user follows.
- `PUT /api/people/{person_id}/follow` sets follow state (`{"following":true|false}`); repeating the same request is safe.
- `PUT /api/auth/preferences` updates the signed-in user's discovery choices (`{"profile_visible":true,"discoverable":true}`); `GET /api/auth/me` returns the current values.

Responses include public bio/interests, follow counts, and whether the current account follows that person. Follow state is stored in PostgreSQL.
The same privacy preferences also control whether an account appears in message recipient search or can receive a new conversation.

## Communities API

All community routes require a verified account:

- `GET /api/communities?query=makers&limit=50` lists communities, the current membership state, and member count without exposing members’ private account details. Search is optional and `limit` is 1–100.
- `POST /api/communities` creates a community with `name`, `description`, and an optional uploaded `image_url`; its creator is automatically joined.
- `PUT /api/communities/{community_id}/membership` joins or leaves a community with `{"joined":true|false}`. Repeating the same request is safe.

Communities and memberships are stored in PostgreSQL.

## Job Hub API

All job routes require a verified, signed-in account:

- `GET /api/jobs?query=design&location=remote&workplace_type=remote&view=all` searches listings. `view` can be `all`, `saved`, `applied`, or `mine`; results include the signed-in user's save/application state.
- `POST /api/jobs` publishes a listing with title, company, location, employment type, workplace type (`remote`, `hybrid`, or `onsite`), summary, description, and optional uploaded `company_image_url`.
- `PUT /api/jobs/{job_id}/save` sets saved state (`{"saved":true|false}`); repeating the same request is safe.
- `POST /api/jobs/{job_id}/applications` submits an optional cover letter. Duplicate applications do not create duplicate records, and listing owners cannot apply to their own roles.
- `GET /api/jobs/{job_id}/applications` lists applicants only for the owner of that listing. Applicant email addresses are not returned.

Listings, saved roles, and applications are stored in PostgreSQL. Listings are visible to signed-in members as soon as they're published; moderation, CV uploads, and employer application-status updates are not implemented. Members should verify listing details before sharing sensitive information.

## Direct messaging API

All messaging routes require a verified account and return only participants' public names and usernames (never email addresses):

- `GET /api/messages/users?query=bo` searches verified accounts by name or username prefix.
- `GET /api/messages/conversations` lists the signed-in user's conversations and unread counts.
- `POST /api/messages/conversations` opens or creates a private one-to-one conversation (`{"recipient_id":"<user-id>"}`).
- `GET /api/messages/conversations/{conversation_id}/messages?limit=100` loads recent messages and marks incoming messages as read; add `query=<text>` to search the conversation without changing read receipts.
- `POST /api/messages/conversations/{conversation_id}/messages` sends text (`{"text":"..."}`, up to 2,000 characters), one uploaded photo (`{"image_url":"/api/media/images/<id>.webp"}`), or both.
- `PUT /api/messages/conversations/{conversation_id}/block` blocks or unblocks the other participant (`{"blocked":true}`); either participant's block prevents both people from sending.
- `PUT /api/messages/conversations/{conversation_id}/preferences` saves that member's mute and archive settings (`{"is_muted":true,"is_archived":false}`).

Message responses include `readAt`; senders can show a read receipt after the recipient opens that conversation. Message sending is rate-limited per client IP. Every read and write verifies conversation membership. Chat search queries stored message history. Mute suppresses the in-app incoming sound, while archive hides the conversation from the default and unread inbox views. File attachments other than photos, message deletion, voice/video calls, and push delivery are not implemented.

## Live updates

The authenticated WebSocket endpoint at `/api/realtime` streams message-created and read-receipt events to the conversation participants, and post/comment changes to connected members. Events contain identifiers and metadata, not message or comment text. The web app reconnects automatically, refreshes on reconnect, and keeps a 60-second polling fallback for inbox recovery.

The API currently fans out events in process memory, so deploy it as a single Uvicorn worker/instance. Multiple workers or API instances require a shared event broker before deployment. Nginx must proxy `/api/realtime` using HTTP/1.1 and forward the `Upgrade` and `Connection` headers; keep its read timeout longer than the API's 25-second WebSocket heartbeat interval. Without WebSocket upgrade proxying, inbox updates fall back to polling, while feed and comment changes will not arrive live.

## Unconnected product areas

The app does not currently have provider-backed APIs for travel bookings, wallet balances or transfers, payments, trading, video storage or streaming, notifications, or external social account connections. The AI assistant uses static example text and is not connected to an AI service. These areas are presented as unavailable or informational in the app; they do not create reservations, financial transactions, uploads, or persistent activity.

## Admin API

Super-admin access is restricted on the server to verified accounts whose email addresses are listed in the comma-separated `ADMIN_EMAILS` environment variable. For example, set `ADMIN_EMAILS=admin@example.com` on the API server after registering and verifying that account through the normal signup flow. Multiple addresses can be separated with commas. An empty value disables super-admin access. Never expose this setting through a `VITE_*` variable.

Super-admins can grant or revoke database-managed sub-admin access for existing, email-verified accounts. Sub-admins can inspect and suspend normal user accounts, manage posts/comments/listings/jobs/communities, and manage iBuy products. They cannot view private message contents, assign administrator roles, or suspend administrator accounts. Super-admins retain the server allowlist as their source of authority and can view private messages; user-detail reads are audited for both roles.

The admin portal at `/admin/login` uses the same secure session cookie as the rest of the API:

- `POST /api/admin/login` verifies the account password, email verification, and super-admin allowlist or sub-admin role.
- `GET /api/admin/me` confirms the current session has admin access.
- `GET /api/admin/overview` returns platform totals and seven-day new-account, post, product, and job counts.
- `GET /api/admin/users?query=alex&limit=50&offset=0` searches account names, usernames, and email addresses. Limits are 1–100.
- `POST /api/admin/users/{user_id}/suspension` suspends or restores a normal account. Suspending revokes its active sessions; administrator accounts and the current admin cannot be suspended through this endpoint.
- `GET /api/admin/users/{user_id}?limit=100&offset=0` returns account details and paginated posts, comments, likes, saved posts, marketplace listings, job activity, communities, and follow activity. Only super-admins receive private message contents. Limits are 1–200.
- `GET /api/admin/content?type=posts|comments|products|local_listings|jobs|communities` searches live user content. `DELETE /api/admin/content/{type}/{id}` removes a selected record and writes an audit event.
- `PUT /api/admin/products/{product_id}` edits an iBuy product, its photo gallery, and its published state. Product creation uses the authenticated marketplace endpoint and the normal authenticated image-upload endpoint.
- `GET /api/admin/subadmins`, `POST /api/admin/subadmins`, and `DELETE /api/admin/subadmins/{user_id}` manage sub-admins and are restricted to super-admins.
- `GET /api/admin/audit-log?limit=100` lists recent user-detail reads and administrative changes. Limits are 1–200.

All admin endpoints independently enforce the server-side role checks. The `admin_roles` and `admin_audit_log` tables and account suspension field are created by the idempotent database migration; run `npm run db:migrate` before starting the updated API.

## Production domains

- Frontend: `https://www.iconnectdworld.com` on Vercel.
- API: `https://api.iconnectdworld.com` on the VPS, with an `A` record pointing to `203.161.49.3`.
- Vercel rewrites `/api/*` to the API hostname. Nginx terminates HTTPS and proxies to `127.0.0.1:10000`.

The Vercel rewrite must only be deployed after the API hostname has DNS, a working TLS certificate, and a running backend. DNS records do not specify ports.

## Production environment

Set `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT=10000`, `APP_ORIGIN=https://www.iconnectdworld.com`, `DATABASE_URL`, `SESSION_SECRET`, `OTP_HASH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SESSION_MAX_AGE_DAYS=7`, `TRUST_PROXY=1`, the intended server-only `ADMIN_EMAILS`, and `ICONNECT_MEDIA_DIR=/var/lib/iconnect/uploads` in the VPS environment. Create the media directory and make it writable by the API service account before starting the API. Keep secrets out of source control and never put them in `VITE_*` variables.

On the VPS, create the environment with `python3 -m venv server/.venv`, install runtime packages with `server/.venv/bin/pip install -r server/requirements.txt`, and run `npm run db:migrate`. Configure the Nginx API virtual host with `client_max_body_size 5m;` so image uploads under the API's 4 MB limit are accepted, and proxy WebSocket upgrades for `/api/realtime` as described above; then test and reload Nginx. Run the API with `server/.venv/bin/uvicorn server.app.main:app --host 127.0.0.1 --port 10000`. The migration creates the account, verification-code, session, admin audit, social feed/bookmark, messaging, follow, community, job, iBuy product/gallery, and local marketplace listing tables idempotently. Back up the media directory alongside PostgreSQL. The API does not configure PostgreSQL, DNS, Nginx, TLS, backups, or a process supervisor.
