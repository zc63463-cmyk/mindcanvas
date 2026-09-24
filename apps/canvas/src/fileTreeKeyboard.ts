/**
 * 文件工作台的**键盘导航状态机**（P1-A ④）—— 纯函数、可单测、零 DOM 依赖。
 *
 * 为什么单独一层（派单书 §3.5）：`roving tabindex` 的核心是「哪个 key 是当前焦点」
 * 这一条状态与它的迁移规则；把它写在树组件里，就只能靠渲染 + 真实键盘事件间接测，
 * 而键位表（`file-management.md` §6）本身是可穷举的。抽成纯函数后：
 * 树组件只**消费**结果（把 `focusedKey` 翻成 `tabIndex=0`），规则本身可逐键断言。
 *
 * ## 键位表（file-management.md §6 原文）
 *
 * | 键 | 行为 |
 * |---|---|
 * | `↑` / `↓` | 在**可见行**序列上移动焦点 |
 * | `→` | 展开当前行；已展开 → 移到第一个子行 |
 * | `←` | 折叠当前行；已折叠（或叶子）→ 移到父行 |
 * | `Home` / `End` | 首行 / 末行 |
 * | `Enter` | 打开当前行 |
 * | `F2` | 重命名当前行 |
 * | `Delete` | 删除当前行 |
 * | `Esc` | 关面板 |
 *
 * ## 让位纪律（负控 1）
 *
 * **焦点在重命名输入框内时，全部键位让位给输入**：`↑`/`↓` 不得移动树焦点、
 * `Delete` 不得删除文档、`F2` 不得重进改名。本模块用 `TreeKeyContext.inRenameInput`
 * 表达这条规则，**拦截点仍必须在输入框自己的按键层**（R1-3 教训：不得挂 window
 * 级监听）；本模块只保证「被让位时返回 `none`」，让调用方零副作用。
 *
 * 不是什么：不读 DOM、不持有状态、不挂监听、不渲染。
 */

/** 树的可见行（已按展开态展平；`parentKey` 为根层行为 null） */
export interface VisibleRow {
  key: string;
  /** 目录行可展开/折叠；文档行是叶子 */
  isDir: boolean;
  isExpanded: boolean;
  parentKey: string | null;
  /** 同级兄弟（用于 `←` 回父级时判定「父是否折叠」；顺序即显示顺序） */
  siblingKeys: readonly string[];
}

/** 键位意图：状态机只**描述**要做什么，动作由组件接线（可测性来自这层分离） */
export type TreeKeyIntent =
  | { kind: 'focus'; key: string }
  | { kind: 'expand'; key: string }
  | { kind: 'collapse'; key: string }
  | { kind: 'open'; key: string }
  | { kind: 'rename'; key: string }
  | { kind: 'delete'; key: string }
  | { kind: 'close-panel' }
  /** 未知键 / 已让位 / 无处可去（边界不越界）→ 调用方零副作用 */
  | { kind: 'none' };

export interface TreeKeyContext {
  /** 展平后的可见行（顺序 = 屏幕顺序） */
  rows: readonly VisibleRow[];
  /** 当前持有 roving tabindex 的 key；null = 尚未进入树 */
  focusedKey: string | null;
  /**
   * 焦点是否在重命名输入框内。**true 时全部键位让位**（负控 1 的判据）。
   * 由组件在输入框的 `onKeyDown` 里传 `true`；不允许从别处猜。
   */
  inRenameInput: boolean;
}

/** 行索引；找不到 → -1 */
function indexOf(rows: readonly VisibleRow[], key: string | null): number {
  if (key === null) return -1;
  return rows.findIndex((r) => r.key === key);
}

/** 当前焦点行（无焦点时退化为首行，使「刚 Tab 进来按 ↓」不会原地不动） */
function currentRow(rows: readonly VisibleRow[], key: string | null): VisibleRow | null {
  const i = indexOf(rows, key);
  if (i >= 0) {
    const r = rows[i];
    if (r !== undefined) return r;
  }
  return rows[0] ?? null;
}

/**
 * 键位 → 意图。**唯一入口**：组件把 `KeyboardEvent.key` 与上下文交给它，
 * 按返回的 `kind` 接线（本函数绝不自己执行动作）。
 *
 * 设计取舍：`←` 在「已折叠的目录」与「文档行」上都必须回父级 —— 两者的共同点是
 * 「当前行没有可折叠的东西」，故判据写成 `!isDir || !isExpanded`，而不是分两种行写两遍。
 */
export function intentFor(key: string, ctx: TreeKeyContext): TreeKeyIntent {
  // 让位：输入框内一切键位归输入框（负控 1）。**先于**任何键位匹配。
  if (ctx.inRenameInput) return { kind: 'none' };

  const rows = ctx.rows;
  if (rows.length === 0) return key === 'Escape' ? { kind: 'close-panel' } : { kind: 'none' };
  const row = currentRow(rows, ctx.focusedKey);
  if (row === null) return { kind: 'none' };
  const i = indexOf(rows, row.key);

  switch (key) {
    case 'ArrowDown': {
      const next = rows[Math.min(i + 1, rows.length - 1)];
      return next === undefined ? { kind: 'none' } : { kind: 'focus', key: next.key };
    }
    case 'ArrowUp': {
      const prev = rows[Math.max(i - 1, 0)];
      return prev === undefined ? { kind: 'none' } : { kind: 'focus', key: prev.key };
    }
    case 'ArrowRight': {
      if (!row.isDir) return { kind: 'none' }; // 叶子无可展开
      if (!row.isExpanded) return { kind: 'expand', key: row.key };
      // 已展开 → 移到第一个子行（子行必然紧跟其父，故 i+1）
      const child = rows[i + 1];
      return child !== undefined && child.parentKey === row.key
        ? { kind: 'focus', key: child.key }
        : { kind: 'none' };
    }
    case 'ArrowLeft': {
      if (row.isDir && row.isExpanded) return { kind: 'collapse', key: row.key };
      // 已折叠的目录 / 文档行 → 回父级（根层无处可去 → 零副作用）
      return row.parentKey === null
        ? { kind: 'none' }
        : { kind: 'focus', key: row.parentKey };
    }
    case 'Home': {
      const first = rows[0];
      return first === undefined ? { kind: 'none' } : { kind: 'focus', key: first.key };
    }
    case 'End': {
      const last = rows[rows.length - 1];
      return last === undefined ? { kind: 'none' } : { kind: 'focus', key: last.key };
    }
    case 'Enter':
      return { kind: 'open', key: row.key };
    case 'F2':
      return { kind: 'rename', key: row.key };
    case 'Delete':
      return { kind: 'delete', key: row.key };
    case 'Escape':
      return { kind: 'close-panel' };
    default:
      return { kind: 'none' };
  }
}

/**
 * 展平所需的**最小节点面**（结构化类型）。
 *
 * 为什么不用 `TreeNode`：本模块是纯函数层，不该依赖 `fileTreeModel` 的类型
 * （那会把「键盘规则」与「树模型」绑在一起，将来换模型要改两处）。
 * 结构化类型让 `TreeNode[]` 天然满足，测试也能直接喂最小对象。
 */
export interface TreeLikeNode {
  key: string;
  type: 'dir' | 'doc';
  children: readonly TreeLikeNode[];
}

/**
 * 展平树为可见行（只含展开目录的子节点）。
 *
 * 与渲染同源的展平规则：`query` 非空时组件把所有命中行视为「强制展开」，
 * 因此调用方传入的 `expanded` 应当**已经**含搜索期的强制展开结果 ——
 * 本函数不重复这条判定（同一规则两处判 = 迟早分叉）。
 */
export function visibleRows(
  nodes: readonly TreeLikeNode[],
  expanded: ReadonlySet<string>,
  parentKey: string | null = null,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  for (const n of nodes) {
    const isExpanded = expanded.has(n.key);
    const siblingKeys = nodes.map((s) => s.key);
    out.push({ key: n.key, isDir: n.type === 'dir', isExpanded, parentKey, siblingKeys });
    if (n.type === 'dir' && isExpanded) {
      out.push(...visibleRows(n.children, expanded, n.key));
    }
  }
  return out;
}

/**
 * 焦点在树结构变化后的**收敛**：原 key 消失（被删/被移动/折叠隐藏）→ 就近落到
 * 可行的一行，绝不留下「tabIndex 全是 -1」的死树（那会让键盘用户彻底失去入口）。
 *
 * 选择「原索引处的行」而不是「首行」：折叠一组目录后光标停在邻近位置，
 * 比跳回顶部更接近用户的预期（`Home` 仍可一键回到顶部）。
 */
export function reconcileFocus(
  rows: readonly VisibleRow[],
  focusedKey: string | null,
  previousRows: readonly VisibleRow[],
): string | null {
  if (rows.length === 0) return null;
  if (focusedKey !== null && rows.some((r) => r.key === focusedKey)) return focusedKey;
  const prevIndex = indexOf(previousRows, focusedKey);
  const fallbackIndex = prevIndex < 0 ? 0 : Math.min(prevIndex, rows.length - 1);
  return rows[fallbackIndex]?.key ?? null;
}
