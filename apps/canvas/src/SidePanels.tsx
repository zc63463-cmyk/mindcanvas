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
  OutlinePanel,
  SearchPanel,
  searchMind,
  svgToDataUrl,
} from '@mindcanvas/react';
import { useCallback } from 'react';
import type { ComponentProps, Dispatch, SetStateAction } from 'react';

/**
 * 素材 → 写入节点的值（FA1-T3 / T5）。
 *
 * - 内置图标 / 小 SVG：直接内联成 data URL 写进 note —— 脱离 IndexedDB 也能在
 *   Obsidian / VS Code 里显示（自包含分发）。
 * - 宿主资产：写 `kind:id` 引用，渲染时经宿主解析（大图不塞进文档）。
 */
function assetValueOf(item: AssetItem): string {
  return item.svg ? svgToDataUrl(item.svg) : `${item.kind}:${item.id}`;
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
          onInsertAs={(item, action: AssetInsertAction) => {
            const targetId = controller.selectedId ?? controller.root.id;
            if (action === 'icon') {
              controller.updateNote(targetId, { icon: assetValueOf(item) });
              return; // 留在面板里：连续换图标是常见操作
            }
            if (action === 'media') {
              controller.updateNote(targetId, { media: assetValueOf(item) });
              return;
            }
            const id = controller.addEntityChild(targetId, { kind: item.kind, id: item.id });
            setEntities((prev) => {
              const next = new Map(prev);
              next.set(`${item.kind}:${item.id}`, {
                kind: item.kind,
                id: item.id,
                title: item.name,
                status: 'ready',
                ref: null,
              });
              return next;
            });
            // 定位新节点（select + 视口平移）：避免新节点落在视口外造成「插入了却看不见」
            onSelectNode(id);
            onClose();
          }}
          // 未显式选语义的老路径（onInsertAs 缺省时）保持原语义：新增子分支
          onInsert={(item) => {
            const parentId = controller.selectedId ?? controller.root.id;
            const id = controller.addEntityChild(parentId, { kind: item.kind, id: item.id });
            setEntities((prev) => {
              const next = new Map(prev);
              next.set(`${item.kind}:${item.id}`, {
                kind: item.kind,
                id: item.id,
                title: item.name,
                status: 'ready',
                ref: null,
              });
              return next;
            });
            onSelectNode(id);
            onClose();
          }}
          onPaste={onUpload}
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
