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
