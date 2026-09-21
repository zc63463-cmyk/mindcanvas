/**
 * ② 二级环席位模型（派生：与右键菜单同源，v1.8.2）
 * ══════════════════════════════════════════════════════════════════════
 * 从 `contextMenuItems.ts` 抽出（守 600 行预算）：事实 → 页席位（纯）+ controller 适配器。
 * 动作闭包与右键菜单同源（同命令：updateNote / onPromote / onDemote / onCopyCid / onStart；
 * 第 1 席「新建同级节点」与剪贴板席的「复制节点文本」走 `sharedCommands` 同一实现）。
 */
import { getNode, readHubFlag } from '@mindcanvas/kernel';
import type { RadialSubItem } from './radialSubRing.js';
import type { EditorController } from './controller.js';
import type { CenterMenuActions, DescMenuActions, NoteMenuActions } from './menuActionTypes.js';
import { addSiblingOf, copyNodeTextToClipboard } from './sharedCommands.js';


// ─────────────────── ② 二级环席位（派生：与右键菜单同源，v1.8.2） ───────────────────

/** 席位图标（16px stroke，与一级环同规范） */
const SUB_ICON = {
  /** 新建同级：一个已存在节点盒 + 右侧加号（与一级「新建子节点」的纯加号区分） */
  sibling: ['M2.5 4.5h6.5v7h-6.5z', 'M12.5 6v4', 'M10.5 8h4'],
  desc: ['M3.5 5h9', 'M3.5 8h6', 'M3.5 11h9'],
  note: ['M4 3.5h8v9H4z', 'M6 6.5h4', 'M6 9h2.5'],
  center: ['M8 2.5v11', 'M2.5 8h11'],
  hub: ['M8 12.5V4', 'M5 7l3-3 3 3', 'M3.5 13h9'],
  copy: ['M6 3.5h6.5v6.5', 'M3.5 6h6.5v6.5h-6.5z'],
  menu: ['M4.4 8h.01', 'M8 8h.01', 'M11.6 8h.01'],
  dir: ['M8 12.5V3.5', 'M5 6.5 8 3.5l3 3'],
  back: ['M12.5 8H3.5', 'M6.5 5 3.5 8l3 3'],
} as const;

/** 环内「复制节点文本」的画布侧动作（缺省 = 适配器直接写剪贴板；注入可加反馈/埋点） */
export interface CopyTextMenuActions {
  onCopyText: (id: string) => void;
}

/**
 * 二级环席位所依据的节点事实（纯数据）——
 * 抽出来是为了让**沙盒/测试**可以直接驱动条件灰显与动态文案（无需造 controller）。
 */
export interface SubRingFacts {
  isRoot: boolean;
  /** 已是中心（席位 3 由「升为中心」动态换成「降格为普通节点」） */
  isCenter: boolean;
  /** 有 doc#cid（剪贴板席 = 复制中心编号；否则该席退化为「复制节点文本」） */
  hasCid: boolean;
  /** note.hub（席位 4 文案与动作取反） */
  isHub: boolean;
  /** 宿主注入了描述入口 */
  hasDesc: boolean;
  /** 宿主注入了笔记入口 */
  hasNote: boolean;
}

/** 二级环模型：页席位 + id → 动作（动作闭包与右键菜单**同源同命令**） */
export interface SubRingModel {
  /** `pages[0]` = 主 7 席；`pages[1]` = 「升为中心」的方向页（末席恒为「返回」） */
  pages: readonly (readonly RadialSubItem[])[];
  /** id → 动作；`sub:more-menu` 由宿主兜底（打开既有右键菜单），不在此表 */
  actions: Readonly<Record<string, () => void>>;
}

/** 方向页：升为中心 › 四向 + 返回（末席恒为返回，回到主页 0） */
function centerDirPage(): readonly RadialSubItem[] {
  const mk = (dir: string, label: string): RadialSubItem => ({
    id: `sub:center-${dir}`,
    label,
    icon: [...SUB_ICON.dir],
  });
  return [
    mk('right', '靠右生长'),
    mk('left', '靠左生长'),
    mk('down', '靠下生长'),
    mk('up', '靠上生长'),
    { id: 'sub:back', label: '返回', icon: [...SUB_ICON.back], opensPage: 0 },
  ];
}

/**
 * 纯函数：事实 → 二级页席位。顺序 = 角度序（marking 记忆），条件不满足 → `disabled` 灰显（不抽席）。
 * 末席恒为「打开完整菜单」（渐进披露兜底）。
 * 剪贴板席**动态化**：有 cid → 复制中心编号；否则 → 复制节点文本（恒可用）——
 * 条件席若不动态化，默认态就是一个「空席」（灰显描边几乎不可见，观感 = 席位空缺）。
 * 角度预算：可用弧 296° ÷ 7 席 ≈ 42.3°/席（中半径 ≈70px → 命中弧长 ≈52px，仍在舒适线内）。
 */
export function subRingPagesFor(facts: SubRingFacts): readonly (readonly RadialSubItem[])[] {
  const centerSeat: RadialSubItem = facts.isCenter
    ? { id: 'sub:demote', label: '降格为普通节点', icon: [...SUB_ICON.center], disabled: facts.isRoot }
    : { id: 'sub:center', label: '升为中心', icon: [...SUB_ICON.center], disabled: facts.isRoot, opensPage: 1 };
  const copySeat: RadialSubItem =
    facts.isCenter && facts.hasCid
      ? { id: 'sub:copy-cid', label: '复制中心编号', icon: [...SUB_ICON.copy] }
      : { id: 'sub:copy-text', label: '复制节点文本', icon: [...SUB_ICON.copy] };
  return [
    [
      // 第 1 席（最近「更多」扇区 = 下钻后指针最先够到的位置）：生长类高频动作
      {
        id: 'sub:add-sibling',
        label: '新建同级节点',
        hint: 'Enter',
        icon: [...SUB_ICON.sibling],
        disabled: facts.isRoot,
      },
      {
        id: 'sub:edit-desc',
        label: '编辑描述',
        hint: 'Shift+Enter',
        icon: [...SUB_ICON.desc],
        disabled: !facts.hasDesc,
      },
      { id: 'sub:edit-note', label: '编辑笔记', icon: [...SUB_ICON.note], disabled: !facts.hasNote },
      centerSeat,
      {
        id: 'sub:hub',
        label: facts.isHub ? '取消出线枢纽' : '升级为出线枢纽',
        icon: [...SUB_ICON.hub],
        disabled: facts.isRoot,
      },
      copySeat,
      { id: 'sub:more-menu', label: '打开完整菜单', hint: '右键', icon: [...SUB_ICON.menu] },
    ],
    centerDirPage(),
  ];
}

/**
 * 宿主适配：`controller + 动作袋` → 二级环模型。
 * 事实读取与动作闭包**复用右键菜单同一命令**（`updateNote` / `onPromote` / `onDemote` /
 * `onCopyCid` / `onStart`）——单一动作源，避免菜单与环双实现漂移。
 */
export function submenuItemsFor(
  controller: EditorController,
  id: string,
  bags: {
    descActions?: DescMenuActions;
    noteActions?: NoteMenuActions;
    centerActions?: CenterMenuActions;
    /** 剪贴板席「复制节点文本」：注入优先（宿主可加 toast / 埋点）；缺省 = 适配器直接写剪贴板 */
    copyActions?: CopyTextMenuActions;
  },
): SubRingModel {
  const isRoot = id === controller.root.id;
  const isCenter = bags.centerActions?.isCenter(id) ?? false;
  const hasCid = bags.centerActions?.cidOf?.(id) !== undefined;
  const isHub = readHubFlag(getNode(controller.root, id)?.note);
  const facts: SubRingFacts = {
    isRoot,
    isCenter,
    hasCid,
    isHub,
    hasDesc: Boolean(bags.descActions),
    hasNote: Boolean(bags.noteActions),
  };
  const ca = bags.centerActions;
  const actions: Record<string, () => void> = {};
  // 第 1 席「新建同级节点」：与菜单「常用 › 新建同级节点」**同一实现**（sharedCommands）
  actions['sub:add-sibling'] = () => addSiblingOf(controller, id);
  if (bags.descActions) actions['sub:edit-desc'] = () => bags.descActions?.onStart(id);
  if (bags.noteActions) actions['sub:edit-note'] = () => bags.noteActions?.onStart(id);
  // 剪贴板席（动态）：无 cid 时退化为「复制节点文本」——恒可用，七席无空缺
  actions['sub:copy-text'] = () => {
    if (bags.copyActions) {
      bags.copyActions.onCopyText(id);
      return;
    }
    copyNodeTextToClipboard(controller.root, id);
  };
  // 与菜单同命令：note.hub 取反（readHubFlag 与内核判定同源，见上方枢纽项注释）
  actions['sub:hub'] = () => controller.updateNote(id, { hub: isHub ? undefined : true });
  if (ca) {
    actions['sub:demote'] = () => ca.onDemote(id);
    for (const [dir, key] of [
      ['right', 'sub:center-right'],
      ['left', 'sub:center-left'],
      ['down', 'sub:center-down'],
      ['up', 'sub:center-up'],
    ] as const) {
      actions[key] = () => ca.onPromote(id, dir);
    }
    if (ca.onCopyCid) actions['sub:copy-cid'] = () => ca.onCopyCid?.(id);
  }
  return { pages: subRingPagesFor(facts), actions };
}

