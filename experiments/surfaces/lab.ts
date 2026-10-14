import { createBadgeScene } from "../../src/renderer/scene.ts";
import { createStamp, DEFAULT_STAMP, type StampOptions } from "../../src/renderer/stamp.ts";
import { getMaterial } from "../../src/lib/materials.ts";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function element<T extends HTMLElement>(selector: string): T {
  const target = document.querySelector<T>(selector);
  if (!target) throw new Error(`Missing ${selector}`);
  return target;
}
function report(cause: unknown) {
  const target = element("#error");
  target.textContent = cause instanceof Error ? cause.message : "Could not make this preview.";
  target.hidden = false;
}
function clearError() {
  element("#error").hidden = true;
}
async function image(url: string) {
  const result = new Image();
  result.src = url;
  await result.decode();
  return result;
}
const presets: Record<string, { title: string; note: string; settings: StampOptions }> = {
  normal: {
    title: "Normal press",
    note: "A full ink pad and even pressure.",
    settings: DEFAULT_STAMP,
  },
  dry: {
    title: "Dry / light press",
    note: "Less ink leaves gaps in the impression.",
    settings: { ...DEFAULT_STAMP, ink: 0.3, pressure: 0.3 },
  },
  heavy: {
    title: "Heavy press",
    note: "Extra ink and pressure spread the edges.",
    settings: { ...DEFAULT_STAMP, ink: 0.98, pressure: 0.98 },
  },
};
let stamp: Awaited<ReturnType<typeof createStamp>>;
let current = { ...DEFAULT_STAMP };
let impression: HTMLCanvasElement | undefined;
let badgeSvg = "";
let uploadedBadge = "";
let cleanupBadge: (() => void) | undefined;
let turnBadges: ((angle: number) => void) | undefined;
let resetBadges: (() => void) | undefined;
let badgeRequest = 0;

function showStamp() {
  impression = stamp.render(current).canvas;
  element("#impression").replaceChildren(impression);
  element("#press-label").textContent =
    `${Math.round(current.ink * 100)}% ink · ${Math.round(current.pressure * 100)}% pressure · ${current.paper} paper`;
}
function compareStamps() {
  const holder = element("#stamp-comparisons");
  holder.replaceChildren();
  for (const [index, preset] of Object.values(presets).entries()) {
    const card = document.createElement("article");
    const view = document.createElement("div");
    view.className = "stamp-image";
    const result = stamp.render(preset.settings);
    result.canvas.setAttribute("aria-label", preset.title);
    view.append(result.canvas);
    const copy = document.createElement("div");
    copy.className = "card-copy";
    const number = document.createElement("span");
    number.className = "number";
    number.textContent = `0${index + 1} / SAME PAPER`;
    const title = document.createElement("h3");
    title.textContent = preset.title;
    const description = document.createElement("p");
    description.textContent = preset.note;
    copy.append(number, title, description);
    card.append(view, copy);
    holder.append(card);
  }
}
function updateControls() {
  for (const name of ["ink", "pressure", "tilt"] as const) {
    element<HTMLInputElement>(`#${name}`).value = String(Math.round(current[name] * 100));
    element(`#${name}-value`).textContent =
      name === "tilt" && current.tilt === 0 ? "Centered" : `${Math.round(current[name] * 100)}%`;
  }
  element<HTMLSelectElement>("#paper").value = current.paper;
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]"))
  button.onclick = () => {
    current = {
      ...presets[button.dataset.preset!]!.settings,
      paper: current.paper,
      seed: current.seed,
    };
    document
      .querySelectorAll("[data-preset]")
      .forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    updateControls();
    showStamp();
  };
let scheduled = false;
for (const name of ["ink", "pressure", "tilt"] as const)
  element<HTMLInputElement>(`#${name}`).oninput = (event) => {
    current[name] = Number((event.target as HTMLInputElement).value) / 100;
    updateControls();
    document
      .querySelectorAll("[data-preset]")
      .forEach((item) => item.setAttribute("aria-pressed", "false"));
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        showStamp();
      });
    }
  };
element<HTMLSelectElement>("#paper").onchange = (event) => {
  current.paper = (event.target as HTMLSelectElement).value === "textured" ? "textured" : "smooth";
  showStamp();
};
element("#press").onclick = () => {
  current.seed += 1;
  element("#impression").classList.remove("pressing");
  requestAnimationFrame(() => {
    showStamp();
    element("#impression").classList.add("pressing");
  });
};
element("#download-stamp").onclick = () => {
  if (!impression) return;
  const link = document.createElement("a");
  link.download = "stamp-impression.png";
  link.href = impression.toDataURL("image/png");
  link.click();
};

async function showBadges(fingerprints: HTMLImageElement, scratches: HTMLImageElement) {
  const request = ++badgeRequest;
  cleanupBadge?.();
  cleanupBadge = undefined;
  clearError();
  const material = getMaterial(element<HTMLSelectElement>("#material").value);
  const input = { svg: badgeSvg, material, thicknessMm: 3.175, sizeIn: 2.2 };
  const views: Awaited<ReturnType<typeof createBadgeScene>>[] = [];
  try {
    for (const options of [{ uniformGloss: true }, {}, { fingerprints, scratches }])
      views.push(await createBadgeScene(input, options));
  } catch (cause) {
    for (const view of views) view.dispose();
    throw cause;
  }
  if (request !== badgeRequest) {
    for (const view of views) view.dispose();
    return;
  }
  let syncing = false;
  const controls = views.map((view, index) => {
    const holder = document.querySelectorAll<HTMLElement>(".viewport")[index]!;
    holder.replaceChildren(view.renderer.domElement);
    const control = new OrbitControls(view.camera, view.renderer.domElement);
    control.enablePan = false;
    control.minDistance = 100;
    control.maxDistance = 400;
    control.saveState();
    const resize = new ResizeObserver(() => {
      const side = holder.clientWidth;
      view.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      view.renderer.setSize(side, side, false);
      view.renderer.render(view.scene, view.camera);
    });
    resize.observe(holder);
    return { control, resize };
  });
  for (const source of controls)
    source.control.addEventListener("change", () => {
      if (syncing) return;
      syncing = true;
      for (const [index, target] of controls.entries()) {
        if (target !== source) {
          target.control.object.position.copy(source.control.object.position);
          target.control.object.quaternion.copy(source.control.object.quaternion);
          target.control.target.copy(source.control.target);
          target.control.update();
        }
        views[index]!.renderer.render(views[index]!.scene, views[index]!.camera);
      }
      syncing = false;
    });
  turnBadges = (angle) => {
    for (const view of views) {
      view.badge.rotation.y = (angle * Math.PI) / 180;
      view.renderer.render(view.scene, view.camera);
    }
  };
  resetBadges = () => {
    controls[0]!.control.reset();
    turnBadges?.(-22);
    element<HTMLInputElement>("#angle").value = "-22";
  };
  turnBadges(Number(element<HTMLInputElement>("#angle").value));
  cleanupBadge = () => {
    for (const item of controls) {
      item.resize.disconnect();
      item.control.dispose();
    }
    for (const view of views) {
      view.renderer.domElement.remove();
      view.dispose();
    }
  };
}
element<HTMLInputElement>("#angle").oninput = (event) =>
  turnBadges?.(Number((event.target as HTMLInputElement).value));
element("#reset").onclick = () => resetBadges?.();

async function start() {
  const [paper, fingerprints, scratches] = await Promise.all([
    image("/lab/paper.png"),
    image("/lab/assets/fingerprints.png"),
    image("/lab/assets/scratches.png"),
  ]);
  const stampSource = await (await fetch("/lab/assets/stamp.svg")).text();
  badgeSvg = await (await fetch("/lab/assets/bottle.svg")).text();
  stamp = await createStamp(stampSource, paper);
  showStamp();
  compareStamps();
  await showBadges(fingerprints, scratches);
  element<HTMLSelectElement>("#material").onchange = () => {
    void showBadges(fingerprints, scratches).catch(report);
  };
  element<HTMLSelectElement>("#badge-sample").onchange = () => {
    void (async () => {
      const selected = element<HTMLSelectElement>("#badge-sample").value;
      badgeSvg =
        selected === "uploaded"
          ? uploadedBadge
          : await (await fetch(`/lab/assets/${selected}.svg`)).text();
      await showBadges(fingerprints, scratches);
    })().catch(report);
  };
  for (const role of ["stamp", "badge"] as const)
    element<HTMLInputElement>(`#${role}-file`).onchange = (event) => {
      void (async () => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const response = await fetch(`/lab/inspect?role=${role}`, {
          method: "POST",
          body: await file.text(),
        });
        const data = (await response.json()) as { svg?: string; error?: string };
        if (!response.ok || !data.svg) throw new Error(data.error ?? "Could not read this SVG.");
        clearError();
        if (role === "stamp") {
          stamp = await createStamp(data.svg, paper);
          element("#stamp-name").textContent = file.name;
          showStamp();
          compareStamps();
        } else {
          badgeSvg = data.svg;
          uploadedBadge = data.svg;
          const samples = element<HTMLSelectElement>("#badge-sample");
          samples.querySelector('[value="uploaded"]')?.remove();
          samples.add(new Option(file.name, "uploaded", true, true));
          await showBadges(fingerprints, scratches);
        }
      })().catch(report);
    };
}
window.addEventListener("pagehide", () => cleanupBadge?.());
void start().catch(report);
