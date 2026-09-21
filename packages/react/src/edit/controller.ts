/**
 * EditorController —— 编辑器交互核心（T1）。
 * 硬约束 1：一切编辑经 TreeOp（applyOp）+ OpHistory（undo/redo 记录逆操作），禁止直接改树内存。
 * - 变更 → epoch++ → 经 FrameScheduler 单帧广播（复用 K3 调度纪律：无永续 rAF）
 * - 折叠/选中/编辑态是独立瞬时状态（不进 history，参考源同语义）
 * - serialize 走 kernel serializeMm(editableToAst(root))——canonical 往返保证
 * - R1-1：锚引用迁移收敛到管线（R1-A1）——白名单 op 在 apply/applyTransaction 一处
 *   统一触发 planReferenceMigration：结构编辑后既有锚引用被重写（改名/缩进/反缩进/
 *   重排不再断开关系线）；冲突整批拒绝（R1-A2「宁可不写也不错写」）。
 *   remove-node 条件式参与（R2-0 契约更新）：仅当触发 op/批次含 remove-node 时
 *   以 tolerateMissingTargets 计划迁移——目标被删的引用降级为 target-lost-kept
 *   诊断（保留原锚），删除不阻断、重复实体的 #N 漂移一并根治。
 */
import {
  applyOp,
  crossesFrameDepthBoundary,
  editableToAst,
  findNode,
  getNode,
  makeEntityNode,
  makeTextNode,
  nodeByPath,
  OpHistory,
  parentIdOf,
  pathOf,
  planReferenceMigration,
  serializeMm,
  type EditableNode,
  type Note,
  type TransactionResult,
  type TreeOp,
} from '@mindcanvas/kernel';
import {
  buildMigrationOps,
  collectReferenceAnchors,
  formatReferenceConflict,
  summarizeReferenceDiagnostics,
} from './cutAttach.js';
import { FrameScheduler } from '../render/scheduler.js';

export interface EditorControllerOptions {
  /** 编辑初始文本（新建节点/同级默认文案） */
  newText?: string;
  /**
   * 折叠状态持久化（应用层注入；缺省 = 不持久化）。
   * 存「索引路径」而非 id：节点 id 每次解析重生成（newId），跨刷新不可靠；
   * 路径在结构未变时稳定（pathOf/nodeByPath）。
   */
  storage?: { load: () => number[][]; save: (paths: number[][]) => void };
  /**
   * R1-1：apply() 的锚迁移冲突回调（apply 返回形状是树本身，冲突经此上报）。
   * applyTransaction 的冲突走返回值（ok:false + code=reference-conflict），不经此回调。
   */
  onAnchorConflict?: (message: string) => void;
  /**
   * R2-0：管线迁移的非阻断诊断汇总回调（R0-4 同款文案通道；apply 与
   * applyTransaction 都经此上报）。诊断随迁移自然产生（如 target-lost-kept）。
   */
  onMigrationDiagnostics?: (message: string) => void;
}

/**
 * R1-A4 op 白名单：仅「路径锚可能受影响」的 op 触发迁移，其余短路（零开销）。
 * - move-node / add-child：结构变化 → 路径/实体锚重算
 * - remove-node（R2-0 条件式启用）：删除使引用目标丢失（target-lost）+ 实体 #N
 *   重排——仅在容忍降级下计划迁移（见 apply/applyTransaction 的 tolerate 判定）
 * - update-node：仅 text patch（改名）——note/style 等高频 patch 直接短路。
 *   已知缺口：setEntityRef（转实体/转回）不改锚（kernel anchor-migrate 不支持
 *   路径锚→实体锚的重建+回验，强行迁移会被 migration-verify-failed 整批拒绝）
 *   → 转换后旧路径锚悬空（R0 健康度可见），留待后续批次。
 */
function isAnchorAffectingOp(op: TreeOp): boolean {
  if (
    op.type === 'move-node' ||
    op.type === 'add-child' ||
    op.type === 'remove-node'
  ) {
    return true;
  }
  if (op.type === 'update-node') return op.patch.text !== undefined;
  return false;
}

const MIGRATION_CONFLICT_FALLBACK = '引用迁移冲突：新路径不可唯一表示';

export class EditorController {
  /** 折叠集合（不可变 Set：toggle 产出新引用，驱动布局重算） */
  collapsed = new Set<string>();
  selectedId: string | null = null;
  editingId: string | null = null;
  dirty = false;

  private history: OpHistory;
  private listeners = new Set<() => void>();
  private frame: FrameScheduler;
  private broadcasting = false;
  private epoch = 0;
  private newText: string;
  private storage: EditorControllerOptions['storage'];
  private onAnchorConflict: ((message: string) => void) | undefined;
  private onMigrationDiagnostics: ((message: string) => void) | undefined;

  constructor(initial: EditableNode, opts: EditorControllerOptions = {}, frame?: FrameScheduler) {
    this.history = new OpHistory(initial);
    this.newText = opts.newText ?? '新节点';
    this.frame = frame ?? new FrameScheduler();
    this.storage = opts.storage;
    this.onAnchorConflict = opts.onAnchorConflict;
    this.onMigrationDiagnostics = opts.onMigrationDiagnostics;
    // 折叠持久化：构造时按路径恢复（节点 id 每次解析重生成，路径在结构未变时稳定）
    const saved = this.storage?.load();
    if (saved && saved.length > 0) {
      for (const p of saved) {
        const n = nodeByPath(this.root, p);
        if (n) this.collapsed.add(n.id);
      }
    }
  }

  get root(): EditableNode {
    return this.history.current;
  }

  get canUndo(): boolean {
    return this.history.canUndo();
  }

  get canRedo(): boolean {
    return this.history.canRedo();
  }

  // useSyncExternalStore：epoch 单调 → 变更触发重渲；渲染时读字段为最新
  getSnapshot = (): number => this.epoch;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  // ---------- 编辑原语（全部经 TreeOp + OpHistory） ----------

  /** 应用任意合法 op（返回应用后的根；非法/不可逆/被拒绝 → 原根，不置脏不广播） */
  apply(op: TreeOp): EditableNode {
    const before = this.root;
    // FO-B1（设计 §5.2 一期）：跨框 depth 边界改层级（进/出大纲层）→ no-op。
    // 单点收口：拖拽落点（MapView.onNodeMove → apply）、Shift+Tab 缩进 / 反缩进
    // （indent/outdent → applyMove → apply）、右键缩进与后续 FrameOutline 结构键全部经此；
    // 显式命令（切断/接回走 applyTransaction）不受影响——那是用户显式意图，不属「拖拽改层级」。
    if (op.type === 'move-node' && crossesFrameDepthBoundary(before, op.id, op.targetParentId)) {
      return before;
    }
    if (!isAnchorAffectingOp(op)) {
      const next = this.history.apply(op);
      if (next !== before) {
        this.dirty = true;
        this.notify();
      }
      return next;
    }
    // R1-1 白名单 op：预演 → 锚迁移（与 op 同一 history 条目）→ 提交
    const simulated = applyOp(before, op);
    if (simulated === before) {
      // op 未产生变化（非法/被拒/零位移）→ 原路径，保留既有语义
      return this.history.apply(op);
    }
    // R2-A4：仅 remove-node 场景容忍目标丢失（降级为诊断），其余保持严格
    const tolerate = op.type === 'remove-node';
    const plan = planReferenceMigration(before, simulated, collectReferenceAnchors(before), {
      tolerateMissingTargets: tolerate,
    });
    if (!plan.ok) {
      const c = plan.conflicts[0];
      this.onAnchorConflict?.(c ? formatReferenceConflict(c) : MIGRATION_CONFLICT_FALLBACK);
      return before; // 整批拒绝：不写 history、不改 root（R1-A2）
    }
    if (plan.diagnostics.length > 0) {
      this.onMigrationDiagnostics?.(summarizeReferenceDiagnostics(plan.diagnostics) ?? '');
    }
    const mig = buildMigrationOps(simulated, plan.updates);
    const result = this.history.applyTransaction([op, ...mig.ops]);
    if (!result.ok) return before; // 防御：批次校验失败零副作用（结构化错误经 debug 场景排查）
    this.dirty = true;
    this.notify();
    return this.root;
  }

  /**
   * A5：原子批次事务（透传 kernel OpHistory.applyTransaction）。
   * 全批预校验、失败零副作用；成功一次 history 记录、一次 dirty/广播。
   * 断言一刀切语义见 kernel TransactionResult；禁止以「连调多次 apply」替代。
   * R1-1：批次含白名单 op → 先预演整批再做锚迁移（迁移 op 追加到同一批次，
   * 一次 undo 同撤）；冲突 → ok:false（code=reference-conflict），整批拒绝。
   */
  applyTransaction(ops: readonly TreeOp[]): TransactionResult {
    const before = this.root;
    if (ops.length > 0 && ops.some(isAnchorAffectingOp)) {
      let staged = before;
      for (const op of ops) staged = applyOp(staged, op);
      if (staged !== before) {
        // R2-A4：批次含 remove-node 才容忍目标丢失（其余保持严格）
        const tolerate = ops.some((o) => o.type === 'remove-node');
        const plan = planReferenceMigration(before, staged, collectReferenceAnchors(before), {
          tolerateMissingTargets: tolerate,
        });
        if (!plan.ok) {
          const c = plan.conflicts[0];
          return {
            ok: false,
            error: {
              code: 'reference-conflict',
              step: 0,
              message: c ? formatReferenceConflict(c) : MIGRATION_CONFLICT_FALLBACK,
            },
          };
        }
        if (plan.diagnostics.length > 0) {
          this.onMigrationDiagnostics?.(summarizeReferenceDiagnostics(plan.diagnostics) ?? '');
        }
        const mig = buildMigrationOps(staged, plan.updates);
        if (mig.ops.length > 0) {
          const result = this.history.applyTransaction([...ops, ...mig.ops]);
          if (result.ok && result.applied > 0) {
            this.dirty = true;
            this.notify();
          }
          return result;
        }
      }
    }
    const result = this.history.applyTransaction(ops);
    if (result.ok && result.applied > 0) {
      this.dirty = true;
      this.notify();
    }
    return result;
  }

  /** 新建子节点（Tab）；返回新节点 id */
  /**
   * 新建子节点。note 可选——PG 式「生长时固化方向」用：
   * 新建即写入 note.dir，与 add-child 同一 op（一次 undo 同时回退节点与方向）。
   */
  addChild(parentId: string, text?: string, note?: Note): string {
    const child = makeTextNode(text ?? this.newText);
    if (note) child.note = { ...(child.note ?? {}), ...note };
    this.apply({ type: 'add-child', parentId, child });
    return child.id;
  }

  /** 新建实体子节点（图库插入 @img/@draw 引用）；返回新节点 id */
  addEntityChild(parentId: string, ref: { kind: string; id: string }): string {
    const child = makeEntityNode(ref);
    this.apply({ type: 'add-child', parentId, child });
    return child.id;
  }

  /** 新建同级节点（Enter）；根无同级 → null。传 note 时新节点即写入（与 addChild 同语义） */
  addSibling(id: string, text?: string, note?: Note): string | null {
    if (id === this.root.id) return null;
    const loc = findNode(this.root, id);
    if (!loc) return null;
    const child = makeTextNode(text ?? this.newText);
    if (note) child.note = { ...(child.note ?? {}), ...note };
    this.apply({ type: 'add-child', parentId: loc.parent.id, child, index: loc.index + 1 });
    return child.id;
  }

  /** 删除节点（含子树；根不可删）；返回是否成功 */
  removeNode(id: string): boolean {
    if (id === this.root.id) return false;
    this.apply({ type: 'remove-node', id });
    if (this.selectedId === id) this.selectedId = null;
    return true;
  }

  /** 编辑文本（F2 → 提交）；空文本不回写（保留原值，参考源语义） */
  updateText(id: string, text: string): void {
    if (text.trim() === '') return;
    this.apply({ type: 'update-node', id, patch: { text } });
  }

  /**
   * 转实体 / 转回文本（M1 实体 picker）：
   * - ref 非空 → 节点变实体（type='entity' + ref），文本保留作显示
   * - ref 为 null → 清引用转回文本节点（type='text'）
   * 经 TreeOp（可 undo/redo，与其余编辑同管线）
   */
  setEntityRef(id: string, ref: { kind: string; id: string } | null): void {
    this.apply({
      type: 'update-node',
      id,
      patch: { type: ref ? 'entity' : 'text', ref: ref ?? undefined },
    });
  }

  /** 编辑 note（merge patch；undefined 值键被清除——删除 qa 等场景） */
  updateNote(id: string, patch: Partial<Note>): void {
    const node = getNode(this.root, id);
    if (!node) return;
    const next: Note = { ...(node.note ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    this.apply({ type: 'update-node', id, patch: { note: next } });
  }

  /** 撤销 / 重做（OpHistory 逆操作） */
  undo(): boolean {
    const next = this.history.undo();
    if (!next) return false;
    this.dirty = true;
    this.notify();
    return true;
  }

  redo(): boolean {
    const next = this.history.redo();
    if (!next) return false;
    this.dirty = true;
    this.notify();
    return true;
  }

  // ---------- 折叠（瞬时状态，不进 history；变更写回 storage） ----------

  /** 显式折叠/展开（Ctrl+[ 折叠 / Ctrl+] 展开）；同态重复设置幂等 */
  setCollapsed(id: string, collapsed: boolean): void {
    const has = this.collapsed.has(id);
    if (has === collapsed) return;
    const next = new Set(this.collapsed);
    if (collapsed) next.add(id);
    else next.delete(id);
    this.commitCollapsed(next);
  }

  /** 切换折叠态（Space） */
  toggleCollapse(id: string): void {
    const next = new Set(this.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.commitCollapsed(next);
  }

  private commitCollapsed(next: Set<string>): void {
    this.collapsed = next;
    if (this.storage) {
      const paths: number[][] = [];
      for (const id of next) {
        const p = pathOf(this.root, id);
        if (p) paths.push(p);
      }
      this.storage.save(paths);
    }
    this.notify();
  }

  // ---------- 层级调整（Shift+Tab 缩进 / Ctrl+Shift+Tab 反缩进；move-node op） ----------

  /** 缩进：移入前一个兄弟的子节点末尾；返回是否发生移动 */
  indent(id: string): boolean {
    if (id === this.root.id) return false;
    const loc = findNode(this.root, id);
    if (!loc || loc.index === 0) return false;
    const prev = loc.parent.children[loc.index - 1]!;
    return this.applyMove(id, prev.id, prev.children.length);
  }

  /** 反缩进：上移一级为父节点的后一兄弟；返回是否发生移动 */
  outdent(id: string): boolean {
    if (id === this.root.id) return false;
    const loc = findNode(this.root, id);
    if (!loc || loc.parent.id === this.root.id) return false;
    const parentLoc = findNode(this.root, loc.parent.id);
    if (!parentLoc) return false;
    return this.applyMove(id, parentLoc.parent.id, parentLoc.index + 1);
  }

  private applyMove(id: string, targetParentId: string, index: number): boolean {
    const before = this.root;
    this.apply({ type: 'move-node', id, targetParentId, index });
    return this.root !== before;
  }

  // ---------- 方向键导航（↑↓←→；尊重折叠：折叠节点子节点不可达） ----------

  /**
   * **大纲式线性导航**（可见前序）：返回新选中 id（无变化 → null）。
   * down/up：可见前序下一/上一节点；right：子节点优先（钻入）否则下一可见；
   * left：父节点优先（返回）否则上一可见。
   *
   * ⚠️ 画布键盘方向键**不再走这里**（v1.8.9 A 档）：线性语义在二维画布上会「穿子树」
   * （↓ 先钻入自己的子树、要穿完整棵才换到下一个兄弟），且 ↓ 与 → 实现同义；
   * 画布改用几何导航 `MapViewApi.navigateFrom`（见 render/navigateDirection.ts）。
   * 本方法保留给列表/大纲式场景，语义不变（既有测试即该语义的契约）。
   */
  navigate(dir: 'up' | 'down' | 'left' | 'right'): string | null {
    const id = this.selectedId;
    if (id === null) return null;
    const ids = this.visibleIds();
    const i = ids.indexOf(id);
    if (i < 0) return null;
    let target: string | null = null;
    switch (dir) {
      case 'down':
        target = ids[i + 1] ?? null;
        break;
      case 'up':
        target = ids[i - 1] ?? null;
        break;
      case 'right':
        target = ids[i + 1] ?? null;
        break;
      case 'left': {
        const parent = parentIdOf(this.root, id);
        target = parent !== null ? parent : (ids[i - 1] ?? null);
        break;
      }
    }
    if (target === null || target === id) return null;
    this.selectedId = target;
    this.notify();
    return target;
  }

  /** 可见节点前序 id 表（折叠节点的子节点被跳过——布局也裁剪它们） */
  private visibleIds(): string[] {
    const out: string[] = [];
    const walk = (n: EditableNode): void => {
      out.push(n.id);
      if (this.collapsed.has(n.id)) return;
      for (const c of n.children) walk(c);
    };
    walk(this.root);
    return out;
  }

  // ---------- 选中 / 编辑态 ----------

  select(id: string | null): void {
    this.selectedId = id;
    this.notify();
  }

  startEdit(id: string | null): void {
    this.editingId = id;
    this.notify();
  }

  /** 提交编辑：空文本 = 取消（参考源：不把节点改空）；Esc/blur 分支在组件层 */
  commitEdit(id: string, text: string): void {
    this.editingId = null;
    if (text.trim() !== '') this.updateText(id, text);
    this.notify();
  }

  cancelEdit(): void {
    this.editingId = null;
    this.notify();
  }

  // ---------- 序列化 / 保存态 ----------

  /** canonical .mm.md 文本（round-trip 保证由 serializeMm + verifyRoundTrip 承载） */
  serialize(): string {
    return serializeMm(editableToAst(this.root));
  }

  /** 保存成功后清脏标记 */
  markSaved(): void {
    this.dirty = false;
    this.notify();
  }

  /** 打开新文件时重置（history 分支清空 + 折叠清空并持久化） */
  reset(initial: EditableNode): void {
    this.history.reset(initial);
    this.collapsed = new Set();
    this.storage?.save([]);
    this.selectedId = null;
    this.editingId = null;
    this.dirty = false;
    this.notify();
  }

  /** 组件卸载清理 */
  dispose(): void {
    this.frame.dispose();
    this.listeners.clear();
  }

  private notify(): void {
    this.epoch += 1;
    if (this.broadcasting) return;
    this.broadcasting = true;
    this.frame.request(() => {
      this.broadcasting = false;
      for (const l of [...this.listeners]) l();
    });
  }
}
