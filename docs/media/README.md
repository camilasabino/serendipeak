# SerendiPeak media

Screenshots used in the root [README](../../README.md). The social preview card lives in [`docs/brand/`](../brand/) and is described at the end of this file.

```text
docs/media/
├── mountain-view.webp         # mountain page, desktop 1440x900
├── mountain-view-mobile.webp  # mountain page, mobile 390x844
└── camera-editor.webp         # Camera Editor opened on a saved camera, desktop 1440x900
```

All three show Aconcagua; see [Credits and rights](#credits-and-rights).

## Conventions

- Capture real product pages, never mockups, in a Chromium with working WebGL.
- Capture at 1440x900 (desktop) or 390x844 (mobile), in English, without browser chrome.
- Wait for the real scene before capturing: no status message left in the stage, no `role="alert"`, the photograph decoded, the fonts loaded, and a few seconds for terrain and imagery tiles to settle. A loading or failure state is never acceptable.
- Use public pages only. The Camera Editor reads everything from its query and writes nothing; use only data the public API already serves for a published mountain, and never click **Save camera…**.
- Never crop, cover or retouch the Cesium ion logo or the **Data attribution** link in the scene; they must stay visible in every capture and in anything derived from it.
- Keep each file under about 300 KB. Terrain imagery compresses poorly, so the set is roughly 0.5 MB.

## Regenerating a screenshot

1. Open the page at the target viewport, for example `https://serendipeak.camilasabino.dev/mountains/aconcagua`.
2. For the Camera Editor, use `/editorial/camera?mountain=<id>&slug=<slug>&name=<name>&lat=<lat>&lon=<lon>&elevation=<m>&heading=<deg>&pitch=<deg>&range=<m>&fx=<x>&fy=<y>`, with the values from the mountain's public API response.
3. Take a PNG screenshot of the viewport (Playwright's `page.screenshot` works well).
4. Convert it with `cwebp` (`brew install webp`):

```bash
cwebp -q 82 -m 6 screenshot.png -o docs/media/mountain-view.webp
```

## Social preview

`docs/brand/social-preview.png` is 1280x640 (the size GitHub recommends) and about 340 KB (an indexed PNG; the Cesium ion logo colors are preserved exactly). It reuses the existing brand mark (`apps/web/public/brand/serendipeak-mark.png`), the Spectral and Instrument Sans typefaces, the `--sp-stage` background and the `--sp-glacier` accent from `apps/web/src/shell/tokens.css`, with a crop of the real Aconcagua scene on the right, the imagery and terrain credits as visible text, and, unmodified, the scene's own Cesium ion attribution strip at the bottom right. It does not introduce a new logo.

To recreate it, lay out a 1280x640 HTML page with those elements, render it in Chromium with the fonts loaded (they are in `apps/web/node_modules/@fontsource/`), and save a PNG screenshot. GitHub does not read the card from the repository: upload it under Settings → General → Social preview.

## Credits and rights

The repository license ("All rights reserved") does not cover the third-party material shown in these images.

- **Photograph** (shown in `mountain-view.webp` only): "Aconcagua2016.jpg" by Bjørn Christian Tørrissen, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0), from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Aconcagua2016.jpg). The captures show it resized inside the product page, where the product itself credits its author and license under **About this photo**.
- **3D terrain**: Cesium World Terrain, streamed through Cesium ion. Cesium's terms allow images of its services in promotional material provided its attribution stays intact, and its [content usage and attribution guide](https://cesium.com/learn/ion/content-usage-and-attribution-guide/) requires the Cesium ion logo to be prominent and the data attribution details to be visible in static images (the "Data attribution" link alone is not enough). The social preview therefore shows the logo and the terrain credits as text: data available from the U.S. Geological Survey; © CGIAR-CSI; produced using Copernicus data and information funded by the European Union - EU-DEM layers; LINZ - Land Information New Zealand; based on Geoscience Australia material; © Environment Agency copyright and/or database right 2015, all rights reserved (the sources listed on the [Cesium World Terrain](https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/) page).
- **Satellite imagery**: Sentinel-2 imagery from Cesium ion (asset 3954), which is the EOxCloudless 2021 layer. Required credit, reproduced in the social preview: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2021)", linking to [cloudless.eox.at](https://cloudless.eox.at) and [EOX IT Services GmbH](https://eox.at). EOX licenses it under [CC BY-NC-SA 4.0](https://cloudless.eox.at/license-non-commercial) (attribution, non-commercial, share-alike); these captures document a non-commercial portfolio project. The images contain no Bing Maps imagery.
- **Brand mark and typefaces**: the SerendiPeak mark, and Spectral and Instrument Sans, which are open-licensed fonts self-hosted by the product.

The captures were taken from a local development build with `NEXT_PUBLIC_CESIUM_IMAGERY_MODE=sentinel2` (the development default). Production keeps its own imagery configuration.

The three screenshots in this folder show the Cesium ion logo and the scene's "Data attribution" link; the full terrain and imagery credits above apply to them and to the social preview.
