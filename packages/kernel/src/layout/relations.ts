/**
 * 关系边（跨子树显式连线）：节点 note.rel 指向目标实体引用，
 * 语义复用 entity-ref（@kind:id 或裸 kind:id），随正文 note 透传持久化（协议兼容预留）。
 * 渲染时仅对"目标实体节点也出现在当前布局中"的组合生成曲线几何。
 */
import type { MindNode } from '../protocol/types.js';

export interface EntityRef {
  kind: string;
  id: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RelEntry {
  /** 源节点路径（root/0/1） */
  from: string;
  targets: EntityRef[];
}

export interface ResolvedRel {
  from: string;
  to: string;
  targetBox: Box;
  ref: string;
}

export interface RelGeometry {
  path: string;
  ref: string;
}

const RE_REF = /^@?([a-z][a-z0-9_]*):(.+)$/;

/** 目标引用规范化：@kind:id 与 kind:id 统一 → {kind,id}；非法/空 → null */
export function normalizeRel(value: unknown): EntityRef | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(RE_REF);
  if (!m) return null;
  return { kind: m[1] as string, id: (m[2] as string).trim() };
}

/** 汇总全部节点的 note.rel（单值或数组），按子树路径标注源节点 */
export function collectRelRefs(root: MindNode): RelEntry[] {
  const out: RelEntry[] = [];
  const walk = (node: MindNode, path: string): void => {
    const rel = node.note?.rel;
    if (rel !== undefined) {
      const raw = Array.isArray(rel) ? rel : [rel];
      const targets = raw.map((v) => normalizeRel(v)).filter((r): r is EntityRef => r !== null);
      if (targets.length > 0) out.push({ from: path, targets });
    }
    node.children.forEach((c, i) => walk(c, `${path}/${i}`));
  };
  if (root) walk(root, 'root');
  return out;
}

/** 目标匹配当前布局中的实体节点（refKey 一致）→ 取目标盒；图中不存在则丢弃 */
export function resolveRelTargets(
  rels: RelEntry[],
  nodes: Array<{ id: string; box: Box; refKey: string }>,
): ResolvedRel[] {
  const byRef = new Map<string, { id: string; box: Box }>();
  for (const n of nodes) byRef.set(n.refKey, n);
  const out: ResolvedRel[] = [];
  for (const entry of rels) {
    for (const ref of entry.targets) {
      const key = `${ref.kind}:${ref.id}`;
      const hit = byRef.get(key);
      if (hit) out.push({ from: entry.from, to: hit.id, targetBox: hit.box, ref: key });
    }
  }
  return out;
}

/** 生成关系曲线 path：源盒右缘 → 目标盒左缘的竖直贝塞尔（与父边同风格、可路由交错） */
export function buildRelGeometries(
  entries: ResolvedRel[],
  fromBoxes: Record<string, Box>,
): RelGeometry[] {
  const out: RelGeometry[] = [];
  for (const e of entries) {
    const src = fromBoxes[e.from];
    if (!src) continue;
    const x1 = src.x + src.w;
    const y1 = src.y + src.h / 2;
    const x2 = e.targetBox.x;
    const y2 = e.targetBox.y + e.targetBox.h / 2;
    const dx = Math.max(24, Math.abs(x2 - x1) / 2);
    // 略微抬高目标端控制点，让连线与父边视觉可区分（interaction 层级显式）
    out.push({
      ref: e.ref,
      path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    });
  }
  return out;
}
