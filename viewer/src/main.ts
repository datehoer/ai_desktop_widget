import * as THREE from "three";
import { OBB } from "three/addons/math/OBB.js";
import { init as initGCodePreview, type WebGLPreview } from "gcode-preview";
import {
  EdgeSettings,
  EmbeddedViewer,
  Direction,
  RGBAColor,
  RGBColor,
} from "online-3d-viewer";
import demoGCode from "./samples/layer-demo.gcode?raw";
import "./styles.css";

type MaterialPreset = "plastic" | "petg" | "metal";
type ViewMode = "model" | "gcode";
type TransformKind = "position" | "rotation" | "scale";
type InspectorTheme = "slate" | "paper" | "signal";
type Axis = "x" | "y" | "z";
type Point2 = { x: number; y: number };
type ScaleHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type GizmoLayout = {
  bounds: { left: number; top: number; right: number; bottom: number };
  center: Point2;
  scaleHandles: Array<Point2 & { id: ScaleHandleId }>;
  rotationHandles: Array<Point2 & { axis: Axis }>;
  lift: Point2;
  ringRadius: number;
};

type GizmoDrag =
  | {
    kind: "scale";
    id: number;
    handle: ScaleHandleId;
    center: Point2;
    startPointer: Point2;
    startScale: THREE.Vector3;
  }
  | {
    kind: "lift";
    id: number;
    startY: number;
    startZ: number;
    pixelsPerUnit: number;
  }
  | {
    kind: "rotate";
    id: number;
    axis: Axis;
    center: Point2;
    lastPointerAngle: number;
    accumulatedAngle: number;
    startRotation: number;
    mode: "fixed" | "fine";
  };

type PhysicsMode = "selected" | "all";
type RapierVector = { x: number; y: number; z: number };
type RapierRotation = RapierVector & { w: number };
type RapierRigidBody = {
  translation(): RapierVector;
  rotation(): RapierRotation;
  setTranslation(value: RapierVector, wakeUp: boolean): void;
  setRotation(value: RapierRotation, wakeUp: boolean): void;
  setLinvel(value: RapierVector, wakeUp: boolean): void;
  setAngvel(value: RapierVector, wakeUp: boolean): void;
  wakeUp(): void;
};
type RapierCollider = {
  handle: number;
  castCollider(
    velocity: RapierVector,
    other: RapierCollider,
    otherVelocity: RapierVector,
    targetDistance: number,
    maxTimeOfImpact: number,
    stopAtPenetration: boolean,
  ): RapierShapeCastHit | null;
  contactCollider(other: RapierCollider, prediction: number): unknown | null;
};
type RapierShapeCastHit = { time_of_impact: number };
type RapierRigidBodyDesc = {
  setTranslation(x: number, y: number, z: number): RapierRigidBodyDesc;
  setRotation(rotation: RapierRotation): RapierRigidBodyDesc;
  setCcdEnabled(enabled: boolean): RapierRigidBodyDesc;
  setSoftCcdPrediction(distance: number): RapierRigidBodyDesc;
  setAdditionalSolverIterations(iterations: number): RapierRigidBodyDesc;
  setLinearDamping(value: number): RapierRigidBodyDesc;
  setAngularDamping(value: number): RapierRigidBodyDesc;
  setCanSleep(value: boolean): RapierRigidBodyDesc;
};
type RapierColliderDesc = {
  setTranslation(x: number, y: number, z: number): RapierColliderDesc;
  setFriction(value: number): RapierColliderDesc;
  setRestitution(value: number): RapierColliderDesc;
  setDensity(value: number): RapierColliderDesc;
  setActiveEvents(value: number): RapierColliderDesc;
  setSensor(value: boolean): RapierColliderDesc;
};
type RapierEventQueue = {
  drainCollisionEvents(callback: (first: number, second: number, started: boolean) => void): void;
  free(): void;
};
type RapierWorld = {
  timestep: number;
  maxCcdSubsteps: number;
  createRigidBody(desc: RapierRigidBodyDesc): RapierRigidBody;
  createCollider(desc: RapierColliderDesc, body: RapierRigidBody): RapierCollider;
  contactPairsWith(collider: RapierCollider, callback: (other: RapierCollider) => void): void;
  intersectionPairsWith(collider: RapierCollider, callback: (other: RapierCollider) => void): void;
  propagateModifiedBodyPositionsToColliders(): void;
  step(queue?: RapierEventQueue): void;
  free(): void;
};
type RapierApi = {
  init(): Promise<void>;
  World: new (gravity: RapierVector) => RapierWorld;
  EventQueue: new (autoDrain: boolean) => RapierEventQueue;
  ActiveEvents: { COLLISION_EVENTS: number };
  RigidBodyDesc: {
    dynamic(): RapierRigidBodyDesc;
    fixed(): RapierRigidBodyDesc;
    kinematicPositionBased(): RapierRigidBodyDesc;
  };
  ColliderDesc: {
    convexHull(vertices: Float32Array): RapierColliderDesc | null;
    trimesh(vertices: Float32Array, indices: Uint32Array): RapierColliderDesc;
    cuboid(x: number, y: number, z: number): RapierColliderDesc;
  };
};
type PhysicsBinding = {
  part: PartRecord;
  body: RapierRigidBody;
  dynamic: boolean;
};
type TransformSnapshot = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};
type EditCollisionSession = {
  world?: RapierWorld;
  body?: RapierRigidBody;
  colliders: RapierCollider[];
  obstacleColliders: RapierCollider[];
  part: PartRecord;
  acceptedPosition: THREE.Vector3;
  acceptedQuaternion: THREE.Quaternion;
  acceptedScale: THREE.Vector3;
  blockedDirection?: THREE.Vector3;
  relativeAfterContact: boolean;
  lastRequestedPosition: THREE.Vector3;
  selectedLocalObb: OBB;
  obstacleObbs: OBB[];
};
type EditQueryBinding = {
  body: RapierRigidBody;
  colliders: RapierCollider[];
};

type PartRecord = {
  id: string;
  name: string;
  fileSize?: number;
  root: THREE.Object3D;
  initialPosition: THREE.Vector3;
  initialQuaternion: THREE.Quaternion;
  initialScale: THREE.Vector3;
  material: MaterialPreset;
  collisionLocalObb?: OBB;
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

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="app-shell" data-mode="model">
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
          <div class="section-title"><span>添加文件</span><small>模型或 G-code</small></div>
          <label class="upload-button" for="file-input">
            <span>打开文件</span><b>＋</b>
          </label>
          <input id="file-input" type="file" multiple accept=".stl,.3mf,.gcode,.gco,.gc,.obj,.amf,.ply,.step,.stp" />
          <div class="drop-hint">也可以将多个文件拖入右侧视窗</div>
        </div>

        <div class="panel-section gcode-demo-section">
          <div class="section-title"><span>快速预览</span><small>本地示例</small></div>
          <div class="sample-list" role="list">
            <button class="sample-item" id="gcode-demo-button">
              <span>打印路径 · Demo</span>
              <b>→</b>
            </button>
          </div>
        </div>

        <div class="panel-section parts-section model-only">
          <div class="section-title">
            <span>零件</span>
            <button id="clear-parts-button" class="section-action">清空</button>
          </div>
          <div id="parts-list" class="parts-list"></div>
        </div>

        <div class="panel-section transform-section model-only">
          <div class="section-title"><span>变换</span><small id="selected-part-label">未选择</small></div>
          <div class="transform-block">
            <p>位置 <small>mm</small></p>
            ${(["x", "y", "z"] as const).map((axis) => `
              <div class="transform-row">
                <span class="axis-tag axis-${axis}">${axis.toUpperCase()}</span>
                <button data-nudge="position" data-axis="${axis}" data-delta="-1" aria-label="${axis.toUpperCase()} 位置减 1 毫米">−</button>
                <input type="number" data-transform="position" data-axis="${axis}" aria-label="${axis.toUpperCase()} 位置（毫米）" step="1" value="0" disabled />
                <button data-nudge="position" data-axis="${axis}" data-delta="1" aria-label="${axis.toUpperCase()} 位置加 1 毫米">＋</button>
              </div>
            `).join("")}
          </div>
          <div class="transform-block rotation-block">
            <p>旋转 <small>°</small></p>
            ${(["x", "y", "z"] as const).map((axis) => `
              <div class="transform-row">
                <span class="axis-tag axis-${axis}">${axis.toUpperCase()}</span>
                <button data-nudge="rotation" data-axis="${axis}" data-delta="-15" aria-label="${axis.toUpperCase()} 旋转减 15 度">−15</button>
                <input type="number" data-transform="rotation" data-axis="${axis}" aria-label="${axis.toUpperCase()} 旋转角度" step="1" value="0" disabled />
                <button data-nudge="rotation" data-axis="${axis}" data-delta="15" aria-label="${axis.toUpperCase()} 旋转加 15 度">＋15</button>
              </div>
            `).join("")}
          </div>
          <div class="transform-block rotation-block">
            <p>缩放 <small>倍数</small></p>
            ${(["x", "y", "z"] as const).map((axis) => `
              <div class="transform-row">
                <span class="axis-tag axis-${axis}">${axis.toUpperCase()}</span>
                <button data-nudge="scale" data-axis="${axis}" data-delta="-0.1" aria-label="${axis.toUpperCase()} 缩放减 0.1">−</button>
                <input type="number" data-transform="scale" data-axis="${axis}" aria-label="${axis.toUpperCase()} 缩放倍数" step="0.1" min="0.05" value="1" disabled />
                <button data-nudge="scale" data-axis="${axis}" data-delta="0.1" aria-label="${axis.toUpperCase()} 缩放加 0.1">＋</button>
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

        <div class="panel-section material-section model-only">
          <div class="section-title"><span>材质</span><small>实时</small></div>
          <div class="segmented" aria-label="外观材质">
            <button class="active" data-material="plastic">哑光</button>
            <button data-material="petg">PETG</button>
            <button data-material="metal">金属</button>
          </div>
        </div>

        <div class="panel-section physics-section model-only">
          <div class="section-title"><span>物理</span><small>Rapier 3D</small></div>
          <p class="physics-copy">编辑时阻止零件穿透 · 自由落体使用网格碰撞</p>
          <div class="physics-actions">
            <button id="collision-guard-button" class="active" aria-pressed="true">防穿透：开</button>
            <button id="physics-drop-selected-button">选中项下落</button>
            <button id="physics-drop-all-button">全部自由落体</button>
            <button id="physics-pause-button" disabled>暂停</button>
            <button id="physics-reset-button" disabled>恢复位置</button>
          </div>
          <div id="physics-status" class="physics-status" data-state="idle"><i></i><span>物理未启动</span></div>
        </div>
      </aside>

      <section class="viewer-panel">
        <div class="viewer-toolbar">
          <div id="viewport-tools" class="viewport-tools" aria-label="零件操作工具">
            <div id="viewport-tool-empty" class="viewport-tool-empty">拖入模型开始编辑</div>
            <div class="viewport-tool-guide" aria-label="组合变换说明">
              <strong>组合控制柄</strong><span>拖动移动 · 方块缩放 · 弧形柄旋转</span>
            </div>
            <div class="viewport-tool-group compact" role="group" aria-label="吸附设置">
              <button id="snap-button" title="移动与缩放吸附"><span>移动吸附</span></button>
            </div>
            <div class="viewport-tool-group compact" role="group" aria-label="零件快捷操作">
              <button id="viewport-place-button" title="贴合热床"><span>落盘</span></button>
              <button id="viewport-duplicate-button" title="复制零件（⌘/Ctrl + D）"><span>复制</span></button>
              <button id="viewport-delete-button" class="danger" title="删除零件（Delete）"><span>删除</span></button>
            </div>
          </div>
          <div class="toolbar-actions">
            <button id="wireframe-button" class="tool-button model-only" title="切换线框">线框</button>
            <button id="fit-button" class="tool-button" title="适应窗口">适应</button>
          </div>
        </div>

        <div id="viewport" class="viewport">
          <div id="model-viewer" class="canvas-host"></div>
          <canvas id="gcode-canvas" class="gcode-canvas" aria-label="G-code 预览"></canvas>
          <canvas id="combined-gizmo" class="combined-gizmo" aria-label="组合变换控制柄"></canvas>
          <div id="selection-chip" class="selection-chip">
            <div><strong id="viewport-part-name">未选择零件</strong><small>拖动零件移动 · 方块缩放 · 弧形柄旋转</small></div>
          </div>
          <div id="empty-workspace" class="empty-workspace visible">
            <strong>拖入模型开始</strong>
            <span>STL / 3MF / OBJ / STEP</span>
            <label class="empty-upload" for="file-input">打开模型</label>
          </div>
          <div id="transform-readout" class="transform-readout" role="status" aria-live="polite"></div>
          <div id="viewport-hint" class="viewport-hint">拖动零件移动 · 方块缩放 · 弧形柄旋转 · D 落盘</div>
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
            <span class="file-type" id="file-type">3D</span>
            <div><strong id="file-name">未载入模型</strong><small id="file-subtitle">文件只在本机处理</small></div>
            <div class="inspector-theme-switch" role="group" aria-label="底部面板配色">
              <button class="active" data-inspector-theme="slate" aria-label="蓝灰色面板" title="蓝灰色"><i></i></button>
              <button data-inspector-theme="paper" aria-label="浅色面板" title="浅色"><i></i></button>
              <button data-inspector-theme="signal" aria-label="橙色高对比面板" title="橙色高对比"><i></i></button>
            </div>
          </div>
          <dl class="metrics">
            <div><dt id="metric-x-label">尺寸 X</dt><dd id="size-x">—</dd></div>
            <div><dt id="metric-y-label">尺寸 Y</dt><dd id="size-y">—</dd></div>
            <div><dt id="metric-z-label">尺寸 Z</dt><dd id="size-z">—</dd></div>
            <div><dt id="metric-primary-label">三角面</dt><dd id="triangles">—</dd></div>
            <div><dt id="metric-secondary-label">网格</dt><dd id="mesh-count">—</dd></div>
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
  appShell: document.querySelector<HTMLElement>(".app-shell")!,
  controlPanel: document.querySelector<HTMLElement>(".control-panel")!,
  viewport: document.querySelector<HTMLDivElement>("#viewport")!,
  inspectorBar: document.querySelector<HTMLDivElement>("#inspector-bar")!,
  modelHost: document.querySelector<HTMLDivElement>("#model-viewer")!,
  gcodeCanvas: document.querySelector<HTMLCanvasElement>("#gcode-canvas")!,
  combinedGizmo: document.querySelector<HTMLCanvasElement>("#combined-gizmo")!,
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
  wireframeButton: document.querySelector<HTMLButtonElement>("#wireframe-button")!,
  viewportTools: document.querySelector<HTMLDivElement>("#viewport-tools")!,
  viewportToolEmpty: document.querySelector<HTMLDivElement>("#viewport-tool-empty")!,
  selectionChip: document.querySelector<HTMLDivElement>("#selection-chip")!,
  viewportPartName: document.querySelector<HTMLElement>("#viewport-part-name")!,
  viewportHint: document.querySelector<HTMLDivElement>("#viewport-hint")!,
  snapButton: document.querySelector<HTMLButtonElement>("#snap-button")!,
  partsList: document.querySelector<HTMLDivElement>("#parts-list")!,
  selectedPartLabel: document.querySelector<HTMLElement>("#selected-part-label")!,
  emptyWorkspace: document.querySelector<HTMLDivElement>("#empty-workspace")!,
  transformReadout: document.querySelector<HTMLDivElement>("#transform-readout")!,
  collisionGuardButton: document.querySelector<HTMLButtonElement>("#collision-guard-button")!,
  physicsDropSelectedButton: document.querySelector<HTMLButtonElement>("#physics-drop-selected-button")!,
  physicsDropAllButton: document.querySelector<HTMLButtonElement>("#physics-drop-all-button")!,
  physicsPauseButton: document.querySelector<HTMLButtonElement>("#physics-pause-button")!,
  physicsResetButton: document.querySelector<HTMLButtonElement>("#physics-reset-button")!,
  physicsStatus: document.querySelector<HTMLDivElement>("#physics-status")!,
  metricXLabel: document.querySelector<HTMLElement>("#metric-x-label")!,
  metricYLabel: document.querySelector<HTMLElement>("#metric-y-label")!,
  metricZLabel: document.querySelector<HTMLElement>("#metric-z-label")!,
  metricPrimaryLabel: document.querySelector<HTMLElement>("#metric-primary-label")!,
  metricSecondaryLabel: document.querySelector<HTMLElement>("#metric-secondary-label")!,
};

let currentMode: ViewMode = "model";
let materialPreset: MaterialPreset = "plastic";
let embeddedViewer: EmbeddedViewer;
let gcodePreview: WebGLPreview | undefined;
let gcodeLoaded = false;
let modelRoot: THREE.Object3D | undefined;
let workspaceRoot = new THREE.Group();
let parts: PartRecord[] = [];
let selectedPartId: string | undefined;
let partCounter = 0;
let importQueue: ImportJob[] = [];
let activeImportJob: ImportJob | undefined;
let bedObject: THREE.Group | undefined;
let selectionHelper: THREE.BoxHelper | undefined;
const colorSchemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
let transformSnapEnabled = false;
let directDragging = false;
let gizmoDragging = false;
let gizmoLayout: GizmoLayout | undefined;
let gizmoDrag: GizmoDrag | undefined;
let interactiveTransformFrame = 0;
let gizmoUpdateFrame = 0;
let interactivePixelRatio: number | undefined;
let rapierReady: Promise<void> | undefined;
let rapierApi: RapierApi | undefined;
let physicsWorld: RapierWorld | undefined;
let physicsEventQueue: RapierEventQueue | undefined;
let physicsBindings: PhysicsBinding[] = [];
let physicsSnapshots = new Map<string, TransformSnapshot>();
let physicsFrameId = 0;
let physicsLastTime = 0;
let physicsAccumulator = 0;
let physicsPaused = false;
let physicsCollisionCount = 0;
let physicsStarting = false;
let physicsGeneration = 0;
let collisionGuardEnabled = true;
let editCollisionSession: EditCollisionSession | undefined;
let editQueryWorld: RapierWorld | undefined;
let editQueryBindings = new Map<string, EditQueryBinding>();
let editQueryGeneration = 0;
let editQueryBuilding = false;
let collisionBlockedVisualUntil = 0;
let wireframeEnabled = false;
let toastTimer = 0;

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
  elements.metricXLabel.textContent = "尺寸 X";
  elements.metricYLabel.textContent = "尺寸 Y";
  elements.metricZLabel.textContent = "尺寸 Z";
  elements.metricPrimaryLabel.textContent = "三角面";
  elements.metricSecondaryLabel.textContent = "网格";
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

function updatePartsListSelection(): void {
  elements.partsList.querySelectorAll<HTMLButtonElement>("[data-part-id]").forEach((button) => {
    button.classList.toggle("active", button.dataset.partId === selectedPartId);
  });
}

function activeTransformRoot(): THREE.Object3D | undefined {
  return modelRoot;
}

function updateTransformPanel(): void {
  const part = selectedPart();
  const target = activeTransformRoot();
  const canEdit = currentMode === "model" && Boolean(target) && !physicsWorld && !physicsStarting;
  elements.selectedPartLabel.textContent = part?.name ?? "未选择";
  document.querySelectorAll<HTMLInputElement>("[data-transform]").forEach((input) => {
    const kind = input.dataset.transform as TransformKind;
    input.disabled = !canEdit;
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
      button.disabled = !canEdit;
    });
  document.querySelectorAll<HTMLButtonElement>("#duplicate-part-button, #remove-part-button, #viewport-duplicate-button, #viewport-delete-button")
    .forEach((button) => { button.disabled = !canEdit || !part; });
  document.querySelectorAll<HTMLButtonElement>("[data-material]")
    .forEach((button) => { button.disabled = !canEdit || !part; });
}

function syncTransformControl(): void {
  const isModel = currentMode === "model";
  const target = activeTransformRoot();
  const canEdit = isModel && Boolean(target) && !physicsWorld && !physicsStarting;
  elements.viewportTools.classList.toggle("visible", isModel);
  elements.viewportTools.classList.toggle("inactive", !canEdit);
  elements.viewportToolEmpty.classList.toggle("visible", isModel && !modelRoot);
  elements.viewportTools.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = !canEdit;
  });
  elements.selectionChip.classList.toggle("visible", isModel && Boolean(modelRoot));
  elements.emptyWorkspace.classList.toggle("visible", isModel && !parts.length);
  elements.viewportHint.classList.toggle("with-selection", canEdit);
  const physicsActive = Boolean(physicsWorld || physicsStarting);
  elements.viewportHint.textContent = physicsActive
    ? "物理模拟运行中 · 暂停或恢复位置后继续编辑"
    : `拖动零件移动 · 方块缩放 · 弧形柄旋转 · ${collisionGuardEnabled ? "防穿透已开启" : "防穿透已关闭"}`;
  elements.selectionChip.querySelector("small")!.textContent = physicsActive
    ? "刚体碰撞已开启 · 变换控制暂时锁定"
    : "拖动零件移动 · 方块缩放 · 弧形柄旋转";
  elements.viewportPartName.textContent = selectedPart()?.name ?? "未选择零件";
  updateCombinedGizmo();
}

function refreshSelectionHelper(): void {
  // Selection is drawn by the lightweight 2D gizmo canvas. Keeping a second
  // BoxHelper in the WebGL scene forced a full clear/render on every selection
  // click, which was visible as a flash on larger models.
  if (!selectionHelper) {
    updateCombinedGizmo();
    return;
  }
  selectionHelper.removeFromParent();
  selectionHelper.geometry.dispose();
  (selectionHelper.material as THREE.Material).dispose();
  selectionHelper = undefined;
  updateCombinedGizmo();
}

function updateSelectedPartView(rebuildList = true): void {
  const part = selectedPart();
  modelRoot = part?.root;
  if (rebuildList) renderPartsList();
  else updatePartsListSelection();
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
    elements.fileSubtitle.textContent = "添加 STL、3MF、OBJ 或 STEP 开始";
    elements.sizeX.textContent = "—";
    elements.sizeY.textContent = "—";
    elements.sizeZ.textContent = "—";
    elements.triangles.textContent = "—";
    elements.meshCount.textContent = "—";
  }
  syncTransformControl();
  refreshSelectionHelper();
  syncPhysicsControls();
  if (currentMode !== "model") switchMode("model");
}

function selectPart(partId?: string): void {
  const nextPartId = partId && parts.some((part) => part.id === partId) ? partId : undefined;
  if (nextPartId === selectedPartId) return;
  selectedPartId = nextPartId;
  updateSelectedPartView(false);
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
  updateCombinedGizmo();
}

function updateAfterTransform(): void {
  if (interactiveTransformFrame) {
    window.cancelAnimationFrame(interactiveTransformFrame);
    interactiveTransformFrame = 0;
  }
  const target = activeTransformRoot();
  const part = selectedPart();
  if (!target) return;
  target.updateMatrixWorld(true);
  if (part) setStats(computeModelStats(part.root, part.name, part.fileSize));
  updateTransformPanel();
  embeddedViewer.GetViewer().Render();
  updateCombinedGizmo();
}

function scheduleInteractiveTransformUpdate(): void {
  if (interactiveTransformFrame) return;
  interactiveTransformFrame = window.requestAnimationFrame(() => {
    interactiveTransformFrame = 0;
    const target = activeTransformRoot();
    if (!target) return;
    target.updateMatrixWorld(true);
    // The rotation dial already provides live numeric feedback. Keeping the
    // helper geometry and inspector frozen until pointer-up avoids a second
    // bounding-box traversal on every X/Y rotation frame.
    if (gizmoDrag?.kind !== "rotate") updateTransformPanel();
    embeddedViewer.GetViewer().Render();
    updateCombinedGizmo();
  });
}

function scheduleCombinedGizmoUpdate(): void {
  if (gizmoUpdateFrame) return;
  gizmoUpdateFrame = window.requestAnimationFrame(() => {
    gizmoUpdateFrame = 0;
    updateCombinedGizmo();
  });
}

function setInteractiveRenderQuality(active: boolean): void {
  const renderer = (embeddedViewer.GetViewer() as unknown as { renderer: THREE.WebGLRenderer }).renderer;
  if (active) {
    if (interactivePixelRatio !== undefined) return;
    interactivePixelRatio = renderer.getPixelRatio();
    if (interactivePixelRatio > 1) renderer.setPixelRatio(1);
    return;
  }
  if (interactivePixelRatio === undefined) return;
  renderer.setPixelRatio(interactivePixelRatio);
  interactivePixelRatio = undefined;
}

function hideTransformReadout(): void {
  elements.transformReadout.classList.remove("visible");
}

function toggleTransformSnap(): void {
  transformSnapEnabled = !transformSnapEnabled;
  elements.snapButton.classList.toggle("active", transformSnapEnabled);
  showToast(transformSnapEnabled ? "移动与缩放已吸附：1 mm / 0.1×" : "已关闭移动与缩放吸附");
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
  // Keep the physical plate surface and the logical workplane at Z = 0.
  plate.position.set(center.x, center.y, -1.3);
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

function setPhysicsStatus(state: "idle" | "loading" | "running" | "paused", label: string): void {
  elements.physicsStatus.dataset.state = state;
  elements.physicsStatus.querySelector("span")!.textContent = label;
}

function syncPhysicsControls(): void {
  const hasParts = parts.length > 0;
  const hasSelected = Boolean(selectedPart());
  const active = Boolean(physicsWorld);
  elements.physicsDropSelectedButton.disabled = physicsStarting || !hasSelected;
  elements.physicsDropAllButton.disabled = physicsStarting || !hasParts;
  elements.physicsPauseButton.disabled = !active;
  elements.physicsResetButton.disabled = !active;
  elements.physicsPauseButton.textContent = physicsPaused ? "继续" : "暂停";
  elements.collisionGuardButton.classList.toggle("active", collisionGuardEnabled);
  elements.collisionGuardButton.setAttribute("aria-pressed", String(collisionGuardEnabled));
  elements.collisionGuardButton.textContent = collisionGuardEnabled ? "防穿透：开" : "防穿透：关";
}

function ensureRapierReady(): Promise<void> {
  // Rapier stays out of the initial bundle and is warmed in the background as
  // soon as the first model arrives. Manual editing can then use the same
  // collision engine as free-fall without blocking the first paint.
  rapierReady ??= import("@dimforge/rapier3d-compat").then(async (module: unknown) => {
    const api = module as RapierApi;
    await api.init();
    rapierApi = api;
  });
  return rapierReady;
}

function meshColliderData(mesh: THREE.Mesh, root: THREE.Object3D): { vertices: Float32Array; indices: Uint32Array } | undefined {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position || position.count < 3) return undefined;
  root.updateMatrixWorld(true);
  mesh.updateWorldMatrix(true, false);
  const rootPosition = root.getWorldPosition(new THREE.Vector3());
  const inverseRootQuaternion = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const vertices = new Float32Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index)
      .applyMatrix4(mesh.matrixWorld)
      .sub(rootPosition)
      .applyQuaternion(inverseRootQuaternion);
    vertices[index * 3] = point.x;
    vertices[index * 3 + 1] = point.y;
    vertices[index * 3 + 2] = point.z;
  }
  const sourceIndex = geometry.index;
  const indices = sourceIndex
    ? Uint32Array.from(sourceIndex.array as ArrayLike<number>)
    : Uint32Array.from({ length: position.count }, (_, index) => index);
  return { vertices, indices };
}

function attachPartColliders(
  world: RapierWorld,
  body: RapierRigidBody,
  part: PartRecord,
  dynamic: boolean,
  sensor = false,
): RapierCollider[] {
  const rapier = rapierApi!;
  const created: RapierCollider[] = [];
  part.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const data = meshColliderData(mesh, part.root);
    if (!data) return;
    let desc = dynamic
      ? rapier.ColliderDesc.convexHull(data.vertices)
      : rapier.ColliderDesc.trimesh(data.vertices, data.indices);
    if (!desc) {
      // A planar or otherwise degenerate mesh has no 3D convex hull. Do not
      // silently leave a hole in a multi-mesh part: give that mesh a thin,
      // conservative cuboid in the same root-local coordinate system.
      const bounds = new THREE.Box3();
      const point = new THREE.Vector3();
      for (let index = 0; index < data.vertices.length; index += 3) {
        point.set(data.vertices[index], data.vertices[index + 1], data.vertices[index + 2]);
        bounds.expandByPoint(point);
      }
      if (bounds.isEmpty()) return;
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      desc = rapier.ColliderDesc.cuboid(
        Math.max(0.05, size.x / 2),
        Math.max(0.05, size.y / 2),
        Math.max(0.05, size.z / 2),
      ).setTranslation(center.x, center.y, center.z);
    }
    desc
      .setFriction(0.68)
      .setRestitution(0.1)
      .setDensity(dynamic ? 0.001 : 1)
      .setSensor(sensor)
      .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
    created.push(world.createCollider(desc, body));
  });
  if (created.length) return created;

  // Degenerate or point-only meshes still get a conservative fallback collider.
  const box = new THREE.Box3().setFromObject(part.root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const rootPosition = part.root.getWorldPosition(new THREE.Vector3());
  const inverseRootQuaternion = part.root.getWorldQuaternion(new THREE.Quaternion()).invert();
  center.sub(rootPosition).applyQuaternion(inverseRootQuaternion);
  const fallback = rapier.ColliderDesc.cuboid(
    Math.max(0.05, size.x / 2),
    Math.max(0.05, size.y / 2),
    Math.max(0.05, size.z / 2),
  )
    .setTranslation(center.x, center.y, center.z)
    .setFriction(0.68)
    .setRestitution(0.1)
    .setSensor(sensor)
    .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
  created.push(world.createCollider(fallback, body));
  return created;
}

function computePartLocalBounds(part: PartRecord): THREE.Box3 {
  part.root.updateMatrixWorld(true);
  const inverseRoot = part.root.matrixWorld.clone().invert();
  const meshToRoot = new THREE.Matrix4();
  const localBounds = new THREE.Box3();
  part.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const geometryBounds = mesh.geometry.boundingBox;
    if (!geometryBounds) return;
    mesh.updateWorldMatrix(true, false);
    meshToRoot.multiplyMatrices(inverseRoot, mesh.matrixWorld);
    localBounds.union(geometryBounds.clone().applyMatrix4(meshToRoot));
  });
  return localBounds;
}

function partLocalObb(part: PartRecord): OBB {
  part.collisionLocalObb ??= new OBB().fromBox3(computePartLocalBounds(part));
  return part.collisionLocalObb.clone();
}

function partWorldObb(part: PartRecord): OBB {
  part.root.updateMatrixWorld(true);
  return partLocalObb(part).applyMatrix4(part.root.matrixWorld);
}

function attachEditProxyCollider(
  world: RapierWorld,
  body: RapierRigidBody,
  part: PartRecord,
  sensor: boolean,
): RapierCollider[] {
  // High-detail convex hulls make near-contact pointer movement scale with the
  // source triangle count. Editing uses one conservative, root-local cuboid
  // proxy per part; free-fall keeps the detailed convex/trimesh colliders.
  const localBounds = computePartLocalBounds(part);
  if (localBounds.isEmpty()) return attachPartColliders(world, body, part, true, sensor);
  const scaledBounds = localBounds.clone().applyMatrix4(new THREE.Matrix4().makeScale(
    part.root.scale.x,
    part.root.scale.y,
    part.root.scale.z,
  ));
  const size = scaledBounds.getSize(new THREE.Vector3());
  const center = scaledBounds.getCenter(new THREE.Vector3());
  const collider = rapierApi!.ColliderDesc.cuboid(
    Math.max(0.05, size.x / 2),
    Math.max(0.05, size.y / 2),
    Math.max(0.05, size.z / 2),
  )
    .setTranslation(center.x, center.y, center.z)
    .setFriction(0.68)
    .setRestitution(0.1)
    .setSensor(sensor)
    .setActiveEvents(rapierApi!.ActiveEvents.COLLISION_EVENTS);
  return [world.createCollider(collider, body)];
}

function clearEditQueryWorld(): void {
  editQueryGeneration += 1;
  editCollisionSession = undefined;
  editQueryWorld?.free();
  editQueryWorld = undefined;
  editQueryBindings.clear();
  editQueryBuilding = false;
}

async function rebuildEditQueryWorld(force = true): Promise<void> {
  if (editQueryBuilding && !force) return;
  clearEditQueryWorld();
  if (!collisionGuardEnabled || parts.length < 2) return;
  const generation = editQueryGeneration;
  editQueryBuilding = true;
  const partSnapshot = [...parts];
  if (!physicsWorld && !physicsStarting) setPhysicsStatus("loading", "正在构建编辑碰撞索引…");
  try {
    await ensureRapierReady();
    if (generation !== editQueryGeneration || partSnapshot.some((part) => !parts.includes(part))) return;
    const rapier = rapierApi!;
    const world = new rapier.World({ x: 0, y: 0, z: 0 });
    const bindings = new Map<string, EditQueryBinding>();
    for (const part of partSnapshot) {
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.fixed()
          .setTranslation(part.root.position.x, part.root.position.y, part.root.position.z)
          .setRotation({
            x: part.root.quaternion.x,
            y: part.root.quaternion.y,
            z: part.root.quaternion.z,
            w: part.root.quaternion.w,
          }),
      );
      const colliders = attachEditProxyCollider(world, body, part, false);
      bindings.set(part.id, {
        body,
        colliders,
      });
    }
    world.step();
    // Warm the collider-pair GJK/TOI and overlap paths before the index is
    // marked ready, keeping one-time WASM work away from pointer events.
    for (const part of partSnapshot) {
      const binding = bindings.get(part.id)!;
      const warmTarget = partSnapshot.find((other) => other.id !== part.id);
      const targetBinding = warmTarget ? bindings.get(warmTarget.id) : undefined;
      const warmVelocity = warmTarget
        ? warmTarget.root.position.clone().sub(part.root.position)
        : new THREE.Vector3(0.001, 0, 0);
      for (const collider of binding.colliders) {
        for (const obstacle of targetBinding?.colliders ?? []) {
          collider.castCollider(
          { x: warmVelocity.x, y: warmVelocity.y, z: warmVelocity.z },
            obstacle,
            { x: 0, y: 0, z: 0 },
          0.05,
          1,
          true,
          );
          collider.contactCollider(obstacle, 0);
        }
      }
    }
    if (generation !== editQueryGeneration) {
      world.free();
      return;
    }
    editQueryWorld = world;
    editQueryBindings = bindings;
    editQueryBuilding = false;
    if (!physicsWorld && !physicsStarting) setPhysicsStatus("idle", "编辑防穿透已就绪");
  } catch (error) {
    if (generation !== editQueryGeneration) return;
    editQueryBuilding = false;
    console.error("Edit collision index failed", error);
    if (!physicsWorld && !physicsStarting) setPhysicsStatus("idle", "编辑碰撞索引不可用");
  }
}

function syncEditQueryPart(part: PartRecord): void {
  const binding = editQueryBindings.get(part.id);
  if (!editQueryWorld || !binding) return;
  binding.body.setTranslation({
    x: part.root.position.x,
    y: part.root.position.y,
    z: part.root.position.z,
  }, false);
  binding.body.setRotation({
    x: part.root.quaternion.x,
    y: part.root.quaternion.y,
    z: part.root.quaternion.z,
    w: part.root.quaternion.w,
  }, false);
  editQueryWorld.propagateModifiedBodyPositionsToColliders();
  editQueryWorld.step();
}

function disposeEditCollisionSession(): void {
  if (editCollisionSession) syncEditQueryPart(editCollisionSession.part);
  editCollisionSession = undefined;
}

function createEditCollisionSession(part: PartRecord, requireRapier = false): EditCollisionSession | undefined {
  const binding = editQueryBindings.get(part.id);
  if (!collisionGuardEnabled || physicsWorld || physicsStarting) return undefined;
  if (requireRapier && (!editQueryWorld || !binding)) return undefined;
  disposeEditCollisionSession();
  editCollisionSession = {
    world: editQueryWorld,
    body: binding?.body,
    colliders: binding?.colliders ?? [],
    obstacleColliders: [...editQueryBindings.entries()]
      .filter(([partId]) => partId !== part.id)
      .flatMap(([, other]) => other.colliders),
    part,
    acceptedPosition: part.root.position.clone(),
    acceptedQuaternion: part.root.quaternion.clone(),
    acceptedScale: part.root.scale.clone(),
    relativeAfterContact: false,
    lastRequestedPosition: part.root.position.clone(),
    selectedLocalObb: partLocalObb(part),
    obstacleObbs: parts.filter((other) => other.id !== part.id).map(partWorldObb),
  };
  return editCollisionSession;
}

function prepareEditCollision(part: PartRecord, detailed = false): boolean {
  if (!collisionGuardEnabled || parts.length < 2) return true;
  if (detailed && (!editQueryWorld || !editQueryBindings.has(part.id))) {
    void rebuildEditQueryWorld(false);
    showToast("碰撞索引正在准备，请稍后再拖动");
    return false;
  }
  createEditCollisionSession(part, detailed);
  return true;
}

function showCollisionBlocked(): void {
  collisionBlockedVisualUntil = performance.now() + 180;
  scheduleCombinedGizmoUpdate();
}

function editShapeOverlaps(
  session: EditCollisionSession,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
): boolean {
  if (!session.world || !session.body) return false;
  session.body.setTranslation({ x: position.x, y: position.y, z: position.z }, false);
  session.body.setRotation({
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  }, false);
  session.world.propagateModifiedBodyPositionsToColliders();
  return session.colliders.some((collider) => session.obstacleColliders.some((obstacle) => (
    collider.contactCollider(obstacle, 0) !== null
  )));
}

function validateEditTransform(sweepPath = false): boolean {
  const session = editCollisionSession;
  if (!session || session.part.id !== selectedPartId) return true;
  const root = session.part.root;
  const scaleChanged = !root.scale.equals(session.acceptedScale);
  const requestedPosition = root.position.clone();
  const pointerDelta = requestedPosition.clone().sub(session.lastRequestedPosition);
  session.lastRequestedPosition.copy(requestedPosition);
  let proposedPosition = requestedPosition.clone();
  const proposedQuaternion = root.quaternion.clone();
  const proposedScale = root.scale.clone();
  const startPosition = session.acceptedPosition.clone();
  const startQuaternion = session.acceptedQuaternion.clone();
  const rotationChanged = !proposedQuaternion.equals(startQuaternion);
  let movement = proposedPosition.clone().sub(startPosition);
  let distance = movement.length();
  let safeProgress = 1;
  let keepContactConstraint = false;

  if (!sweepPath && session.relativeAfterContact) {
    // The drag projection keeps reporting an absolute pointer target even after
    // we clamp the object at contact. Stay on adjacent pointer deltas for the
    // rest of this drag; returning to the stale absolute target on the frame
    // after an outward move causes an alternating move/block/move stutter.
    const constrainedDelta = pointerDelta.clone();
    let rejectedInwardMotion = false;
    if (session.blockedDirection && pointerDelta.lengthSq() > 1e-10) {
      const inwardDistance = pointerDelta.dot(session.blockedDirection);
      if (inwardDistance > 0) {
        constrainedDelta.addScaledVector(session.blockedDirection, -inwardDistance);
        keepContactConstraint = true;
        rejectedInwardMotion = true;
      } else if (inwardDistance < -1e-5) {
        session.blockedDirection = undefined;
      } else {
        keepContactConstraint = true;
      }
    }

    if (constrainedDelta.lengthSq() <= 1e-10) {
      root.position.copy(startPosition);
      root.quaternion.copy(startQuaternion);
      if (rejectedInwardMotion) {
        showCollisionBlocked();
        return false;
      }
      if (!rotationChanged) return true;
    }

    proposedPosition = startPosition.clone().add(constrainedDelta);
    movement = proposedPosition.clone().sub(startPosition);
    distance = movement.length();
  }

  if (!sweepPath) {
    // Follow the pointer all the way to its requested pose. To prevent a sparse
    // pointer event from tunnelling through a thin part, test intermediate SAT
    // poses instead of limiting the accepted movement to 2.5 mm per event.
    // The old clamp made the object visibly chase behind a fast pointer.
    const maxSweepStep = 2.5;
    const sweepSteps = distance > 1e-5 ? Math.max(1, Math.ceil(distance / maxSweepStep)) : 1;
    const samplePosition = new THREE.Vector3();
    const sampleMatrix = new THREE.Matrix4();
    const selectedObb = session.selectedLocalObb.clone();
    let safeProgress = 0;
    let blocked = scaleChanged;
    if (!blocked) {
      for (let step = 1; step <= sweepSteps; step += 1) {
        const progress = step / sweepSteps;
        samplePosition.copy(startPosition).lerp(proposedPosition, progress);
        sampleMatrix.compose(samplePosition, proposedQuaternion, root.scale);
        selectedObb.copy(session.selectedLocalObb).applyMatrix4(sampleMatrix);
        if (session.obstacleObbs.some((obstacle) => selectedObb.intersectsOBB(obstacle, 1e-6))) {
          blocked = true;
          break;
        }
        safeProgress = progress;
      }
    }
    if (blocked) {
      if (distance > 1e-5 && !keepContactConstraint) session.blockedDirection = movement.clone().normalize();
      session.relativeAfterContact = true;
      root.position.copy(startPosition).lerp(proposedPosition, safeProgress);
      root.quaternion.copy(startQuaternion);
      if (scaleChanged) root.scale.copy(session.acceptedScale);
      session.acceptedPosition.copy(root.position);
      showCollisionBlocked();
      return false;
    }
    root.position.copy(proposedPosition);
    root.quaternion.copy(proposedQuaternion);
    session.acceptedPosition.copy(proposedPosition);
    session.acceptedQuaternion.copy(proposedQuaternion);
    session.acceptedScale.copy(proposedScale);
    if (!keepContactConstraint) session.blockedDirection = undefined;
    collisionBlockedVisualUntil = 0;
    return true;
  }

  if (!session.world || !session.body) {
    root.position.copy(startPosition);
    root.quaternion.copy(startQuaternion);
    root.updateMatrixWorld(true);
    return false;
  }

  if (distance > 1e-5) {
    session.body.setTranslation({
      x: startPosition.x,
      y: startPosition.y,
      z: startPosition.z,
    }, false);
    session.body.setRotation({
      x: startQuaternion.x,
      y: startQuaternion.y,
      z: startQuaternion.z,
      w: startQuaternion.w,
    }, false);
    session.world.propagateModifiedBodyPositionsToColliders();
    for (const collider of session.colliders) {
      for (const obstacle of session.obstacleColliders) {
        // Rapier's native collider-pair cast performs convex GJK/TOI directly
        // on the cached obstacle collider pairs for this low-frequency path.
        const hit = collider.castCollider(
          { x: movement.x, y: movement.y, z: movement.z },
          obstacle,
          { x: 0, y: 0, z: 0 },
          0.05,
          1,
          true,
        );
        if (hit) safeProgress = Math.min(safeProgress, Math.max(0, hit.time_of_impact - 0.002));
      }
    }
  }

  let safePosition = startPosition.clone().lerp(proposedPosition, safeProgress);
  let safeQuaternion = startQuaternion.clone().slerp(proposedQuaternion, safeProgress);
  let blocked = safeProgress < 1 || scaleChanged;

  if (!blocked && editShapeOverlaps(session, safePosition, safeQuaternion)) {
    blocked = true;
    // Shape casts are linear. For pure/angular transforms, use Rapier's native
    // overlap query with a short binary search to keep the last safe angle.
    let low = 0;
    let high = safeProgress;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const middle = (low + high) / 2;
      const position = startPosition.clone().lerp(proposedPosition, middle);
      const quaternion = startQuaternion.clone().slerp(proposedQuaternion, middle);
      if (editShapeOverlaps(session, position, quaternion)) high = middle;
      else low = middle;
    }
    safeProgress = Math.max(0, low - 0.002);
    safePosition = startPosition.clone().lerp(proposedPosition, safeProgress);
    safeQuaternion = startQuaternion.clone().slerp(proposedQuaternion, safeProgress);
  }

  if (blocked) {
    if (safeProgress < 1 && distance > 1e-5) session.blockedDirection = movement.clone().normalize();
    root.position.copy(safePosition);
    root.quaternion.copy(safeQuaternion);
    if (scaleChanged) root.scale.copy(session.acceptedScale);
    session.acceptedPosition.copy(safePosition);
    session.acceptedQuaternion.copy(safeQuaternion);
    root.updateMatrixWorld(true);
    showCollisionBlocked();
    return false;
  }

  session.acceptedPosition.copy(proposedPosition);
  session.acceptedQuaternion.copy(proposedQuaternion);
  session.acceptedScale.copy(proposedScale);
  session.blockedDirection = undefined;
  collisionBlockedVisualUntil = 0;
  return true;
}

function updatePhysicsScene(): void {
  for (const binding of physicsBindings) {
    if (!binding.dynamic) continue;
    const translation = binding.body.translation();
    const rotation = binding.body.rotation();
    binding.part.root.position.set(translation.x, translation.y, translation.z);
    binding.part.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    binding.part.root.updateMatrixWorld(true);
  }
  embeddedViewer.GetViewer().Render();
}

function physicsFrame(now: number): void {
  if (!physicsWorld || physicsPaused) return;
  if (!physicsLastTime) physicsLastTime = now;
  physicsAccumulator += Math.min(0.05, (now - physicsLastTime) / 1000);
  physicsLastTime = now;
  const step = 1 / 60;
  let iterations = 0;
  while (physicsAccumulator >= step && iterations < 4) {
    physicsWorld.timestep = step;
    physicsWorld.step(physicsEventQueue);
    physicsEventQueue?.drainCollisionEvents((_first, _second, started) => {
      if (started) physicsCollisionCount += 1;
    });
    physicsAccumulator -= step;
    iterations += 1;
  }
  updatePhysicsScene();
  setPhysicsStatus("running", `物理运行中 · 碰撞 ${physicsCollisionCount}`);
  physicsFrameId = window.requestAnimationFrame(physicsFrame);
}

function stopPhysics(restore = true, render = true): void {
  physicsGeneration += 1;
  physicsStarting = false;
  if (physicsFrameId) window.cancelAnimationFrame(physicsFrameId);
  physicsFrameId = 0;
  if (restore) {
    for (const part of parts) {
      const snapshot = physicsSnapshots.get(part.id);
      if (!snapshot) continue;
      part.root.position.copy(snapshot.position);
      part.root.quaternion.copy(snapshot.quaternion);
      part.root.updateMatrixWorld(true);
    }
  }
  physicsWorld?.free();
  physicsEventQueue?.free();
  physicsWorld = undefined;
  physicsEventQueue = undefined;
  physicsBindings = [];
  physicsSnapshots.clear();
  physicsPaused = false;
  physicsCollisionCount = 0;
  physicsAccumulator = 0;
  physicsLastTime = 0;
  setPhysicsStatus("idle", "物理未启动");
  syncPhysicsControls();
  updateTransformPanel();
  syncTransformControl();
  if (render && embeddedViewer) {
    refreshSelectionHelper();
    updateAfterTransform();
  }
}

async function startPhysics(mode: PhysicsMode): Promise<void> {
  const activePart = selectedPart();
  if (!parts.length || (mode === "selected" && !activePart)) return;
  if (physicsWorld) stopPhysics(true, false);
  const generation = ++physicsGeneration;
  physicsStarting = true;
  setPhysicsStatus("loading", "正在构建碰撞体…");
  syncPhysicsControls();
  updateTransformPanel();
  syncTransformControl();
  try {
    await ensureRapierReady();
    if (generation !== physicsGeneration) return;
    const rapier = rapierApi!;
    physicsSnapshots = new Map(parts.map((part) => [part.id, {
      position: part.root.position.clone(),
      quaternion: part.root.quaternion.clone(),
    }]));
    const world = new rapier.World({ x: 0, y: 0, z: -450 });
    world.maxCcdSubsteps = 4;
    const eventQueue = new rapier.EventQueue(true);
    physicsWorld = world;
    physicsEventQueue = eventQueue;
    physicsBindings = [];

    const bed = bedObject?.userData.bed as { center: THREE.Vector3; width: number; depth: number } | undefined;
    if (bed) {
      const ground = world.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(bed.center.x, bed.center.y, -1.3),
      );
      world.createCollider(
        rapier.ColliderDesc.cuboid(bed.width / 2, bed.depth / 2, 1.3)
          .setFriction(0.82)
          .setRestitution(0.05)
          .setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS),
        ground,
      );
    }

    const partBoxes = new Map(parts.map((part) => [part.id, new THREE.Box3().setFromObject(part.root)]));
    const sceneTop = Math.max(0, ...[...partBoxes.values()].map((box) => box.max.z));
    let nextSpawnBottom = sceneTop + 30;
    for (const part of parts) {
      const dynamic = mode === "all" || part.id === activePart?.id;
      const box = partBoxes.get(part.id)!;
      const height = box.getSize(new THREE.Vector3()).z;
      let raise = 0;
      if (dynamic && mode === "all") {
        // Spawn every body in its own non-overlapping vertical interval. CCD
        // prevents motion-time tunnelling, but it cannot repair bodies that
        // already overlap when the simulation starts.
        raise = nextSpawnBottom - box.min.z;
        nextSpawnBottom += height + Math.max(14, Math.min(32, height * 0.2));
      } else if (dynamic) {
        const obstacleTop = Math.max(
          0,
          ...parts
            .filter((other) => other.id !== part.id)
            .map((other) => partBoxes.get(other.id)!.max.z),
        );
        const clearOtherParts = obstacleTop + Math.max(14, Math.min(32, height * 0.2)) - box.min.z;
        raise = Math.max(38, height * 0.55, clearOtherParts);
      }
      const bodyDesc = dynamic ? rapier.RigidBodyDesc.dynamic() : rapier.RigidBodyDesc.fixed();
      bodyDesc
        .setTranslation(part.root.position.x, part.root.position.y, part.root.position.z + raise)
        .setRotation({
          x: part.root.quaternion.x,
          y: part.root.quaternion.y,
          z: part.root.quaternion.z,
          w: part.root.quaternion.w,
        });
      if (dynamic) {
        bodyDesc
          .setCcdEnabled(true)
          .setSoftCcdPrediction(Math.max(2, Math.min(16, height * 0.25)))
          .setAdditionalSolverIterations(4)
          .setLinearDamping(0.18)
          .setAngularDamping(0.32)
          .setCanSleep(true);
      }
      const body = world.createRigidBody(bodyDesc);
      attachPartColliders(world, body, part, dynamic);
      physicsBindings.push({ part, body, dynamic });
    }

    physicsStarting = false;
    physicsPaused = false;
    physicsCollisionCount = 0;
    physicsAccumulator = 0;
    physicsLastTime = 0;
    syncPhysicsControls();
    updateTransformPanel();
    syncTransformControl();
    updatePhysicsScene();
    setPhysicsStatus("running", mode === "selected" ? "选中项自由下落 · 碰撞 0" : "全部自由落体 · 碰撞 0");
    physicsFrameId = window.requestAnimationFrame(physicsFrame);
  } catch (error) {
    if (generation !== physicsGeneration) return;
    console.error("Physics initialization failed", error);
    stopPhysics(true, false);
    showToast("无法启动物理模拟", true);
  }
}

function togglePhysicsPause(): void {
  if (!physicsWorld) return;
  physicsPaused = !physicsPaused;
  if (physicsPaused) {
    if (physicsFrameId) window.cancelAnimationFrame(physicsFrameId);
    physicsFrameId = 0;
    setPhysicsStatus("paused", `已暂停 · 碰撞 ${physicsCollisionCount}`);
  } else {
    physicsBindings.forEach((binding) => binding.body.wakeUp());
    physicsLastTime = 0;
    setPhysicsStatus("running", `物理运行中 · 碰撞 ${physicsCollisionCount}`);
    physicsFrameId = window.requestAnimationFrame(physicsFrame);
  }
  syncPhysicsControls();
  updateTransformPanel();
}

function rebuildWorkspace(fitView = true): void {
  const viewer = embeddedViewer.GetViewer();
  workspaceRoot = new THREE.Group();
  workspaceRoot.name = "print-workspace";
  for (const part of parts) workspaceRoot.add(part.root);
  viewer.SetMainObject(workspaceRoot);
  viewer.SetUpVector(Direction.Z, false);

  viewer.ClearExtra();
  if (bedObject) disposeObject(bedObject);
  if (parts.length) {
    const workspaceBox = new THREE.Box3().setFromObject(workspaceRoot);
    bedObject = createBed(workspaceBox);
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
  if (physicsWorld || physicsStarting) stopPhysics(true, false);
  activeImportJob = importQueue.shift();
  showLoading(true);
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
    rebuildWorkspace();
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
  part.collisionLocalObb = new OBB().fromBox3(computePartLocalBounds(part));
  applyMaterial(part.root, part.material);
  parts.push(part);
  selectedPartId = part.id;
  document.querySelector<HTMLButtonElement>("#gcode-demo-button")?.classList.remove("active");
  activeImportJob = undefined;

  if (importQueue.length) {
    // Online3DViewer is not re-entrant: starting the next import from inside
    // its completion callback can leave the second model permanently pending.
    window.setTimeout(processImportQueue, 0);
    return;
  }
  showLoading(false);
  rebuildWorkspace();
  clearEditQueryWorld();
  showToast(`已添加 ${part.name}，当前共 ${parts.length} 个零件`);
}

function onModelLoadFailed(): void {
  const failedName = activeImportJob?.name;
  activeImportJob = undefined;
  if (importQueue.length) window.setTimeout(processImportQueue, 0);
  else {
    showLoading(false);
    rebuildWorkspace();
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
  initCombinedGizmo();
  installViewportSelection();
}

function projectSelectedBounds(): GizmoLayout | undefined {
  const target = activeTransformRoot();
  if (!target || currentMode !== "model" || !embeddedViewer || physicsWorld || physicsStarting) return undefined;
  const viewer = embeddedViewer.GetViewer();
  const camera = viewer.camera as THREE.Camera;
  const rect = elements.viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return undefined;
  target.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) return undefined;
  const points = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ].map((point) => point.project(camera));
  const rawLeft = (Math.min(...points.map((point) => point.x)) + 1) * rect.width / 2;
  const rawRight = (Math.max(...points.map((point) => point.x)) + 1) * rect.width / 2;
  const rawTop = (1 - Math.max(...points.map((point) => point.y))) * rect.height / 2;
  const rawBottom = (1 - Math.min(...points.map((point) => point.y))) * rect.height / 2;
  // Keep every handle reachable even when part of a large model is outside the camera crop.
  const left = Math.max(44, rawLeft);
  const right = Math.min(rect.width - 44, rawRight);
  const top = Math.max(88, rawTop);
  const bottom = Math.min(rect.height - 30, rawBottom);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const scaleHandles: Array<Point2 & { id: ScaleHandleId }> = [
    { id: "nw", x: left, y: top },
    { id: "n", x: center.x, y: top },
    { id: "ne", x: right, y: top },
    { id: "e", x: right, y: center.y },
    { id: "se", x: right, y: bottom },
    { id: "s", x: center.x, y: bottom },
    { id: "sw", x: left, y: bottom },
    { id: "w", x: left, y: center.y },
  ];
  const ringRadius = Math.min(280, Math.max(92, Math.max(right - left, bottom - top) / 2 + 42));
  return {
    bounds: { left, top, right, bottom },
    center,
    scaleHandles,
    rotationHandles: [
      { axis: "z", x: center.x - 52, y: top - 48 },
      { axis: "x", x: right + 32, y: center.y - 22 },
      { axis: "y", x: left - 32, y: center.y + 22 },
    ],
    lift: { x: center.x, y: top - 54 },
    ringRadius,
  };
}

function drawRotationHandle(
  context: CanvasRenderingContext2D,
  handle: Point2 & { axis: Axis },
  active: boolean,
): void {
  const colors: Record<Axis, string> = { x: "#ff665c", y: "#48a868", z: "#3977d6" };
  context.save();
  context.translate(handle.x, handle.y);
  context.lineWidth = active ? 3 : 2.2;
  context.strokeStyle = colors[handle.axis];
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.beginPath();
  context.arc(0, 0, 16, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(40, 45, 47, 0.18)";
  context.stroke();
  context.strokeStyle = colors[handle.axis];
  context.beginPath();
  context.arc(0, 1, 8.5, -Math.PI * 0.85, Math.PI * 0.52);
  context.stroke();
  context.beginPath();
  context.moveTo(7, 4);
  context.lineTo(11, 4);
  context.lineTo(9, 8);
  context.closePath();
  context.fillStyle = colors[handle.axis];
  context.fill();
  context.font = "600 8px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(handle.axis.toUpperCase(), 0, 3);
  context.restore();
}

function drawRotationRing(context: CanvasRenderingContext2D, layout: GizmoLayout, drag: Extract<GizmoDrag, { kind: "rotate" }>): void {
  const { center, ringRadius } = layout;
  context.save();
  context.fillStyle = "rgba(33, 199, 217, 0.18)";
  context.strokeStyle = "rgba(33, 199, 217, 0.8)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(center.x, center.y, ringRadius + 28, 0, Math.PI * 2);
  context.arc(center.x, center.y, ringRadius + 5, 0, Math.PI * 2, true);
  context.fill();
  context.stroke();
  context.fillStyle = "rgba(255, 255, 255, 0.64)";
  context.beginPath();
  context.arc(center.x, center.y, ringRadius, 0, Math.PI * 2);
  context.arc(center.x, center.y, ringRadius - 28, 0, Math.PI * 2, true);
  context.fill();
  context.strokeStyle = "rgba(33, 199, 217, 0.72)";
  context.stroke();
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    const inner = ringRadius - (index % 2 === 0 ? 28 : 21);
    context.beginPath();
    context.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
    context.lineTo(center.x + Math.cos(angle) * ringRadius, center.y + Math.sin(angle) * ringRadius);
    context.stroke();
  }
  const target = activeTransformRoot();
  const current = target ? target.rotation[drag.axis] : 0;
  const pointerAngle = current - Math.PI / 2;
  context.strokeStyle = drag.mode === "fixed" ? "#ff8a55" : "#ff5a1f";
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(center.x, center.y);
  context.lineTo(
    center.x + Math.cos(pointerAngle) * (ringRadius + 30),
    center.y + Math.sin(pointerAngle) * (ringRadius + 30),
  );
  context.stroke();
  context.restore();
}

function updateCombinedGizmo(): void {
  const canvas = elements.combinedGizmo;
  const rect = elements.viewport.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  // X/Y rotation changes the projected box dramatically. Keep the dial fixed
  // under the pointer for the duration of a rotation drag, then reproject once.
  if (!(gizmoDrag?.kind === "rotate" && gizmoLayout)) gizmoLayout = projectSelectedBounds();
  if (!gizmoLayout) {
    canvas.dataset.handles = "";
    canvas.classList.remove("visible");
    return;
  }
  canvas.classList.add("visible");
  const { bounds, center, scaleHandles, rotationHandles, lift } = gizmoLayout;
  canvas.dataset.handles = JSON.stringify({ bounds, center, scaleHandles, rotationHandles, lift, ringRadius: gizmoLayout.ringRadius });
  canvas.dataset.dragging = gizmoDrag?.kind ?? "";
  canvas.dataset.rotationMode = gizmoDrag?.kind === "rotate" ? gizmoDrag.mode : "";

  context.save();
  context.strokeStyle = "#21c7d9";
  context.lineWidth = 2;
  context.setLineDash([]);
  context.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  context.setLineDash([4, 4]);
  context.strokeStyle = "rgba(33, 199, 217, 0.78)";
  context.beginPath();
  context.moveTo(center.x, bounds.top);
  context.lineTo(lift.x, lift.y - 19);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#2f3537";
  context.beginPath();
  context.moveTo(lift.x, lift.y - 29);
  context.lineTo(lift.x - 8, lift.y - 13);
  context.lineTo(lift.x + 8, lift.y - 13);
  context.closePath();
  context.fill();
  context.fillStyle = "#ffffff";
  context.strokeStyle = "#2f3537";
  context.lineWidth = 2;
  context.fillRect(lift.x - 6, lift.y - 6, 12, 12);
  context.strokeRect(lift.x - 6, lift.y - 6, 12, 12);
  for (const handle of scaleHandles) {
    const side = ["n", "e", "s", "w"].includes(handle.id) ? 11 : 13;
    context.fillStyle = "rgba(255, 255, 255, 0.96)";
    context.strokeStyle = "#303638";
    context.lineWidth = 2;
    context.fillRect(handle.x - side / 2, handle.y - side / 2, side, side);
    context.strokeRect(handle.x - side / 2, handle.y - side / 2, side, side);
  }
  const activeAxis = gizmoDrag?.kind === "rotate" ? gizmoDrag.axis : undefined;
  rotationHandles.forEach((handle) => drawRotationHandle(context, handle, handle.axis === activeAxis));
  if (gizmoDrag?.kind === "rotate") drawRotationRing(context, gizmoLayout, gizmoDrag);
  if (performance.now() < collisionBlockedVisualUntil) {
    context.strokeStyle = "#d4543d";
    context.lineWidth = 3;
    context.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  }
  context.restore();
}

function setTransformReadout(clientX: number, clientY: number, text: string): void {
  const rect = elements.viewport.getBoundingClientRect();
  const left = Math.min(Math.max(clientX - rect.left + 16, 12), rect.width - 150);
  const top = Math.min(Math.max(clientY - rect.top - 44, 12), rect.height - 44);
  elements.transformReadout.textContent = text;
  elements.transformReadout.style.left = `${left}px`;
  elements.transformReadout.style.top = `${top}px`;
  elements.transformReadout.classList.add("visible");
}

function normalizeAngleDelta(angle: number): number {
  let normalized = angle;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  while (normalized < -Math.PI) normalized += Math.PI * 2;
  return normalized;
}

function hitGizmoHandle(point: Point2):
  | { kind: "scale"; handle: ScaleHandleId }
  | { kind: "lift" }
  | { kind: "rotate"; axis: Axis }
  | undefined {
  if (!gizmoLayout) return undefined;
  if (Math.hypot(point.x - gizmoLayout.lift.x, point.y - gizmoLayout.lift.y) <= 15) return { kind: "lift" };
  const rotation = gizmoLayout.rotationHandles.find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= 20);
  if (rotation) return { kind: "rotate", axis: rotation.axis };
  const scale = gizmoLayout.scaleHandles.find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= 15);
  return scale ? { kind: "scale", handle: scale.id } : undefined;
}

function projectedPixelsPerWorldZ(): number {
  const target = activeTransformRoot();
  if (!target) return 1;
  const camera = embeddedViewer.GetViewer().camera as THREE.Camera;
  const rect = elements.viewport.getBoundingClientRect();
  const center = new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());
  const base = center.clone().project(camera);
  const raised = center.clone().add(new THREE.Vector3(0, 0, 10)).project(camera);
  return Math.max(0.1, Math.abs(raised.y - base.y) * rect.height / 20);
}

function initCombinedGizmo(): void {
  const viewport = elements.viewport;
  const toLocal = (event: PointerEvent): Point2 => {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || currentMode !== "model" || !activeTransformRoot() || physicsWorld || physicsStarting) return;
    updateCombinedGizmo();
    const point = toLocal(event);
    const hit = hitGizmoHandle(point);
    if (!hit || !gizmoLayout) return;
    const target = activeTransformRoot()!;
    const part = selectedPart();
    if (hit.kind !== "scale" && part && !prepareEditCollision(part)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (hit.kind === "scale") {
      gizmoDrag = {
        kind: "scale",
        id: event.pointerId,
        handle: hit.handle,
        center: { ...gizmoLayout.center },
        startPointer: point,
        startScale: target.scale.clone(),
      };
    } else if (hit.kind === "lift") {
      gizmoDrag = {
        kind: "lift",
        id: event.pointerId,
        startY: point.y,
        startZ: target.position.z,
        pixelsPerUnit: projectedPixelsPerWorldZ(),
      };
    } else {
      gizmoDrag = {
        kind: "rotate",
        id: event.pointerId,
        axis: hit.axis,
        center: { ...gizmoLayout.center },
        lastPointerAngle: Math.atan2(point.y - gizmoLayout.center.y, point.x - gizmoLayout.center.x),
        accumulatedAngle: 0,
        startRotation: target.rotation[hit.axis],
        mode: "fixed",
      };
    }
    gizmoDragging = true;
    setInteractiveRenderQuality(true);
    viewport.dataset.gizmoPointer = "down";
    viewport.dataset.gizmoAxis = hit.kind === "rotate" ? hit.axis : hit.kind;
    viewport.classList.add("gizmo-dragging");
    viewport.setPointerCapture?.(event.pointerId);
    updateCombinedGizmo();
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  viewport.addEventListener("pointermove", (event) => {
    if (!gizmoDrag || gizmoDrag.id !== event.pointerId) return;
    const target = activeTransformRoot();
    if (!target) return;
    const point = toLocal(event);
    if (gizmoDrag.kind === "scale") {
      const horizontal = Math.max(8, Math.abs(gizmoDrag.startPointer.x - gizmoDrag.center.x));
      const vertical = Math.max(8, Math.abs(gizmoDrag.startPointer.y - gizmoDrag.center.y));
      const radial = Math.max(8, Math.hypot(
        gizmoDrag.startPointer.x - gizmoDrag.center.x,
        gizmoDrag.startPointer.y - gizmoDrag.center.y,
      ));
      const isHorizontal = gizmoDrag.handle === "e" || gizmoDrag.handle === "w";
      const isVertical = gizmoDrag.handle === "n" || gizmoDrag.handle === "s";
      let factor = isHorizontal
        ? Math.abs(point.x - gizmoDrag.center.x) / horizontal
        : isVertical
          ? Math.abs(point.y - gizmoDrag.center.y) / vertical
          : Math.hypot(point.x - gizmoDrag.center.x, point.y - gizmoDrag.center.y) / radial;
      factor = Math.max(0.05, factor);
      if (transformSnapEnabled) factor = Math.max(0.05, Math.round(factor * 10) / 10);
      if (isHorizontal) target.scale.x = Math.max(0.05, gizmoDrag.startScale.x * factor);
      else if (isVertical) target.scale.y = Math.max(0.05, gizmoDrag.startScale.y * factor);
      else target.scale.copy(gizmoDrag.startScale).multiplyScalar(factor);
      const label = isHorizontal ? "X" : isVertical ? "Y" : "等比";
      setTransformReadout(event.clientX, event.clientY, `${label}  ${factor.toFixed(2)}×`);
    } else if (gizmoDrag.kind === "lift") {
      let z = gizmoDrag.startZ + (gizmoDrag.startY - point.y) / gizmoDrag.pixelsPerUnit;
      if (transformSnapEnabled) z = Math.round(z);
      target.position.z = z;
      setTransformReadout(event.clientX, event.clientY, `Z  ${z.toFixed(1)} mm`);
    } else {
      const pointerAngle = Math.atan2(point.y - gizmoDrag.center.y, point.x - gizmoDrag.center.x);
      gizmoDrag.accumulatedAngle += normalizeAngleDelta(pointerAngle - gizmoDrag.lastPointerAngle);
      gizmoDrag.lastPointerAngle = pointerAngle;
      const radius = Math.hypot(point.x - gizmoDrag.center.x, point.y - gizmoDrag.center.y);
      gizmoDrag.mode = radius <= (gizmoLayout?.ringRadius ?? 100) + 4 ? "fixed" : "fine";
      const step = gizmoDrag.mode === "fixed" ? 22.5 : 1;
      const rawDegrees = THREE.MathUtils.radToDeg(gizmoDrag.startRotation + gizmoDrag.accumulatedAngle);
      const snappedDegrees = Math.round(rawDegrees / step) * step;
      target.rotation[gizmoDrag.axis] = THREE.MathUtils.degToRad(snappedDegrees);
      setTransformReadout(
        event.clientX,
        event.clientY,
        `${gizmoDrag.axis.toUpperCase()}  ${snappedDegrees.toFixed(gizmoDrag.mode === "fine" ? 0 : 1)}° · ${gizmoDrag.mode === "fixed" ? "固定 22.5°" : "精细 1°"}`,
      );
    }
    if (gizmoDrag.kind !== "scale") validateEditTransform();
    scheduleInteractiveTransformUpdate();
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const finishDrag = (event: PointerEvent) => {
    if (!gizmoDrag || gizmoDrag.id !== event.pointerId) return;
    gizmoDrag = undefined;
    gizmoDragging = false;
    viewport.dataset.gizmoPointer = "up";
    viewport.dataset.gizmoAxis = "";
    viewport.classList.remove("gizmo-dragging");
    viewport.releasePointerCapture?.(event.pointerId);
    setInteractiveRenderQuality(false);
    hideTransformReadout();
    updateAfterTransform();
    disposeEditCollisionSession();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  viewport.addEventListener("pointerup", finishDrag, true);
  viewport.addEventListener("pointercancel", finishDrag, true);

  // Redraw after the viewer updates its camera, without recomputing geometry
  // continuously while the scene is idle.
  const viewerCanvas = embeddedViewer.canvas;
  viewerCanvas.addEventListener("pointermove", () => {
    if (!gizmoDragging && !directDragging) scheduleCombinedGizmoUpdate();
  });
  viewerCanvas.addEventListener("wheel", scheduleCombinedGizmoUpdate, { passive: true });
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
  workspaceRoot.updateMatrixWorld(true);
  (viewer.camera as THREE.Camera).updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, viewer.camera as THREE.Camera);
  const hit = raycaster.intersectObject(workspaceRoot, true)
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

function pointerOnHorizontalPlane(clientX: number, clientY: number, z: number): THREE.Vector3 | undefined {
  const canvas = embeddedViewer.canvas;
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const camera = embeddedViewer.GetViewer().camera as THREE.Camera;
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  return raycaster.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
    new THREE.Vector3(),
  ) ?? undefined;
}

function installViewportSelection(): void {
  const canvas = embeddedViewer.canvas;
  let emptyPointerStart: { id: number; x: number; y: number } | undefined;
  let directDrag: {
    id: number;
    part: PartRecord;
    x: number;
    y: number;
    planeZ: number;
    offset: THREE.Vector3;
    moved: boolean;
  } | undefined;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || currentMode !== "model" || physicsWorld || physicsStarting) return;
    if (gizmoDragging) return;
    const directHit = partUnderPointer(event.clientX, event.clientY);
    if (!directHit) {
      emptyPointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }

    ensurePartSelected(directHit);
    const point = pointerOnHorizontalPlane(event.clientX, event.clientY, directHit.root.position.z);
    if (!point) return;
    directDrag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      part: directHit,
      planeZ: directHit.root.position.z,
      offset: directHit.root.position.clone().sub(point),
      moved: false,
    };
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  canvas.addEventListener("pointermove", (event) => {
    if (!directDrag || directDrag.id !== event.pointerId) return;
    if (!directDrag.moved) {
      if (Math.hypot(event.clientX - directDrag.x, event.clientY - directDrag.y) <= 5) return;
      if (!prepareEditCollision(directDrag.part)) return;
      directDrag.moved = true;
      directDragging = true;
      setInteractiveRenderQuality(true);
      elements.viewport.classList.add("direct-dragging");
    }
    const point = pointerOnHorizontalPlane(event.clientX, event.clientY, directDrag.planeZ);
    if (!point) return;
    let x = point.x + directDrag.offset.x;
    let y = point.y + directDrag.offset.y;
    if (transformSnapEnabled) {
      x = Math.round(x);
      y = Math.round(y);
    }
    directDrag.part.root.position.x = x;
    directDrag.part.root.position.y = y;
    validateEditTransform();
    scheduleInteractiveTransformUpdate();
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  canvas.addEventListener("pointerup", (event) => {
    if (directDrag?.id === event.pointerId) {
      const moved = directDrag.moved;
      directDrag = undefined;
      directDragging = false;
      elements.viewport.classList.remove("direct-dragging");
      canvas.releasePointerCapture?.(event.pointerId);
      if (moved) {
        setInteractiveRenderQuality(false);
        updateAfterTransform();
      } else {
        updateTransformPanel();
        updateCombinedGizmo();
      }
      disposeEditCollisionSession();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!emptyPointerStart || emptyPointerStart.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - emptyPointerStart.x, event.clientY - emptyPointerStart.y);
    emptyPointerStart = undefined;
    if (moved <= 5 && !gizmoDragging && currentMode === "model") selectPart(undefined);
  }, true);

  canvas.addEventListener("pointercancel", (event) => {
    emptyPointerStart = undefined;
    if (directDrag?.id !== event.pointerId) return;
    const moved = directDrag.moved;
    directDrag = undefined;
    directDragging = false;
    elements.viewport.classList.remove("direct-dragging");
    if (moved) {
      setInteractiveRenderQuality(false);
      updateAfterTransform();
    }
    disposeEditCollisionSession();
  }, true);

  // Keep a click fallback for browser engines and embedded webviews that expose
  // mouse events without a complete PointerEvent sequence.
  canvas.addEventListener("click", (event) => {
    if (currentMode !== "model" || directDragging || gizmoDragging) return;
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

function analyzeGCode(source: string): { dimensions: THREE.Vector3; extrusionMoves: number } {
  let absolutePosition = true;
  let absoluteExtrusion = true;
  const position = new THREE.Vector3();
  let extrusion = 0;
  let extrusionMoves = 0;
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  const fallbackMin = min.clone();
  const fallbackMax = max.clone();
  const include = (point: THREE.Vector3, fallback = false) => {
    (fallback ? fallbackMin : min).min(point);
    (fallback ? fallbackMax : max).max(point);
  };

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.split(";", 1)[0].trim().toUpperCase();
    if (!line) continue;
    if (/^G90(?:\s|$)/u.test(line)) { absolutePosition = true; continue; }
    if (/^G91(?:\s|$)/u.test(line)) { absolutePosition = false; continue; }
    if (/^M82(?:\s|$)/u.test(line)) { absoluteExtrusion = true; continue; }
    if (/^M83(?:\s|$)/u.test(line)) { absoluteExtrusion = false; continue; }

    const values = new Map<string, number>();
    for (const match of line.matchAll(/([XYZE])\s*(-?\d+(?:\.\d+)?)/gu)) values.set(match[1], Number(match[2]));
    if (/^G92(?:\s|$)/u.test(line)) {
      if (values.has("X")) position.x = values.get("X")!;
      if (values.has("Y")) position.y = values.get("Y")!;
      if (values.has("Z")) position.z = values.get("Z")!;
      if (values.has("E")) extrusion = values.get("E")!;
      continue;
    }
    if (!/^G0?1?(?:\s|$)/u.test(line)) continue;

    const previous = position.clone();
    const next = position.clone();
    for (const axis of ["X", "Y", "Z"] as const) {
      const value = values.get(axis);
      if (value === undefined) continue;
      const key = axis.toLowerCase() as "x" | "y" | "z";
      next[key] = absolutePosition ? value : next[key] + value;
    }
    include(previous, true);
    include(next, true);

    const eValue = values.get("E");
    const nextExtrusion = eValue === undefined
      ? extrusion
      : absoluteExtrusion ? eValue : extrusion + eValue;
    if (eValue !== undefined && nextExtrusion > extrusion + 1e-7) {
      include(previous);
      include(next);
      extrusionMoves += 1;
    }
    position.copy(next);
    extrusion = nextExtrusion;
  }

  const hasExtrusionBounds = Number.isFinite(min.x);
  const usedMin = hasExtrusionBounds ? min : fallbackMin;
  const usedMax = hasExtrusionBounds ? max : fallbackMax;
  if (!Number.isFinite(usedMin.x)) return { dimensions: new THREE.Vector3(), extrusionMoves };
  const dimensions = usedMax.clone().sub(usedMin);
  dimensions.z = Math.max(0, usedMax.z);
  return { dimensions, extrusionMoves };
}

function switchMode(mode: ViewMode): void {
  if (mode !== "model" && (physicsWorld || physicsStarting)) stopPhysics(true, false);
  currentMode = mode;
  const isModel = mode === "model";
  elements.appShell.dataset.mode = mode;
  elements.modelHost.classList.toggle("hidden", !isModel);
  elements.gcodeCanvas.classList.toggle("visible", !isModel);
  elements.layerControl.classList.toggle("visible", !isModel && gcodeLoaded);
  elements.wireframeButton.disabled = !isModel || !modelRoot;
  elements.viewportHint.classList.toggle("hidden", !isModel);
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  syncTransformControl();
  updateTransformPanel();
  if (isModel) {
    const part = selectedPart();
    if (part) setStats(computeModelStats(part.root, part.name, part.fileSize));
    embeddedViewer?.Resize();
    embeddedViewer?.GetViewer().Render();
  } else {
    gcodePreview?.resize();
  }
}

async function loadGCode(file: File): Promise<void> {
  showLoading(true);
  try {
    const source = await file.text();
    const preview = initGCode();
    preview.clear();
    preview.startLayer = 1;
    preview.endLayer = undefined;
    preview.processGCode(source);
    const layerCount = preview.parser.layers.length;
    if (!layerCount) throw new Error("No printable layers found");
    preview.endLayer = layerCount + 1;
    preview.render();
    const analysis = analyzeGCode(source);
    gcodeLoaded = true;
    switchMode("gcode");
    elements.layerRange.min = "1";
    elements.layerRange.max = String(Math.max(1, layerCount));
    elements.layerRange.value = String(Math.max(1, layerCount));
    elements.layerValue.textContent = `${layerCount} / ${layerCount}`;
    elements.fileType.textContent = "GCODE";
    elements.fileName.textContent = file.name;
    elements.fileSubtitle.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB · ${layerCount} 层`;
    elements.metricXLabel.textContent = "路径 X";
    elements.metricYLabel.textContent = "路径 Y";
    elements.metricZLabel.textContent = "打印高度";
    elements.metricPrimaryLabel.textContent = "挤出段";
    elements.metricSecondaryLabel.textContent = "层数";
    elements.sizeX.textContent = formatDimension(analysis.dimensions.x);
    elements.sizeY.textContent = formatDimension(analysis.dimensions.y);
    elements.sizeZ.textContent = formatDimension(analysis.dimensions.z);
    elements.triangles.textContent = formatCount(analysis.extrusionMoves);
    elements.meshCount.textContent = String(layerCount);
    showToast(`已解析 ${layerCount} 个打印层`);
  } catch (error) {
    console.error(error);
    gcodeLoaded = false;
    if (currentMode === "gcode") switchMode("model");
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
    else showToast("不支持这个文件格式", true);
  }
}

function clearWorkspace(): void {
  if (parts.length && !window.confirm(`确定清空工作区中的 ${parts.length} 个零件吗？`)) return;
  if (physicsWorld || physicsStarting) stopPhysics(true, false);
  for (const part of parts) disposeObject(part.root);
  parts = [];
  selectedPartId = undefined;
  modelRoot = undefined;
  importQueue = [];
  activeImportJob = undefined;
  rebuildWorkspace();
  clearEditQueryWorld();
  showToast("工作区已清空");
}

function removeSelectedPart(): void {
  const part = selectedPart();
  if (!part) return;
  if (physicsWorld || physicsStarting) stopPhysics(true, false);
  const index = parts.indexOf(part);
  parts.splice(index, 1);
  part.root.removeFromParent();
  disposeObject(part.root);
  selectedPartId = parts[Math.min(index, parts.length - 1)]?.id;
  rebuildWorkspace(false);
  clearEditQueryWorld();
  showToast(`已删除 ${part.name}`);
}

function nextCopyName(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const hasExtension = dot > 0;
  const extension = hasExtension ? sourceName.slice(dot) : "";
  const stem = (hasExtension ? sourceName.slice(0, dot) : sourceName)
    .replace(/ · 副本(?: \d+)?$/u, "");
  const pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} · 副本(?: (\\d+))?${extension.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u");
  const used = parts.flatMap((part) => {
    const match = part.name.match(pattern);
    return match ? [match[1] ? Number(match[1]) : 1] : [];
  });
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `${stem} · 副本${next === 1 ? "" : ` ${next}`}${extension}`;
}

function duplicateSelectedPart(): void {
  const source = selectedPart();
  if (!source) return;
  if (physicsWorld || physicsStarting) stopPhysics(true, false);
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
    name: nextCopyName(source.name),
    fileSize: source.fileSize,
    root: clone,
    initialPosition: clone.position.clone(),
    initialQuaternion: clone.quaternion.clone(),
    initialScale: clone.scale.clone(),
    material: source.material,
  };
  markPartHierarchy(part);
  part.collisionLocalObb = new OBB().fromBox3(computePartLocalBounds(part));
  parts.push(part);
  selectedPartId = part.id;
  rebuildWorkspace(false);
  clearEditQueryWorld();
  showToast(`已复制 ${source.name}`);
}

function centerSelectedPart(): void {
  const target = activeTransformRoot();
  if (!target || !bedObject) return;
  const part = selectedPart();
  if (part && !prepareEditCollision(part, true)) return;
  const box = new THREE.Box3().setFromObject(target);
  const center = box.getCenter(new THREE.Vector3());
  const bed = bedObject.userData.bed as { center: THREE.Vector3 };
  target.position.x += bed.center.x - center.x;
  target.position.y += bed.center.y - center.y;
  validateEditTransform(true);
  disposeEditCollisionSession();
  updateAfterTransform();
}

function placeSelectedPartOnBed(): void {
  const target = activeTransformRoot();
  if (!target) return;
  const part = selectedPart();
  if (part && !prepareEditCollision(part, true)) return;
  const box = new THREE.Box3().setFromObject(target);
  target.position.z -= box.min.z;
  validateEditTransform(true);
  disposeEditCollisionSession();
  updateAfterTransform();
}

function resetSelectedPart(): void {
  const part = selectedPart();
  const target = activeTransformRoot();
  if (!target) return;
  if (part) {
    part.root.position.copy(part.initialPosition);
    part.root.quaternion.copy(part.initialQuaternion);
    part.root.scale.copy(part.initialScale);
  }
  updateAfterTransform();
}

function applyTransformValue(kind: TransformKind, axis: "x" | "y" | "z", value: number): void {
  const target = activeTransformRoot();
  if (!target || !Number.isFinite(value)) return;
  const part = selectedPart();
  const guardTransform = kind !== "scale" && Boolean(part);
  if (guardTransform && part && !prepareEditCollision(part, true)) {
    updateTransformPanel();
    return;
  }
  if (kind === "position") target.position[axis] = value;
  else if (kind === "rotation") target.rotation[axis] = THREE.MathUtils.degToRad(value);
  else target.scale[axis] = Math.max(0.05, value);
  if (guardTransform) {
    validateEditTransform(true);
    disposeEditCollisionSession();
  }
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

document.querySelector<HTMLButtonElement>("#gcode-demo-button")!.addEventListener("click", () => {
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

document.querySelector<HTMLButtonElement>("#clear-parts-button")!.addEventListener("click", clearWorkspace);
document.querySelector<HTMLButtonElement>("#remove-part-button")!.addEventListener("click", removeSelectedPart);
document.querySelector<HTMLButtonElement>("#center-part-button")!.addEventListener("click", centerSelectedPart);
document.querySelector<HTMLButtonElement>("#place-part-button")!.addEventListener("click", placeSelectedPartOnBed);
document.querySelector<HTMLButtonElement>("#duplicate-part-button")!.addEventListener("click", duplicateSelectedPart);
document.querySelector<HTMLButtonElement>("#reset-part-button")!.addEventListener("click", resetSelectedPart);
document.querySelector<HTMLButtonElement>("#viewport-place-button")!.addEventListener("click", placeSelectedPartOnBed);
document.querySelector<HTMLButtonElement>("#viewport-duplicate-button")!.addEventListener("click", duplicateSelectedPart);
document.querySelector<HTMLButtonElement>("#viewport-delete-button")!.addEventListener("click", removeSelectedPart);
elements.physicsDropSelectedButton.addEventListener("click", () => { void startPhysics("selected"); });
elements.physicsDropAllButton.addEventListener("click", () => { void startPhysics("all"); });
elements.physicsPauseButton.addEventListener("click", togglePhysicsPause);
elements.physicsResetButton.addEventListener("click", () => stopPhysics(true));
elements.collisionGuardButton.addEventListener("click", () => {
  collisionGuardEnabled = !collisionGuardEnabled;
  disposeEditCollisionSession();
  clearEditQueryWorld();
  syncPhysicsControls();
  syncTransformControl();
  setPhysicsStatus("idle", collisionGuardEnabled ? "编辑防穿透已开启" : "编辑防穿透已关闭");
  showToast(collisionGuardEnabled ? "已开启编辑防穿透" : "已关闭编辑防穿透");
});

elements.snapButton.addEventListener("click", toggleTransformSnap);

document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode as ViewMode;
    if (mode === "gcode" && !gcodeLoaded) {
      showToast("请先打开一个 G-code 文件");
      return;
    }
    switchMode(mode);
  });
});

elements.wireframeButton.addEventListener("click", () => {
  if (!modelRoot) return;
  wireframeEnabled = !wireframeEnabled;
  elements.wireframeButton.classList.toggle("active", wireframeEnabled);
  for (const part of parts) applyMaterial(part.root, part.material);
});

document.querySelector<HTMLButtonElement>("#fit-button")!.addEventListener("click", () => {
  if (currentMode === "model") {
    if (!parts.length) return;
    const viewer = embeddedViewer.GetViewer();
    viewer.FitSphereToWindow(viewer.GetBoundingSphere(() => true), true);
  } else {
    gcodePreview?.resize();
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
  if (target?.matches("input, textarea, select, [contenteditable='true']") || currentMode !== "model" || physicsWorld || physicsStarting) return;
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "d") {
    event.preventDefault();
    duplicateSelectedPart();
  } else if (key === "d") {
    event.preventDefault();
    placeSelectedPartOnBed();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelectedPart();
  } else if (key === "f") {
    if (!parts.length) return;
    const viewer = embeddedViewer.GetViewer();
    viewer.FitSphereToWindow(viewer.GetBoundingSphere(() => true), true);
  } else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
    const targetRoot = activeTransformRoot();
    if (!targetRoot) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    if ((event.metaKey || event.ctrlKey) && (key === "arrowup" || key === "arrowdown")) {
      targetRoot.position.z += key === "arrowup" ? step : -step;
    } else if (key === "arrowleft" || key === "arrowright") {
      targetRoot.position.x += key === "arrowright" ? step : -step;
    } else {
      targetRoot.position.y += key === "arrowup" ? step : -step;
    }
    updateAfterTransform();
  }
});

const resizeObserver = new ResizeObserver(() => {
  if (currentMode === "model") {
    embeddedViewer?.Resize();
    scheduleCombinedGizmoUpdate();
  }
  else gcodePreview?.resize();
});
resizeObserver.observe(elements.viewport);

initModelViewer();
restoreInspectorTheme();
syncPhysicsControls();
switchMode("model");

colorSchemeMedia.addEventListener("change", () => {
  const isDark = colorSchemeMedia.matches;
  embeddedViewer.GetViewer().SetBackgroundColor(
    isDark
      ? new RGBAColor(21, 21, 21, 255)
      : new RGBAColor(241, 241, 241, 255),
  );
  if (parts.length) rebuildWorkspace(false);
});
