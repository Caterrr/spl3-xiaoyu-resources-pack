# Raiders character customizer

The customizer combines the four source player bodies, 20 hairstyle assets and 39 complete game-defined outfits. Gender and species select the source body; 21 original iris textures and editable hair colour are embedded in the downloaded GLB. Outfit masks are fitted to each body. Closed helmets suppress hair according to the source configuration.

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
