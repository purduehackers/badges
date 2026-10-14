import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createBadgeScene } from "./scene.ts";
import type { RenderInput } from "./types.ts";

export async function mountBadge(
  viewport: HTMLElement,
  input: RenderInput,
  reset?: HTMLButtonElement | null,
) {
  const { renderer, scene, camera, half, dispose } = await createBadgeScene(input);
  viewport.append(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Interactive 3D badge preview");
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minZoom = 0.5;
  controls.maxZoom = 4;
  controls.saveState();
  const draw = () => renderer.render(scene, camera);
  const resetView = () => controls.reset();
  controls.addEventListener("change", draw);
  reset?.addEventListener("click", resetView);
  const resize = new ResizeObserver(() => {
    const { width, height } = viewport.getBoundingClientRect();
    const aspect = width / Math.max(height, 1);
    camera.left = -half * Math.max(aspect, 1);
    camera.right = -camera.left;
    camera.top = half / Math.min(aspect, 1);
    camera.bottom = -camera.top;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(width, height);
    draw();
  });
  resize.observe(viewport);
  return () => {
    resize.disconnect();
    reset?.removeEventListener("click", resetView);
    controls.dispose();
    renderer.domElement.remove();
    dispose();
  };
}
