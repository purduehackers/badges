---
meta:
  contentType: Reference
---

# Paper texture used by stamp previews

`paper-height.png` is a 512 × 512-pixel derivative of `Paper001_1K-PNG_Displacement.png` from [ambientCG Paper 001](https://ambientcg.com/view?id=Paper001). The [ambientCG license](https://docs.ambientcg.com/license/) releases the source under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

The stamp renderer uses this map for paper grain and contact variation, at an estimated 80 mm tile size. The source describes an approximation, not a scanned or measured paper sample. `scripts/build-renderer.ts` embeds the PNG as a data URL; production renders do not fetch textures.
