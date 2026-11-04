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
- `GET /api/statuses` lists active statuses from the signed-in member, followed accounts, and conversation contacts. `GET /api/statuses?user_id=<uuid>` returns one permitted account’s statuses.
- `POST /api/statuses` posts an uploaded status photo and optional caption (`{"image_url":"/api/media/images/<id>.webp","caption":"..."}`). Statuses expire after 24 hours.
- `GET /api/statuses/{status_id}` opens a status and records one view per account. Only the status owner receives the names and timestamps of viewers.
- `DELETE /api/statuses/{status_id}` removes the signed-in member’s status.

`POST /api/media/images` accepts one authenticated JPEG, PNG, or WebP image (maximum 4 MB and 20 megapixels); uploaded files are validated, resized, and stored as WebP. The web app automatically optimizes larger selected photos before upload. Image files are stored on the API host in `ICONNECT_MEDIA_DIR` (default: `./uploads` relative to the repository root), not in PostgreSQL; production should point this variable at a persistent VPS directory and make it writable by the API service account. Images are served to signed-in members at the returned URL. Upload controls are available for posts, profile photos, private-message attachments, iBuy products, local listings, community covers, and job/company photos. Post creation, likes, comments, bookmarks, and media uploads are rate-limited per client IP. `GET /api/social/posts?following_only=true` limits results to authors the current user follows. Stories and live video are not implemented.

## Video Hub and Studio

All video routes require a verified, signed-in member. Videos are stored as files below `ICONNECT_MEDIA_DIR/videos` and metadata is stored in PostgreSQL. Only the uploader can delete a video; playback is not public and requires the member session cookie.

- `POST /api/videos` streams one MP4 or WebM file to disk (maximum 250 MiB). Send the raw file body with `Content-Type: video/mp4` or `video/webm`, plus percent-encoded `X-Video-Title` and optional `X-Video-Caption` headers (title up to 120 characters, caption up to 500).
- `GET /api/videos?query=clip&view=all&limit=50` lists and searches videos; `view` can be `all` or `mine`, and `limit` is 1–100.
- `GET /api/videos/{video_id}/stream` streams a video to signed-in members.
- `DELETE /api/videos/{video_id}` permanently removes the uploader's video and its media file.

The Studio accepts MP4 and WebM, validates their file signatures, and reports upload progress. Browser playback depends on the codecs used to encode the file (H.264/AAC MP4 and VP8/VP9 WebM are recommended). Video files count toward VPS disk usage; monitor free space and back up the `videos` media directory. The API does not transcode videos, enforce a global storage quota, or provide live streaming.

- `PUT /api/auth/profile/photo` updates or removes the signed-in member's photo (`{"image_url":"/api/media/images/<id>.webp"}` or `{"image_url":null}`).

## iBuy marketplace API

All marketplace routes require a verified account:

- `GET /api/marketplace/products?query=lamp&category=Home&limit=50` lists published member products. Search is optional, category can be `Style`, `Tech`, `Home`, or `Other`, and limits are 1–100.
- `POST /api/marketplace/products` publishes a listing with `name`, `category`, integer `price` in NGN, `stock`, `description`, and up to five `image_urls` (plus optional legacy HTTPS `image_url`).
- `GET /api/marketplace/products/{product_id}` returns a published product and the seller’s public name and username.
- `PUT /api/marketplace/products/{product_id}` edits the signed-in seller’s listing using the same fields as creation.
- `DELETE /api/marketplace/products/{product_id}` permanently deletes the signed-in seller’s listing.

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

- `GET /api/communities?query=makers&limit=50` lists communities, membership status, owner, posting setting, and member count. Search is optional and `limit` is 1–100.
- `POST /api/communities` creates a community with `name`, `description`, an optional uploaded `image_url`, optional `rules`, `members_can_post` (defaults to true), and `membership_mode` (`open` by default or `approval`); its creator is automatically joined and can immediately manage the group.
- `GET /api/communities/{community_id}` loads community details, rules, and creator settings.
- `PUT /api/communities/{community_id}` lets the creator update the name, description, cover photo, rules, `members_can_post`, and `membership_mode` settings.
- `PUT /api/communities/{community_id}/membership` joins or leaves a community with `{"joined":true|false}`. Open groups add members immediately; approval groups create a pending request for the creator. Members can cancel pending requests, and the creator cannot leave their own group.
- `GET /api/communities/{community_id}/posts?limit=50&offset=0` loads the member-only feed; joined members and the creator can read it.
- `POST /api/communities/{community_id}/posts` shares text and up to five uploaded `image_urls`. Members can post by default; the creator can disable member posting in group settings.
- `DELETE /api/communities/{community_id}/posts/{post_id}` lets an author delete their own post or the creator moderate any group post.
- `GET /api/communities/{community_id}/members?limit=100` lists group members to members and the creator.
- `DELETE /api/communities/{community_id}/members/{member_id}` lets the creator remove a member. The creator cannot remove themself.
- `GET /api/communities/{community_id}/join-requests` lists pending requests for the creator.
- `PUT /api/communities/{community_id}/join-requests/{member_id}` accepts `{"approved":true|false}` and is restricted to the creator.

Community settings, posts, and memberships are stored in PostgreSQL. Uploaded cover/post photos use the authenticated image upload endpoint.

## Job Hub API

All job routes require a verified, signed-in account:

- `GET /api/jobs?query=design&location=remote&workplace_type=remote&view=all` searches listings. `view` can be `all`, `saved`, `applied`, or `mine`; results include the signed-in user's save/application state.
- `POST /api/jobs` publishes a listing with title, company, location, employment type, workplace type (`remote`, `hybrid`, or `onsite`), summary, description, and optional uploaded `company_image_url`.
- `PUT /api/jobs/{job_id}/save` sets saved state (`{"saved":true|false}`); repeating the same request is safe.
- `POST /api/jobs/{job_id}/applications` submits an optional cover letter. Duplicate applications do not create duplicate records, and listing owners cannot apply to their own roles.
- `GET /api/jobs/{job_id}/applications` lists applicants only for the owner of that listing. Applicant email addresses are not returned.

Before a member can post a role, they must submit their registered company name, CAC registration number, business type, business address, contact phone, company description, and a CAC document through `POST /api/jobs/business-profile`. The raw document body accepts PDF, JPEG, PNG, or WebP up to 10 MB; company fields are sent as percent-encoded JSON in `X-Company-Details`. A successful submission unlocks job posting immediately; it does not wait for admin approval. `GET /api/jobs/business-profile` returns the signed-in member's company details, and `GET /api/jobs/business-profile/document` serves only that member's document. `POST /api/jobs` enforces the company profile requirement on the server.

Administrators can inspect an account's profile photo, contact email, company/CAC details, posts and images, comments, likes, bookmarks, private message text, photos, and voice notes, listings, jobs, applications, communities, and follow activity from the Users section. Message history is paginated with the rest of the account activity; account-detail reads, voice-note playback, and CAC document access are recorded in the audit log. CAC files and voice notes are served only through authenticated endpoints, with admin voice-note playback scoped to a message involving the selected account. Administrators can edit member posts from the account view. Listings, business profiles, saved roles, and applications are stored in PostgreSQL. Listings are visible to signed-in members as soon as they're published; moderation, CV uploads, and employer application-status updates are not implemented. Members should verify listing details before sharing sensitive information.

## Direct messaging API

All messaging routes require a verified account and return only participants' public names and usernames (never email addresses):

- `GET /api/messages/users?query=bo` searches verified accounts by name or username prefix.
- `GET /api/messages/conversations` lists the signed-in user's conversations and unread counts.
- `POST /api/messages/conversations` opens or creates a private one-to-one conversation (`{"recipient_id":"<user-id>"}`).
- `GET /api/messages/conversations/{conversation_id}/messages?limit=100` loads recent messages and marks incoming messages as read; add `query=<text>` to search the conversation without changing read receipts.
- `POST /api/media/voice-notes` uploads an authenticated WebM, Ogg, or MP4 audio recording (up to 10 MB).
- `GET /api/media/voice-notes/{filename}` plays a voice note for a participant in the conversation containing it.
- `POST /api/messages/conversations/{conversation_id}/messages` sends text (`{"text":"..."}`, up to 2,000 characters), one uploaded photo (`{"image_url":"/api/media/images/<id>.webp"}`), one uploaded voice note (`{"audio_url":"/api/media/voice-notes/<id>.webm"}`), or text with a photo.
- `PUT /api/messages/conversations/{conversation_id}/messages/{message_id}` edits the sender's text message for up to 15 minutes after sending; photo and voice-note messages cannot be edited.
- `PUT /api/messages/conversations/{conversation_id}/block` blocks or unblocks the other participant (`{"blocked":true}`); either participant's block prevents both people from sending.
- `PUT /api/messages/conversations/{conversation_id}/preferences` saves that member's mute and archive settings (`{"is_muted":true,"is_archived":false}`).

Message responses include `readAt`; senders can show a read receipt after the recipient opens that conversation. Message sending and editing are rate-limited per client IP. Every read and write verifies conversation membership. Chat search queries stored message history. Mute suppresses the in-app incoming sound, while archive hides the conversation from the default and unread inbox views. File attachments other than photos and voice notes, message deletion, voice/video calls, and push delivery are not implemented.

Administrators can publish official content using admin-only routes: `POST /api/admin/posts`, `POST /api/admin/products`, `POST /api/admin/jobs`, and `POST /api/admin/local-listings`. They validate the same content fields and uploaded image references as member posts and listings, publish directly into the user-visible feed and marketplaces, and record a `create_admin_content` audit event. The admin Publishing section creates posts, jobs, and housing listings; Products manages iBuy items. Members can continue publishing through their existing routes.

## Savings tracker and dating

The personal savings tracker is record-keeping only. It does not collect, transfer, hold, or verify money; members manually log contributions they make elsewhere. Amounts are whole Nigerian naira values.

- `GET /api/savings/plans` lists the signed-in member's plans and manually recorded totals.
- `POST /api/savings/plans` creates a goal with a target amount, contribution amount, daily/weekly/monthly frequency, and optional target date.
- `POST /api/savings/plans/{plan_id}/contributions` records a contribution for an active plan.
- `GET /api/savings/plans/{plan_id}/contributions` lists that member's contribution history.
- `PUT /api/savings/plans/{plan_id}/active?active=false` pauses or resumes a plan.
- `DELETE /api/savings/plans/{plan_id}` deletes the plan and its history.

Dating has a private profile separate from the regular member profile. The API checks the submitted birth date on the server and rejects users under 18; it returns age but never the birth date. This is self-reported and is not identity or age verification. Discovery respects both members' gender preferences and account discoverability settings. Pausing hides a profile from discovery but keeps existing mutual-match conversations available.

- `GET /api/dating/profile` and `PUT /api/dating/profile` read or save the member's dating profile.
- `GET /api/dating/discovery` returns compatible, undiscovered profiles.
- `POST /api/dating/profiles/{user_id}/swipe` records a like or pass; a match is created only after both people like each other.
- `GET /api/dating/matches` lists mutual matches.
- `GET /api/dating/matches/{match_id}/messages` and `POST /api/dating/matches/{match_id}/messages` provide the separate dating inbox; every request verifies match membership and blocks.
- `DELETE /api/dating/matches/{match_id}` ends a match; `POST /api/dating/users/{user_id}/block` and `/report` provide dating-specific safety actions.

Dating profiles, likes, matches, messages, blocks, and reports are stored separately from standard messages and social follows/blocks. Dating profile photos use the existing authenticated image upload API. Run `npm run db:migrate` when deploying these tables.

## Live updates

The authenticated WebSocket endpoint at `/api/realtime` streams message-created and read-receipt events to the conversation participants, and post/comment changes to connected members. Events contain identifiers and metadata, not message or comment text. The web app reconnects automatically, refreshes on reconnect, and keeps a 60-second polling fallback for inbox recovery.

The API currently fans out events in process memory, so deploy it as a single Uvicorn worker/instance. Multiple workers or API instances require a shared event broker before deployment. Nginx must proxy `/api/realtime` using HTTP/1.1 and forward the `Upgrade` and `Connection` headers; keep its read timeout longer than the API's 25-second WebSocket heartbeat interval. Without WebSocket upgrade proxying, inbox updates fall back to polling, while feed and comment changes will not arrive live.

## Unconnected product areas

The app does not currently have provider-backed APIs for travel bookings, wallet balances or transfers, payments, trading, video storage or streaming, notifications, or external social account connections. Savings plans only track member-entered records; no money moves through iConnect. Dating is limited to 18+ self-reported profiles and mutual matches, without identity verification. The AI assistant uses static example text and is not connected to an AI service.

## Admin API

Super-admin access is restricted on the server to verified accounts whose email addresses are listed in the comma-separated `ADMIN_EMAILS` environment variable. For example, set `ADMIN_EMAILS=admin@example.com` on the API server after registering and verifying that account through the normal signup flow. Multiple addresses can be separated with commas. An empty value disables super-admin access. Never expose this setting through a `VITE_*` variable.

Super-admins can grant or revoke database-managed sub-admin access for existing, email-verified accounts. Sub-admins can inspect and suspend normal user accounts, manage posts/comments/listings/jobs/communities, and manage iBuy products. Both admin roles can view private message contents in user details; only super-admins can assign administrator roles, and administrator accounts cannot be suspended through the user-status endpoint. Super-admins retain the server allowlist as their source of authority. User-detail reads, including message history, are audited for both roles.

The admin portal at `/admin/login` uses the same secure session cookie as the rest of the API:

- `POST /api/admin/login` verifies the account password, email verification, and super-admin allowlist or sub-admin role.
- `GET /api/admin/me` confirms the current session has admin access.
- `GET /api/admin/overview` returns platform totals and seven-day new-account, post, product, and job counts.
- `GET /api/admin/users?query=alex&limit=50&offset=0` searches account names, usernames, and email addresses. Limits are 1–100.
- `POST /api/admin/users/{user_id}/suspension` suspends or restores a normal account. Suspending revokes its active sessions; administrator accounts and the current admin cannot be suspended through this endpoint.
- `GET /api/admin/users/{user_id}?limit=100&offset=0` returns account details and paginated posts, comments, likes, saved posts, direct messages, marketplace listings, job activity, communities, and follow activity. Message text, photo URLs, participants, and read status are visible to both admin roles. Limits are 1–200.
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

On the VPS, create the environment with `python3 -m venv server/.venv`, install runtime packages with `server/.venv/bin/pip install -r server/requirements.txt`, and run `npm run db:migrate`. The API virtual host must allow request bodies up to 260 MB for 250 MiB video uploads and 12 MB for CAC documents. Add these exact-match locations to its HTTPS `server` block so Nginx streams upload bodies to the API instead of buffering the entire upload first:

```nginx
location = /api/jobs/business-profile {
    client_max_body_size 12M;
    client_body_timeout 120s;
    proxy_request_buffering off;
    proxy_send_timeout 120s;
    proxy_pass http://127.0.0.1:10000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/videos {
    client_max_body_size 260M;
    client_body_timeout 300s;
    proxy_request_buffering off;
    proxy_send_timeout 300s;
    proxy_pass http://127.0.0.1:10000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Keep the existing `/api/realtime` WebSocket proxy and other API routes, then run `sudo nginx -t` and reload Nginx. Run the API with `server/.venv/bin/uvicorn server.app.main:app --host 127.0.0.1 --port 10000`. The migration creates the account, verification-code, session, admin audit, social feed/bookmark, messaging, follow, community, job/business-profile, iBuy product/gallery, local marketplace listing, and video tables idempotently. Back up the media directory alongside PostgreSQL, including the private `business-documents` subdirectory. The API does not configure PostgreSQL, DNS, Nginx, TLS, backups, or a process supervisor.

## Job Hub external career boards

`GET /api/jobs` combines iConnect member listings with public employer-board listings from Greenhouse and SmartRecruiters. Configure comma-separated public identifiers in the API environment:

- `GREENHOUSE_BOARD_TOKENS`: the board token in a Greenhouse URL such as `boards.greenhouse.io/<board-token>`.
- `SMARTRECRUITERS_COMPANY_IDS`: the company identifier used in a SmartRecruiters careers URL such as `jobs.smartrecruiters.com/<company-id>`.

These are public employer identifiers, not API keys. Both providers expose jobs per employer and do not provide a global directory of every company’s jobs. The starter set is Stripe, Figma, Cloudflare, GitLab, MongoDB, Airbnb, Red Bull, and SmartRecruiters; their public boards were checked before configuring them. Set either variable to a comma-separated list to replace its starter set, or set it to `none` to disable that provider. Up to 20 identifiers per provider are accepted. External jobs are cached for five minutes, filtered with the existing title/location/workplace filters, and link to the employer for application; iConnect saves and applications remain limited to member listings. If an external provider is temporarily unavailable, available member and external listings are still returned with a source warning.
