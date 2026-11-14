# Raiders character customizer

The customizer combines the four source player bodies, 20 hairstyle assets, 16 eyebrow variants and 39 complete game-defined outfits. Gender and species select the source body and four compatible eyebrow styles. The 21 original iris textures and editable hair colour are embedded in the downloaded GLB. Eyebrows follow the selected hair colour. Outfit masks are fitted to each body. Closed helmets suppress hair according to the source configuration.

Clothing and gloves share the character skeleton. Additional sleeve and waistcloth bones are retained; hair, eyebrows and headwear keep their bone hierarchy below the character head. Exports contain editable meshes, skins and embedded images. No server-side Blender conversion or user addon is required.

## Verification — 2026-11-14

- Production assembly and GLTFExporter code exercised on 156 body/outfit combinations, covering all 20 hairstyles and 21 iris textures across the matrix.
- Khronos glTF validation: zero errors across all 156 exported files.
- Every exported file re-imported into Blender 4.5.3; embedded textures, mesh attachment and finite geometry checked.
- Front/back renders reviewed for all 156 combinations. Forearm/head motion tested on every combination; upper-arm, elbow, knee and head movement checked separately, with rendered motion review across all 39 outfits.
- State normalization, compatible hairstyle fallback, checksum/length failures, download retry and cache behavior tested.
- Page IDs, controls, module references, navigation links, JavaScript syntax and static build checked.
- All 63 hosted assets downloaded again and matched against local SHA-256 and length; CORS and all hairstyle/outfit posters verified. Temporary ingest authorization removed and confirmed inaccessible.

The test matrix covers each body/outfit pair and every available asset; it does not exhaust every hairstyle/outfit/colour permutation or extreme animation pose. No connected browser-control surface was available, so browser-rendered UI, touch interaction and actual browser download clicks require user acceptance testing.

The source assets are content-addressed. Before updating the catalog, repeat source/material/assembly checks, export round trips and post-upload integrity verification. Keep the vendored Three.js version and its MIT license together.

## Texture repair and eyebrow selection — 2026-11-14

The eye and clothing checker artifacts were present in the converted images. Loading multiple conversion helpers replaced a shared BNTX deswizzler while the active importer updated a different helper's platform flag. This applied the NX block order to Ounc textures. Each texture import now scopes its decoder to the file header and restores the previous decoder in `finally`; it no longer depends on shared mutable platform state. Mixed-helper regression tests compare iris, albedo and normal images with confirmed Ounc-decoded references.

All 84 iris images were regenerated and reviewed at enlarged scale. All 39 complete outfits were rebuilt, including their packed Blender files, library GLBs, posters, outfit masks and customizer assets. The 16 source eyebrow models are separate skinned accessories, attached below the head. The existing hairstyle tab now reads “头部” and includes eyebrow choices; old saved selections default to style 02. Exports preserve the chosen eyebrow mesh and style metadata.

Revalidation completed with zero glTF errors for 156 body/outfit combinations covering all 16 eyebrow variants. Each exact exported file was reopened in Blender, checked for packed images and attached skins, and rendered from front/back. Arm, elbow, knee and head motion were checked; eyebrow vertices were verified to follow head movement. All 16 assembled eyebrow variants received additional close-up renders. Updated library Blender/GLB files were reopened independently during conversion.

All 192 changed hosted files were downloaded and matched against SHA-256 and original byte length, with CORS verified. The upload credential was removed and ingest returned HTTP 403. Cache revisions cover the customizer modules, stylesheet and both affected catalogs. See `raiders-texture-repair-validation.json` for exact export and hosted-file hashes. Browser UI and download clicks remain untested because a connected browser-control surface was unavailable; the assembly/export checks run the production modules with Node Canvas, and visual checks use Blender.

## Eyebrow posters and control edges — 2026-11-14 follow-up

The eyebrow poster renderer had omitted the source `Mouth00` face meshes and teeth, leaving the lower face incomplete. Regenerated all 16 posters with those components, a complete-head 512 × 320 frame and no CSS crop offsets. Reviewed every resulting render and downloaded all 16 new hosted images to verify byte length, SHA-256 and CORS. This changes preview images only; the assembled/exported character already includes these facial components.

Species and gender now use two-option native radio groups with matching selected, hover and keyboard-focus styles. Color swatches reserve a 44px hit area; their color disc, selection ring and hover effect stay inside it. Thumbnail and color-input focus outlines also draw inward, and native color-input swatch borders are normalized. Removed outward swatch scaling and negative ring insets that were clipped by the scrolling editor. Reduced-motion settings remain respected.

JavaScript syntax, HTML IDs/ARIA references, radio-group defaults, selector references and static build checked. No browser-control surface was available, so these checks do not constitute browser interaction testing.
