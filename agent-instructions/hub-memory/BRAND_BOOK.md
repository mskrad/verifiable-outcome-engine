# VRE — Brand Book v1.0

## 1. Brand foundation

**Project:** Verifiable Outcome Engine
**Short name:** VRE

**Core line:** Commit rules, then verify.

**Brand role:** A memorable Solana-native infrastructure brand for deterministic, replay-verifiable outcomes.

**Brand priorities:**
1. Trust
2. Technical depth
3. Memorability

**Desired first impression:** Memorable Solana-native infra brand. Not toy-like, not generic serious-infra sludge.

---

## 2. Brand system architecture

**Layer A — Core mark**
favicon, repo identity, docs header, compact branding, technical contexts

**Layer B — Mascot (Match Keeper)**
landing hero, README banner, slide covers, social cards, pitch surfaces

**Layer C — Tooling UI**
verify, spec, results, docs diagrams, CLI surfaces

**Rule:** tooling UI stays strict. Mascot absent or only ghosted. No mascot-led trust cues inside critical verification flows.

---

## 3. Core logo asset spec

**Symbolic priority:** verified match → replay loop → sealed artifact

**Personality:** infrastructure-oriented, precise, modern, technical, slightly brandable. Seriousness: 5/10.

**Required visual ideas:**
- compact confirmation / check logic
- replay loop / ring / orbital trace
- central sealed core or capsule-derived geometry

**Forbidden:** dice, coins, lootboxes, shields, padlocks, generic blockchain cubes, animal silhouettes, casino symbolism, glossy 3D

**Deliverables:**
1. Icon only
2. Icon + VRE wordmark
3. Monochrome dark
4. Monochrome light
5. Accent color version
6. Favicon simplification (только symbol, без текста, без orbit clutter)

---

## 4. Match Keeper asset spec

**Canonical role:** Silent verifier / witness

**Emotional profile:** calm, composed, slightly friendly, observant, incorruptible

**Cuteness:** 4/10 — approachable but restrained. Not plushy, not chibi, not comedic.

**Canonical silhouette:** Hooded keeper

**Mandatory elements:** check seal on chest + replay ring / orbit

**Optional (if subtle):** minimal glow in eyes, subtle inner core lighting, restrained robe geometry, faint hex framing

**Forbidden:** circuit tendrils, chibi proportions, cyberpunk neon, aggressive fantasy details, over-mechanical robot parts, weapons, exaggerated magical FX

**Design notes:** compact body, readable silhouette, dark face cavity or visor, minimal eyes, stable chest seal, thin precise orbit, robe/hood — symbolic not medieval

---

## 5. Match Keeper deliverables

1. Canonical full-body pose (neutral / front-facing / 3/4 angle)
2. Hero pose (orbit more active, chest seal emphasized, calm not action-comic)
3. Bust / icon crop
4. Ghosted watermark version (very low contrast, silhouette + chest seal hint only)
5. Flat simplified vector version
6. Transparent-background PNG
7. SVG-style clean illustration version

---

## 6. Color system

### Palette — реальные значения из проекта

| Role | Name | Hex |
|---|---|---|
| Base background | Graphite deep | `#0d0f14` |
| Surface 1 | Graphite mid | `#13161e` |
| Surface 2 | Graphite light | `#1a1d28` |
| Border | — | `#252835` |
| Primary text | — | `#e8eaf0` |
| Secondary text | — | `#8b91a8` |
| **Primary accent** | Solana green / teal | `#14f195` |
| Primary accent dim | — | `#0d9b61` |
| **Secondary accent** | Solana violet | `#9945ff` |
| Error / mismatch | Red | `#f14d4d` |

### Color roles

`#14f195` — verification signal, match state, orbit line, chest seal highlight, active accent

`#9945ff` — ambient depth, supporting glow, premium tonal balance, timeline artifact marker

`#0d0f14` — base surfaces, stability, technical seriousness, contrast background

### Glow policy
Intensity: 6/10 — visible in hero branding, controlled in UI, no neon bloom overload, accents stay crisp.

### Semantic colors

| State | Color |
|---|---|
| Match / success | `#14f195` led |
| Neutral / inactive | graphite / `#8b91a8` |
| Warning | amber, restrained |
| Error / mismatch | `#f14d4d`, not screaming |

---

## 7. Typography

**Primary font:** [Inter](https://fonts.google.com/specimen/Inter) — neo-grotesk, free, works in README, slides, UI одновременно.

**Fallback stack:** `Inter, system-ui, -apple-system, sans-serif`

**Tone:** typography должна быть трезнее маскота.

**Avoid:** sci-fi gamer fonts, decorative futuristic fonts, fantasy serif, over-stylized crypto type.

---

## 8. Visual style

**Overall:** Dark infra + subtle mystic character

**Materials:** clean vector-like surfaces, controlled soft glow, strong silhouette, minimal internal detailing

**Shape language — use:** arches, capsules, loops, precise seals, controlled symmetry, soft geometric robe planes

**Shape language — avoid:** spikes, jagged aggression, too many micro-details, chaotic fragments

---

## 9. Surface usage policy

| Surface | Match Keeper |
|---|---|
| landing hero | ✅ prominently |
| README banner | ✅ prominently |
| slide cover | ✅ prominently |
| social cards | ✅ prominently |
| section dividers | ✅ allowed |
| announcement images | ✅ allowed |
| build.html | 👻 ghosted accent only |
| technical forms | 👻 ghosted accent only |
| verify.html | ❌ absent |
| spec.html | ❌ absent |
| result tables | ❌ absent |
| CLI docs | ❌ absent |

**Verify/spec rule:** эти страницы должны читаться как инструменты, proof interfaces. Не как game front или mascot scene.

---

## 10. Website asset spec

### Landing hero

**Composition:**
- Match Keeper as primary visual figure
- VRE core mark nearby or integrated
- chest seal clearly readable
- replay orbit visible
- dark `#0d0f14` background
- `#14f195` teal signal accents
- subtle `#9945ff` violet ambient depth

**Mood:** calm, technical, precise, slightly mystical, not playful

**Hero line:** Commit rules, then verify.

**Supporting options:**
- Any outcome. Independently verifiable.
- Replay the result. Confirm the match.
- Pre-committed rules. Deterministic replay.

### Verify page
- Match Keeper: none или очень faint watermark
- Priority: MATCH/MISMATCH clarity, semantic colors, replay logic readability

### README banner
- Match Keeper bust или half-body
- VRE core mark
- Strong copy line
- Flat dark background, clear text contrast
- Работает в horizontal формате

---

## 11. Messaging spec

**One-liner (5 words, Josip standard):** On-chain proof of who won.

**Core tagline:** Commit rules, then verify.

**Secondary lines:**
- Any outcome. Independently verifiable.
- Replay the exact result from public data.
- Pre-committed rules. Deterministic replay.
- Verification should not depend on trust.

**Tone:** concise, falsifiable, technical, grounded, low-hype

**Avoid:** luck, fate, magic, fortune, "provably fair" без concrete replay framing

**Pitch don'ts (Josip's rules — apply to all public copy):**
- No "The Problem" / "The Solution" as slide/section titles
- No buzzwords: trustless, infrastructure, deterministic, disrupting, revolutionizing
- "verifiable" is allowed — it's technically accurate, not marketing fluff
- No text-heavy slides — max 3 lines per slide
- Problem framed as user desire, not lack of solution: "users want proof their winner wasn't faked" not "there's no verification tool"
- Numbers must have sources cited or be removed
- Pitch deck: Google Slides link only, never PDF

---

## 12. Prompt pack

### 12.1 Core logo
```
Create a clean vector logo for "Verifiable Outcome Engine" (VRE).
Style: modern infra brand, dark graphite base (#0d0f14), electric teal accents (#14f195),
subtle muted violet secondary (#9945ff), square-friendly, transparent background.
Symbol priority: verified match first, replay loop second, sealed artifact third.
Use a compact geometric icon that suggests confirmation, deterministic replay,
and a committed core.
Avoid dice, coins, lootboxes, shields, padlocks, cubes, mascots, cyberpunk neon,
and glossy effects. --no text letters numbers
Deliver icon-only and icon+wordmark versions.
```

### 12.2 Match Keeper
```
Create a mascot called "Match Keeper" for a Solana-native infrastructure project
called Verifiable Outcome Engine.
The mascot is a silent verifier / witness, slightly friendly but composed,
not cute, not chibi, not cyberpunk.
Canonical form: hooded keeper with a compact silhouette, dark face cavity,
minimal glowing eyes, a precise check seal on the chest (#14f195 teal),
and a thin replay orbit around or behind the body.
Style: dark infra + subtle mystic character, graphite base (#0d0f14),
electric teal highlights (#14f195), muted violet ambient depth (#9945ff).
The mascot must feel trustworthy, technical, and symbolic of verification integrity.
Avoid circuit tendrils, exaggerated fantasy robe details, cyberpunk neon,
comedic expressions, gaming-gacha aesthetics, chibi proportions.
--no text letters numbers symbols words
```

### 12.3 Hero art
```
Create a landing-page hero illustration for "Verifiable Outcome Engine"
featuring the mascot Match Keeper and the VRE core logo.
The scene should communicate: committed rules, deterministic replay, verified match.
Use a dark graphite background (#0d0f14), electric teal verification accents (#14f195),
and restrained muted violet atmosphere (#9945ff).
Match Keeper should be calm, centered, and readable — check seal on chest,
replay orbit visible.
Mood: memorable Solana-native infra brand, not toy-like, not casino-themed, not cyberpunk.
--no text letters numbers
```

### 12.4 README banner
```
Create a wide GitHub README banner for "Verifiable Outcome Engine"
featuring Match Keeper and the VRE core logo.
The banner should be clean, horizontal, dark (#0d0f14), high-contrast,
readable at small sizes.
Include the text line: "Commit rules, then verify."
Avoid clutter, excessive glow, UI screenshots, and playful game imagery.
Style: dark infra + subtle mystic character, teal (#14f195) and violet (#9945ff) accents.
```

---

## 13. Asset roadmap

### Phase 1 — до Apr 25 (конец Sprint 3)
1. Core VRE logo
2. Match Keeper canonical pose
3. Landing hero image
4. README banner

### Phase 2 — до May 4 (конец Sprint 4)
5. Match Keeper bust icon
6. Watermark ghost version
7. Social card template
8. Slide cover template

### Phase 3 — nice-to-have
9. Sticker sheet
10. Favicon refinement
11. Verified badge family
12. Section divider illustrations

---

## 14. Design guardrails

**Always preserve:** trust, technical depth, clarity, replay/verify semantics

**Acceptable tradeoff:** minimalism

**Never sacrifice:** seriousness of verification flows, legibility of technical surfaces, independent core logo function

---

## 15. Final directive

Build VRE as a technically credible, memorable Solana-native infra brand where Match Keeper symbolizes verified match, while all critical tooling surfaces remain clean, strict, and instrument-like.
