# iConnect

iConnect is a web-first social product prototype built with React, Vite, Tailwind CSS, and a FastAPI/PostgreSQL backend. The public landing page introduces the product through an editorial layout, a warm neutral palette, and restrained CSS motion.

## Landing page design guide

### Visual direction

The design aims to feel like a welcoming digital home rather than a generic technology dashboard. It combines large, confident headlines with rounded social UI previews, soft paper-like backgrounds, small editorial labels, and a few bright accents. Keep the visual hierarchy calm: motion and color should draw attention to the people and product preview, not compete with the copy.

### Color palette

| Purpose | Color | Hex |
| --- | --- | --- |
| Main page background / paper | Warm off-white | `#f5f3ee` |
| Primary text / ink | Soft charcoal | `#20211f` |
| Main action and reaction accent | Coral | `#ff735e` |
| Secondary hover coral | Warm coral | `#f26c57` |
| Highlight behind the hero word | Soft lime | `#d2e879` |
| Live indicator | Leaf green | `#95bd4a` |
| Cards | Ivory white | `#fffefa` |
| Supporting section backgrounds | Light stone | `#f0eee7`, `#e9e6de`, `#fbfaf6` |
| Body copy | Muted gray | `#64645f` |

Tailwind aliases for `ink`, `paper`, and `coral` are in `tailwind.config.js`. The landing page's detailed colors and effects are in `src/index.css`.

### Typography

- **DM Sans** is the default body and interface font.
- **Manrope** is used for the wordmark, headings, and display emphasis.
- **Georgia** supplies the occasional italic serif phrase for contrast.
- The fonts are loaded in `index.html`; retain sans-serif fallbacks for offline and failed font loads.
- Use a responsive, tightly tracked display headline (`clamp(...)`) and small uppercase, letter-spaced section labels.

### Page structure

The landing page is composed in `src/pages/HomePage.jsx` and wrapped by `src/components/SiteLayout.jsx`:

1. **Header:** compact wordmark, navigation, and a pill-shaped preview CTA.
2. **Hero:** a two-column desktop layout. The left side contains the eyebrow, large promise, short explanation, join/login links, and social proof. The right side contains a miniature social feed preview with orbit rings, reaction, and floating conversation notes.
3. **Ticker:** a dark, continuous strip that gives the page a change of pace.
4. **Intro and feature cards:** explain the product direction and link to product areas.
5. **Community concepts:** three image-led cards, with a gradient for readable labels.
6. **Values and closing CTA:** summarize the product principles and point people to the preview.
7. **Footer:** closes the page with a consistent brand and navigation system.

The hero feed is an **illustrative concept preview**, not a live feed. Its sample content comes from `src/data/siteContent.js`; keep concept labels clear when reusing it.

### Motion and interaction

Most motion is CSS-based. The keyframes are near the beginning of `src/index.css`; the home-page component applies them to layered elements rather than running a JavaScript animation loop.

| Element | Motion | Timing / feel |
| --- | --- | --- |
| Green live dot | Soft pulse in its halo | `pulse`, 2 seconds, infinite |
| Hero glow | Gently grows and fades | `breathe`, 6 seconds, ease-in-out |
| Feed preview card | Small upward drift while slightly rotating | `card-float`, 7 seconds, ease-in-out |
| Feed photo | Slow, subtle pan/zoom | `post-pan`, 18 seconds, alternating |
| Coral reaction bubble | Floats up and scales slightly | `like-bob`, 3 seconds, ease-in-out |
| Chat note | Small diagonal arrival drift | `chat-arrive`, 5 seconds, ease-in-out |
| Floating hero labels | Gentle vertical bob, with staggered delays | `bob`, 5 seconds |
| Dark ticker | Continuous horizontal marquee | `ticker`, 36 seconds, linear |
| Feature and community cards | Lift, reveal shadow, or zoom the photo on hover | CSS transitions, roughly 200–650 ms |

Use transforms and opacity for movement, keep loops slow and low-amplitude, and reserve bright or fast movement for a single point of attention. The orbit rings are static decoration; the glow and floating preview elements create the feeling of movement without rotating the whole scene.

The global `prefers-reduced-motion: reduce` rule in `src/index.css` nearly disables animation and transitions and turns off smooth scrolling. Preserve that behavior when adding motion.

### Responsive layout

- The hero and section grids become two columns on wider screens and stack for narrow screens.
- Around `900px`, feature grids reduce their column count and spacing.
- Around `680px`, navigation becomes a menu button, the hero stacks, buttons become touch-friendly, and the decorative hero art scales to fit.
- Small-screen overrides further tune text and card sizing around `420px`.
- Keep the page usable at 320px wide; avoid letting decorative art create horizontal scrolling.

### How to build a similar landing page

1. Start with a clear content outline: one promise, one supporting paragraph, one primary action, and a few proof points.
2. Define the palette and type scale before styling individual sections. Use the same ink, paper, and accent colors consistently.
3. Build the page as small React components. Keep repeated cards data-driven, as the feature and community sections are here.
4. Make the hero illustration from ordinary HTML/CSS layers: a preview card, soft glow, static orbit rings, and a few floating notes. This keeps it responsive and easier to maintain than a large video or canvas.
5. Add a small set of named CSS keyframes and apply them to specific elements. Avoid animating layout properties or making every component move.
6. Add hover states for interactive cards and controls, then check keyboard focus and the reduced-motion preference.
7. Test desktop and phone layouts, especially the hero composition, navigation menu, content width, and text wrapping.

## Run locally

```sh
npm install
npm run dev
```

The public landing page is available at the Vite URL. Backend-backed preview routes additionally require the FastAPI/PostgreSQL setup described in [server/README.md](./server/README.md).

## Production build

```sh
npm run build
```

The frontend is a Vite application. Production deployment and API setup are described in [server/README.md](./server/README.md).

## Product direction and implementation handoff

This section records the product decisions and implementation boundaries discussed with the project owner. Read it before continuing product or payment work so prototypes are not mistaken for live financial or travel services.

### Product modules and navigation names

The technical blueprint defines these product modules: iConnect Social, iConnect Chat, iConnect Create, iConnect Market, iConnect Trade, iConnect Invest, iConnect Jobs, iConnect Date, iConnect AI, iConnect Wallet, iConnect Ajo, iConnect Business, iConnect Ads, and iConnect Premium. Existing app navigation uses the matching iConnect names for modules that already have a page. General links such as Home and Connect remain general navigation, not module names.

Do not add links that imply unavailable modules are implemented. Ajo (group savings), Business, and Ads are blueprint modules but are not currently fully implemented as standalone services. Keep the distinction between an existing page/prototype and a live, provider-backed service explicit.

### iBook: stays, rentals, and local rides

The iBook page implements member-to-member listing and request workflows:

- Hosts can publish a room, apartment, house, or vacation rental with location, NGN price per night/month, capacity, description, and 1–5 photos.
- Guests can search stays by area and submit date-based requests. Requests are not reservations until the host confirms them; confirmed date ranges cannot overlap.
- Members can create a driver profile, set vehicle/service area/seats, and control availability.
- Riders can search available drivers and request a trip with pickup, destination, time, passenger count, and an optional note. Drivers can accept/decline and mark an accepted trip complete; riders can cancel a pending request.
- Accepting a ride takes the driver offline. After completing it, the driver must choose to go online again.

The current iBook implementation is not full inDrive dispatch. It does not provide live GPS tracking, fare calculation, in-app ride payments, automatic stay payments, identity verification of hosts/drivers, or airline inventory/ticketing. Members must verify details and agree on price and safety arrangements directly. Flights remain unavailable until an airline booking provider is integrated. See [server/README.md](./server/README.md) for API details.

### Wallet, Paystack, and currency/crypto plans

The owner wants an OPay-like experience where customers can hold and send NGN, convert NGN to USD, and send/receive crypto. The current Wallet and Payments pages are informational placeholders: there is no customer wallet balance, custody, FX conversion, or crypto functionality.

Paystack is configured for supported payment collection and certain NGN transfers from the iConnect business balance. Paystack alone does **not** create customer-held iConnect wallet balances, provide NGN/USD exchange, or provide crypto exchange/custody. Do not represent a payment made to iConnect as a user's withdrawable wallet balance. A real wallet requires a suitable licensed wallet/BaaS partner; FX and crypto may require separate authorized providers. Before implementing those services, confirm provider, supported countries/currencies, account approval, official API documentation, compliance requirements, fees, and sandbox access. Never put provider secrets in frontend code, `VITE_*` variables, this README, or chat.

The repository already has Paystack checkout/webhook flows for the supported iBuy and publishing/dating payment features. The Paystack webhook endpoint is:

```text
https://api.iconnectdworld.com/api/billing/webhooks/paystack
```

Configure that URL in the Paystack Dashboard's API Keys & Webhooks settings, with webhook signing enabled. `PAYSTACK_SECRET_KEY` belongs only in the backend/VPS environment (for example, `/home/iconnect/iconnect/.env`, mode `600`). Start in Paystack test mode and verify the backend is deployed before using live mode. Deployment and payment setup details are in [server/README.md](./server/README.md). The webhook is for payment events; it does not create wallet, FX, or crypto features.

### iTrade / Deriv trading-bot proposal

The owner has proposed an iTrade bot that can trade for users through a broker such as Deriv. The existing iTrade page is not an automated trading integration. Before implementation, establish the broker's official API and sandbox/test-account flow, account authorization model, permitted jurisdictions, and any required approvals. Prefer user-authorized access, demo trading first, explicit opt-in before live trades, user-set risk/loss limits, clear risk disclosure, revocable authorization, and an immediate stop control. Never promise profits or payouts; trading can lose money. Keep customer assets at the broker unless an independently approved custody/wallet arrangement is implemented.

### Deploying changes to the VPS

#### Server route and locations

The production frontend and API are separate:

| Purpose | Public route | Where it runs |
| --- | --- | --- |
| Web app | `https://www.iconnectdworld.com` | Vercel |
| API | `https://api.iconnectdworld.com` | VPS; Nginx HTTPS proxy to `127.0.0.1:10000` |
| VPS login | `iconnect@server1.ilearnova.com` | SSH |
| App checkout | `/home/iconnect/iconnect` | Git working copy on the VPS |
| Backend environment | `/home/iconnect/iconnect/.env` | Server-only secrets and settings |
| API service | `iconnect-api.service` | systemd |
| Health check | `https://api.iconnectdworld.com/api/health` | Returns `{"status":"ok"}` when the API and database respond |

Port `10000` is an internal loopback port. Public API requests should go through the HTTPS API hostname; do not open port `10000` to the internet. Use the authorized SSH key for the VPS account.

#### Connect and deploy backend changes

Run this from your own computer to connect:

```sh
ssh iconnect@server1.ilearnova.com
```

Then run these commands inside the VPS. First make sure the working copy has no local changes; if `git status --short` reports changes, stop and preserve/review them before pulling. The changes must already be pushed to the branch checked out by the VPS:

```sh
cd /home/iconnect/iconnect
git status --short
git pull --ff-only
npm run db:migrate
sudo systemctl restart iconnect-api.service
sudo systemctl status iconnect-api.service --no-pager
curl -fsS https://api.iconnectdworld.com/api/health
```

If the health check fails, inspect the API logs:

```sh
sudo journalctl -u iconnect-api.service --since "10 minutes ago" --no-pager | tail -n 100
```

The frontend is deployed through the configured Vercel/Git integration when changes are pushed. `git pull` cannot deploy local, uncommitted changes: commit and push them first, and confirm the VPS is tracking the intended branch.

#### Add the Paystack secret on the VPS

Edit the backend environment file on the VPS (not Vercel and not the frontend):

```sh
sudo nano /home/iconnect/iconnect/.env
```

Add or update this line, using the Paystack **Secret Key** from the Paystack Dashboard. Use a test key while testing:

```dotenv
PAYSTACK_SECRET_KEY=your_paystack_secret_key
```

Save in nano with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**. Restrict file permissions and restart the API so it reads the setting:

```sh
sudo chmod 600 /home/iconnect/iconnect/.env
sudo systemctl restart iconnect-api.service
sudo systemctl status iconnect-api.service --no-pager
```

In Paystack Dashboard → **Settings → API Keys & Webhooks**, configure the webhook URL as `https://api.iconnectdworld.com/api/billing/webhooks/paystack` and keep webhook signing enabled. This webhook reports payment events; it does not provide customer wallet balances, FX conversion, or crypto services. Never paste secrets into chat or commit them to Git.

Do not run wallet setup commands or advertise real wallet functionality until the required provider integration is implemented and approved.
