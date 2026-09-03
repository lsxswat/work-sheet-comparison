# Sheet Tools — Slip Sheet + Sheet Comparison

Two previously separate browser apps combined into one site, with a cover page
that selects between them. All PDF processing still happens locally in the
browser; no file bytes are uploaded anywhere.

## Navigation

```
Cover page
├── Slip Sheet ──── Choose Slip Sheet Mode
│                   ├── Drawing Update      (match by native PDF page label)
│                   └── Specification Update (match by footer section number)
└── Sheet Comparison
                    ├── Paired pages   (old page, then new page)
                    └── Vector overlay (original green / updated magenta / overlap black)
```

The brand button in the top-left returns to the cover page from anywhere.
Both tools stay mounted, so switching between them does not discard an
uploaded PDF or a built plan.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | All views in one document |
| `styles.css` | Slip Sheet stylesheet (unmodified from the original build) |
| `comparison.css` | Sheet Comparison styles, scoped to `#comparison-view` |
| `shell.css` | Cover page and view routing |
| `slipsheet.js` | Slip Sheet Drawing + Specification workflows |
| `comparison.js` | Sheet Comparison workflows |
| `shell.js` | Cover navigation, shared pdf.js worker setup |
| `drawing-plan-icon.png` | Icon asset used by the Slip Sheet cover |

Deploy by serving the folder as static files, or open `index.html` directly.
The pdf.js, pdf-lib, SheetJS and Font Awesome dependencies are still loaded
from their CDNs, exactly as in the two original builds.

## How the two apps were isolated

Both originals declared the same globals (`state`, `$`, `toast`, `parsePdf`,
`upload`, `buildPlan`, `renderReview`, `countOutline`) and shared several
element IDs and class names. Dropping them onto one page unchanged would have
broken both, so:

- **Module scope.** Each app is wrapped in an IIFE. No globals leak between them.
- **ID namespacing.** Sheet Comparison element IDs are prefixed `cmp-`
  (`#generate` → `#cmp-generate`, `#export-progress` → `#cmp-export-progress`,
  and so on). This removed six ID collisions, including `#export-progress`,
  which both apps queried.
- **CSS scoping.** Every Sheet Comparison selector is prefixed with
  `#comparison-view`, including its `:root` custom properties. Its `--green`,
  `--line` and `--shadow` values therefore no longer overwrite Slip Sheet's.
- **Class renames.** `.mode` and `.mode-switch` became `.cmp-mode` and
  `.cmp-mode-switch`. This mattered: Slip Sheet's cover CSS pins `.mode-switch`
  to `position:fixed` at 70% viewport height, which would have thrown the
  Sheet Comparison output-mode toggle across the screen.
- **Scoped lookups.** Slip Sheet's global `document.querySelectorAll('.mode')`
  and `.upload-card[data-kind]` queries are now scoped to `#slip-mode-switch`
  and `#drawing-view`. Sheet Comparison's upload cards use `data-cmp-kind` so
  the Slip Sheet binder skips them.
- **Body flag moved.** Sheet Comparison's `body.overlay-mode` flag now lives on
  the view root instead of `<body>`, so it cannot affect Slip Sheet.
- **Shared singletons.** One `#toast` element and one pdf.js worker
  registration, set by `shell.js` before either app initialises.
- **Reverse leakage blocked.** Scoping Sheet Comparison stopped it from
  reaching Slip Sheet, but not the other way around: `styles.css` is the
  unmodified Slip Sheet build, so its unscoped `body`, `.upload-card`,
  `.dropzone` and `.upload-card.loaded` rules also matched Sheet Comparison's
  markup (21px base font, tracking, text colour, `border: … !important` card
  and dropzone borders, and a loaded-card rule that hid the dropzone's
  "Choose a replacement PDF" label after an upload). The isolation block at
  the end of `comparison.css` restores the values the standalone build relied
  on, scoped to `#comparison-view`.

The transformations were applied by script (`build_comparison.py`,
`build_slipsheet.py` in the working tree) rather than by hand, so the app logic
inside each module is otherwise byte-identical to the originals.

## Notes

- The Sheet Comparison H1 was renamed from "Drawing Overlay Comparison" to
  "Sheet Comparison" to match the cover button. Change it in `index.html` if
  you prefer the original.
- "Sheet Tools" is a placeholder suite name, used in the `<title>` and the
  footer version line.
- Version strings for both underlying apps are preserved in the footer.

## Sheet Tools version history

### v2026.09.02.1

- Fixed a malformed `#comparison-view @media (max-width: 680px)` rule in
  `comparison.css`, which the browser discarded outright. Sheet Comparison's
  narrow-screen adjustments (hero side padding, stacked export card spacing,
  single-column phase rows) apply again.
- Stopped the Slip Sheet stylesheet from restyling Sheet Comparison — see
  "Reverse leakage blocked" above.

### v2026.09.01.1

- Combined the Slip Sheet and Sheet Comparison builds into one site behind a
  tool-selection cover page.

## Sheet Comparison version history

Versions below predate the merge, when the tool shipped on its own as
"Drawing Overlay Comparison".

### v2026.08.27.11

- Renamed the completed-state action from "Download again" to "Generate Again" in both output modes.

### v2026.08.27.10

- Read page labels and bookmarks concurrently.
- Enabled the PDF parser's fastest safe parsing mode.
- Released preview documents concurrently and removed redundant output flush passes while preserving UI yields.

### v2026.08.27.9

- Added adaptive PDF loading: small jobs load both sources together for speed; large jobs automatically use separate loading and memory-safe 10-sheet parts.

### v2026.08.27.8

- Each active sheet now moves smoothly from 0% to 80% over five seconds, waits at 80% if necessary, and fills immediately when the actual sheet work completes.

### v2026.08.27.7

- Normalized every vector page to its visible PDF CropBox before rotation and overlay, preventing offsets caused by different page origins or hidden media-box margins.

### v2026.08.27.6

- Added smooth simulated progress inside each numbered sheet rectangle.
- Removed the redundant batch bar above the ten sheet rectangles.

### v2026.08.27.5

- Replaced the large hero headline with "Drawing Overlay Comparison."

### v2026.08.27.4

- Reduced peak overlay memory by loading the original and updated vector sources in separate passes.
- Changed each numbered sheet rectangle into a live mini progress bar and enlarged progress text.

### v2026.08.27.3

- Renamed the tool and removed the decorative old/new sheet example from the hero.

### v2026.08.27.2

- Aligned the hero, output mode selector, upload cards, and review area to one consistent full-width page grid.

## How Sheet Comparison works

1. Upload the complete original drawing set.
2. Upload the PDF containing updated selected sheets.
3. Review the output order and generate the paired PDF.

Vector overlay is the default mode. Sheets are grouped into ordered batches of up to 10. Within each batch, source pairs are prepared and committed promptly to prevent the browser crashes caused by retaining 10 complete vector-mask pairs at once. The detailed progress panel reports source loading, difference-mask creation, page assembly, PDF writing, and 1-10 progress for the active batch.

The overall and detailed progress panels span the full width of the export area for easier monitoring on large screens.

The updated PDF controls sheet order. Matching native page labels produce an original/new pair; labels without a match remain as a single inserted sheet. Both pages in a pair receive the same page label. Applicable bookmark structures from both source PDFs are retained under separate bookmark groups.

All PDF bytes remain in the browser on the local device. PDFs are read directly from the selected local files instead of being duplicated in memory during upload. Local-file streaming and range requests are disabled to prevent browser `blob:` response errors while retaining the lower-memory loading path.

### Output modes

- **Paired pages:** each matched original sheet is immediately followed by its updated version. Inserted sheets appear once.
- **Vector overlay:** each selected sheet remains vector-based. Each source page becomes an explicitly inverted luminosity soft mask, then the tool paints the original mask with exact RGB 0,255,0 and the updated mask with exact RGB 255,0,255. The inversion is built from vector Difference blending rather than a soft-mask transfer function, improving viewer compatibility. Multiply blending makes aligned ink black, while differences remain green or magenta. Inserted sheets remain magenta. The updated sheet's native page rotation is preserved.

Vector overlay mode does not rasterize drawing pages, so exports generate faster and remain sharp at any zoom. It provides a two-color visual comparison rather than isolating only changed pixels.

Large vector exports are assembled one sheet at a time and written in chunks to reduce browser memory pressure.

Before comparison, every source sheet is normalized into its displayed visual orientation. Native PDF rotation is clockwise, so the vector drawing transform applies the corresponding inverse library angle and translated placement for 0, 90, 180, and 270 degree pages. Original and updated sheets are normalized independently, allowing matching sheets with different underlying rotation flags to align correctly.
