import * as THREE from "three";
import { TransformControls, type TransformControlsMode } from "three/addons/controls/TransformControls.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { init as initGCodePreview, type WebGLPreview } from "gcode-preview";
import {
  EdgeSettings,
  EmbeddedViewer,
  Direction,
  RGBAColor,
  RGBColor,
} from "online-3d-viewer";
import sampleFrontUrl from "../../output/enclosure/front-black-v5-wide.stl?url";
import sampleBackUrl from "../../output/enclosure/back-smoke-petg-v6-wide.stl?url";
import sampleStandUrl from "../../output/enclosure/stand-black-v5-wide.stl?url";
import demoGCode from "./samples/layer-demo.gcode?raw";
import "./styles.css";

type MaterialPreset = "plastic" | "petg" | "metal";
type ViewMode = "model" | "gcode";
type TransformKind = "position" | "rotation" | "scale";
type InspectorTheme = "slate" | "paper" | "signal";

type PartRecord = {
  id: string;
  name: string;
  fileSize?: number;
  root: THREE.Object3D;
  initialPosition: THREE.Vector3;
  initialQuaternion: THREE.Quaternion;
  initialScale: THREE.Vector3;
  material: MaterialPreset;
};

type ImportJob = {
  name: string;
  fileSize?: number;
  load: () => void;
};

type ModelStats = {
  name: string;
  fileSize?: number;
  dimensions: THREE.Vector3;
  triangles: number;
  meshes: number;
};

const samples = {
  front: { label: "前壳 · Black", fileName: "front-black-v5-wide.stl", url: sampleFrontUrl },
  back: { label: "后壳 · Smoke PETG", fileName: "back-smoke-petg-v6-wide.stl", url: sampleBackUrl },
  stand: { label: "支架 · Black", fileName: "stand-black-v5-wide.stl", url: sampleStandUrl },
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <div class="brand">
        <strong>PRINT LAB</strong>
      </div>
      <div class="mode-switch header-mode-switch" aria-label="预览模式">
        <button class="active" data-mode="model">模型</button>
        <button data-mode="gcode">打印路径</button>
      </div>
      <div class="privacy-note">文件仅在本机处理，不会上传或共享</div>
    </header>

    <section class="workspace">
      <aside class="control-panel">
        <div class="panel-section upload-section">
          <div class="section-title"><span>添加零件</span><small>STL · 3MF · G-code</small></div>
          <label class="upload-button" for="file-input">
            <span>打开文件</span><b>＋</b>
          </label>
          <input id="file-input" type="file" multiple accept=".stl,.3mf,.gcode,.gco,.gc,.obj,.amf,.ply,.step,.stp" />
          <div class="drop-hint">也可以将多个文件拖入右侧视窗</div>
        </div>

        <div class="panel-section">
          <div class="section-title"><span>示例</span><small>本地</small></div>
          <div class="sample-list" role="list">
            ${Object.entries(samples).map(([key, sample], index) => `
              <button class="sample-item ${index === 0 ? "active" : ""}" data-sample="${key}">
                <span>${sample.label}</span>
                <b>＋</b>
              </button>
            `).join("")}
            <button class="sample-item" id="gcode-demo-button">
              <span>打印路径 · Demo</span>
              <b>→</b>
            </button>
          </div>
        </div>

        <div class="panel-section assembly-section">
          <div class="section-title">
            <span>装配</span>
            <button id="clear-parts-button" class="section-action">清空</button>
          </div>
          <div id="assembly-status" class="assembly-status" data-state="idle">
            <strong>三件套装配</strong>
            <span>载入后按 CAD 约束自动对位</span>
          </div>
          <div id="parts-list" class="parts-list"></div>
        </div>

        <div class="panel-section transform-section">
          <div class="section-title"><span>变换</span><small id="selected-part-label">未选择</small></div>
          <div class="transform-block">
            <p>位置 <small>mm</small></p>
            ${(["x", "y", "z"] as const).map((axis) => `
              <div class="transform-row">
                <span class="axis-tag axis-${axis}">${axis.toUpperCase()}</span>
                <button data-nudge="position" data-axis="${axis}" data-delta="-1">−</button>
                <input type="number" data-transform="position" data-axis="${axis}" step="1" value="0" disabled />
                <button data-nudge="position" data-axis="${axis}" data-delta="1">＋</button>
              </div>
            `).join("")}
          </div>
          <div class="transform-block rotation-block">
            <p>旋转 <small>°</small></p>
            ${(["x", "y", "z"] as const).map((axis) => `
              <div class="transform-row">
                <span class="axis-tag axis-${axis}">${axis.toUpperCase()}</span>
                <button data-nudge="rotation" data-axis="${axis}" data-delta="-15">−15</button>
                <input type="number" data-transform="rotation" data-axis="${axis}" step="1" value="0" disabled />
                <button data-nudge="rotation" data-axis="${axis}" data-delta="15">＋15</button>
              </div>
            `).join("")}
          </div>
          <div class="transform-block rotation-block">
            <p>缩放 <small>倍数</small></p>
            ${(["x", "y", "z"] as const).map((axis) => `
              <div class="transform-row">
                <span class="axis-tag axis-${axis}">${axis.toUpperCase()}</span>
                <button data-nudge="scale" data-axis="${axis}" data-delta="-0.1">−</button>
                <input type="number" data-transform="scale" data-axis="${axis}" step="0.1" min="0.05" value="1" disabled />
                <button data-nudge="scale" data-axis="${axis}" data-delta="0.1">＋</button>
              </div>
            `).join("")}
          </div>
          <div class="transform-actions">
            <button id="center-part-button">居中</button>
            <button id="place-part-button">贴合热床</button>
            <button id="duplicate-part-button">复制</button>
            <button id="reset-part-button">复位</button>
            <button id="remove-part-button" class="danger">删除</button>
          </div>
        </div>

        <div class="panel-section material-section">
          <div class="section-title"><span>材质</span><small>实时</small></div>
          <div class="segmented" aria-label="外观材质">
            <button class="active" data-material="plastic">哑光</button>
            <button data-material="petg">PETG</button>
            <button data-material="metal">金属</button>
          </div>
        </div>
      </aside>

      <section class="viewer-panel">
        <div class="viewer-toolbar">
          <div id="viewport-tools" class="viewport-tools" aria-label="零件操作工具">
            <div class="assembly-tool-group" role="group" aria-label="自动装配">
              <button id="auto-assemble-button"><b>⌁</b><span>装配三件套</span></button>
              <button id="explode-button" disabled title="按打印方向平铺三个零件"><span>拆件平铺</span></button>
            </div>
            <div id="viewport-tool-empty" class="viewport-tool-empty">点击零件启用编辑</div>
            <div class="viewport-tool-group" role="group" aria-label="变换模式">
              <button class="active" data-gizmo-mode="translate" title="移动（W）"><b>↔</b><span>移动</span><kbd>W</kbd></button>
              <button data-gizmo-mode="rotate" title="旋转（E）"><b>↻</b><span>旋转</span><kbd>E</kbd></button>
              <button data-gizmo-mode="scale" title="缩放（R）"><b>↗</b><span>缩放</span><kbd>R</kbd></button>
            </div>
            <div class="viewport-tool-group compact" role="group" aria-label="坐标与吸附">
              <button id="space-button" title="切换世界/局部坐标（Q）"><span>世界坐标</span><kbd>Q</kbd></button>
              <button id="snap-button" title="切换吸附"><span>吸附</span></button>
            </div>
            <div class="viewport-tool-group compact" role="group" aria-label="零件快捷操作">
              <button id="viewport-place-button" title="贴合热床"><span>落盘</span></button>
              <button id="viewport-duplicate-button" title="复制零件（⌘/Ctrl + D）"><span>复制</span></button>
              <button id="viewport-delete-button" class="danger" title="删除零件（Delete）"><span>删除</span></button>
            </div>
          </div>
          <div class="toolbar-actions">
            <button id="wireframe-button" class="tool-button" title="切换线框">线框</button>
            <button id="fit-button" class="tool-button" title="适应窗口">适应</button>
            <button id="physics-button" class="physics-button" title="使用 Rapier 3D 进行重力、摩擦和碰撞测试">Rapier 重力测试</button>
          </div>
        </div>

        <div id="viewport" class="viewport">
          <div id="model-viewer" class="canvas-host"></div>
          <canvas id="gcode-canvas" class="gcode-canvas" aria-label="G-code 预览"></canvas>
          <div id="selection-chip" class="selection-chip">
            <div><strong id="viewport-part-name">未选择零件</strong><small>拖动三轴操纵器直接编辑</small></div>
          </div>
          <div id="viewport-hint" class="viewport-hint">点击零件选择 · W 移动 · E 旋转 · R 缩放</div>
          <div class="axis-indicator" aria-hidden="true">
            <span class="axis-z">Z</span><i></i><span class="axis-y">Y</span><b></b><span class="axis-x">X</span>
          </div>
          <div id="drop-overlay" class="drop-overlay">
            <strong>释放以载入文件</strong>
            <span>STL · 3MF · G-CODE</span>
          </div>
          <div id="loading" class="loading-state"><span></span>正在解析几何数据</div>
          <div id="toast" class="toast" role="status"></div>
        </div>

        <div id="inspector-bar" class="inspector-bar" data-theme="slate">
          <div class="file-identity">
            <span class="file-type" id="file-type">STL</span>
            <div><strong id="file-name">front-black-v5-wide.stl</strong><small id="file-subtitle">模型预览</small></div>
            <div class="inspector-theme-switch" role="group" aria-label="底部面板配色">
              <button class="active" data-inspector-theme="slate" aria-label="蓝灰色面板" title="蓝灰色"><i></i></button>
              <button data-inspector-theme="paper" aria-label="浅色面板" title="浅色"><i></i></button>
              <button data-inspector-theme="signal" aria-label="橙色高对比面板" title="橙色高对比"><i></i></button>
            </div>
          </div>
          <dl class="metrics">
            <div><dt>尺寸 X</dt><dd id="size-x">—</dd></div>
            <div><dt>尺寸 Y</dt><dd id="size-y">—</dd></div>
            <div><dt>尺寸 Z</dt><dd id="size-z">—</dd></div>
            <div><dt>三角面</dt><dd id="triangles">—</dd></div>
            <div><dt>网格</dt><dd id="mesh-count">—</dd></div>
          </dl>
          <div id="layer-control" class="layer-control">
            <label for="layer-range"><span>显示层</span><b id="layer-value">0 / 0</b></label>
            <input id="layer-range" type="range" min="0" max="0" value="0" />
          </div>
        </div>
      </section>
    </section>
  </main>
`;

const elements = {
  viewport: document.querySelector<HTMLDivElement>("#viewport")!,
  inspectorBar: document.querySelector<HTMLDivElement>("#inspector-bar")!,
  modelHost: document.querySelector<HTMLDivElement>("#model-viewer")!,
  gcodeCanvas: document.querySelector<HTMLCanvasElement>("#gcode-canvas")!,
  input: document.querySelector<HTMLInputElement>("#file-input")!,
  loading: document.querySelector<HTMLDivElement>("#loading")!,
  dropOverlay: document.querySelector<HTMLDivElement>("#drop-overlay")!,
  toast: document.querySelector<HTMLDivElement>("#toast")!,
  fileName: document.querySelector<HTMLElement>("#file-name")!,
  fileType: document.querySelector<HTMLElement>("#file-type")!,
  fileSubtitle: document.querySelector<HTMLElement>("#file-subtitle")!,
  sizeX: document.querySelector<HTMLElement>("#size-x")!,
  sizeY: document.querySelector<HTMLElement>("#size-y")!,
  sizeZ: document.querySelector<HTMLElement>("#size-z")!,
  triangles: document.querySelector<HTMLElement>("#triangles")!,
  meshCount: document.querySelector<HTMLElement>("#mesh-count")!,
  layerControl: document.querySelector<HTMLDivElement>("#layer-control")!,
  layerRange: document.querySelector<HTMLInputElement>("#layer-range")!,
  layerValue: document.querySelector<HTMLElement>("#layer-value")!,
  physicsButton: document.querySelector<HTMLButtonElement>("#physics-button")!,
  wireframeButton: document.querySelector<HTMLButtonElement>("#wireframe-button")!,
  viewportTools: document.querySelector<HTMLDivElement>("#viewport-tools")!,
  viewportToolEmpty: document.querySelector<HTMLDivElement>("#viewport-tool-empty")!,
  selectionChip: document.querySelector<HTMLDivElement>("#selection-chip")!,
  viewportPartName: document.querySelector<HTMLElement>("#viewport-part-name")!,
  viewportHint: document.querySelector<HTMLDivElement>("#viewport-hint")!,
  spaceButton: document.querySelector<HTMLButtonElement>("#space-button")!,
  snapButton: document.querySelector<HTMLButtonElement>("#snap-button")!,
  partsList: document.querySelector<HTMLDivElement>("#parts-list")!,
  selectedPartLabel: document.querySelector<HTMLElement>("#selected-part-label")!,
  assemblyStatus: document.querySelector<HTMLDivElement>("#assembly-status")!,
  autoAssembleButton: document.querySelector<HTMLButtonElement>("#auto-assemble-button")!,
  explodeButton: document.querySelector<HTMLButtonElement>("#explode-button")!,
};

let currentMode: ViewMode = "model";
let materialPreset: MaterialPreset = "plastic";
let embeddedViewer: EmbeddedViewer;
let gcodePreview: WebGLPreview | undefined;
let modelRoot: THREE.Object3D | undefined;
let assemblyRoot = new THREE.Group();
let parts: PartRecord[] = [];
let selectedPartId: string | undefined;
let partCounter = 0;
let importQueue: ImportJob[] = [];
let activeImportJob: ImportJob | undefined;
let bedObject: THREE.Group | undefined;
let selectionHelper: THREE.BoxHelper | undefined;
let transformControls: TransformControls | undefined;
let transformHelper: THREE.Object3D | undefined;
const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
let transformMode: TransformControlsMode = "translate";
let transformSpace: "world" | "local" = "world";
let transformSnapEnabled = false;
let transformDragging = false;
let wireframeEnabled = false;
let toastTimer = 0;

let rapierReady = false;
let physicsRunning = false;
let physicsWorld: RAPIER.World | undefined;
let physicsBody: RAPIER.RigidBody | undefined;
let physicsStartPosition = new THREE.Vector3();
let physicsStartQuaternion = new THREE.Quaternion();
let lastFrame = performance.now();
let accumulator = 0;
let pendingAutoAssembly = false;
let assemblyExploded = false;
let applyingAssemblyPreset = false;
let assemblyGroupMode = false;

function showLoading(show: boolean): void {
  elements.loading.classList.toggle("visible", show);
}

function showToast(message: string, isError = false): void {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 100 ? 1 : 2)} mm`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: value > 999_999 ? "compact" : "standard" }).format(value);
}

function setInspectorTheme(theme: InspectorTheme, persist = true): void {
  elements.inspectorBar.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>("[data-inspector-theme]").forEach((button) => {
    const active = button.dataset.inspectorTheme === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (persist) {
    try {
      localStorage.setItem("printlab-inspector-theme", theme);
    } catch {
      // The color switch still works when storage is blocked by privacy mode.
    }
  }
}

function restoreInspectorTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("printlab-inspector-theme");
  } catch {
    // Keep the default slate theme when storage is unavailable.
  }
  const theme: InspectorTheme = stored === "paper" || stored === "signal" || stored === "slate"
    ? stored
    : "slate";
  setInspectorTheme(theme, false);
}

function setStats(stats: ModelStats): void {
  const ext = extensionOf(stats.name).toUpperCase() || "3D";
  elements.fileType.textContent = ext;
  elements.fileName.textContent = stats.name;
  elements.fileSubtitle.textContent = stats.fileSize
    ? `${(stats.fileSize / 1024 / 1024).toFixed(2)} MB · 模型预览`
    : "模型预览";
  elements.sizeX.textContent = formatDimension(stats.dimensions.x);
  elements.sizeY.textContent = formatDimension(stats.dimensions.y);
  elements.sizeZ.textContent = formatDimension(stats.dimensions.z);
  elements.triangles.textContent = formatCount(stats.triangles);
  elements.meshCount.textContent = String(stats.meshes);
}

function computeModelStats(root: THREE.Object3D, name: string, fileSize?: number): ModelStats {
  const box = new THREE.Box3().setFromObject(root);
  const dimensions = box.getSize(new THREE.Vector3());
  let triangles = 0;
  let meshes = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes += 1;
    const geometry = mesh.geometry;
    triangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute("position")?.count ?? 0) / 3;
  });
  return { name, fileSize, dimensions, triangles, meshes };
}

function selectedPart(): PartRecord | undefined {
  return parts.find((part) => part.id === selectedPartId);
}

function markPartHierarchy(part: PartRecord): void {
  part.root.userData ??= {};
  part.root.userData.partId = part.id;
  part.root.traverse((object) => {
    object.userData ??= {};
    object.userData.partId = part.id;
  });
}

function renderPartsList(): void {
  if (!parts.length) {
    elements.partsList.innerHTML = '<div class="empty-parts">添加零件后可在这里选择和编辑</div>';
    return;
  }
  elements.partsList.innerHTML = parts.map((part, index) => `
    <button class="part-item ${part.id === selectedPartId ? "active" : ""}" data-part-id="${part.id}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong title="${part.name}">${part.name}</strong>
      <small>${extensionOf(part.name).toUpperCase()}</small>
    </button>
  `).join("");
  elements.partsList.querySelectorAll<HTMLButtonElement>("[data-part-id]").forEach((button) => {
    button.addEventListener("click", () => selectPart(button.dataset.partId));
  });
}

function getSampleAssemblyParts(): {
  front?: PartRecord;
  back?: PartRecord;
  stand?: PartRecord;
} {
  return {
    front: parts.find((part) => part.name === samples.front.fileName),
    back: parts.find((part) => part.name === samples.back.fileName),
    stand: parts.find((part) => part.name === samples.stand.fileName),
  };
}

function hasCompleteSampleAssembly(): boolean {
  const sampleParts = getSampleAssemblyParts();
  return Boolean(sampleParts.front && sampleParts.back && sampleParts.stand);
}

function activeTransformRoot(): THREE.Object3D | undefined {
  if (assemblyGroupMode && hasCompleteSampleAssembly()) return assemblyRoot;
  return modelRoot;
}

function setAssemblyStatus(
  title: string,
  detail: string,
  state: "idle" | "loading" | "verified" | "manual" = "idle",
): void {
  elements.assemblyStatus.dataset.state = state;
  elements.assemblyStatus.querySelector("strong")!.textContent = title;
  elements.assemblyStatus.querySelector("span")!.textContent = detail;
}

function markAssemblyManuallyAdjusted(): void {
  if (applyingAssemblyPreset || !hasCompleteSampleAssembly()) return;
  elements.explodeButton.textContent = assemblyExploded ? "恢复装配" : "拆件平铺";
  setAssemblyStatus(
    "已手动调整",
    assemblyExploded ? "零件保持平铺，可随时恢复精确装配" : "当前位置已偏离 CAD 装配约束",
    "manual",
  );
}

function setPartTransformFromMatrix(part: PartRecord, matrix: THREE.Matrix4): void {
  matrix.decompose(part.root.position, part.root.quaternion, part.root.scale);
  part.root.updateMatrixWorld(true);
}

function assembleSampleParts(exploded = false): void {
  const { front, back, stand } = getSampleAssemblyParts();
  if (!front || !back || !stand) {
    showToast("三件套尚未载入完整", true);
    return;
  }

  stopPhysics(true);
  applyingAssemblyPreset = true;

  // These are the exact constraints from codex_widget_enclosure.scad:
  // the rear shell starts 2.6 mm behind the front plate, then the complete
  // enclosure is remapped upright and docked into the 15-degree stand slot.
  const assembledDepth = 34.8;
  const slotClearance = 0.6;
  const caseHeight = 78;
  const standBaseThickness = 3;
  const standAngle = THREE.MathUtils.degToRad(15);
  const pivotZ = standBaseThickness + ((assembledDepth + 2 * slotClearance) / 2) * Math.sin(standAngle);
  const sourceToStand = new THREE.Matrix4().set(
    1, 0, 0, 0,
    0, 0, 1, -assembledDepth / 2,
    0, 1, 0, caseHeight / 2,
    0, 0, 0, 1,
  );
  const enclosureTransform = new THREE.Matrix4()
    .makeTranslation(0, 0, pivotZ)
    .multiply(new THREE.Matrix4().makeRotationX(-standAngle))
    .multiply(sourceToStand);

  setPartTransformFromMatrix(front, enclosureTransform.clone());
  setPartTransformFromMatrix(
    back,
    enclosureTransform.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 2.6)),
  );
  setPartTransformFromMatrix(stand, new THREE.Matrix4().identity());

  front.material = "plastic";
  back.material = "petg";
  stand.material = "plastic";
  applyMaterial(front.root, front.material);
  applyMaterial(back.root, back.material);
  applyMaterial(stand.root, stand.material);

  for (const part of [front, back, stand]) {
    part.initialPosition.copy(part.root.position);
    part.initialQuaternion.copy(part.root.quaternion);
    part.initialScale.copy(part.root.scale);
  }

  if (exploded) {
    // Inspection is easier in each part's native print orientation. Keeping
    // the assembled vertical rotation here made both shells look like lines
    // as soon as the user orbited the camera toward their side faces.
    setPartTransformFromMatrix(front, new THREE.Matrix4().makeTranslation(-66, 0, 0));
    setPartTransformFromMatrix(back, new THREE.Matrix4().makeTranslation(66, 0, 0));
    setPartTransformFromMatrix(stand, new THREE.Matrix4().identity());
  }

  assemblyExploded = exploded;
  assemblyGroupMode = !exploded;
  if (assemblyGroupMode && transformMode === "scale") setTransformMode("translate", false);
  elements.explodeButton.textContent = exploded ? "恢复装配" : "拆件平铺";
  selectedPartId = front.id;
  applyingAssemblyPreset = false;
  rebuildAssembly(true);
  setAssemblyStatus(
    exploded ? "拆件平铺" : "配合验证通过",
    exploded ? "零件已恢复打印方向，可编辑单件" : "无穿模 · 每侧 0.6 mm 间隙 · 当前整体移动",
    exploded ? "manual" : "verified",
  );
  showToast(exploded ? "已按打印方向平铺三件套" : "已按 CAD 原始约束完成三件套装配");
}

function loadAndAssembleSamples(): void {
  if (pendingAutoAssembly) return;
  const loaded = getSampleAssemblyParts();
  const missing = (Object.keys(samples) as Array<keyof typeof samples>)
    .filter((key) => key !== "front" || !loaded.front)
    .filter((key) => key !== "back" || !loaded.back)
    .filter((key) => key !== "stand" || !loaded.stand);

  assemblyExploded = false;
  if (!missing.length) {
    assembleSampleParts(false);
    return;
  }

  pendingAutoAssembly = true;
  setAssemblyStatus("正在自动装配", `载入 ${missing.length} 个缺失零件`, "loading");
  for (const key of missing) {
    const sample = samples[key];
    enqueueImport({
      name: sample.fileName,
      load: () => embeddedViewer.LoadModelFromUrlList([sample.url]),
    });
  }
}

function updateTransformPanel(): void {
  const part = selectedPart();
  const target = activeTransformRoot();
  elements.selectedPartLabel.textContent = assemblyGroupMode && target ? "完整装配体" : (part?.name ?? "未选择");
  document.querySelectorAll<HTMLInputElement>("[data-transform]").forEach((input) => {
    const kind = input.dataset.transform as TransformKind;
    input.disabled = !target || (assemblyGroupMode && kind === "scale");
    if (!target) {
      input.value = input.dataset.transform === "scale" ? "1" : "0";
      return;
    }
    const axis = input.dataset.axis as "x" | "y" | "z";
    if (kind === "position") input.value = target.position[axis].toFixed(1);
    else if (kind === "rotation") input.value = THREE.MathUtils.radToDeg(target.rotation[axis]).toFixed(1);
    else input.value = target.scale[axis].toFixed(2);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-nudge], #center-part-button, #place-part-button, #reset-part-button, #viewport-place-button")
    .forEach((button) => {
      button.disabled = !target || (assemblyGroupMode && button.dataset.nudge === "scale");
    });
  document.querySelectorAll<HTMLButtonElement>("#duplicate-part-button, #remove-part-button, #viewport-duplicate-button, #viewport-delete-button")
    .forEach((button) => { button.disabled = !part || assemblyGroupMode; });
}

function syncTransformControl(): void {
  const isModel = currentMode === "model";
  const target = activeTransformRoot();
  const canEdit = isModel && Boolean(target) && !physicsRunning;
  elements.viewportTools.classList.toggle("visible", isModel);
  elements.viewportTools.classList.toggle("inactive", !canEdit);
  elements.viewportToolEmpty.classList.toggle("visible", isModel && !modelRoot);
  elements.viewportTools.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = !canEdit;
  });
  document.querySelector<HTMLButtonElement>('[data-gizmo-mode="scale"]')!.disabled = !canEdit || assemblyGroupMode;
  elements.autoAssembleButton.disabled = !isModel || pendingAutoAssembly;
  elements.explodeButton.disabled = !isModel || !hasCompleteSampleAssembly() || pendingAutoAssembly;
  elements.selectionChip.classList.toggle("visible", isModel && Boolean(modelRoot));
  elements.viewportHint.classList.toggle("with-selection", canEdit);
  elements.viewportPartName.textContent = assemblyGroupMode && target
    ? "完整装配体 · 相对位置已锁定"
    : (selectedPart()?.name ?? "未选择零件");

  if (!transformControls || !transformHelper) return;
  transformControls.enabled = canEdit;
  transformHelper.visible = canEdit;
  if (canEdit && target) {
    embeddedViewer.GetViewer().AddExtraObject(transformHelper);
    transformControls.attach(target);
  } else {
    transformControls.detach();
  }
}

function refreshSelectionHelper(): void {
  const viewer = embeddedViewer.GetViewer();
  if (selectionHelper) {
    selectionHelper.removeFromParent();
    selectionHelper.geometry.dispose();
    (selectionHelper.material as THREE.Material).dispose();
    selectionHelper = undefined;
  }
  const target = activeTransformRoot();
  if (!target || currentMode !== "model") {
    viewer.Render();
    return;
  }
  selectionHelper = new THREE.BoxHelper(target, 0xff5a1f);
  selectionHelper.name = "selected-part-outline";
  viewer.AddExtraObject(selectionHelper);
}

function updateSelectedPartView(): void {
  const part = selectedPart();
  modelRoot = part?.root;
  renderPartsList();
  updateTransformPanel();
  if (part) {
    materialPreset = part.material;
    document.querySelectorAll<HTMLButtonElement>("[data-material]").forEach((button) => {
      button.classList.toggle("active", button.dataset.material === part.material);
    });
    setStats(computeModelStats(part.root, part.name, part.fileSize));
  } else {
    elements.fileType.textContent = "—";
    elements.fileName.textContent = "未选择零件";
    elements.fileSubtitle.textContent = "添加 STL 或 3MF 开始装配";
    elements.sizeX.textContent = "—";
    elements.sizeY.textContent = "—";
    elements.sizeZ.textContent = "—";
    elements.triangles.textContent = "—";
    elements.meshCount.textContent = "—";
  }
  syncTransformControl();
  refreshSelectionHelper();
  switchMode("model");
}

function selectPart(partId?: string): void {
  if (physicsRunning) stopPhysics(true);
  selectedPartId = partId && parts.some((part) => part.id === partId) ? partId : undefined;
  updateSelectedPartView();
  const part = selectedPart();
  if (part) showToast(`已选择 ${part.name}`);
}

function ensurePartSelected(part: PartRecord): void {
  if (part.id !== selectedPartId) {
    selectPart(part.id);
    return;
  }
  modelRoot = part.root;
  syncTransformControl();
  refreshSelectionHelper();
}

function updateAfterTransform(): void {
  const target = activeTransformRoot();
  const part = selectedPart();
  if (!target) return;
  if (assemblyGroupMode) {
    setAssemblyStatus("整机姿态已调整", "三个零件的相对装配关系保持不变", "verified");
  } else {
    markAssemblyManuallyAdjusted();
  }
  target.updateMatrixWorld(true);
  selectionHelper?.update();
  if (assemblyGroupMode) setStats(computeModelStats(assemblyRoot, "完整装配体"));
  else if (part) setStats(computeModelStats(part.root, part.name, part.fileSize));
  updateTransformPanel();
  embeddedViewer.GetViewer().Render();
}

function setTransformMode(mode: TransformControlsMode, announce = true): void {
  transformMode = mode;
  transformControls?.setMode(mode);
  document.querySelectorAll<HTMLButtonElement>("[data-gizmo-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.gizmoMode === mode);
  });
  if (announce) {
    const labels: Record<TransformControlsMode, string> = { translate: "移动", rotate: "旋转", scale: "缩放" };
    showToast(`${labels[mode]}工具：拖动彩色轴或平面控制柄`);
  }
  embeddedViewer?.GetViewer().Render();
}

function toggleTransformSpace(): void {
  transformSpace = transformSpace === "world" ? "local" : "world";
  transformControls?.setSpace(transformSpace);
  elements.spaceButton.querySelector("span")!.textContent = transformSpace === "world" ? "世界坐标" : "局部坐标";
  elements.spaceButton.classList.toggle("active", transformSpace === "local");
  showToast(transformSpace === "world" ? "已使用世界坐标轴" : "已使用零件局部坐标轴");
}

function toggleTransformSnap(): void {
  transformSnapEnabled = !transformSnapEnabled;
  transformControls?.setTranslationSnap(transformSnapEnabled ? 1 : null);
  transformControls?.setRotationSnap(transformSnapEnabled ? THREE.MathUtils.degToRad(15) : null);
  transformControls?.setScaleSnap(transformSnapEnabled ? 0.1 : null);
  elements.snapButton.classList.toggle("active", transformSnapEnabled);
  showToast(transformSnapEnabled ? "已启用吸附：1 mm / 15° / 0.1×" : "已关闭变换吸附");
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

function createBed(box: THREE.Box3): THREE.Group {
  const isDark = colorSchemeMedia.matches;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(220, Math.ceil(size.x + 30));
  const depth = Math.max(220, Math.ceil(size.y + 30));
  const group = new THREE.Group();
  group.name = "print-bed";

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(width, depth, 2.6),
    new THREE.MeshStandardMaterial({
      color: isDark ? 0x1b1b1b : 0xe6e6e6,
      roughness: 0.82,
      metalness: 0.08,
    }),
  );
  plate.position.set(center.x, center.y, -1.5);
  plate.receiveShadow = true;
  group.add(plate);

  const linePositions: number[] = [];
  const halfW = width / 2;
  const halfD = depth / 2;
  for (let x = -halfW; x <= halfW + 0.01; x += 10) {
    linePositions.push(center.x + x, center.y - halfD, 0, center.x + x, center.y + halfD, 0);
  }
  for (let y = -halfD; y <= halfD + 0.01; y += 10) {
    linePositions.push(center.x - halfW, center.y + y, 0, center.x + halfW, center.y + y, 0);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const grid = new THREE.LineSegments(
    gridGeometry,
    new THREE.LineBasicMaterial({
      color: isDark ? 0x525252 : 0xa6a6a6,
      transparent: true,
      opacity: isDark ? 0.35 : 0.46,
    }),
  );
  grid.position.z = 0.03;
  group.add(grid);
  group.userData.bed = { center, width, depth };
  return group;
}

function applyMaterial(root: THREE.Object3D, preset: MaterialPreset): void {
  const config = {
    plastic: { color: "#ff5a1f", roughness: 0.58, metalness: 0.02, opacity: 1 },
    petg: { color: "#b7b7b7", roughness: 0.24, metalness: 0, opacity: 0.62 },
    metal: { color: "#a4a4a4", roughness: 0.2, metalness: 0.82, opacity: 1 },
  }[preset];

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const physical = material as THREE.MeshPhysicalMaterial;
      physical.color?.set(config.color);
      physical.roughness = config.roughness;
      physical.metalness = config.metalness;
      physical.opacity = config.opacity;
      physical.transparent = config.opacity < 1;
      physical.depthWrite = config.opacity >= 1;
      physical.wireframe = wireframeEnabled;
      physical.needsUpdate = true;
    }
  });
  embeddedViewer.GetViewer().Render();
}

function rebuildAssembly(fitView = true): void {
  const viewer = embeddedViewer.GetViewer();
  transformControls?.detach();
  if (transformHelper) transformHelper.visible = false;
  assemblyRoot = new THREE.Group();
  assemblyRoot.name = "print-assembly";
  for (const part of parts) assemblyRoot.add(part.root);
  viewer.SetMainObject(assemblyRoot);
  viewer.SetUpVector(Direction.Z, false);

  viewer.ClearExtra();
  if (bedObject) disposeObject(bedObject);
  selectionHelper = undefined;
  if (transformHelper) viewer.AddExtraObject(transformHelper);
  if (parts.length) {
    const assemblyBox = new THREE.Box3().setFromObject(assemblyRoot);
    bedObject = createBed(assemblyBox);
    viewer.AddExtraObject(bedObject);
    if (fitView) viewer.FitSphereToWindow(viewer.GetBoundingSphere(() => true), false);
  } else {
    bedObject = undefined;
  }
  if (!selectedPartId && parts.length) selectedPartId = parts[parts.length - 1].id;
  updateSelectedPartView();
  viewer.Render();
}

function arrangeNewPart(root: THREE.Object3D): void {
  if (!parts.length) return;
  const existingBox = new THREE.Box3();
  for (const part of parts) existingBox.expandByObject(part.root);
  const newBox = new THREE.Box3().setFromObject(root);
  root.position.x += existingBox.max.x - newBox.min.x + 12;
  root.updateMatrixWorld(true);
}

function normalizePrintCoordinates(root: THREE.Object3D): void {
  const isViewerAxisConversion =
    Math.abs(root.rotation.x + Math.PI / 2) < 0.01 &&
    Math.abs(root.rotation.y) < 0.01 &&
    Math.abs(root.rotation.z) < 0.01;
  if (isViewerAxisConversion) {
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
  }
}

function processImportQueue(): void {
  if (activeImportJob || !importQueue.length) return;
  activeImportJob = importQueue.shift();
  showLoading(true);
  stopPhysics(true);
  transformControls?.detach();
  if (transformHelper) transformHelper.visible = false;
  activeImportJob?.load();
}

function enqueueImport(job: ImportJob): void {
  importQueue.push(job);
  processImportQueue();
}

function onModelLoaded(): void {
  const viewer = embeddedViewer.GetViewer();
  const loadedRoot = viewer.mainModel.mainModel.GetRootObject() as THREE.Object3D | undefined;
  const job = activeImportJob;
  if (!loadedRoot || !job) {
    activeImportJob = undefined;
    showLoading(false);
    showToast("模型已解析，但没有发现可显示的网格", true);
    rebuildAssembly();
    return;
  }

  normalizePrintCoordinates(loadedRoot);
  arrangeNewPart(loadedRoot);
  const part: PartRecord = {
    id: `part-${++partCounter}`,
    name: job.name,
    fileSize: job.fileSize,
    root: loadedRoot,
    initialPosition: loadedRoot.position.clone(),
    initialQuaternion: loadedRoot.quaternion.clone(),
    initialScale: loadedRoot.scale.clone(),
    material: materialPreset,
  };
  markPartHierarchy(part);
  applyMaterial(part.root, part.material);
  parts.push(part);
  selectedPartId = part.id;
  activeImportJob = undefined;

  if (importQueue.length) {
    // Online3DViewer is not re-entrant: starting the next import from inside
    // its completion callback can leave the second model permanently pending.
    window.setTimeout(processImportQueue, 0);
    return;
  }
  showLoading(false);
  rebuildAssembly();
  if (pendingAutoAssembly) {
    pendingAutoAssembly = false;
    assembleSampleParts(false);
  } else {
    showToast(`已添加 ${part.name}，当前共 ${parts.length} 个零件`);
  }
}

function onModelLoadFailed(): void {
  const failedName = activeImportJob?.name;
  activeImportJob = undefined;
  if (importQueue.length) window.setTimeout(processImportQueue, 0);
  else {
    pendingAutoAssembly = false;
    showLoading(false);
    rebuildAssembly();
  }
  showToast(`无法解析${failedName ? ` ${failedName}` : "这个文件"}`, true);
}

function initModelViewer(): void {
  const isDark = colorSchemeMedia.matches;
  embeddedViewer = new EmbeddedViewer(elements.modelHost, {
    backgroundColor: isDark
      ? new RGBAColor(21, 21, 21, 255)
      : new RGBAColor(241, 241, 241, 255),
    defaultColor: new RGBColor(255, 90, 31),
    edgeSettings: new EdgeSettings(false, new RGBColor(isDark ? 45 : 185, isDark ? 45 : 185, isDark ? 45 : 185), 30),
    onModelLoaded,
    onModelLoadFailed,
  });
  initTransformControls();
}

function initTransformControls(): void {
  const viewer = embeddedViewer.GetViewer();
  const canvas = embeddedViewer.canvas;
  transformControls = new TransformControls(viewer.camera as THREE.Camera, canvas);
  transformControls.setMode(transformMode);
  transformControls.setSpace(transformSpace);
  transformControls.setSize(1.02);
  transformHelper = transformControls.getHelper();
  transformHelper.name = "part-transform-gizmo";
  transformHelper.visible = false;
  viewer.AddExtraObject(transformHelper);

  transformControls.addEventListener("change", () => viewer.Render());
  transformControls.addEventListener("axis-changed", (event) => {
    elements.viewport.dataset.gizmoAxis = String(event.value ?? "");
  });
  transformControls.addEventListener("mouseDown", () => {
    elements.viewport.dataset.gizmoPointer = "down";
  });
  transformControls.addEventListener("mouseUp", () => {
    elements.viewport.dataset.gizmoPointer = "up";
  });
  transformControls.addEventListener("objectChange", () => {
    const target = activeTransformRoot();
    if (!target) return;
    target.scale.set(
      Math.max(0.05, target.scale.x),
      Math.max(0.05, target.scale.y),
      Math.max(0.05, target.scale.z),
    );
    updateAfterTransform();
  });
  transformControls.addEventListener("dragging-changed", (event) => {
    transformDragging = Boolean(event.value);
    elements.viewport.classList.toggle("transform-dragging", transformDragging);
  });

  // Online3DViewer listens for mouse events to orbit the camera. While a gizmo
  // handle is active we keep those events for TransformControls only.
  canvas.addEventListener("mousedown", (event) => {
    if (!transformControls?.axis) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("mousemove", (event) => {
    if (!transformDragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("mouseup", (event) => {
    if (!transformDragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Some embedded webviews report pointermove.button as 0 while dragging.
  // TransformControls expects -1 for move events and otherwise discards them.
  canvas.addEventListener("pointermove", (event) => {
    if (!transformControls?.dragging || event.button === -1) return;
    const rect = canvas.getBoundingClientRect();
    transformControls.pointerMove({
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      button: -1,
    } as unknown as PointerEvent);
  });

  installViewportSelection();
}

function partUnderPointer(clientX: number, clientY: number): PartRecord | undefined {
  if (!parts.length) return undefined;
  const canvas = embeddedViewer.canvas;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const viewer = embeddedViewer.GetViewer();
  assemblyRoot.updateMatrixWorld(true);
  (viewer.camera as THREE.Camera).updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, viewer.camera as THREE.Camera);
  const hit = raycaster.intersectObject(assemblyRoot, true)
    .find((intersection) => Boolean(intersection.object.userData?.partId));
  const partId = hit?.object.userData?.partId as string | undefined;
  const raycastPart = partId ? parts.find((part) => part.id === partId) : undefined;
  if (raycastPart) return raycastPart;

  // Some importer meshes use custom geometry wrappers that do not always
  // participate in Three.js raycasting. Project each part's world bounds as a
  // dependable picking fallback and prefer the closest on-screen center.
  const projected = parts.flatMap((part) => {
    const box = new THREE.Box3().setFromObject(part.root);
    const points = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ].map((point) => point.project(viewer.camera as THREE.Camera));
    const minX = rect.left + (Math.min(...points.map((point) => point.x)) + 1) * rect.width / 2;
    const maxX = rect.left + (Math.max(...points.map((point) => point.x)) + 1) * rect.width / 2;
    const minY = rect.top + (1 - Math.max(...points.map((point) => point.y))) * rect.height / 2;
    const maxY = rect.top + (1 - Math.min(...points.map((point) => point.y))) * rect.height / 2;
    if (clientX < minX || clientX > maxX || clientY < minY || clientY > maxY) return [];
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    return [{ part, distance }];
  });
  return projected.sort((a, b) => a.distance - b.distance)[0]?.part;
}

function installViewportSelection(): void {
  const canvas = embeddedViewer.canvas;
  let pointerStart: { id: number; x: number; y: number; gizmo: boolean } | undefined;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || currentMode !== "model") return;
    const directHit = partUnderPointer(event.clientX, event.clientY);
    if (directHit) {
      if (directHit.id !== selectedPartId && transformControls) transformControls.axis = null;
      ensurePartSelected(directHit);
    }
    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      gizmo: directHit?.id === selectedPartId && Boolean(transformControls?.axis),
    };
  }, true);
  canvas.addEventListener("pointerup", (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    const wasGizmo = pointerStart.gizmo || transformDragging || Boolean(transformControls?.dragging);
    pointerStart = undefined;
    if (moved > 5 || wasGizmo || currentMode !== "model") return;
    const part = partUnderPointer(event.clientX, event.clientY);
    if (part?.id === selectedPartId) return;
    selectPart(part?.id);
  }, true);
  canvas.addEventListener("pointercancel", () => { pointerStart = undefined; }, true);
  // Keep a click fallback for browser engines and embedded webviews that expose
  // mouse events without a complete PointerEvent sequence.
  canvas.addEventListener("click", (event) => {
    if (currentMode !== "model" || transformDragging || transformControls?.dragging) return;
    const part = partUnderPointer(event.clientX, event.clientY);
    if (part) ensurePartSelected(part);
  }, true);
}

function initGCode(): WebGLPreview {
  if (gcodePreview) return gcodePreview;
  gcodePreview = initGCodePreview({
    canvas: elements.gcodeCanvas,
    backgroundColor: 0x11110f,
    buildVolume: { x: 220, y: 220, z: 250 },
    extrusionColor: 0xff5a1f,
    topLayerColor: 0xffca52,
    travelColor: 0x66706a,
    renderTravel: false,
    renderTubes: false,
    lineWidth: 3,
    extrusionWidth: 0.42,
    initialCameraPosition: [260, 220, 220],
  });
  return gcodePreview;
}

function switchMode(mode: ViewMode): void {
  currentMode = mode;
  const isModel = mode === "model";
  elements.modelHost.classList.toggle("hidden", !isModel);
  elements.gcodeCanvas.classList.toggle("visible", !isModel);
  elements.layerControl.classList.toggle("visible", !isModel);
  elements.physicsButton.disabled = !isModel || !modelRoot || assemblyGroupMode;
  elements.physicsButton.title = assemblyGroupMode
    ? "拆件平铺后可选择单个零件进行 Rapier 重力测试"
    : "使用 Rapier 3D 进行重力、摩擦和碰撞测试";
  elements.wireframeButton.disabled = !isModel || !modelRoot;
  elements.viewportHint.classList.toggle("hidden", !isModel);
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  syncTransformControl();
  if (isModel) {
    embeddedViewer?.Resize();
    embeddedViewer?.GetViewer().Render();
  } else {
    initGCode().resize();
  }
}

async function loadGCode(file: File): Promise<void> {
  showLoading(true);
  try {
    const source = await file.text();
    switchMode("gcode");
    const preview = initGCode();
    preview.clear();
    preview.startLayer = 1;
    preview.endLayer = undefined;
    preview.processGCode(source);
    const layerCount = preview.parser.layers.length;
    preview.endLayer = layerCount + 1;
    preview.render();
    elements.layerRange.min = "1";
    elements.layerRange.max = String(Math.max(1, layerCount));
    elements.layerRange.value = String(Math.max(1, layerCount));
    elements.layerValue.textContent = `${layerCount} / ${layerCount}`;
    elements.fileType.textContent = "GCODE";
    elements.fileName.textContent = file.name;
    elements.fileSubtitle.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · ${layerCount} 层`;
    elements.sizeX.textContent = "220 mm";
    elements.sizeY.textContent = "220 mm";
    elements.sizeZ.textContent = "—";
    elements.triangles.textContent = "路径";
    elements.meshCount.textContent = "—";
    showToast(`已解析 ${layerCount} 个打印层`);
  } catch (error) {
    console.error(error);
    showToast("G-code 解析失败", true);
  } finally {
    showLoading(false);
  }
}

function loadModelFiles(files: File[]): void {
  const importableExtensions = new Set(["stl", "3mf", "obj", "amf", "ply", "step", "stp"]);
  const modelFiles = files.filter((file) => importableExtensions.has(extensionOf(file.name)));
  if (!modelFiles.length) {
    showToast("没有发现可导入的模型文件", true);
    return;
  }

  if (modelFiles.length === 1) {
    const main = modelFiles[0];
    enqueueImport({
      name: main.name,
      fileSize: files.reduce((sum, file) => sum + file.size, 0),
      load: () => embeddedViewer.LoadModelFromFileList(files),
    });
    return;
  }

  for (const file of modelFiles) {
    enqueueImport({
      name: file.name,
      fileSize: file.size,
      load: () => embeddedViewer.LoadModelFromFileList([file]),
    });
  }
}

async function loadFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  if (!files.length) return;
  const modelFiles = files.filter((file) => ["stl", "3mf", "obj", "amf", "ply", "step", "stp"].includes(extensionOf(file.name)));
  if (modelFiles.length) loadModelFiles(files);
  else {
    const gcode = files.find((file) => ["gcode", "gco", "gc"].includes(extensionOf(file.name)));
    if (gcode) await loadGCode(gcode);
  }
}

function loadSample(key: keyof typeof samples): void {
  const sample = samples[key];
  enqueueImport({
    name: sample.fileName,
    load: () => embeddedViewer.LoadModelFromUrlList([sample.url]),
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((button) => button.classList.remove("active"));
  document.querySelector<HTMLButtonElement>("#gcode-demo-button")?.classList.remove("active");
}

async function ensureRapier(): Promise<void> {
  if (rapierReady) return;
  await RAPIER.init();
  rapierReady = true;
}

async function startPhysics(): Promise<void> {
  if (!modelRoot || !bedObject) return;
  elements.physicsButton.classList.add("busy");
  elements.physicsButton.textContent = "准备 Rapier…";
  await ensureRapier();

  if (physicsRunning) stopPhysics(true);
  physicsStartPosition.copy(modelRoot.position);
  physicsStartQuaternion.copy(modelRoot.quaternion);
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const bed = bedObject.userData.bed as { center: THREE.Vector3; width: number; depth: number };

  physicsWorld = new RAPIER.World({ x: 0, y: 0, z: -9810 });
  const ground = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(bed.center.x, bed.center.y, -1.5),
  );
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(bed.width / 2, bed.depth / 2, 1.3).setFriction(0.72),
    ground,
  );

  for (const part of parts) {
    if (part.root === modelRoot) continue;
    const staticBox = new THREE.Box3().setFromObject(part.root);
    const staticSize = staticBox.getSize(new THREE.Vector3());
    const staticCenter = staticBox.getCenter(new THREE.Vector3());
    const staticBody = physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(part.root.position.x, part.root.position.y, part.root.position.z)
        .setRotation({
          x: part.root.quaternion.x,
          y: part.root.quaternion.y,
          z: part.root.quaternion.z,
          w: part.root.quaternion.w,
        }),
    );
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(
        Math.max(staticSize.x / 2, 0.1),
        Math.max(staticSize.y / 2, 0.1),
        Math.max(staticSize.z / 2, 0.1),
      )
        .setTranslation(
          staticCenter.x - part.root.position.x,
          staticCenter.y - part.root.position.y,
          staticCenter.z - part.root.position.z,
        )
        .setFriction(0.66),
      staticBody,
    );
  }

  const lift = Math.max(35, size.z * 0.8);
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(physicsStartPosition.x, physicsStartPosition.y, physicsStartPosition.z + lift)
    .setRotation({
      x: physicsStartQuaternion.x,
      y: physicsStartQuaternion.y,
      z: physicsStartQuaternion.z,
      w: physicsStartQuaternion.w,
    })
    .setLinearDamping(0.16)
    .setAngularDamping(0.42);
  physicsBody = physicsWorld.createRigidBody(bodyDesc);
  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(
      Math.max(size.x / 2, 0.1),
      Math.max(size.y / 2, 0.1),
      Math.max(size.z / 2, 0.1),
    )
      .setTranslation(
        center.x - physicsStartPosition.x,
        center.y - physicsStartPosition.y,
        center.z - physicsStartPosition.z,
      )
      .setDensity(0.00124)
      .setFriction(0.66)
      .setRestitution(0.04),
    physicsBody,
  );
  physicsBody.setAngvel({ x: 0.16, y: -0.11, z: 0.04 }, true);

  accumulator = 0;
  lastFrame = performance.now();
  physicsRunning = true;
  syncTransformControl();
  elements.physicsButton.classList.remove("busy");
  elements.physicsButton.classList.add("active");
  elements.physicsButton.textContent = "停止物理";
  showToast("已启用重力、摩擦与碰撞");
}

function stopPhysics(resetPose: boolean): void {
  const wasRunning = physicsRunning;
  physicsRunning = false;
  physicsWorld = undefined;
  physicsBody = undefined;
  if (resetPose && wasRunning && modelRoot) {
    modelRoot.position.copy(physicsStartPosition);
    modelRoot.quaternion.copy(physicsStartQuaternion);
    modelRoot.updateMatrixWorld(true);
    selectionHelper?.update();
    updateTransformPanel();
  }
  if (elements.physicsButton) {
    elements.physicsButton.classList.remove("active", "busy");
    elements.physicsButton.textContent = "Rapier 重力测试";
  }
  syncTransformControl();
}

function animationLoop(now: number): void {
  if (physicsRunning && physicsWorld && physicsBody && modelRoot) {
    accumulator += Math.min((now - lastFrame) / 1000, 0.05);
    const fixedStep = 1 / 60;
    while (accumulator >= fixedStep) {
      physicsWorld.timestep = fixedStep;
      physicsWorld.step();
      accumulator -= fixedStep;
    }
    const position = physicsBody.translation();
    const rotation = physicsBody.rotation();
    modelRoot.position.set(position.x, position.y, position.z);
    modelRoot.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    modelRoot.updateMatrixWorld(true);
    selectionHelper?.update();
    updateTransformPanel();
    embeddedViewer.GetViewer().Render();
  }
  lastFrame = now;
  requestAnimationFrame(animationLoop);
}

function clearAssembly(): void {
  stopPhysics(true);
  transformControls?.detach();
  for (const part of parts) disposeObject(part.root);
  parts = [];
  selectedPartId = undefined;
  modelRoot = undefined;
  importQueue = [];
  activeImportJob = undefined;
  pendingAutoAssembly = false;
  assemblyExploded = false;
  assemblyGroupMode = false;
  elements.explodeButton.textContent = "拆件平铺";
  setAssemblyStatus("三件套装配", "载入后按 CAD 约束自动对位", "idle");
  rebuildAssembly();
  showToast("装配工作区已清空");
}

function removeSelectedPart(): void {
  const part = selectedPart();
  if (!part) return;
  stopPhysics(true);
  transformControls?.detach();
  const index = parts.indexOf(part);
  assemblyGroupMode = false;
  parts.splice(index, 1);
  part.root.removeFromParent();
  disposeObject(part.root);
  selectedPartId = parts[Math.min(index, parts.length - 1)]?.id;
  rebuildAssembly(false);
  showToast(`已删除 ${part.name}`);
}

function duplicateSelectedPart(): void {
  const source = selectedPart();
  if (!source) return;
  stopPhysics(true);
  const clone = source.root.clone(true);
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone());
    else if (mesh.material) mesh.material = mesh.material.clone();
  });
  clone.position.x += 12;
  clone.position.y += 12;
  clone.updateMatrixWorld(true);
  const part: PartRecord = {
    id: `part-${++partCounter}`,
    name: `${source.name.replace(/( \u00b7 \u526f\u672c \d+| \u526f\u672c)$/u, "")} · 副本`,
    fileSize: source.fileSize,
    root: clone,
    initialPosition: clone.position.clone(),
    initialQuaternion: clone.quaternion.clone(),
    initialScale: clone.scale.clone(),
    material: source.material,
  };
  markPartHierarchy(part);
  parts.push(part);
  selectedPartId = part.id;
  rebuildAssembly(false);
  showToast(`已复制 ${source.name}`);
}

function centerSelectedPart(): void {
  const target = activeTransformRoot();
  if (!target || !bedObject) return;
  stopPhysics(true);
  const box = new THREE.Box3().setFromObject(target);
  const center = box.getCenter(new THREE.Vector3());
  const bed = bedObject.userData.bed as { center: THREE.Vector3 };
  target.position.x += bed.center.x - center.x;
  target.position.y += bed.center.y - center.y;
  updateAfterTransform();
}

function placeSelectedPartOnBed(): void {
  const target = activeTransformRoot();
  if (!target) return;
  stopPhysics(true);
  const box = new THREE.Box3().setFromObject(target);
  target.position.z -= box.min.z;
  updateAfterTransform();
}

function resetSelectedPart(): void {
  const part = selectedPart();
  const target = activeTransformRoot();
  if (!target) return;
  stopPhysics(true);
  if (assemblyGroupMode) {
    target.position.set(0, 0, 0);
    target.quaternion.identity();
    target.scale.set(1, 1, 1);
  } else if (part) {
    part.root.position.copy(part.initialPosition);
    part.root.quaternion.copy(part.initialQuaternion);
    part.root.scale.copy(part.initialScale);
  }
  updateAfterTransform();
}

function applyTransformValue(kind: TransformKind, axis: "x" | "y" | "z", value: number): void {
  const target = activeTransformRoot();
  if (!target || !Number.isFinite(value)) return;
  if (assemblyGroupMode && kind === "scale") {
    showToast("整机装配状态禁止非等比缩放；拆件平铺后可编辑单件尺寸");
    updateTransformPanel();
    return;
  }
  stopPhysics(true);
  if (kind === "position") target.position[axis] = value;
  else if (kind === "rotation") target.rotation[axis] = THREE.MathUtils.degToRad(value);
  else target.scale[axis] = Math.max(0.05, value);
  updateAfterTransform();
}

elements.input.addEventListener("change", () => {
  if (elements.input.files) void loadFiles(elements.input.files);
  elements.input.value = "";
});

let dragDepth = 0;
elements.viewport.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  elements.dropOverlay.classList.add("visible");
});
elements.viewport.addEventListener("dragover", (event) => event.preventDefault());
elements.viewport.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth -= 1;
  if (dragDepth <= 0) elements.dropOverlay.classList.remove("visible");
});
elements.viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements.dropOverlay.classList.remove("visible");
  if (event.dataTransfer?.files) void loadFiles(event.dataTransfer.files);
});

document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => loadSample(button.dataset.sample as keyof typeof samples));
});

document.querySelector<HTMLButtonElement>("#gcode-demo-button")!.addEventListener("click", () => {
  document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((button) => button.classList.remove("active"));
  document.querySelector<HTMLButtonElement>("#gcode-demo-button")!.classList.add("active");
  const demoFile = new File([demoGCode], "layer-demo.gcode", { type: "text/plain" });
  void loadGCode(demoFile);
});

document.querySelectorAll<HTMLButtonElement>("[data-material]").forEach((button) => {
  button.addEventListener("click", () => {
    materialPreset = button.dataset.material as MaterialPreset;
    document.querySelectorAll<HTMLButtonElement>("[data-material]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    const part = selectedPart();
    if (part) {
      part.material = materialPreset;
      applyMaterial(part.root, materialPreset);
    }
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-inspector-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    setInspectorTheme(button.dataset.inspectorTheme as InspectorTheme);
  });
});

document.querySelectorAll<HTMLInputElement>("[data-transform]").forEach((input) => {
  input.addEventListener("input", () => {
    applyTransformValue(
      input.dataset.transform as TransformKind,
      input.dataset.axis as "x" | "y" | "z",
      Number(input.value),
    );
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-nudge]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = activeTransformRoot();
    if (!target) return;
    const kind = button.dataset.nudge as TransformKind;
    const axis = button.dataset.axis as "x" | "y" | "z";
    const delta = Number(button.dataset.delta);
    const current = kind === "position"
      ? target.position[axis]
      : kind === "rotation"
        ? THREE.MathUtils.radToDeg(target.rotation[axis])
        : target.scale[axis];
    applyTransformValue(kind, axis, current + delta);
  });
});

document.querySelector<HTMLButtonElement>("#clear-parts-button")!.addEventListener("click", clearAssembly);
elements.autoAssembleButton.addEventListener("click", loadAndAssembleSamples);
elements.explodeButton.addEventListener("click", () => assembleSampleParts(!assemblyExploded));
document.querySelector<HTMLButtonElement>("#remove-part-button")!.addEventListener("click", removeSelectedPart);
document.querySelector<HTMLButtonElement>("#center-part-button")!.addEventListener("click", centerSelectedPart);
document.querySelector<HTMLButtonElement>("#place-part-button")!.addEventListener("click", placeSelectedPartOnBed);
document.querySelector<HTMLButtonElement>("#duplicate-part-button")!.addEventListener("click", duplicateSelectedPart);
document.querySelector<HTMLButtonElement>("#reset-part-button")!.addEventListener("click", resetSelectedPart);
document.querySelector<HTMLButtonElement>("#viewport-place-button")!.addEventListener("click", placeSelectedPartOnBed);
document.querySelector<HTMLButtonElement>("#viewport-duplicate-button")!.addEventListener("click", duplicateSelectedPart);
document.querySelector<HTMLButtonElement>("#viewport-delete-button")!.addEventListener("click", removeSelectedPart);

document.querySelectorAll<HTMLButtonElement>("[data-gizmo-mode]").forEach((button) => {
  button.addEventListener("click", () => setTransformMode(button.dataset.gizmoMode as TransformControlsMode));
});
elements.spaceButton.addEventListener("click", toggleTransformSpace);
elements.snapButton.addEventListener("click", toggleTransformSnap);

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as ViewMode;
    if (mode === "gcode" && !gcodePreview) showToast("请选择一个 G-code 文件");
    switchMode(mode);
  });
});

elements.wireframeButton.addEventListener("click", () => {
  if (!modelRoot) return;
  wireframeEnabled = !wireframeEnabled;
  elements.wireframeButton.classList.toggle("active", wireframeEnabled);
  applyMaterial(modelRoot, materialPreset);
});

document.querySelector<HTMLButtonElement>("#fit-button")!.addEventListener("click", () => {
  if (currentMode === "model") {
    const viewer = embeddedViewer.GetViewer();
    viewer.FitSphereToWindow(viewer.GetBoundingSphere(() => true), true);
  } else {
    gcodePreview?.resize();
  }
});

elements.physicsButton.addEventListener("click", () => {
  if (physicsRunning) {
    stopPhysics(true);
    embeddedViewer.GetViewer().Render();
  } else {
    void startPhysics();
  }
});

elements.layerRange.addEventListener("input", () => {
  if (!gcodePreview) return;
  const layer = Number(elements.layerRange.value);
  gcodePreview.endLayer = layer + 1;
  gcodePreview.render();
  elements.layerValue.textContent = `${layer} / ${elements.layerRange.max}`;
});

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, select, [contenteditable='true']") || currentMode !== "model") return;
  const key = event.key.toLowerCase();
  if (key === "w") setTransformMode("translate", false);
  else if (key === "e") setTransformMode("rotate", false);
  else if (key === "r") setTransformMode("scale", false);
  else if (key === "q") toggleTransformSpace();
  else if ((event.metaKey || event.ctrlKey) && key === "d") {
    event.preventDefault();
    duplicateSelectedPart();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelectedPart();
  } else if (key === "f") {
    const viewer = embeddedViewer.GetViewer();
    viewer.FitSphereToWindow(viewer.GetBoundingSphere(() => true), true);
  }
});

const resizeObserver = new ResizeObserver(() => {
  if (currentMode === "model") embeddedViewer?.Resize();
  else gcodePreview?.resize();
});
resizeObserver.observe(elements.viewport);

initModelViewer();
restoreInspectorTheme();
switchMode("model");
loadAndAssembleSamples();
requestAnimationFrame(animationLoop);

colorSchemeMedia.addEventListener("change", () => {
  const isDark = colorSchemeMedia.matches;
  embeddedViewer.GetViewer().SetBackgroundColor(
    isDark
      ? new RGBAColor(21, 21, 21, 255)
      : new RGBAColor(241, 241, 241, 255),
  );
  if (parts.length) rebuildAssembly(false);
});
