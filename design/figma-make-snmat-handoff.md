# Figma Make / scratch — SNMAT-aligned URL tester

## Scratch file (created via MCP)

Open the blank design file and continue in **Figma** or **Figma Make** in the browser:

**[SNMAT URL list tester (scratch)](https://www.figma.com/design/t92bcwuVr13onJxiVBwoHY)**

> If automated plugin/API edits hit rate limits, paste the prompt below into **Figma Make** on this file (or a new file) to generate frames.

## Paste prompt for Figma Make (AI)

Design a single desktop frame (1280px wide) for a **URL filter testing tool** for the **Diocese of Southwell & Nottingham Multi Academy Trust** ([snmat.org.uk](https://www.snmat.org.uk/)). Visual language: **trustworthy education sector**, not corporate — deep **navy** backgrounds, **warm gold** accent for headings and primary actions, **accessible blue** for links (similar to `#007cba`), **Source Sans 3** or humanist sans typography, generous whitespace, rounded cards. Include: (1) small gold kicker “Diocese of Southwell & Nottingham MAT”; (2) H1 “Test your URL list”; (3) short body copy; (4) a **panel** with label “URLs (CSV or one URL per line)” and a large textarea; (5) primary button “Run checks” in gold and secondary “Export results CSV”; (6) **Results** table with three example rows: one **Allowed** (deep red row `#b91c1c`, white text), one **Blocked** (green `#15803d`, white text), one **Unverified** (amber `#b45309`, white text); (7) **Summary** with stat tiles and two charts: pie “Verdict mix”, bar “Verdict counts”; (8) footer line with copyright tone and link to snmat.org.uk. Use auto-layout, 8px grid, WCAG-friendly contrast on text.

## Design tokens (code-aligned)

| Token | Hex | Usage |
|--------|-----|--------|
| Page background | `#0a1524` | Canvas / html |
| Surface / cards | `#132a45` | Panels |
| Border | `#2d4a6f` | Card borders |
| Text | `#f8fafc` | Body |
| Muted text | `#94a3b8` | Secondary |
| Gold accent | `#c9a227` | Kicker, primary button, focus |
| Link (WP-style) | `#007cba` | Hyperlinks (if not on red/green rows) |
| Allowed row | `#b91c1c` | Verdict Allowed |
| Blocked row | `#15803d` | Verdict Blocked |
| Unverified row | `#b45309` | Verdict Unverified |

## Frames to create (checklist)

1. `Desktop — URL list tester (SNMAT)` — vertical auto-layout, padding 56px, gap 28px.
2. `Header` — kicker + H1 + lede paragraph.
3. `Panel / Input` — textarea + actions row.
4. `Panel / Results` — table with Verdict | URL | Probes.
5. `Panel / Summary` — 4 stat chips + pie + bar + optional third chart “Edge HTTP status groups”.

## Notes

- **Figma MCP** `use_figma` calls may be limited on Starter plans; manual **Figma Make** prompts work in the same file.
- Live app styling is implemented in `src/components/UrlTester.css` — keep tokens in sync when changing Figma variables.
