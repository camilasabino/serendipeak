# SerendiPeak media

Screenshots for the root [README](../../README.md) and technical reference. The README masthead and the social preview card live in [`docs/brand/`](../brand/) and are described at the end of this file.

```text
docs/media/
├── atlas.webp                 # Atlas, desktop 1920x1080
├── mountain-view.webp         # K2 mountain page, desktop 1920x1080
├── mountain-view-mobile.webp  # Fitz Roy mountain page, mobile 390x844
└── camera-editor.webp         # Camera Editor on the saved camera of Kilimanjaro, desktop 1440x900 (technical reference, not used in the README)
```

The README images show different mountains on purpose. See [Credits and rights](#credits-and-rights).

## Conventions

- Capture real product pages, never mockups, in a Chromium with working WebGL. Headless Chromium with software WebGL (`--use-angle=swiftshader --enable-unsafe-swiftshader`) is enough.
- Capture at 1920x1080 (desktop) or 390x844 (mobile), in English, without browser chrome. The saved camera of a mountain adapts to the stage size, so the desktop size matters: at 1440x900 Half Dome is partly hidden behind a ridge that the 1920x1080 framing clears.
- Open the mountain's route directly and capture without touching the camera: no `setView`, `flyTo` or `lookAt`, no Camera Editor query and no manual orbit or zoom.
- Use the production imagery configuration, `NEXT_PUBLIC_CESIUM_IMAGERY_MODE=world`. Sentinel-2, the development default, renders snow nearly white and does not look like the deployed site.
- Serve a production build (`next build` with `NEXT_PUBLIC_CESIUM_IMAGERY_MODE=world`, then `next start`) so the Next.js development indicator never appears in the scene. Set `NEXT_DIST_DIR` to keep the build away from the `.next` that a running development server uses.
- Capture one page at a time. Several browsers loading terrain at once leave tiles at a low level of detail, and a scene can fail to load entirely.
- Wait for the real scene before capturing: no status message left in the stage, no `role="alert"`, the photograph decoded, the fonts loaded, and a few seconds for terrain and imagery tiles to settle. A loading or failure state is never acceptable.
- Use public pages only. The Camera Editor reads everything from its query and writes nothing; use only data the public API already serves for a published mountain, and never click **Save camera…**.
- Never crop, cover or retouch the Cesium ion logo or the **Data attribution** link in the scene; they must stay visible in every capture and in anything derived from it.
- Keep each file under about 300 KB. Terrain imagery compresses poorly, so the set is roughly 0.5 MB at these sizes (about 0.37 MB for the three README images).
- The Atlas globe turns slowly (about 1.2° per second), so its framing depends on when the frame is taken. Capture it about 12 seconds after the stage is ready, which frames Europe and Africa as the earlier captures did; never pause or drag the globe to compose it.
- A mountain page opened directly has no **Back to atlas** link, which only appears for a visitor who arrived from the Atlas. Do not navigate through the Atlas just to show it.
- For the phone capture use a touch-enabled mobile emulation at 390x844 with a device scale factor of 1.

## Regenerating a screenshot

1. Build and serve the production build on a spare port, away from a running development server, against a local API with a published catalog (the page is rendered on the server, so the API's CORS origin does not matter for these routes):

   ```bash
   cd apps/web
   NEXT_DIST_DIR=.next-e2e/readme-media NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 \
     NEXT_PUBLIC_CESIUM_IMAGERY_MODE=world npm run build
   NEXT_DIST_DIR=.next-e2e/readme-media NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 \
     npx next start -p 3100
   ```

   `.next-e2e/` is ignored by Git. `NEXT_PUBLIC_CESIUM_ION_TOKEN` comes from `apps/web/.env.local`. Then open the page at the target viewport, for example `http://localhost:3100/mountains/k2`. The Atlas is `/atlas`.
2. Only for a Camera Editor reference (never for the public pages), use `/editorial/camera?mountain=<id>&slug=<slug>&name=<name>&lat=<lat>&lon=<lon>&elevation=<m>&heading=<deg>&pitch=<deg>&range=<m>&fx=<x>&fy=<y>`, with the values from the mountain's public API response.
3. Take a PNG screenshot of the viewport (Playwright's `page.screenshot` works well). The Atlas globe turns slowly, so each capture frames it slightly differently.
4. Convert it with `cwebp` (`brew install webp`):

```bash
cwebp -q 82 -m 6 screenshot.png -o docs/media/mountain-view.webp
```

## Brand images

Both images use the approved symbol and wordmark SVGs from `apps/web/public/brand/` unmodified. Those artworks are snow-colored, so they would disappear on GitHub's light theme; the images therefore set them on the product's basalt surface, which reads the same in both themes.

- **`docs/brand/readme-masthead.png`** is 2560x300 (shown at the README's width, so it stays sharp on high-density screens). It is the symbol and wordmark on `--sp-basalt` (`#110f0e`) and nothing else; the tagline is Markdown text in the README.
- **`docs/brand/social-preview.png`** is 1280x640 (the size GitHub recommends) and about 600 KB (an RGB PNG: quantizing it to a palette bands the sky and washes out the Cesium ion logo colors). It lays out the symbol, the wordmark, the tagline and a short description in Marcellus and Archivo (the product's typefaces) on `--sp-basalt`, `--sp-snow`, `--sp-snow-muted` and `--sp-copper` from `apps/web/src/shell/tokens.css`. On the right is a crop of the real Half Dome scene without any scene controls, the imagery and terrain credits as visible text and, unmodified, the scene's own Cesium ion attribution strip at the bottom right. It does not introduce a new logo.

To recreate the social preview, lay out a 1280x640 HTML page with those elements, render it in Chromium with the fonts loaded (they are in `apps/web/node_modules/@fontsource/` and `@fontsource-variable/`), and save a PNG screenshot. The strip and the terrain crop come from one capture of the Half Dome page at 1920x1080: the terrain from the scene area clear of the controls, and the strip copied pixel for pixel from the scene's bottom-left corner.

GitHub does not read the card from the repository: upload it under Settings → General → Social preview.

### Two different social images

- **`docs/brand/social-preview.png`** is the *GitHub repository* social preview. It is not referenced by any page and is never served by the web app; it only exists to be uploaded by hand. Its right half is a real Half Dome capture in World Imagery, with the imagery and terrain credits printed as text.
- **`apps/web/public/brand/serendipeak-mountain-social-v1.png`** is the *mountain page* Open Graph card, below.

The Open Graph card for mountain pages is a separate, static asset: `apps/web/public/brand/serendipeak-mountain-social-v1.png` (1200x630), original artwork of contour lines on `--sp-basalt` with no photograph, satellite imagery or Cesium capture, so it needs no credits. It is served as-is and never regenerated; to change it, add a new `-vN` file and point `MOUNTAIN_CARD_PATH` at it.

## Credits and rights

The repository license ("All rights reserved") does not cover the third-party material shown in these images.

- **Photographs**: the captures show them resized inside the product page, where the product itself credits the author and license under **About this photo**.
  - `mountain-view.webp` (K2): "Chogori.jpg" by Zacharie Grossen, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Chogori.jpg).
  - `mountain-view-mobile.webp` (Fitz Roy): "Vue du Fitz Roy.jpg" by Sebgigon, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vue_du_Fitz_Roy.jpg).
  - `atlas.webp`, `camera-editor.webp` and the social preview show no photograph.
- **3D terrain** (all images): Cesium World Terrain, streamed through Cesium ion. Cesium's terms allow images of its services in promotional material provided its attribution stays intact, and its [content usage and attribution guide](https://cesium.com/learn/ion/content-usage-and-attribution-guide/) requires the Cesium ion logo to be prominent and the data attribution details to be visible in static images (the "Data attribution" link alone is not enough). The social preview therefore shows the logo and the credits as text, and the root README prints the terrain, imagery and photograph credits as visible text directly under its screenshots, which is the guide's "caption" approach. The README images are deliberately not links to the standalone files, so none is offered without that caption; the files are still reachable by their repository path, and they keep the scene's own logo and **Data attribution** link unaltered. Anyone reusing an image elsewhere must carry the credits with it.

Review of the terms (guide, [Appendix B](https://cesium.com/legal/third-party-terms/) and [Appendix B-1, Bing Maps Content](https://cesium.com/legal/terms-for-bing/), read 2026-11-24): the guide requires visible attribution details in static content made with Cesium ion Asset Depot assets, says screenshots nowhere by name, and warns that some providers limit renderings that include their data. Appendix B forbids removing, obscuring or blocking attribution. The Bing terms allow content only "to access and display maps and related information", forbid copying or archiving the content and obscuring Microsoft's notices, and say nothing about screenshots, static images or published material. Not read: the Bing Maps end-user terms and Microsoft's brand guidelines that Appendix B-1 links. The guide also says Cesium ion's Bing access runs "at least through September 2026", a date that has passed; nothing here checks what the service serves now. **Unresolved:** no document reviewed expressly permits republishing screenshots of World Imagery, so the right to reproduce the imagery in these images is not confirmed. The credits and the unmodified attribution are kept as the conservative course, and the images are kept because they show the product as a portfolio project, not because clearance was established. The terrain credits, as the scene's own **Data attribution** panel lists them: data available from the U.S. Geological Survey, © CGIAR-CSI, produced using Copernicus data and information funded by the European Union - EU-DEM layers, data available from Land Information New Zealand, data available from data.gov.uk, data courtesy Geoscience Australia.
- **Satellite imagery** (every image here, the Camera Editor reference and the social preview included): Cesium World Imagery from Cesium ion, the imagery the deployed site uses (`world` mode). Credits as the scene's **Data attribution** panel lists them, and as the social preview reproduces them: © 2026 Microsoft Corporation, © Mapbox, © Maxar, ©CNES (2026) Distribution Airbus DS, Earthstar Geographics SIO. These images show the product as a portfolio project; Cesium World Imagery stays subject to its providers' terms, which the repository license does not cover. The attribution strip in each capture is the scene's own.
- **Camera Editor reference** (`camera-editor.webp`): the same Cesium World Terrain and World Imagery as the other captures, so it carries the same credits. It shows no photograph and no scene beyond the Kilimanjaro scene and the editor's own panel. (An earlier version used Sentinel-2 imagery from Cesium ion, EOxCloudless under CC BY-NC-SA; no current image does.)
- **Starfield**: the Atlas capture shows CesiumJS's built-in sky box, whose star images come from NASA (see the [CesiumJS license notices](https://github.com/CesiumGS/cesium/blob/main/LICENSE.md), "Sky box images from NASA", and [NASA's media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)).
- **Brand artwork and typefaces**: the SerendiPeak symbol and wordmark, and Marcellus and Archivo, which are open-licensed (SIL Open Font License) fonts self-hosted by the product.

The four screenshots were recaptured on 2026-11-24 from a local production build of the current code with `NEXT_PUBLIC_CESIUM_IMAGERY_MODE=world`, against a local catalog whose slugs and saved cameras matched the production API's, and the social preview was captured earlier the same way. They match the deployed site for the same viewport. Each shows the Cesium ion logo and the scene's "Data attribution" link, and the credits above apply to it.
