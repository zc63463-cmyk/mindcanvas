/**
 * 侧面板簇（S1：互斥单态）—— 搜索 / 大纲 / 图库 / 关系图谱。
 *
 * 从 `MindmapStage` 的 StageContent 拆出，属代码结构规范化 T1 的第 3 小步。
 *
 * 为什么能整体抽：这四个面板共享 S1 的**互斥单态**管理（`panel`），
 * 同一时刻最多显示一个，是天然的单一职责单元。抽走后 StageContent
 * 只剩「画布 + 编辑器浮层 + 工具栏」。
 *
 * 不是什么：不含实体 picker / 边编辑器 / 右键菜单——它们不是 `panel` 单态的一部分，
 * 各自有独立的开关状态，仍留在 StageContent。
 */
import type { Entity } from '@mindcanvas/kernel';
import type {
  AssetHost,
  AssetInsertAction,
  AssetItem,
  EditorController,
  EntityRelation,
} from '@mindcanvas/react';
import {
  AssetPanel,
  EntityGraphPanel,
  INLINE_SVG_LIMIT,
  OutlinePanel,
  SearchPanel,
  searchMind,
  svgToDataUrl,
} from '@mindcanvas/react';
import { useCallback } from 'react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';

/**
 * 未挂载工作区且不可内联时的拒绝**键**（I-10 规则 3）。
 *
 * P0-C ②：这里此前是**已成形文案**（「这张图片需要先打开一个文件夹作为工作区，
 * 才能插入到文档里。」），经 `onInsertRefused` 直塞提示位 —— 绕过唯一事实源的
 * 第二条通道，两处文案只能靠人眼同步。现在只传键：文案落在
 * `assetNotices.ASSET_INSERT_REFUSAL_COPY['inline-impossible']` 一处，
 * **字节一字未改**（既有断言若指向该句，照样成立）。
 */
const REFUSED_INLINE_IMPOSSIBLE = 'inline-impossible' as const;

/**
 * 归一化产物的引用 id → 文档里的引用值（P0-B）。
 *
 * 归一化产物的 `refId` 已是**完整**引用 id（`assets/<rel>` / `data:` 形态），
 * 故这里只补 `kind:` 前缀 —— 与既有格式（`assetRef.ts` 解析 `kind:id`）一致。
 */
function refValueOf(refId: string, kind: 'img' | 'draw'): string {
  return `${kind}:${refId}`;
}

/**
 * 自包含兜底的引用 id（P0-B）：只有「能净化的 SVG 源码」才有内联形态。
 *
 * 判据刻意**收窄**到「有 svg 源码」：
 *  - 内置图标（`source: 'builtin'`，自带源码）→ 内联，child 路径也因此不断图（CE-05）；
 *  - 小型上传 SVG（宿主留了源码）→ 内联；
 *  - 位图 / 大 SVG（无源码或超限）→ 拒绝（`unsupported-format`）。
 *
 * 内联之前一律过 `normalizeForInsert`（它内部走 `sanitizeInlineSvg`）——
 * 本兜底只负责挑出**候选**，净化这件事不在应用层重写一遍。
 */
function inlineRefIdOf(item: AssetItem): { refId: string | null; reason: string } {
  if (typeof item.svg !== 'string') {
    return { refId: null, reason: REFUSED_INLINE_IMPOSSIBLE };
  }
  if (item.kind === 'draw' && item.svg.length <= INLINE_SVG_LIMIT) {
    return { refId: svgToDataUrl(item.svg), reason: '' };
  }
  if (item.source === 'builtin') return { refId: svgToDataUrl(item.svg), reason: '' };
  return { refId: null, reason: REFUSED_INLINE_IMPOSSIBLE };
}

/** 侧面板的互斥状态（null = 全关） */
export type PanelId = 'search' | 'outline' | 'assets' | 'relation' | null;

export interface SidePanelsProps {
  /** 当前打开的面板（互斥；null 时本组件渲染为空） */
  panel: PanelId;
  controller: EditorController;
  /** 图库：资产清单（异步加载） */
  assetList: AssetItem[];
  assetHost: AssetHost;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  /** 关系图谱：实体关系 + 当前选中实体的 key + 语义边清单 */
  relations: EntityRelation[];
  activeRefKey: string | null;
  /** 形状跟随 EntityGraphPanel 的 edges（用 ComponentProps 推导，避免依赖其内部类型名） */
  edgeItems: ComponentProps<typeof EntityGraphPanel>['edges'];
  /** R2-3：重挂候选 + 行内动作（写路径归宿主 useEdgeActions，本组件不持有写逻辑） */
  choices?: ComponentProps<typeof EntityGraphPanel>['choices'];
  onReattachEdge?: ComponentProps<typeof EntityGraphPanel>['onReattachEdge'];
  onDeleteEdge?: ComponentProps<typeof EntityGraphPanel>['onDeleteEdge'];
  /** R6-S1b：畸形项行（原始数组下标；由宿主从 edgeHealthOf.problems 派生） */
  malformedRows?: ComponentProps<typeof EntityGraphPanel>['malformedRows'];
  /** 图库上传（P1-1）：上传按钮 / 面板拖拽 → 文件数组（上层经资产宿主入清单） */
  onUpload: (files: File[]) => void;
  /**
   * 插入归一化（P0-B，I-10）：把所选资产变成「重开后仍能解析」的引用。
   *
   * 由调用方（MindmapStage）注入——它持有工作区写入器与宿主（本组件只做编排）。
   * 缺省时退回 `assetValueOf` 的旧形态（向后兼容老调用方）。
   */
  normalizeInsert?: (
    item: AssetItem,
    action: AssetInsertAction,
  ) => Promise<{ refId: string } | null>;
  /**
   * 归一化被拒（未挂载工作区 / 格式不支持 / 写失败）时回传的**拒绝键**。
   *
   * P0-C ②：契约从「已成形文案」改为「键」—— 面板**不得**再持有用户可见字节，
   * 文案由上层查 `assetNotices.ASSET_INSERT_REFUSAL_COPY`（唯一事实源）。
   * 取值域见 `AssetInsertRefusalCode`。
   */
  onInsertRefused?: (reason: string) => void;
  /**
   * 落点徽章（P0-B ⑦）：由调用方（持有工作区与宿主）判定每个卡片写到了哪。
   *
   * 本组件只透传 —— 它不知道工作区挂没挂，也不该靠 id 前缀猜（R-12）。
   */
  storeOf?: (item: AssetItem) => 'workspace-assets' | 'browser-idb' | 'builtin' | null;
  /** 定位并选中节点（由调用方封装「收起快速注释展开态 + 画布定位」） */
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

export function SidePanels({
  panel,
  controller,
  assetList,
  assetHost,
  setEntities,
  relations,
  activeRefKey,
  edgeItems,
  choices,
  onReattachEdge,
  onDeleteEdge,
  malformedRows,
  onUpload,
  normalizeInsert,
  onInsertRefused,
  storeOf,
  onSelectNode,
  onClose,
}: SidePanelsProps) {
  // B-P6：search 闭包稳定化 —— SearchPanel 内部按 [query, search] memo 检索结果，
  // 内联 lambda 每渲染换身份会把 memo 打穿；controller 长寿命，调用时实时读 controller.root。
  // deps 补 controller.root：kernel 纯函数，编辑产出**新 root 引用**（同 layout 的 useMemo 口径）——
  // 否则「面板开着、query 不变时编辑节点 → 结果不刷新」（P6 伴随回归，tests/side-panels-search-refresh）。
  const searchFn = useCallback(
    (q: string) => searchMind(controller.root, q),
    [controller, controller.root],
  );

  /**
   * 一次插入先算出「写进文档的引用 id」（P0-B，I-10）。
   *
   * 顺序：注入的归一化器（生产路径，含工作区落盘与同名三选）→ 自包含兜底
   * （小 SVG / 内置图标内联，净化后 data URL）→ null（拒绝，调用方零副作用）。
   * 拒绝时调 `onInsertRefused` 让上层出提示；**不**沿用 `assetValueOf` 的
   * `kind:id` 形态 —— 那正是重开断图的成因（CE-05 / N4）。
   */
  const resolveRefId = useCallback(
    async (item: AssetItem, action: AssetInsertAction): Promise<string | null> => {
      if (normalizeInsert) {
        const result = await normalizeInsert(item, action);
        if (result !== null) return result.refId;
      }
      // 无注入归一化器（测试 / 老调用方）：只允许自包含形态，否则拒绝
      const { refId, reason } = inlineRefIdOf(item);
      if (refId !== null) return refId;
      onInsertRefused?.(reason);
      return null;
    },
    [normalizeInsert, onInsertRefused],
  );

  if (panel === null) return null;

  return (
    <>
      {panel === 'search' && (
        <SearchPanel
          search={searchFn}
          onSelect={onSelectNode}
          onClose={onClose}
        />
      )}

      {panel === 'outline' && (
        <OutlinePanel
          root={controller.root}
          collapsed={controller.collapsed}
          selectedId={controller.selectedId}
          onSelect={onSelectNode}
          onToggle={(id) => controller.toggleCollapse(id)}
        />
      )}

      {panel === 'assets' && (
        <AssetPanel
          assets={assetList}
          defaultView="grid"
          resolve={(item) => assetHost.resolveAsset(item)}
          onUpload={onUpload}
          // 三语义插入（FA1-T3）：图标 / 插图 / 子分支。
          // 前两者都落在**当前节点本体**上（note.icon / note.media），
          // 只有「子分支」才新建子节点 —— 终结「点素材必生子节点」。
          //
          // P0-B（I-10）：三种语义**共用**一次归一化。此前 child 分支直接写
          // `{ kind, id }`，内置图标因此序列化成 `@draw:builtin:<id>` → 重开断图
          // （CE-05）。归一化后 child 与 icon/media 形态一致：引用一律是
          // `assets/<rel>`（已挂载）或 `data:`（自包含内联）。
          onInsertAs={(item, action: AssetInsertAction) => {
            const targetId = controller.selectedId ?? controller.root.id;
            void (async () => {
              const refId = await resolveRefId(item, action);
              if (refId === null) return; // 归一化被拒：不改文档（零副作用）
              const value = refValueOf(refId, item.kind);
              if (action === 'icon') {
                controller.updateNote(targetId, { icon: value });
                return; // 留在面板里：连续换图标是常见操作
              }
              if (action === 'media') {
                controller.updateNote(targetId, { media: value });
                return;
              }
              const id = controller.addEntityChild(targetId, { kind: item.kind, id: refId });
              setEntities((prev) => {
                const next = new Map(prev);
                next.set(`${item.kind}:${refId}`, {
                  kind: item.kind,
                  id: refId,
                  title: item.name,
                  status: 'ready',
                  ref: null,
                });
                return next;
              });
              // 定位新节点（select + 视口平移）：避免新节点落在视口外造成「插入了却看不见」
              onSelectNode(id);
              onClose();
            })();
          }}
          // 未显式选语义的老路径（onInsertAs 缺省时）保持原语义：新增子分支。
          // 同样过归一化 —— 老调用方不该继承 CE-05 的断图。
          onInsert={(item) => {
            const parentId = controller.selectedId ?? controller.root.id;
            void (async () => {
              const refId = await resolveRefId(item, 'child');
              if (refId === null) return;
              const id = controller.addEntityChild(parentId, { kind: item.kind, id: refId });
              setEntities((prev) => {
                const next = new Map(prev);
                next.set(`${item.kind}:${refId}`, {
                  kind: item.kind,
                  id: refId,
                  title: item.name,
                  status: 'ready',
                  ref: null,
                });
                return next;
              });
              onSelectNode(id);
              onClose();
            })();
          }}
          onPaste={onUpload}
          storeOf={storeOf}
          onClose={onClose}
        />
      )}

      {panel === 'relation' && (
        <EntityGraphPanel
          relations={relations}
          activeRefKey={activeRefKey}
          edges={edgeItems}
          malformedRows={malformedRows}
          onFocusNode={onSelectNode}
          onClose={onClose}
          choices={choices}
          onReattachEdge={onReattachEdge}
          onDeleteEdge={onDeleteEdge}
        />
      )}
    </>
  );
}
