---
meta:
  contentType: How-to
---

# Compare stamp impressions and acrylic finishes

Use the local comparison page to vary ink, pressure, paper, acrylic, and viewing angle. You can upload your own SVGs. The page runs the same stamp and badge renderers that generate Wack Hacker’s workflow previews. Uploaded files are checked locally and are not saved.

## Open the comparison

The comparison is a development tool and is not included in the public site. Use the local server below to run it.

Run this command from the repository root, then open `http://127.0.0.1:30589`:

```sh
bun experiments/surfaces/server.ts
```

The stamp starts at 1.5 inches on its shortest side. Black in the source removes rubber; the remaining surface prints. The impression stays readable because the cutting export handles mirroring separately.

Use **Normal**, **Dry / light**, or **Heavy** to compare ink transfer. Select paper and adjust pressure to explore incomplete contact. **Press stamp again** changes the ink distribution while preserving your settings.

The acrylic comparison holds geometry, color, lighting, and camera constant. Its three variants are:

- **Gloss everywhere**: A control with polished engraving
- **Matte engraving**: The default renderer, with glossy acrylic and matte engraving
- **Light handling**: The default finish with fingerprint roughness and scratch normals

Drag a badge to rotate all three. The angle slider moves the reflection across the design. Texture scale and strength are estimates.

## Export the experiments

Set `BADGE_CHROMIUM_EXECUTABLE_PATH` to your local Chromium executable on macOS. Run this command to export PNGs and `results.json` into `dist/surface-experiments`:

```sh
bun experiments/surfaces/render.ts
```

Pass an output directory as the first argument to save elsewhere. The script renders normal, dry, heavy, textured-paper, tilted, zero-ink, zero-pressure, and repeated impressions. It also renders opaque red, opaque black, transparent light blue, and pearlescent white acrylic.

The results compare identical-seed output and zero-input behavior. Dark-pixel coverage measures changes in these rendered images; it does not measure printing accuracy. The interactive acrylic comparison uses the same camera for every variant; the exported material examples use different colors and are not a controlled roughness comparison.

## Interpret the result

The stamp is an appearance model. Paper height affects contact, ink amount affects deposit, and pressure broadens the ink boundary. The model does not solve rubber deformation, ink fluid dynamics, or measured paper absorption. Validate fine details with a physical impression before manufacturing.

The badge uses one front surface. The engraving mask controls color, roughness, clearcoat, and transmission. Engraved pixels have roughness around 0.88 and no clearcoat. Fingerprints modify roughness; OpenGL scratch normals modify reflection direction. Neither texture changes the artwork color. The back and cut edge retain their polished material.

The workflow stores the stamp impression and acrylic render together during preview preparation. It preserves the source SVG, flat badge preview, and mirrored stamp cutting file. Existing stored previews remain unchanged until the workflow prepares new previews.

## Texture sources

The texture files are redistributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Sources and roles are:

| Asset                                                             | Source map                             | Use                               | Estimated tile size |
| ----------------------------------------------------------------- | -------------------------------------- | --------------------------------- | ------------------- |
| [Paper 001](https://ambientcg.com/view?id=Paper001)               | `Paper001_1K-PNG_Displacement.png`     | Paper grain and contact variation | 80 mm               |
| [Fingerprints 002](https://ambientcg.com/view?id=Fingerprints002) | `Fingerprints002_1K-JPG_Roughness.jpg` | Acrylic roughness variation       | 160 mm              |
| [Plastic 0002](https://www.texturecan.com/details/372/)           | `plastic_0002_normal_opengl_1k.png`    | Acrylic scratch normals           | 60 mm               |

The maps were resized to 512 × 512 pixels. The paper map lives in `src/renderer/assets` and is embedded into the headless renderer at build time. The other maps remain in this experiment. Preview generation makes no external texture requests.

License sources: [ambientCG license](https://docs.ambientcg.com/license/) and [TextureCan terms](https://www.texturecan.com/terms/).

Rendering references: [Three.js physical materials](https://threejs.org/docs/pages/MeshPhysicalMaterial.html), [roughness and normal maps](https://threejs.org/docs/pages/MeshStandardMaterial.html), and [Trodat’s explanation of excess pressure and ink feathering](https://www.trodat.net/us/en/blog/basic-flash-troubleshooting-part-2-identifying-an-imprint-issue). Trodat discusses flash stamps; its qualitative pressure and paper effects inform this approximation, not a calibrated model of the workshop’s laser-cut rubber.

The sample artwork comes from [Purdue Hackers badge designs](https://github.com/purduehackers/badge-designs): Hack Night 6.3 for the stamp and 6.17 for the bottle badge. The diamond is a workflow fixture. Samples do not change the current SVG checks.
