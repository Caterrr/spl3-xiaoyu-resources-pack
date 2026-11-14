# Local conversion pipeline snapshots

These scripts record the conversion and regression logic used for the 2026-11-14 texture repair. They are not part of the browser bundle. Their native-resource paths and Blender dependencies refer to the local model workspace; game source assets are not included in this repository.

- `export_raiders.py`: source texture decoding; each BNTX import scopes and restores its platform-specific deswizzler.
- `assemble_outfits.py`: assemble complete native outfits, pack materials and validate GLB/Blender round trips.
- `prepare_customizer_assets.py`: generate avatar, hair, eyebrow and skinned outfit components.
- `decoder-regression.py`: mixed-helper isolation and known-good eye/albedo/normal decode comparisons.
- `customizer-runtime-test.mjs`: exercise production assembly/export, validate skin attachment and eyebrow/head motion, and run Khronos validation.
- `customizer-state-test.mjs`: state normalization, 16 eyebrow variants, integrity errors and retries.
- `render_brow_posters.py`: complete-head eyebrow previews including the neutral mouth and teeth; output framing matches the UI without crop offsets.
