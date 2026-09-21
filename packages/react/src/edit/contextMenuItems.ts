/**
 * 节点右键菜单项（从 app 层下沉：纯函数可测）。
 * 既有项语义完全保留；N2 追加实体节点专属三项（改引用… / 在关系图中显示 / 转为纯文本）——
 * 实体项的画布侧动作由调用方注入（entityActions），缺省则不追加（向后兼容）。
 *
 * v1.3.0 扩展：可选 descActions —— 「编辑描述」入口，与 Shift+Enter 同一动作
 * （进入节点下方幕布描述 note.desc 的行内编辑）。
 * v1.4.0 扩展：可选 noteActions —— 「编辑笔记」，打开节点下方的固定笔记。
 * 两种内容不同：desc 常驻节点盒内，固定 note 笔记在节点下方向下生长并参与布局。
 *
 * v1.8.1 菜单梳理（右键能力盘点与清理，用户裁决）：
 *   - **分区**：常用（与环一级对齐置顶：新建/同级/编辑/删除）/ 内容 / 结构 /
 *     生长与连线 / 岛与区域——分区顺序 = 构造顺序 = 渲染顺序
 *   - **快捷键提示**（hint）：Tab / Enter / F2 / Del / Space / Shift+Tab 等
 *   - **删除改直删**：原生 confirm 摩擦太大，撤销（Ctrl+Z）兜底（裁决 M2）；
 *     环内删除的气泡确认保留（已验收交互，另行裁决）
 *   - **自定义长度不再弹原生 prompt**：交宿主注入 `onRequestLenCustom`（数值气泡）；
 *     缺省注入则隐藏「自定义…」项（向后兼容）
 *   - **副标题消歧**：编辑描述（盒内）/ 编辑笔记（盒下）/ 升为中心（钉住坐标）/
 *     生长方向（子树往哪边长）
 *
 * v1.8.2 T6（菜单瘦身 + 深度优化，用户拍板）：
 *   - **阶段 1 移除 4 项**：编辑描述 / 编辑笔记 / 升级·取消出线枢纽 / 复制中心编号
 *     —— 环（已进正片，T5）有等价席位；描述另有 Shift+Enter 双代偿
 *   - **方向型 / 参数型收成「一行 + 子页」**（`page`）：生长方向（4 向 + 继承）/ 出线长度（预设 + 缺省 + 自定义）
 *     / 升为中心（4 向）——首屏行数 28 → 12，行内显示**当前值**，行尾 hint 指出更快的通道
 */
import {
  canCreateFrame,
  frameOf,
  getNode,
  readLinkLen,
  type EditableNode,
  type Note,
} from '@mindcanvas/kernel';
import type { ContextMenuItem } from '../chrome/ContextMenu.js';
import { inferChildDir } from '../render/growDir.js';
import type { EditorController } from './controller.js';
import { createFrame, frameDepthRange, removeFrame } from './frameCommands.js';
import { addSiblingOf, copyNodeTextToClipboard } from './sharedCommands.js';

/** 菜单分区（v1.8.1；顺序即渲染顺序，渲染端在变化处画标题与分隔线） */
const SEC = {
  common: '常用',
  content: '内容',
  structure: '结构',
  growth: '生长与连线',
  island: '岛与区域',
} as const;

/** 成框默认深度（设计 §4.1：默认 `depth = 2`；步进器 UI 属 B2） */
const FRAME_DEFAULT_DEPTH = 2;

/**
 * 动作袋类型在**中立模块** `menuActionTypes.ts`：环席位模型（`subRingItems.ts`）也要用，
 * 放本文件会与「本文件 re-export 环派生入口（`submenuItemsFor`）」形成依赖环
 * （depcruise no-circular）。此处 import + re-export 保持公开 API 与既有 import 路径不变。
 */
import type {
  CenterMenuActions,
  DescMenuActions,
  EdgeMenuActions,
  EntityMenuActions,
  FrameMenuActions,
  GrowDirMenuActions,
  NoteMenuActions,
  SectionMenuActions,
} from './menuActionTypes.js';
export type {
  CenterMenuActions,
  DescMenuActions,
  EdgeMenuActions,
  EntityMenuActions,
  FrameMenuActions,
  GrowDirMenuActions,
  NoteMenuActions,
  SectionMenuActions,
} from './menuActionTypes.js';

export function contextMenuItemsFor(
  controller: EditorController,
  id: string,
  entityActions?: EntityMenuActions,
  edgeActions?: EdgeMenuActions,
  centerActions?: CenterMenuActions,
  growDirActions?: GrowDirMenuActions,
  sectionActions?: SectionMenuActions,
  frameActions?: FrameMenuActions,
): ContextMenuItem[] {
  const isRoot = id === controller.root.id;
  // G6′ 触发一致性：菜单生长与 Tab 生长共用 inferChildDir（兄弟多数 → 父方向 → 继承）
  const inferDirNoteOf = (nid: string): Note | undefined => {
    const n = getNode(controller.root, nid);
    const d = n ? inferChildDir(n) : null;
    return d ? { dir: d } : undefined;
  };
  // （v1.8.2：同级生长方向推断搬去 `sharedCommands.addSiblingOf`——环第 1 席与菜单同一实现）

  // ── 常用（v1.8.1：与环一级对齐置顶——新建/同级/编辑/删除）──
  const items: ContextMenuItem[] = [
    {
      label: '新建子节点',
      hint: 'Tab',
      section: SEC.common,
      onSelect: () => {
        const cid = controller.addChild(id, undefined, inferDirNoteOf(id));
        controller.select(cid);
        controller.startEdit(cid);
      },
    },
  ];
  if (!isRoot) {
    items.push({
      label: '新建同级节点',
      hint: 'Enter',
      section: SEC.common,
      onSelect: () => addSiblingOf(controller, id),
    });
  }
  items.push({
    label: '编辑',
    hint: 'F2',
    section: SEC.common,
    onSelect: () => controller.startEdit(id),
  });
  if (!isRoot) {
    // v1.8.1（裁决 M2）：直删——原生 confirm 摩擦太大；撤销（Ctrl+Z）兜底
    items.push({
      label: '删除节点',
      hint: 'Del',
      danger: true,
      section: SEC.common,
      onSelect: () => {
        controller.removeNode(id);
        controller.select(null);
      },
    });
  }

  // ── 内容 ──
  // v1.8.2（T6 阶段 1 瘦身）：描述 / 笔记入口**移出菜单**——环内二级有等价席位（第 2/3 席），
  // 且描述另有 Shift+Enter 双代偿（`descActions` / `noteActions` 现在只喂环席位模型）。
  // v1.8.2：复制节点文本——与环剪贴板席**同源同一实现**（`sharedCommands`）；通用动作，常驻内容区
  items.push({
    label: '复制节点文本',
    section: SEC.content,
    onSelect: () => copyNodeTextToClipboard(controller.root, id),
  });
  // N2：实体节点专属项（改引用 / 关系图定位 / 转纯文本）
  if (entityActions) {
    const node = getNode(controller.root, id);
    if (node && node.type === 'entity' && node.ref) {
      items.push(
        { label: '改引用…', section: SEC.content, onSelect: () => entityActions.onEditRef(id) },
        {
          label: '在关系图中显示',
          section: SEC.content,
          onSelect: () => entityActions.onShowInGraph(id),
        },
        {
          label: '转为纯文本',
          section: SEC.content,
          onSelect: () => controller.setEntityRef(id, null),
        },
      );
    }
  }

  // ── 结构 ──
  if (!isRoot) {
    items.push(
      {
        label: '缩进',
        hint: 'Shift+Tab',
        section: SEC.structure,
        onSelect: () => controller.indent(id),
      },
      {
        label: '反缩进',
        hint: 'Ctrl+Shift+Tab',
        section: SEC.structure,
        onSelect: () => controller.outdent(id),
      },
    );
  }
  items.push({
    label: '折叠 / 展开',
    hint: 'Space',
    section: SEC.structure,
    onSelect: () => controller.toggleCollapse(id),
  });
  // FO-A3：子树框编辑（局部大纲）——三态入口（非框→成框；已框→改深度 / 拆框）。
  // 成框前先过 canCreateFrame（§3.3）：祖先大纲层内不显示入口，避免「点了才被拒」。
  // 成框用默认 depth 2；改深度交**宿主浮层**（FO-UI1：原生 prompt 在 webview 下会被静默
  // 吞掉；未注入 frameActions 时不出现该项——与「出线长度 › 自定义…」同款纪律）。
  const frameNode = getNode(controller.root, id);
  if (frameNode) {
    if (frameOf(frameNode.note) !== undefined) {
      // 已框：改深度 / 拆框（无后代也保留——拆框必须可达）
      if (frameActions !== undefined) {
        items.push({
          label: '改框深度…',
          section: SEC.structure,
          onSelect: () => {
            const range = frameDepthRange(controller, id);
            if (range === null) return; // 防御：与上文 frameOf 同源，理论不可达
            frameActions.onRequestFrameDepth(id, range.current, range.max);
          },
        });
      }
      items.push({
        label: '拆框',
        section: SEC.structure,
        onSelect: () => removeFrame(controller, id),
      });
    } else if (frameNode.children.length > 0 && canCreateFrame(controller.root, id).ok) {
      // 成框入口：**有后代**才给（深度范围 1…min(8, 子树高度)，叶子成框只剩框头 = 退化，
      // 设计 §4.1）；且守 v1.8.2 T6「普通节点首屏 12 行」预算——叶子节点不增行。
      // 数据层（frameCommands.createFrame）仍宽松：宿主/命令面板可按需成框。
      items.push({
        label: '成框编辑…',
        section: SEC.structure,
        onSelect: () => createFrame(controller, id, FRAME_DEFAULT_DEPTH),
      });
    }
  }
  // E3：连线到…（以该节点为源新建自由边；树形之外的语义连接）
  if (edgeActions) {
    items.push({ label: '连线到…', section: SEC.structure, onSelect: () => edgeActions.onStartLink(id) });
  }

  // ── 生长与连线（D3′ 生长方向 / 出线长度 / 出线枢纽）──
  // v1.8.2（T6）：**方向型 / 参数型收成「一行 + 子页」**——首屏只留 2 行，行内显示当前值，
  // 行尾 hint 指出更快的通道（Alt+方向 / 拖梁）。子页结构与环「同一外圈换页」同语义。
  if (growDirActions && !isRoot) {
    const cur = growDirActions.explicitDirOf(id);
    const DIR_LABEL = { right: '向右', left: '向左', down: '向下', up: '向上' } as const;
    items.push({
      label: `生长方向：${cur !== null ? DIR_LABEL[cur] : '继承'}`,
      hint: 'Alt+方向',
      section: SEC.growth,
      page: [
        ...(['right', 'left', 'down', 'up'] as const).map((dir) => ({
          label: `${DIR_LABEL[dir]}${cur === dir ? ' ✓' : ''}`,
          onSelect: () => growDirActions.onSetGrowDir(id, dir),
        })),
        // 显式方向才提供「继承」出口（已在继承 → 无需该项）
        ...(cur !== null
          ? [{ label: '继承（跟随父级）', onSelect: () => growDirActions.onSetGrowDir(id, null) }]
          : []),
      ],
    });
    // v1.6.0：出线长度（note.len）——与生长方向同族的软约束：只调本节点连线的
    // 直线段长度（up/down 垂直 / left/right 水平），不改居中与避让。
    // v1.8.2（T6）：预设 + 缺省 + 自定义全部收进子页；行内只显示当前值（预设外的值直接显示数字）。
    if (growDirActions.lenOf && growDirActions.onSetLen) {
      const curLen = growDirActions.lenOf(id);
      const presets = [14, 32, 60, 100];
      const isCustom = curLen !== null && !presets.includes(curLen);
      const requestCustom = growDirActions.onRequestLenCustom;
      items.push({
        label: `出线长度：${curLen === null ? '缺省' : curLen}`,
        hint: '拖梁',
        section: SEC.growth,
        page: [
          ...presets.map((v) => ({
            label: `${v}${curLen === v ? ' ✓' : ''}`,
            onSelect: () => growDirActions.onSetLen?.(id, v),
          })),
          { label: `缺省${curLen === null ? ' ✓' : ''}`, onSelect: () => growDirActions.onSetLen?.(id, null) },
          // v1.8.1：自定义值走宿主注入的数值气泡（原 window.prompt 退役——裁决 M3）
          ...(requestCustom
            ? [{ label: `自定义…${isCustom ? ' ✓' : ''}`, onSelect: () => requestCustom(id) }]
            : []),
        ],
      });
    }
    // v1.7.1：左右出线残留复位（lens.left/right 与 hub 无关——取消枢纽后拖出的长间距会留着；
    // 出现条件 = 确实有残留值，避免菜单噪音）
    if (growDirActions.lenSidesOf && growDirActions.onClearLenSides) {
      const sides = growDirActions.lenSidesOf(id);
      if (sides && (sides.left !== undefined || sides.right !== undefined)) {
        const desc = [
          sides.left !== undefined ? `左 ${sides.left}` : null,
          sides.right !== undefined ? `右 ${sides.right}` : null,
        ]
          .filter(Boolean)
          .join(' / ');
        items.push({
          label: `出线长度 › 清除左右出线残留（${desc}）`,
          section: SEC.growth,
          onSelect: () => growDirActions.onClearLenSides?.(id),
        });
      }
    }
  }
  // v1.8.2（T6 阶段 1）：出线枢纽入口**移出菜单**——环第 5 席「升级 / 取消出线枢纽」为等价入口。
  // 「hub: 'true' 字符串容错（readHubFlag）」的语义由环席位继承（见 `subRingItems.ts` 同源判定）。

  // ── 岛与区域（G6′ 中心 / G2 接回 / G3 父级连接 / C3 编号 / v1.5 Section）──
  if (centerActions && !isRoot) {
    if (centerActions.isCenter(id)) {
      const detached = centerActions.isDetached(id);
      if (detached) {
        // G2（A5）：detached 无有效父级 → 禁普通降格；接回 = 显式命令（选中目标节点后操作）
        const target = controller.selectedId;
        const attachable = target !== null && target !== id ? { targetId: target } : null;
        items.push({
          label:
            attachable !== null
              ? '接为所选节点的子树'
              : '接为子树（先选中目标父节点）',
          disabled: attachable === null,
          section: SEC.island,
          onSelect: () => {
            if (attachable === null) return;
            centerActions.onAttach(id, attachable.targetId);
          },
        });
      } else {
        // 非切断中心 → 普通降格出口（坐标进历史区，再升格可吸附回原位）
        items.push({
          label: '降格为普通节点',
          section: SEC.island,
          onSelect: () => centerActions.onDemote(id),
        });
      }
      // G3：跨岛父级连接显示切换（detached 强制不显示容器线，无切换意义）
      if (!detached) {
        const pl = centerActions.parentLinkOf(id);
        items.push({
          label: pl === 'show' ? '隐藏父级连接' : '显示父级连接',
          section: SEC.island,
          onSelect: () => centerActions.onToggleParentLink(id, pl === 'show' ? 'hide' : 'show'),
        });
      }
      // v1.8.2（T6 阶段 1）：复制中心编号**移出菜单**——环剪贴板席为等价入口
      // （中心且有 cid 时该席显示「复制中心编号」，否则退化为「复制节点文本」）。
    } else {
      // G6″（A3）：任意深度节点可升格（用户批准的产品核心）。
      // v1 的「仅根直接子节点」守卫源于布局层重复投影缺陷——A3 起由 kernel
      // projectIslands 递归投影根治（深层升格从父岛剔除、独立成岛），菜单不再设限。
      // v1.8.2（T6）：四向收进**子页**（与环「升为中心 ⌄ → 方向页」同语义）；行尾 hint 指出更快的通道。
      const CENTER_DIR_LABEL = { right: '靠右生长', left: '靠左生长', down: '靠下生长', up: '靠上生长' } as const;
      items.push({
        label: '升为中心（钉住坐标）',
        hint: '环：更多',
        section: SEC.island,
        page: (['right', 'left', 'down', 'up'] as const).map((dir) => ({
          // 文案与环方向页统一（靠右生长 / 靠左生长 / 靠下生长 / 靠上生长）
          label: CENTER_DIR_LABEL[dir],
          onSelect: () => centerActions.onPromote(id, dir),
        })),
      });
    }
  }
  // v1.5.0：Section 三态入口（D1：Section ⇒ center，不存在非 center 的 Section）
  if (sectionActions && centerActions && !isRoot) {
    const secId = sectionActions.sectionOf(id);
    if (secId !== undefined) {
      items.push({
        label: '取消 Section',
        section: SEC.island,
        onSelect: () => sectionActions.onUnmark(id),
      });
    } else if (centerActions.isCenter(id)) {
      items.push({
        label: '标记为 Section',
        section: SEC.island,
        onSelect: () => sectionActions.onMark(id),
      });
    } else {
      items.push({
        label: '设为 Section（升为中心）',
        section: SEC.island,
        onSelect: () => sectionActions.onPromoteAndMark(id),
      });
    }
  }
  return items;
}

/** 节点显示名（菜单文案用） */
export function getNodeLabel(root: EditableNode, id: string): string {
  const n = getNode(root, id);
  if (!n) return '节点';
  if (root.id === id) return n.text ?? '根';
  return n.text ?? '（无文本）';
}

// ② 二级环席位模型在同目录 `subRingItems.ts`（守 600 行预算）；此处再导出，保持对外 API 不变
export { submenuItemsFor, subRingPagesFor } from './subRingItems.js';
export type { SubRingFacts, SubRingModel } from './subRingItems.js';
