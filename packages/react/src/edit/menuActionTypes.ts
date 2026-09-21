/**
 * 菜单动作袋类型（中立模块，v1.8.2 收口）
 * ══════════════════════════════════════════════════════════════════════
 * 从 `contextMenuItems.ts` 抽出：环席位模型（`subRingItems.ts`）也要用这些类型，
 * 而 `contextMenuItems.ts` 又 re-export 环的派生入口（`submenuItemsFor`）——
 * 原先是「值 re-export + 类型回指」的依赖环（depcruise no-circular 报错）。
 * 类型放中立模块后，两个方向都不成环。
 *
 * 公开 API 不变：`contextMenuItems.ts` 仍 re-export 本文件的类型（`index.ts` 出口不动）。
 */
import type { GrowDir } from '@mindcanvas/kernel';

/** 实体菜单的画布侧动作（picker / 关系面板由调用方持有） */
export interface EntityMenuActions {
  /** 打开实体 picker 改引用 */
  onEditRef: (id: string) => void;
  /** 打开关系图谱面板并定位该实体 */
  onShowInGraph: (id: string) => void;
}

/** 边菜单的画布侧动作（E3：连线到…） */
export interface EdgeMenuActions {
  /** 以该节点为源新建连线 */
  onStartLink: (id: string) => void;
}

/** v1.3.0 幕布描述菜单动作 */
export interface DescMenuActions {
  /** 进入该节点描述的行内编辑（缺省 = 隐藏该入口） */
  onStart: (id: string) => void;
}

/**
 * note 笔记菜单动作。
 * 与「编辑描述」是两种不同内容：描述常驻节点盒内，note 笔记在节点下方布局区。
 */
export interface NoteMenuActions {
  /** 打开该节点的固定 note 笔记并进入编辑（缺省 = 隐藏该入口） */
  onStart: (id: string) => void;
}

/**
 * G6′ 中心菜单动作（升格 / 降格 / 父级连接显示切换）。
 * 升格 = 该子树从根下提出来成为可拖拽摆放的中心；降格 = 回到自动树布局。
 */
export interface CenterMenuActions {
  /** 升格为中心并指定生长方向 */
  onPromote: (id: string, dir: GrowDir) => void;
  /** 降格为普通节点（坐标进历史区，再升格可吸附回原位） */
  onDemote: (id: string) => void;
  /** 该节点当前是否已是中心 */
  isCenter: (id: string) => boolean;
  /** G3：该中心当前的跨岛父级连接显示状态（缺省 hide） */
  parentLinkOf: (id: string) => 'show' | 'hide';
  /** G3：切换跨岛父级连接显示（只影响显示，不改变语义归属） */
  onToggleParentLink: (id: string, next: 'show' | 'hide') => void;
  /** G2（A5）：该中心是否为切断独立（detached）——detached 禁普通降格，走显式接回 */
  isDetached: (id: string) => boolean;
  /** G2（A5）：接回 detached 分支到目标父节点（成环/深度超限由命令层拒绝并提示） */
  onAttach: (id: string, targetParentId: string) => void;
  /** C3：该中心的 cid（无 cid 的旧数据返回 undefined——菜单据此隐藏复制入口） */
  cidOf?: (id: string) => string | undefined;
  /** C3：复制中心编号到剪贴板（格式「文档名#cid」，由上层写剪贴板与反馈） */
  onCopyCid?: (id: string) => void;
}

/**
 * D3′ 生长方向菜单动作（思想分叉）。
 * dir 写在节点 note（语义意图，先例 via/edge/desc/qa；随子树迁移零成本）。
 */
export interface GrowDirMenuActions {
  /** 节点当前显式 dir（null = 继承父级/岛方向） */
  explicitDirOf: (id: string) => GrowDir | null;
  /** 设置/清除生长方向（null = 恢复继承；经 OpHistory 可撤销） */
  onSetGrowDir: (id: string, dir: GrowDir | null) => void;
  /**
   * v1.6.0：节点当前出线长度 note.len（null = 未设置，跟随布局缺省）。
   * 可选——缺省不出现「出线长度」项（向后兼容：既有调用方/测试不受影响）。
   */
  lenOf?: (id: string) => number | null;
  /** v1.6.0：设置/清除出线长度（null = 恢复缺省；与 onSetLen 同经 updateNote 可撤销） */
  onSetLen?: (id: string, len: number | null) => void;
  /**
   * v1.8.1：「出线长度 › 自定义…」的值输入交宿主（数值气泡）。
   * 缺省不注入 → 不出现「自定义…」项（原实现弹原生 prompt，已退役——裁决 M3）。
   */
  onRequestLenCustom?: (id: string) => void;
  /**
   * v1.7.1：节点 `lens.left/right` 的残留值（拖过梁又取消枢纽后会留着——
   * lens 读取与 hub 无关，非枢纽也生效，表现为「不是枢纽却线很长」）。
   * 返回非空 → 菜单出现「清除左右」复位项。可选（缺省不出现该项）。
   */
  lenSidesOf?: (id: string) => { left?: number; right?: number } | null;
  /** v1.7.1：清除 lens.left/right（保留 up/down 节奏；经 updateNote 可撤销） */
  onClearLenSides?: (id: string) => void;
}

/**
 * FO-A3 框菜单动作（改深度）。
 *
 * 成框 / 拆框是**确定性命令**（点击即写，经 OpHistory 可撤销），不需要宿主参与；
 * 只有「改框深度…」要收一个数值 → 交宿主浮层（`apps/canvas` 的数值步进气泡，
 * 与出线长度 `onRequestLenCustom` 同款——原生 `prompt` 在 webview 下会被静默吞掉）。
 */
export interface FrameMenuActions {
  /**
   * 「改框深度…」→ 宿主数值气泡（坐标由调用方按菜单位置补）。
   * **缺省不注入 → 不出现该菜单项**（与「出线长度 › 自定义…」同款，向后兼容）。
   */
  onRequestFrameDepth: (id: string, current: number, max: number) => void;
}

/**
 * v1.5.0 Section 菜单动作（Phase 1：Section = 带装饰的 Center Island，D1 裁决）。
 * 三态入口：已是 center → 标记；非 center → 升格并标记（合并单条 undo）；已是 Section → 取消。
 */
export interface SectionMenuActions {
  /** 该节点是否是某 Section 的 root（返回 sectionId；否 undefined） */
  sectionOf: (id: string) => string | undefined;
  /** 已是 center → 标记为 Section（写 cid 锚元数据，单条 undo） */
  onMark: (id: string) => void;
  /** 非 center → 升格为中心并标记为 Section（合并单条 undo） */
  onPromoteAndMark: (id: string) => void;
  /** 取消 Section（仅删元数据，不动树、不动 center） */
  onUnmark: (id: string) => void;
}
