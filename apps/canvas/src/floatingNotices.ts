/**
 * 舞台浮动提示条的**唯一位置系统与消退策略**（P1-A rider-A · P0-C-review §7-a）。
 * ══════════════════════════════════════════════════════════════════════
 * 要解决的问题（P0-C-review §7-a 原文）：`MindmapStage.tsx` 里四条浮动条各自手写
 * `position: absolute; top: 64 / 100 / 16 / 10`，位置靠**逐个硬编码的数字**维持
 * 互不重叠，消退策略也各写各的（有的 `setTimeout` 4000、有的 2500、有的从不消退）。
 *
 * 本模块把两件事收敛成**唯一事实源**：
 *  ① **位置系统**：`FLOATING_SLOTS` 一张表 —— 每个槽位有名字、层级（top/center）、
 *     序号，几何值由表推导，组件不得再写字面量；
 *  ② **消退策略**：`NoticeDismiss` 显式参数化 —— `auto(ms)` = 定时消退，
 *     `manual` = 常驻直到用户/状态清除。
 *
 * **既有语义逐字保留**（派单书 §3.6：「错误类常驻、成功类自动消退」指的是
 * **不得把既有的常驻条改成自动消退**这条禁令，而不是要求按 tone 一刀切）：
 * 命令告警 4s 自动消退、预方向提示 2.5s 自动消退、资产条点击关闭、规模提示
 * 条件存续期间常驻 —— 四个槽位的 `dismiss` 与改动前**逐一相同**，
 * `floating-notices-consistency.test.tsx` 逐值钉死。把错误条也改成自动消退
 * 会制造假安心，是明令禁止的错法（§8 第 5 条）。
 *
 * 不是什么：不渲染、不持有状态、不注册定时器（定时器在消费组件的 effect 里，
 * 因为「何时清」是组件生命周期的一部分）。本模块只回答「放在哪、多久退」。
 */

/** 浮条的语义类别 —— 决定**消退策略**的默认值（不是外观） */
export type NoticeTone = 'error' | 'hint' | 'info';

/**
 * 消退策略。
 *
 * `auto` 带毫秒数而不是只给一个布尔：不同提示的阅读时间不同（预方向提示比
 * 资产落点提示更短命），把毫秒留在槽位表里可读性最好 —— 但**默认值集中在这里**，
 * 组件不得再写 `setTimeout(..., 4000)` 这种裸数字。
 */
export type NoticeDismiss = { kind: 'auto'; ms: number } | { kind: 'manual' };

/**
 * 浮动槽位的名字（**新槽位必须加在这里**，不得在组件里临时编一个 top 值）。
 *
 * 命名按「用途」而不是「位置」：位置会随布局调整而变，用途不会。
 * 这保证将来挪动布局时只改本文件一处。
 */
export type FloatingSlot =
  | 'command-notice' // A5：命令拒绝 / 事务失败（错误类 → 常驻语义由 tone 给，见下）
  | 'asset-notice' // P0-B ⑦：资产落点 / 失败
  | 'pre-dir-hint' // 预方向提示
  | 'scale-notice'; // T8 规模提示

interface SlotSpec {
  /** 距顶像素（居中层） */
  top: number;
  /** 层叠顺序 */
  zIndex: number;
  /** 语义类别 → 决定默认消退策略 */
  tone: NoticeTone;
  /**
   * 消退策略。**显式写在这里**（不在组件里）：
   *  - `manual`：常驻，直到状态被清除（错误/警示的既有语义）；
   *  - `auto`：到点自动清（提示类）。
   */
  dismiss: NoticeDismiss;
}

/**
 * 位置系统（唯一事实源）。
 *
 * 为什么是「居中 + 显式 top」而不是「各自 absolute 手写」：位置值只在本表出现一次，
 * 组件侧零字面量（源码守卫测试扫描 `MindmapStage.tsx` 里的旧值）；
 * 四条各为一行高的横条，`top` 64 / 100 / 16 / 10 互不重叠 ——
 * 与改动前的四个数字**逐一相同**（几何没动，动的只是「写在哪」）。
 */
export const FLOATING_SLOTS: Record<FloatingSlot, SlotSpec> = {
  // 命令告警：错误色、4s 自动消退（既有语义：错误也要让开画布，但不制造常驻恐慌）
  'command-notice': { top: 64, zIndex: 5, tone: 'error', dismiss: { kind: 'auto', ms: 4000 } },
  // 资产落点/失败：中性色、点击关闭（既有语义：不是错误，用户读完自己点掉）
  'asset-notice': { top: 100, zIndex: 5, tone: 'info', dismiss: { kind: 'manual' } },
  // 预方向提示：提示色、2.5s 自动消退（既有语义：轻反馈，不必常驻）
  'pre-dir-hint': { top: 16, zIndex: 6, tone: 'hint', dismiss: { kind: 'auto', ms: 2500 } },
  // 规模提示：错误色（条件存续期间常驻——节点数不降它不走，是状态不是通知）
  'scale-notice': { top: 10, zIndex: 3, tone: 'error', dismiss: { kind: 'manual' } },
};

/** 槽位定位样式（`top` / `zIndex` / 水平居中）—— 组件**只**用这个，不写字面量 */
export function floatingSlotStyle(slot: FloatingSlot): {
  position: 'absolute';
  top: number;
  left: string;
  transform: string;
  zIndex: number;
} {
  const spec = FLOATING_SLOTS[slot];
  return {
    position: 'absolute',
    top: spec.top,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: spec.zIndex,
  };
}

/**
 * 槽位的消退毫秒（`manual` → null，调用方据此**不注册**定时器）。
 * 组件用 `useNoticeDismiss` 消费本函数，不得自己读 `FLOATING_SLOTS` 里的数字。
 */
export function dismissMsOf(slot: FloatingSlot): number | null {
  const d = FLOATING_SLOTS[slot].dismiss;
  return d.kind === 'auto' ? d.ms : null;
}

/** 槽位是否为常驻（错误/警示类）—— 供测试与几何断言读取，不参与渲染 */
export function isPersistent(slot: FloatingSlot): boolean {
  return FLOATING_SLOTS[slot].dismiss.kind === 'manual';
}

/**
 * 浮条的**基础外观**（唯一事实源）：位置由 `floatingSlotStyle` 给，视觉由这里给。
 *
 * 为什么外观也收进来：rider-A 要求「统一位置系统与消退策略」，而四条浮条此前
 * 连 `padding` / `borderRadius` / `maxWidth` 都不一致（8×14 vs 8×12 vs 6×14）——
 * 位置统一了而内边距还在漂，视觉上仍不是一套。语义差异（错误红的底色）由
 * 调用方按 `tone` **覆写** `background` / `borderColor` / `color` 三件，
 * 其余几何一律取自本函数。
 */
export function floatingBaseStyle(): {
  maxWidth: number;
  padding: string;
  borderRadius: number;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  pointerEvents: 'none';
  userSelect: 'none';
} {
  return {
    maxWidth: 460,
    padding: '8px 14px',
    borderRadius: 8,
    fontSize: 12,
    lineHeight: 1.6,
    fontFamily: 'inherit',
    pointerEvents: 'none',
    userSelect: 'none',
  };
}

/**
 * tone → 视觉三件（底色 / 描边 / 文字色）。
 *
 * `error` 的字节是既有 `MindmapStage.tsx` 里命令告警条的原值（未改一字：
 * 真浏览器截图基线依赖它）；`hint` 是预方向提示的原值；`info` 是资产条的
 * 中性底（P0-B 刻意选的「落点提示不是错误」）。
 */
export function floatingToneStyle(tone: NoticeTone): {
  background: string;
  border: string;
  color: string;
} {
  switch (tone) {
    case 'error':
      return {
        background: 'rgba(226, 75, 74, 0.14)',
        border: '1px solid rgba(226, 75, 74, 0.5)',
        color: '#e24b4a',
      };
    case 'hint':
      return {
        background: 'rgba(64, 128, 255, 0.14)',
        border: '1px solid rgba(64, 128, 255, 0.5)',
        color: '#2f6fed',
      };
    case 'info':
      return {
        background: 'rgba(120, 170, 255, 0.12)',
        border: '1px solid rgba(120, 170, 255, 0.45)',
        color: '#e8eaef',
      };
  }
}
