# Openhall — Product Plan

> AI-generated 3D galleries that artists actually own.
> IBM AI Builders Challenge — July 2026: "Reimagine Creative Industries with AI"

---

## 1. Problem Statement

Independent artists and art students create work worth showing, but exhibiting it remains gatekept and expensive. Physical gallery space costs hundreds to thousands of dollars, is location-bound, and is often inaccessible to emerging creators. Existing online alternatives — Instagram grids, Behance pages, PDF portfolios — flatten artwork into scrolling feeds, stripping away the spatial, curated experience that gives an exhibition its impact.

Existing virtual gallery platforms (Artsteps, Kunstmatrix, ArtPlacer, Exhibbit) don't solve this either:

- They are **manual 3D editors** — artists still spend hours dragging, placing, and lighting.
- They are **walled platforms** — galleries live on the vendor's servers, behind subscription tiers, and disappear if the artist stops paying or the vendor shuts down.

## 2. Target Audience

| Tier | Who | Need |
|------|-----|------|
| Primary | Art & design students (graduation shows, portfolio reviews, applications) | Professional exhibition experience, zero budget, zero 3D skills |
| Secondary | Independent/emerging artists (illustrators, photographers, digital artists) | Shareable immersive showcase for clients, collectors, social media |
| Roadmap | Collectives, student clubs, educators | Group/class virtual exhibitions |

## 3. Solution

**Openhall** is an open-source, AI-powered web tool that turns a folder of images into a walkable 3D exhibition in minutes — and the artist owns the result outright.

The artist uploads up to 10 works (MVP), plugs in their own AI API key (BYOK), and Openhall does the rest:

1. **AI Curation** — vision + language models analyze style, color, and theme to group works, order them, and design the visitor flow.
2. **Text-to-Gallery** — describe the space in natural language ("concrete walls, cold lighting, a narrow corridor opening into a large hall") and AI translates it into gallery parameters; or pick a style preset (white cube, classical, industrial, minimalist).
3. **AI Docent** — auto-generated wall labels and artist-statement polish for each piece.
4. **Walkable 3D** — first-person WASD + mouse-look navigation, click-to-inspect artworks, plus a guided tour mode for mobile/non-gamer visitors.
5. **Export & Own** — one click produces a self-contained static site (HTML + JS + assets). Deploy free on GitHub Pages / Netlify / Vercel, on your own domain. No platform lock-in, no monthly fee, no dependency on Openhall's servers.

## 4. Differentiation

Individual pieces exist in the market; **the combination does not**:

| | Artsteps / Kunstmatrix / etc. | Openhall |
|---|---|---|
| Gallery creation | Manual 3D editor, hours of work | Fully AI-generated in minutes |
| Customization | Drag-and-drop | Natural language ("text-to-gallery") + presets |
| Ownership | Locked to platform, subscription | Exported static site, artist-owned forever |
| Cost model | Freemium walls (e.g. 10-artwork cap then pay) | Open source + BYOK ≈ $0 |
| AI | Partial add-ons (audio guides) | Core of the product: vision analysis, curation, layout, labels |

**One-line pitch:** "Artsteps gives you a 3D editor; Openhall gives you an AI curator — and the gallery is yours to keep."

## 5. Features

### MVP (July — hackathon submission)

- **F1. Upload** — up to 10 images (JPG/PNG), drag-and-drop, client-side resize/compress.
- **F2. BYOK setup** — API key stored in localStorage only; IBM watsonx.ai first-class, OpenAI-compatible providers as fallback. 3-minute onboarding guide.
- **F3. AI analysis** — Granite Vision analyzes each work (style, palette, subject, mood) → structured JSON.
- **F4. AI curation** — Granite LLM groups/orders works, assigns walls, generates visitor flow. **Room count and room sizes are AI-decided**, driven by artwork count and grouping (e.g. one large hall for a cohesive set; three rooms for three series) — capped at 4 rooms for ≤10 works. Style presets define materials, lighting, proportions, and flow character — never a fixed room count.
- **F5. Text-to-Gallery** — natural-language room description → gallery parameter JSON (layout, wall material, lighting temperature, floor, accent color). 4 style presets as one-click alternatives.
- **F6. AI wall labels** — title/medium/statement text per work, editable by the artist.
- **F7. 3D walkthrough** — Three.js first-person: WASD + PointerLock mouse-look, wall collision, raycast hover-highlight, click → info panel with smooth camera dolly to viewing position. Controls hint overlay on first entry.
- **F8. Tour mode** — click-to-advance guided path (reuses AI-generated visitor flow); default on mobile/touch.
- **F9. Export** — download self-contained static site (viewer + gallery.json + images) as a zip. Step-by-step "publish free in 5 minutes" guide (Netlify Drop / GitHub Pages).
- **F10. Demo mode** — bundled sample artworks + pre-generated gallery so anyone (and judges) can experience the full flow without a key.

### Explicitly OUT of MVP (roadmap slide only)

Multi-user presence, VR/WebXR, video/3D-model artworks, sales/checkout, accounts & hosted galleries, real-time AI voice docent, one-click deploy API integration.

## 6. Architecture

```
┌────────────────────────── Browser (everything runs client-side) ─────────────────────────┐
│                                                                                          │
│  Upload UI ──► Image preprocessing (resize/compress, canvas API)                         │
│                     │                                                                    │
│                     ▼                                                                    │
│  BYOK key (localStorage) ──► AI Pipeline                                                 │
│                              1. Vision analysis (Granite Vision via watsonx.ai API)      │
│                              2. Curation plan   (Granite LLM → curation JSON)            │
│                              3. Gallery params  (text-to-gallery → gallery JSON)         │
│                              4. Wall labels     (LLM → labels JSON)                      │
│                     │                                                                    │
│                     ▼                                                                    │
│  gallery.json (single source of truth: rooms, walls, placements, lighting, labels, tour) │
│                     │                                                                    │
│                     ▼                                                                    │
│  Three.js Viewer (procedural room builder ← gallery.json)                                │
│    • PointerLockControls (WASD + mouse-look)   • AABB wall collision                     │
│    • Raycaster (hover/click artworks)          • Tour mode (waypoint walk)               │
│                     │                                                                    │
│                     ▼                                                                    │
│  Exporter: zip(viewer bundle + gallery.json + images) ──► artist self-hosts anywhere     │
└──────────────────────────────────────────────────────────────────────────────────────────┘

Serverless (only if needed): tiny token-exchange function for watsonx IAM auth/CORS
(Cloudflare Workers / Vercel functions free tier). No database. No backend state.
```

### Key design decisions

- **gallery.json is the contract.** AI generates it; the viewer renders it; the exporter ships it. This decouples AI from 3D and makes everything testable.
- **Procedural rooms, not 3D assets.** Rooms are generated from parameters (dimensions, materials, lighting) — no modeling, tiny bundle, infinite variety.
- **Client-side only.** No server compute, no stored user data, no AI cost to us. The exception is an optional stateless token-exchange worker for watsonx IAM (its API-key→token flow and CORS make pure-browser calls awkward).
- **Provider abstraction.** One `AIProvider` interface; `WatsonxProvider` (primary, IBM story) and `OpenAICompatProvider` (fallback) behind it.

### Tech stack

- **Frontend:** Vite + TypeScript + Three.js (vanilla or React — Bob's choice; keep the viewer framework-free so the export bundle stays lean)
- **AI:** IBM watsonx.ai — Granite Vision (image analysis) + Granite LLM (curation, text-to-gallery, labels); structured JSON outputs
- **Auth to watsonx:** IBM Cloud IAM token exchange via minimal serverless function
- **Export:** JSZip client-side packaging
- **Hosting (tool itself):** GitHub Pages or Vercel free tier
- **Dev tooling:** IBM Bob + BobShell throughout (see AGENTS.md)

## 7. How Openhall uses IBM technology

- **IBM Bob** — primary development agent for the entire codebase: Three.js viewer, AI pipeline, exporter, tests. BobShell session logs committed to the repo document the human+Bob workflow (judging: Best Use of Technology).
- **IBM watsonx.ai** — runtime AI brain: Granite Vision for artwork analysis, Granite LLM for curation/layout/labels.
- **Narrative:** *Built with Bob. Powered by watsonx. Owned by artists.*

## 8. Business / sustainability model (post-hackathon)

Open-source core stays free forever (BYOK). Optional paid layers later: premium gallery presets, managed hosting with custom domains, one-click deploy, team/classroom features. None required for the tool to be useful — which is the point.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Text-to-gallery output too unpredictable | Constrain to parameter schema + presets as guardrails; LLM fills a validated JSON, never freeform geometry |
| watsonx browser auth friction | Token-exchange worker ready day 1; OpenAI-compatible fallback provider |
| 3D scope creep | gallery.json schema frozen end of week 1; features F1–F10 only |
| Artists can't get API keys | Demo mode + 3-minute BYOK guide with free-tier providers |
| Judges can't run it | Hosted demo instance + demo mode requires zero setup |
