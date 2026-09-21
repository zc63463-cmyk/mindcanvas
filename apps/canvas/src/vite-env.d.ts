/// <reference types="vite/client" />

/**
 * R3-(b)：**真实挂载**测试观测口（`MindmapStage.tsx` 内写入）。
 *
 * 为什么是全局声明而不是 `(window as ...)` 断言：生产代码的类型断言受债务预算约束
 * （asCast 只减不增），声明式扩展 `Window` 是同一件事的无债务写法。
 *
 * **隔离**：该入口只在**测试构建**注册（`src/testBuild.ts` 的 `IS_TEST_BUILD`，
 * 由构建期 `define` 决定）。生产 `vite build` 注入 `false` → 整块被 Rollup
 * tree-shake → 产物里无注册语句、无该全局名。故此处声明在类型层可见，
 * 运行期生产并不存在该入口。
 *
 * **两类入口必须分清**：
 * - `observe`：只读观测（快照与只读事实），测试据此断言生产事实；
 * - `actions`：会改变文档状态的真实生产入口（经 `applyDoc` / `controller.undo|redo`），
 *   调用它们与用户操作走**同一条生产代码路径**，不是旁路。
 */
interface MindcanvasSummaryHostHandle {
  /** 只读观测：纯快照与只读事实，不改变任何状态 */
  observe: {
    /** 摘要草稿（渲染态快照） */
    summaryDraft: { fromId: string } | null;
    /** 草稿是否存在（hook 的**同步**真理源，与渲染时机无关） */
    hasDraft: () => boolean;
    /** 文档会话令牌（R2 的替换判据；值只用于比较是否变化） */
    documentToken: number;
    /** 当前选中节点 id（只读事实） */
    selectedId: string | null;
    /** 当前真实编辑树（**只读**使用；改树必须走 actions 或 UI） */
    root: import('@mindcanvas/kernel').EditableNode;
    /** 布局是否就绪（早退分支诊断用） */
    layoutReady: boolean;
  };
  /** 操作入口：会改变文档状态，但走真实生产路径（非旁路） */
  actions: {
    undo: () => boolean;
    redo: () => boolean;
    /** 经生产的 `applyDoc` 替换文档（同内容替换也能构造） */
    replaceDoc: (next: import('@mindcanvas/react').MindDoc) => Promise<boolean>;
  };
}

interface Window {
  __mindcanvasSummaryHost?: MindcanvasSummaryHostHandle;
}
