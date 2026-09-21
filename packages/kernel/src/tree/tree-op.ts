/**
 * TreeOp —— 可重放树操作（K2 唯一新设计）。
 * 把树变更提炼为操作对象：op 携带全部参数（不依赖闭包/时序），applyOp 为纯函数。
 * CRDT 留缝：将来 Loro/Yjs 多设备同步只需把 op 序列喂给 CRDT（调研第二辑 §5 结论 2）。
 * op 集以 treeOps 现有能力为准（addChild/removeNode/moveNode/updateNode），不臆造。
 */
import {
  addChild,
  findNode,
  getNode,
  moveNode,
  removeNode,
  updateNode,
  type EditableNode,
} from './treeOps.js';

/**
 * 节点字段补丁（与 updateNode 的 patch 一致）。
 * M1 加 'type'：实体 picker 需要「文本节点 ↔ 实体节点」互转（type 是实体渲染的判定依据）；
 * 属加宽（既有字段语义与行为均不变）。
 */
export type NodePatch = Partial<Pick<EditableNode, 'text' | 'url' | 'ref' | 'note' | 'type'>>;

/** 实体引用入参（setEntityRef 用；与 EntityRef 同形但解耦具体类型定义） */
export interface EntityRefInput {
  kind: string;
  id: string;
}

/** 可重放树操作（判别联合）：覆盖 treeOps 的增删移改四能力 */
export type TreeOp =
  /** 添加子节点（index 缺省 = 末尾） */
  | { type: 'add-child'; parentId: string; child: EditableNode; index?: number }
  /** 删除节点（含子树；根不可删） */
  | { type: 'remove-node'; id: string }
  /** 移动节点（拒绝根移动/移动到自身子树/深度超限） */
  | { type: 'move-node'; id: string; targetParentId: string; index: number }
  /** 更新节点字段（text/url/ref/note） */
  | { type: 'update-node'; id: string; patch: NodePatch };

/** 应用操作到树（纯函数，返回新根；非法 / 找不到目标 → 原样返回） */
export function applyOp(root: EditableNode, op: TreeOp): EditableNode {
  switch (op.type) {
    case 'add-child':
      return addChild(root, op.parentId, op.child, op.index);
    case 'remove-node':
      return removeNode(root, op.id).root;
    case 'move-node':
      return moveNode(root, op.id, op.targetParentId, op.index).root;
    case 'update-node':
      return updateNode(root, op.id, op.patch);
  }
}

/**
 * 计算逆操作（基于应用前树状态）。
 * - add-child → remove-node(child.id)
 * - remove-node → add-child(parentId, node, index)（恢复原位）
 * - move-node → move-node(id, 原父 id, 原索引)
 * - update-node → update-node(id, 原字段值)
 * 非法（目标缺失 / 根删除等）→ null（调用方视为不可逆，跳过）。
 */
export function invertOp(root: EditableNode, op: TreeOp): TreeOp | null {
  switch (op.type) {
    case 'add-child': {
      return { type: 'remove-node', id: op.child.id };
    }
    case 'remove-node': {
      const loc = findNode(root, op.id);
      if (!loc) return null;
      return { type: 'add-child', parentId: loc.parent.id, child: loc.node, index: loc.index };
    }
    case 'move-node': {
      const loc = findNode(root, op.id);
      if (!loc) return null;
      return { type: 'move-node', id: op.id, targetParentId: loc.parent.id, index: loc.index };
    }
    case 'update-node': {
      const node = getNode(root, op.id);
      if (!node) return null;
      const prev: NodePatch = {};
      if (op.patch.text !== undefined) prev.text = node.text;
      if (op.patch.url !== undefined) prev.url = node.url;
      if (op.patch.ref !== undefined) prev.ref = node.ref;
      if (op.patch.note !== undefined) prev.note = node.note;
      // M1：type 参与逆操作（实体↔文本互转的 undo 一致性）
      if (op.patch.type !== undefined) prev.type = node.type;
      return { type: 'update-node', id: op.id, patch: prev };
    }
  }
}

/** 记录操作：op + 其逆操作（undo 时应用逆操作） */
export interface RecordedOp {
  op: TreeOp;
  inverse: TreeOp;
}

/**
 * 批次记录（applyTransaction 的等价历史机制，design §6）：
 * 一次事务只产生一条历史记录（不拆成多条 RecordedOp），undo/redo 整批进出。
 * ops 与 inverses 同序：inverses[i] 撤销 ops[i]（基于 ops[0..i-1] 应用后的树计算）。
 */
export interface RecordedBatch {
  ops: TreeOp[];
  inverses: TreeOp[];
}

/** 历史条目（OpHistory 内部）：单 op 记录或批次记录（RecordedOp 形状不变，纯新增联合分支） */
type RecordedEntry = RecordedOp | RecordedBatch;

/**
 * 事务结果（design §6 冻结契约）：
 * - ok: true → applied = 实际提交的 op 数（空批次为 0，不入历史）
 * - ok: false → error.code 结构化错误码、error.step 失败的 op 下标（0 起）、error.message 人读原因；
 *   整批不提交（树与 history 零副作用，redo 分支保持不变）
 */
export type TransactionResult =
  | { ok: true; applied: number }
  | { ok: false; error: { code: string; step: number; message: string } };

/**
 * 单 op 校验 + 应用（事务内部用；与 applyOp 同一套底层函数，但把「黑盒原样返回」
 * 显式化为结构化错误——事务需要区分「非法 op」与「成功应用」）。
 * 非法：目标缺失（target-missing）/ 根保护（root-protected）/ 移动被拒（move-rejected）/
 * 零位移（no-op-move，视为无效步骤整批拒绝——入史只会记录空转）。
 */
function applyOpChecked(
  root: EditableNode,
  op: TreeOp,
): { root: EditableNode; error?: { code: string; message: string } } {
  switch (op.type) {
    case 'add-child': {
      if (getNode(root, op.parentId) === null) {
        return { root, error: { code: 'target-missing', message: `add-child 父节点不存在: ${op.parentId}` } };
      }
      return { root: addChild(root, op.parentId, op.child, op.index) };
    }
    case 'remove-node': {
      if (op.id === root.id) {
        return { root, error: { code: 'root-protected', message: '根节点不可删除' } };
      }
      const r = removeNode(root, op.id);
      if (!r.removed) {
        return { root, error: { code: 'target-missing', message: `remove-node 目标不存在: ${op.id}` } };
      }
      return { root: r.root };
    }
    case 'move-node': {
      if (op.id === root.id) {
        return { root, error: { code: 'root-protected', message: '根节点不可移动' } };
      }
      const loc = findNode(root, op.id);
      if (!loc) {
        return { root, error: { code: 'target-missing', message: `move-node 目标不存在: ${op.id}` } };
      }
      if (op.targetParentId === loc.parent.id && op.index === loc.index) {
        return { root, error: { code: 'no-op-move', message: `零位移移动: ${op.id}` } };
      }
      const r = moveNode(root, op.id, op.targetParentId, op.index);
      if (!r.moved) {
        return { root, error: { code: 'move-rejected', message: r.reason ?? '移动被拒绝' } };
      }
      return { root: r.root };
    }
    case 'update-node': {
      if (getNode(root, op.id) === null) {
        return { root, error: { code: 'target-missing', message: `update-node 目标不存在: ${op.id}` } };
      }
      return { root: updateNode(root, op.id, op.patch) };
    }
  }
}

/**
 * OpHistory —— op 序列 + 逆操作的 undo/redo（K2 新设计）。
 * 与快照式 History<T>（参考源，已移植）并存：本类以 op 序列维护状态（CRDT 留缝），
 * 快照式供快照场景使用 —— 两种机制并存说明见 K2-report。
 */
export class OpHistory {
  private root: EditableNode;
  private past: RecordedEntry[] = [];
  private future: RecordedEntry[] = [];
  /** 嵌套事务防御标志（design §6：事务内再调事务返回错误；同步实现无重入窗口，纯防御） */
  private inBatch = false;

  constructor(
    initial: EditableNode,
    private readonly limit = 100,
  ) {
    this.root = initial;
  }

  /** 当前根节点 */
  get current(): EditableNode {
    return this.root;
  }

  /** 应用操作并记录（截断 redo 分支；非法 / 不可逆 → 原样返回） */
  apply(op: TreeOp): EditableNode {
    const inverse = invertOp(this.root, op);
    if (inverse === null) return this.root;
    this.root = applyOp(this.root, op);
    this.past.push({ op, inverse });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    return this.root;
  }

  /**
   * 事务：全批预校验 + 暂存树顺序执行（design §6 冻结契约）。
   * - 在暂存树上顺序应用每个 op 并逐个计算逆操作；任一步失败 → 整批不提交，
   *   history 与树零副作用、redo 分支保持不变，返回 { ok: false, error }；
   * - 全部成功 → 一次 history 记录（单条 RecordedBatch，不拆条）、一次提交（调用方
   *   以返回后的树变化作一次变更通知——本类无监听器，通知语义由 controller 编排）；
   * - undo 按逆序恢复（inverses 从尾到头应用）、redo 按原序重放；
   * - 空批次（或无有效变化）→ ok + applied: 0，不入历史、不清空 redo；
   * - 嵌套事务 → 返回错误（nested-batch）；禁止以「连调多次 apply」或第二历史栈实现。
   */
  applyTransaction(ops: readonly TreeOp[]): TransactionResult {
    if (this.inBatch) {
      return {
        ok: false,
        error: { code: 'nested-batch', step: 0, message: '不支持嵌套事务' },
      };
    }
    if (ops.length === 0) return { ok: true, applied: 0 };
    this.inBatch = true;
    try {
      let staged = this.root;
      const inverses: TreeOp[] = [];
      let step = 0;
      for (const op of ops) {
        const checked = applyOpChecked(staged, op);
        if (checked.error) {
          return { ok: false, error: { code: checked.error.code, step, message: checked.error.message } };
        }
        const inverse = invertOp(staged, op);
        if (inverse === null) {
          return {
            ok: false,
            error: { code: 'non-invertible', step, message: `操作不可逆: ${op.type}` },
          };
        }
        staged = checked.root;
        inverses.push(inverse);
        step += 1;
      }
      // 全批成功：一次性提交（此前任何 return 均未触碰 this.root/past/future）
      this.root = staged;
      this.past.push({ ops: [...ops], inverses });
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
      return { ok: true, applied: ops.length };
    } finally {
      this.inBatch = false;
    }
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 撤销：单 op 应用逆操作；批次按逆序恢复（从最后一个 op 的逆开始）；无历史 → null */
  undo(): EditableNode | null {
    const rec = this.past.pop();
    if (!rec) return null;
    if ('ops' in rec) {
      // 逆序恢复：从最后一个 op 的逆开始（inverses[i] 撤销 ops[i]）
      for (const inverse of [...rec.inverses].reverse()) {
        this.root = applyOp(this.root, inverse);
      }
    } else {
      this.root = applyOp(this.root, rec.inverse);
    }
    this.future.push(rec);
    return this.root;
  }

  /** 重做：单 op 重放原操作；批次按原序重放；无 redo 分支 → null */
  redo(): EditableNode | null {
    const rec = this.future.pop();
    if (!rec) return null;
    if ('ops' in rec) {
      for (const op of rec.ops) this.root = applyOp(this.root, op);
    } else {
      this.root = applyOp(this.root, rec.op);
    }
    this.past.push(rec);
    return this.root;
  }

  /** 重置（打开新文件） */
  reset(initial: EditableNode): void {
    this.root = initial;
    this.past = [];
    this.future = [];
  }
}
