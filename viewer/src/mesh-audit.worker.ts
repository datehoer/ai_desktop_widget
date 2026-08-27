type AuditRequest = {
  requestId: number;
  partId: string;
  triangles: Float32Array;
};

export type MeshHealthReport = {
  triangleCount: number;
  uniqueVertexCount: number;
  shellCount: number;
  boundaryEdgeCount: number;
  boundaryLoopCount: number;
  nonManifoldEdgeCount: number;
  inconsistentWindingEdgeCount: number;
  reversedShellCount: number;
  duplicateTriangleCount: number;
  degenerateTriangleCount: number;
  closedVolumeCm3?: number;
  toleranceMm: number;
  printable: boolean;
  needsReview: boolean;
};

type EdgeUse = {
  count: number;
  directionBalance: number;
  firstFace: number;
  a: number;
  b: number;
};

class DisjointSet {
  private readonly parent: Int32Array;
  private readonly rank: Uint8Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) this.parent[index] = index;
  }

  find(value: number): number {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[value] !== value) {
      const next = this.parent[value];
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(first: number, second: number): void {
    let a = this.find(first);
    let b = this.find(second);
    if (a === b) return;
    if (this.rank[a] < this.rank[b]) [a, b] = [b, a];
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b]) this.rank[a] += 1;
  }
}

function countBoundaryLoops(boundaryEdges: EdgeUse[]): number {
  if (!boundaryEdges.length) return 0;
  const vertexParents = new Map<number, number>();
  const find = (value: number): number => {
    const parent = vertexParents.get(value) ?? value;
    if (parent === value) {
      vertexParents.set(value, value);
      return value;
    }
    const root = find(parent);
    vertexParents.set(value, root);
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) vertexParents.set(rootB, rootA);
  };
  for (const edge of boundaryEdges) union(edge.a, edge.b);
  return new Set([...vertexParents.keys()].map(find)).size;
}

function auditTriangleSoup(triangles: Float32Array): MeshHealthReport {
  const triangleCount = Math.floor(triangles.length / 9);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < triangleCount * 9; index += 3) {
    minX = Math.min(minX, triangles[index]);
    minY = Math.min(minY, triangles[index + 1]);
    minZ = Math.min(minZ, triangles[index + 2]);
    maxX = Math.max(maxX, triangles[index]);
    maxY = Math.max(maxY, triangles[index + 1]);
    maxZ = Math.max(maxZ, triangles[index + 2]);
  }
  const diagonal = triangleCount
    ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ)
    : 0;
  const toleranceMm = Math.max(0.00001, diagonal * 0.000001);
  const inverseTolerance = 1 / toleranceMm;
  const areaToleranceSquared = Math.max(1e-20, diagonal ** 4 * 1e-24);
  const vertexIds = new Map<string, number>();
  const edges = new Map<string, EdgeUse>();
  const triangleKeys = new Set<string>();
  const activeFaces = new Uint8Array(triangleCount);
  const faceVolume6 = new Float64Array(triangleCount);
  const sets = new DisjointSet(triangleCount);
  let duplicateTriangleCount = 0;
  let degenerateTriangleCount = 0;

  const vertexId = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x * inverseTolerance)},${Math.round(y * inverseTolerance)},${Math.round(z * inverseTolerance)}`;
    const existing = vertexIds.get(key);
    if (existing !== undefined) return existing;
    const next = vertexIds.size;
    vertexIds.set(key, next);
    return next;
  };

  for (let face = 0; face < triangleCount; face += 1) {
    const offset = face * 9;
    const ax = triangles[offset];
    const ay = triangles[offset + 1];
    const az = triangles[offset + 2];
    const bx = triangles[offset + 3];
    const by = triangles[offset + 4];
    const bz = triangles[offset + 5];
    const cx = triangles[offset + 6];
    const cy = triangles[offset + 7];
    const cz = triangles[offset + 8];
    const ids = [vertexId(ax, ay, az), vertexId(bx, by, bz), vertexId(cx, cy, cz)];
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const crossLengthSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
    if (new Set(ids).size < 3 || crossLengthSquared <= areaToleranceSquared) {
      degenerateTriangleCount += 1;
      continue;
    }
    activeFaces[face] = 1;
    faceVolume6[face] = ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx);
    const triangleKey = [...ids].sort((a, b) => a - b).join(":");
    if (triangleKeys.has(triangleKey)) duplicateTriangleCount += 1;
    else triangleKeys.add(triangleKey);

    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const from = ids[edgeIndex];
      const to = ids[(edgeIndex + 1) % 3];
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      const key = `${a}:${b}`;
      const direction = from === a ? 1 : -1;
      const edge = edges.get(key);
      if (edge) {
        edge.count += 1;
        edge.directionBalance += direction;
        sets.union(edge.firstFace, face);
      } else {
        edges.set(key, { count: 1, directionBalance: direction, firstFace: face, a, b });
      }
    }
  }

  const boundaryEdges: EdgeUse[] = [];
  let nonManifoldEdgeCount = 0;
  let inconsistentWindingEdgeCount = 0;
  for (const edge of edges.values()) {
    if (edge.count === 1) boundaryEdges.push(edge);
    else if (edge.count > 2) nonManifoldEdgeCount += 1;
    if (edge.count === 2 && edge.directionBalance !== 0) inconsistentWindingEdgeCount += 1;
  }

  const shellRoots = new Set<number>();
  const shellVolumes = new Map<number, number>();
  for (let face = 0; face < triangleCount; face += 1) {
    if (!activeFaces[face]) continue;
    const root = sets.find(face);
    shellRoots.add(root);
    shellVolumes.set(root, (shellVolumes.get(root) ?? 0) + faceVolume6[face]);
  }
  const topologyClosed = boundaryEdges.length === 0
    && nonManifoldEdgeCount === 0
    && inconsistentWindingEdgeCount === 0;
  const volumeTolerance6 = Math.max(1e-9, diagonal ** 3 * 1e-12 * 6);
  const reversedShellCount = topologyClosed
    ? [...shellVolumes.values()].filter((volume6) => volume6 < -volumeTolerance6).length
    : 0;
  const closedVolumeCm3 = topologyClosed
    ? [...shellVolumes.values()].reduce((sum, volume6) => sum + Math.abs(volume6) / 6, 0) / 1000
    : undefined;
  const printable = triangleCount > 0
    && boundaryEdges.length === 0
    && nonManifoldEdgeCount === 0
    && inconsistentWindingEdgeCount === 0
    && reversedShellCount === 0
    && duplicateTriangleCount === 0
    && degenerateTriangleCount === 0;

  return {
    triangleCount,
    uniqueVertexCount: vertexIds.size,
    shellCount: shellRoots.size,
    boundaryEdgeCount: boundaryEdges.length,
    boundaryLoopCount: countBoundaryLoops(boundaryEdges),
    nonManifoldEdgeCount,
    inconsistentWindingEdgeCount,
    reversedShellCount,
    duplicateTriangleCount,
    degenerateTriangleCount,
    closedVolumeCm3,
    toleranceMm,
    printable,
    needsReview: printable && shellRoots.size > 1,
  };
}

self.addEventListener("message", (event: MessageEvent<AuditRequest>) => {
  const { requestId, partId, triangles } = event.data;
  const report = auditTriangleSoup(triangles);
  self.postMessage({ requestId, partId, report });
});

export {};
