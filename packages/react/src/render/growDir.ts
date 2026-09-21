/**
 * 节点级生长方向（思想分叉）协议层 · D1′
 *
 * `note.dir: left|right|up|down` = 本节点相对父级的生长侧（**子级声明**语义）。
 * 缺省 = 继承（最近显式 dir 祖先 → 岛 dir）；非法值 → 诊断 + 按继承处理。
 *
 * 设计原则（与 centers.ts 同一套读侧容错）：
 * - 节点数据保持纯净：dir 是**语义意图**（如既有 via/edge/desc/qa），绝不挂 x/y 坐标。
 * - 纯函数，零 DOM——本模块可被 kernel 消费侧（pipeline）直接调用，仅产出数据。
 * - 非法值不抛异常：诊断信息供 UI 呈现「宁可不写也不错写」的原因。
 *
 * 与布局层接口：解析出的有效方向（Map<nodeId, GrowDir>）经布局入参注入
 * kernel 的 layoutMindmapBranched（见 packages/kernel/src/layout/layouts.ts），
 * 本模块不依赖 kernel 内部实现，仅复用其导出的 `GrowDir` / `Note` / `EditableNode` 类型。
 */
import type { EditableNode, GrowDir, Note } from '@mindcanvas/kernel';
import { parseMm, serializeMm } from '@mindcanvas/kernel';

/** 四向合法值（与 forest.ts 的 GrowDir 同源） */
export const GROW_DIRS: readonly GrowDir[] = ['right', 'left', 'down', 'up'] as const;

const GROW_DIR_VALUES: readonly string[] = GROW_DIRS;

/** 读侧类型守卫：未知协议形状（裸标量 / 大小写错 / 多余字段）一律视为非法 */
export function isGrowDir(v: unknown): v is GrowDir {
  return typeof v === 'string' && GROW_DIR_VALUES.includes(v);
}

/**
 * 数值容错读取：note 标量经 .mm.md 往返（kernel parseMm 裸标量保字符串，
 * v1.0.0 冻结协议行为）会变成 "250" 这类数字串——本模块不消费数值，但保留
 * 统一工具以防未来扩展（与 centers.ts 的 num() 同构）。
 */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** 读侧容错：未知协议形状窄化（运行期类型收窄，不做断言转换） */
function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 诊断（中文消息；与 kernel Diagnostic 语义一致，供 UI 呈现原因） */
export interface GrowDirDiagnostic {
  code: 'grow-dir-invalid';
  nodeId: string | null;
  raw: unknown;
  message: string;
}

/**
 * 读取单个节点的显式 dir 声明（校验 + 诊断）。
 *
 * - 节点无 note / 无 dir 字段 → 返回 null（表示「未声明，需继承」）
 * - dir 字段非法（非四向 / 非字符串 / 数字串等）→ 返回 null（按继承处理）+ 收集诊断
 * - 合法 → 返回 GrowDir
 *
 * 不修改传入 note，纯读取。
 */
export function readGrowDir(
  note: Note | undefined,
  nodeId: string | null = null,
  diagnostics: GrowDirDiagnostic[] = [],
): GrowDir | null {
  const raw = note?.dir;
  if (raw === undefined || raw === null) return null;
  if (isGrowDir(raw)) return raw;
  diagnostics.push({
    code: 'grow-dir-invalid',
    nodeId,
    raw,
    message: `dir 取值「${String(raw)}」非法（仅允许 left/right/up/down），已按继承处理`,
  });
  return null;
}

/**
 * 解析节点的**有效**生长方向（继承链）。
 *
 * 继承语义（设计 §5）：
 * - 节点自身显式 dir（合法）→ 采用
 * - 否则 → 采用最近祖先的**有效**方向（ancestors 由近到远排列：ancestors[0] 为直接父）
 * - 祖先均无显式声明 → 采用 islandDir（岛整体摆放方向 / 根缺省）
 *
 * @param node       当前节点（仅用其 note.dir）
 * @param ancestors  祖先链，index 0 = 直接父，末尾 = 根。可为空。
 * @param islandDir  岛/根缺省方向（无显式声明时的归宿）
 */
export function effectiveGrowDir(
  node: EditableNode,
  ancestors: EditableNode[],
  islandDir: GrowDir = 'right',
): GrowDir {
  const self = readGrowDir(node.note, node.id);
  if (self !== null) return self;
  for (const anc of ancestors) {
    const d = readGrowDir(anc.note, anc.id);
    if (d !== null) return d;
  }
  return islandDir;
}

/**
 * 从整棵文档树提取「显式 dir 声明」映射（nodeId → GrowDir）。
 * 仅收集合法声明；非法值通过 diagnostics 暴露（但不进映射，按继承处理）。
 *
 * 该映射即布局层注入所需的 dir 信息（pipeline 一次性预解析，避免布局期重复爬祖先）。
 */
export function collectExplicitDir(root: EditableNode): {
  dirByNodeId: Map<string, GrowDir>;
  diagnostics: GrowDirDiagnostic[];
} {
  const dirByNodeId = new Map<string, GrowDir>();
  const diagnostics: GrowDirDiagnostic[] = [];
  const walk = (n: EditableNode): void => {
    const d = readGrowDir(n.note, n.id, diagnostics);
    if (d !== null) dirByNodeId.set(n.id, d);
    n.children.forEach(walk);
  };
  walk(root);
  return { dirByNodeId, diagnostics };
}

/**
 * 写回 / 更新一个节点的 dir 声明（不可变：返回新 note，不改动传入值）。
 *
 * - dir 合法 → 写入 note.dir
 * - dir 为 null/undefined（继承语义）→ 删除 note.dir 键（不残留「null」属性，与
 *   updateNode 的字段删除语义一致；避免序列化产生 `dir: null` 歧义）
 * - dir 非法 → 不写、返回原 note（由调用方决定是否先经 readGrowDir 诊断）
 *
 * 本协议层不负责「事务 / undo」——OpHistory 在调用方包裹，本函数只产出纯数据。
 */
export function upsertGrowDir(note: Note | undefined, dir: GrowDir | null | undefined): Note {
  if (dir !== undefined && dir !== null) {
    if (!isGrowDir(dir)) return note ?? {};
    const out: Note = { ...(note ?? {}) };
    out.dir = dir;
    return out;
  }
  // 显式清除（继承）
  if (note && 'dir' in note) {
    const out: Note = { ...note };
    delete out.dir;
    return out;
  }
  return note ?? {};
}

/**
 * 新子节点方向推断（PG「按入边多数方向推断」的树版）。
 *
 * 优先级：兄弟节点的显式 dir **多数** → 父节点的显式 dir → null（不写，走继承）。
 * 返回 null 表示「不需要固化」——保持旧行为（不写 note.dir，布局走继承）。
 *
 * 为什么用「兄弟多数」而非 PG 的入边方向：树里子节点只有一条入边（父边），
 * 无「入边方向」概念；兄弟既有方向才是用户对这一层的真实意图表达。
 */
export function inferChildDir(parent: EditableNode): GrowDir | null {
  const counts = new Map<GrowDir, number>();
  for (const c of parent.children) {
    const d = readGrowDir(c.note, c.id);
    if (d !== null) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size > 0) {
    let best: GrowDir | null = null;
    let bestN = 0;
    for (const [d, n] of counts) {
      if (n > bestN) {
        best = d;
        bestN = n;
      }
    }
    if (best !== null) return best;
  }
  // 无兄弟声明 → 跟随父节点自己的生长侧（父朝左长，新子节点也朝左）
  return readGrowDir(parent.note, parent.id);
}

/** 文档级 dir 聚合诊断（供 UI 顶部一次性汇报非法声明数量） */
export function summarizeGrowDirDiagnostics(diagnostics: GrowDirDiagnostic[]): string {
  if (diagnostics.length === 0) return '无 dir 诊断';
  return diagnostics.map((d) => d.message).join('；');
}

/**
 * 全树声明方向映射（含显式祖先继承）：declared(node) = 自身显式 ?? 最近显式祖先；全无 → 不入表。
 *
 * 与内核 layoutMindmapBranched 内部的 dirOf 语义一致（显式声明 → 跟随显式父 → 沿继承链上溯），
 * 供渲染侧连线选型（geometry linkOrientation 的声明覆盖）消费。
 *
 * 中心节点特化（用户回归）：**岛默认方向（islandDir）不充当声明**——均衡模式下位于根左侧的
 * 无声明子节点若被岛默认 'right' 顶死，连线会从根右缘出发横穿中心节点。无声明 = 不入表 =
 * 回退几何自适应（左右贴实际所在侧的边缘）。
 * O(n) 单遍，调用方按树引用 memo 化。
 */
export function collectDeclaredGrowDir(root: EditableNode): Map<string, GrowDir> {
  const m = new Map<string, GrowDir>();
  const walk = (n: EditableNode, inherited: GrowDir | undefined): void => {
    const d = readGrowDir(n.note, n.id) ?? inherited;
    if (d !== undefined) m.set(n.id, d);
    n.children.forEach((c) => walk(c, d));
  };
  walk(root, undefined);
  return m;
}

/**
 * 序列化探针（D1′ 验收项）：note.dir 标量经 parseMm → serializeMm → parseMm
 * 往返后保持一致。返回 { ok, before, after }。
 *
 * 依赖 kernel 的 parse/serialize（纯函数，无 DOM）。
 */
export function probeDirRoundTrip(dir: GrowDir): {
  ok: boolean;
  before: GrowDir | null;
  after: GrowDir | null;
} {
  const text = `# 中心议题\n\n<!--\ndir: ${dir}\n-->\n#### 分支\n- 叶子`;
  // 注意：parseMm 产出的是协议 AST（MindNode），没有会话 id——id 是 EditableNode
  // 概念（astToEditable 才生成）。探针只做字段级往返验证，诊断上下文传 null。
  // 防御式取值（不用非空断言——预算纪律 bang 只减不增）：结构异常时 before/after
  // 为 null、ok=false，由调用方诊断而非抛错。
  const ast = parseMm(text).root;
  const branch = ast?.children[0];
  const before = branch ? readGrowDir(branch.note, null) : null;
  const round = ast ? parseMm(serializeMm(ast)).root : null;
  const roundBranch = round?.children[0];
  const after = roundBranch ? readGrowDir(roundBranch.note, null) : null;
  return { ok: before === dir && after === dir, before, after };
}
