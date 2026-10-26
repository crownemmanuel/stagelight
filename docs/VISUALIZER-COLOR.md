# Visualizer color

Engine and preview use `public/fixture-colors.js` as the shared color-wheel source. R3 and MH7 preview beams and chip dots show the nearest selected wheel filter rather than the requested RGB. Agents can inspect these exact hex/value choices via `lights_schema` profile `colorWheel`; commands remain `lights_fixture_set` color and cue/effect parameters. Filter swatches approximate the real filters; no measured colorimetry is implied.

Fixed RGB/RGBW lights display their RGB values plus the white emitter (warm-white tint for Q120). Preview RGB is converted from sRGB into Three.js's linear working space. Haze cones and footprint overlays use normal alpha blending without exposure/tone mapping or scene fog, so overlapping beams do not all accumulate to white. Lens brightness and room spotlight energy are bounded separately from DMX intensity.

The physical DMX channel mapping and nearest-filter selection are unchanged. In the Neon Tidal Dance pastel chapter, a requested pale cyan can legitimately select white on the R3 wheel. Exact RGB matching is unavailable on a fixed color wheel. User may choose a saturated wheel color if a stronger physical color is desired.

## Permanent White swatch
White is pinned first in the operator palette, even for older imported shows without it. It uses color #ffffff and white 0: R3/MH7 select the open white wheel slot (DMX 0); Q120/COLORado use full RGB mixing without adding a warm-white tint. Intensity and position are unchanged. MCP equivalents: lights_palette_save {id: white, name: White, color: #ffffff} and lights_fixture_set {ids: [...], values: {color: #ffffff, white: 0}}. Unsupported/unverified profiles remain disabled.
