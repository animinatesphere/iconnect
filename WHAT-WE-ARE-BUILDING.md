# What We're Building

## iConnect in one sentence

iConnect is a connected digital home intended to bring social feeds, conversations, content creation, and useful opportunities closer together.

## Build order: website first, mobile later

The first milestone is the **iConnect website**. It introduces the product, explains the direction, and gives people a place to follow progress. The mobile app is a later phase; the current website should not be presented as a completed mobile product or as a fully working unified social platform.

The current website is a product introduction and concept preview. Its sample profiles, posts, stories, reactions, and chats are illustrative UI—not live user content or connected accounts. Early-access signup is not open yet, and no contact details are collected.

## Website routes

The website uses client-side routing with a distinct page component for each route:

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | Introduce iConnect and the website-first direction. |
| `/product` | Product | Explain the product vision and label planned capabilities honestly. |
| `/communities` | Communities | Show illustrative community concepts and product principles. |
| `/roadmap` | Roadmap | Explain the sequence from website to web product to mobile apps. |
| `/early-access` | Early access | Explain the current signup status without pretending to collect emails. |

Unknown routes show a branded 404 page. The Vercel rewrite serves the SPA shell for direct navigation and browser refreshes. Shared layout and navigation live in reusable components; content pages are separated under `src/pages`.

## User-side product preview

The website also includes a navigable concept preview of the user experience under `/app`. It follows the PRD's initial journey—welcome, profile and interests, then the home feed—and provides separate screens for the product areas described in the PRD:

| Route | Screen |
|---|---|
| `/app/onboarding` | Social product introduction and preview entry |
| `/app/signup` | Local demo sign-up form |
| `/app/login` | Local demo login form |
| `/app/setup` | Profile and interests setup |
| `/app/home` | Sample home feed and stories |
| `/app/post/:postId` | Full post details and reply thread |
| `/app/chat` | Illustrative conversations |
| `/app/create` | Post composition preview |
| `/app/jobs` | Sample opportunity listings |
| `/app/connect` | People and community discovery |
| `/app/invest` | Future wallet and savings concept |
| `/app/assistant` | AI assistance concept |
| `/app/profile` | Profile and settings preview |

These are frontend previews, not a connected product. Sign-up saves a demo profile (name, email, bio, and interests) in the current browser and opens the sample feed after profile setup. Login recognizes that browser's saved demo email; passwords are never saved, sent, or verified, and there is no backend or secure authentication. Sample content is illustrative, and interactions such as likes and replies are temporary browser state. Messages are not delivered, posts are not published, external accounts are not connected, AI is not powered by a service, and no financial activity takes place. On mobile, the feed is prioritized and the dashboard top bar is hidden; the bottom navigation provides the core destinations and a **More** sheet links to every other product area and profile settings. Desktop uses the sidebar and top bar. Wallet, investment, and savings features remain exploratory and require appropriate product, security, legal, and regulatory work before implementation.

## Product vision

The product requirements document describes a longer-term platform with these areas:

- **A unified home feed:** Bring updates from connected services together, with filtering and familiar social actions where integrations allow.
- **Messaging:** A central inbox for supported connected services, with messaging and calling capabilities determined by each service.
- **Create and share:** Compose posts, add captions and hashtags, select supported destinations, and eventually schedule posts or use AI-assisted suggestions.
- **Jobs and opportunities:** Discover and organize roles, with filters and application support as integrations permit.
- **Connect:** Help people find communities and make social or professional connections. Dating-related functionality would require dedicated safety, privacy, and moderation decisions.
- **AI assistance:** Potential tools for drafting, summarizing, and guidance. AI output should be reviewable by the user before it is applied or shared.
- **Wallet and savings tools:** The PRD includes wallets, investments, and Ajo groups as longer-term ideas. These are exploratory and must not be treated as available financial services; any implementation requires security, legal, regulatory, and operational review.
- **Profiles and preferences:** Account details, connected services, privacy choices, and notifications.

These are roadmap areas, not claims that the current landing page provides these capabilities.

## Phased direction

### Phase 1 — Website

- Responsive website that explains iConnect and its product direction.
- Routed product, communities, roadmap, and early-access information pages.
- Clear distinction between the current website, concept previews, and future product features.
- A genuine early-access signup flow once a backend or mailing-list provider is selected and connected.
- Accessible layouts, reduced-motion support, and a consistent brand experience.

### Phase 2 — Web product

Define and build the first usable product experience for the web. Prioritize onboarding, account/profile basics, and a focused core workflow before expanding to every area in the PRD. Integration availability, permissions, and platform policies need to be confirmed before promising cross-service features.

### Phase 3 — Mobile apps

Plan native or cross-platform mobile applications after the web product has established its core experience and priorities. Reuse the product concepts where appropriate, while designing for mobile navigation and interaction patterns.

The phases are a direction, not a delivery schedule. Product scope and sequencing should be revisited as research and technical feasibility become clearer.

## Product principles

1. **Be clear about what exists.** Mark previews and planned capabilities as concepts or roadmap items until they are functional.
2. **Respect user control.** Explain connected-account permissions and give people meaningful privacy and notification controls.
3. **Build the core experience before the super-app scope.** Validate a coherent web workflow before taking on every integration and product area.
4. **Treat sensitive areas carefully.** Messaging, dating, AI, employment, wallets, and investments each need their own safety, privacy, and compliance requirements.
5. **Design for a broad audience.** The PRD identifies Nigeria as the primary market and global users as a secondary audience. English is the initial language, with Yoruba, Hausa, and Igbo listed as possible later localization.

## Source material

- [Updated iConnect Product Requirements Document](./src/UPDATED%20ICONNECT%20Product%20Requirements%20Document%20(PRD).pdf)
- [iConnect Major UX Flows board](https://www.figma.com/board/fSBexyart39kkc3nfd09Tu/iConnect-%E2%80%94-Major-UX-Flows?node-id=0-1)

The PRD is the product-scope reference. The Figma board was supplied as a UX-flow reference, but it required access that was unavailable during this review; confirm its flows against an accessible export before using them as implementation requirements.
