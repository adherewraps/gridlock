# GridLock — local geography trainer

Gamified spatial-memory trainer for a metro's freeways, arterials, districts and key junctions.
Ships with three regions — switch in the sidebar header; progress and pins are stored per region:
- **Piedmont Triad, NC** (default) — Greensboro, Winston-Salem, High Point, Burlington; Elm & Market address origin
- **Seattle Metro, WA** — Seattle, the Eastside and the south end; lake crossings and directional sectors (no single origin)
- **Phoenix Metro, AZ** — the one-mile arterial grid around Central & Washington

```bash
npm install
npm run dev
```

## Modes
- **Explorer** — color-coded freeways, grid arterials, address quadrants, districts, landmarks, custom pins (click-to-drop, drag to move). Hover any road or sector to inspect what it connects; click a road to study its crossings in order.
- **Quiz** — Intersection ID (multiple choice or typed), Boundary Match (districts, quadrants, "which road is the north edge?"), Corridor Connection (A→B). Basemap labels are hidden and zoom is capped at 14 while a question is open.
- **Route** — pick two anchors and the corridors you'd drive. A corridor-level router accepts any plan within 15% of the fastest, not just one canned answer.
- **Analytics** — accuracy by quadrant / district / challenge type, a recency-weighted heatmap on the map, and a spaced-repetition "Target my weak spots" round.

All progress, pins and preferences persist in `localStorage` (`gridlock:*` keys).

## Data pipeline
`scripts/region.<id>.mjs` is the only hand-written file per region: corridor **names / route refs**, descriptions,
districts (`bounds` rectangles, `around: [lat, lon]` squares, or `osm: 'Town Name'` for real municipal boundaries),
an optional address-grid origin, and landmarks. Use `names` for direction-agnostic matching ("Market Street" matches
"West Market Street") and `exact` where the direction *is* the identity (Seattle's "15th Avenue Northwest").
`scripts/build-region.mjs` pulls matching geometry from Overpass, then **derives** intersections (crossings,
T-junctions, freeway merges — and correctly ignores concurrent routes like I-40/I-85 sharing pavement), grid axes,
and district outlines.

```bash
node scripts/build-region.mjs --region=triad            # uses scripts/.cache if present
node scripts/build-region.mjs --region=triad --refresh  # re-download from OpenStreetMap
```

The build refuses Overpass mirrors whose data is more than 14 days old (stale route tags silently drop corridors)
and fails if any corridor matches no OSM ways.

To add a region: write `scripts/region.<id>.mjs`, run the build with `--region=<id>`, and register it in `src/data/regions.ts`.

Basemap: Esri Canvas (keyless). Roads: © OpenStreetMap contributors, ODbL.
