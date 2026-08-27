# Drawing Overlay Comparison

## v2026.08.27.11

- Renamed the completed-state action from "Download again" to "Generate Again" in both output modes.

## v2026.08.27.10

- Read page labels and bookmarks concurrently.
- Enabled the PDF parser's fastest safe parsing mode.
- Released preview documents concurrently and removed redundant output flush passes while preserving UI yields.

## v2026.08.27.9

- Added adaptive PDF loading: small jobs load both sources together for speed; large jobs automatically use separate loading and memory-safe 10-sheet parts.

## v2026.08.27.8

- Each active sheet now moves smoothly from 0% to 80% over five seconds, waits at 80% if necessary, and fills immediately when the actual sheet work completes.

## v2026.08.27.7

- Normalized every vector page to its visible PDF CropBox before rotation and overlay, preventing offsets caused by different page origins or hidden media-box margins.

## v2026.08.27.6

- Added smooth simulated progress inside each numbered sheet rectangle.
- Removed the redundant batch bar above the ten sheet rectangles.

## v2026.08.27.5

- Replaced the large hero headline with "Drawing Overlay Comparison."

## v2026.08.27.4

- Reduced peak overlay memory by loading the original and updated vector sources in separate passes.
- Changed each numbered sheet rectangle into a live mini progress bar and enlarged progress text.

## v2026.08.27.3

- Renamed the tool and removed the decorative old/new sheet example from the hero.

## v2026.08.27.2

- Aligned the hero, output mode selector, upload cards, and review area to one consistent full-width page grid.

Open `index.html` in a modern browser with an internet connection, then:

1. Upload the complete original drawing set.
2. Upload the PDF containing updated selected sheets.
3. Review the output order and generate the paired PDF.

Vector overlay is the default mode. Sheets are grouped into ordered batches of up to 10. Within each batch, source pairs are prepared and committed promptly to prevent the browser crashes caused by retaining 10 complete vector-mask pairs at once. The detailed progress panel reports source loading, difference-mask creation, page assembly, PDF writing, and 1-10 progress for the active batch.

The overall and detailed progress panels span the full width of the export area for easier monitoring on large screens.

The updated PDF controls sheet order. Matching native page labels produce an original/new pair; labels without a match remain as a single inserted sheet. Both pages in a pair receive the same page label. Applicable bookmark structures from both source PDFs are retained under separate bookmark groups.

All PDF bytes remain in the browser on the local device. PDFs are read directly from the selected local files instead of being duplicated in memory during upload. Local-file streaming and range requests are disabled to prevent browser `blob:` response errors while retaining the lower-memory loading path.

## Output modes

- **Paired pages:** each matched original sheet is immediately followed by its updated version. Inserted sheets appear once.
- **Vector overlay:** each selected sheet remains vector-based. Each source page becomes an explicitly inverted luminosity soft mask, then the tool paints the original mask with exact RGB 0,255,0 and the updated mask with exact RGB 255,0,255. The inversion is built from vector Difference blending rather than a soft-mask transfer function, improving viewer compatibility. Multiply blending makes aligned ink black, while differences remain green or magenta. Inserted sheets remain magenta. The updated sheet's native page rotation is preserved.

Vector overlay mode does not rasterize drawing pages, so exports generate faster and remain sharp at any zoom. It provides a two-color visual comparison rather than isolating only changed pixels.

Large vector exports are assembled one sheet at a time and written in chunks to reduce browser memory pressure.

Before comparison, every source sheet is normalized into its displayed visual orientation. Native PDF rotation is clockwise, so the vector drawing transform applies the corresponding inverse library angle and translated placement for 0, 90, 180, and 270 degree pages. Original and updated sheets are normalized independently, allowing matching sheets with different underlying rotation flags to align correctly.
