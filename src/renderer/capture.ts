import { createBadgeScene } from "./scene.ts";
import { createStamp } from "./stamp.ts";

declare const STAMP_PAPER: string;

window.renderDesigns = async (input) => {
  const { renderer, scene, camera, dispose } = await createBadgeScene(input);
  try {
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    const paper = new Image();
    paper.src = STAMP_PAPER;
    await paper.decode();
    const stamp = await createStamp(input.stampSvg, paper);
    return {
      badge: renderer.domElement.toDataURL("image/png"),
      stamp: stamp.render(input.stampSettings).canvas.toDataURL("image/png"),
    };
  } finally {
    dispose();
  }
};
