import { createBadgeScene } from "./scene.ts";
import { renderStamp } from "./stamp.ts";

declare const STAMP_PAPER: string;

window.renderDesigns = async (input) => {
  const { renderer, scene, camera, dispose } = await createBadgeScene(input);
  try {
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    const stamp = await renderStamp(input.stampSvg, STAMP_PAPER, false, input.stampSettings);
    return {
      badge: renderer.domElement.toDataURL("image/png"),
      stamp: stamp.toDataURL("image/png"),
    };
  } finally {
    dispose();
  }
};
