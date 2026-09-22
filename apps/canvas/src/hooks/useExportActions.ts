/**
 * 导出 hook —— 全图 SVG / PNG 导出。
 *
 * 从 `MindmapStage.tsx` 的 `StageContent`（原 1,394 行单函数）中抽出，**纯搬迁，逻辑未改写**。
 *
 * PNG 的降级语义（保留原实现）：外链资产会污染画布导致 PNG 导出失败（tainted），
 * 此时降级为下载 SVG 并提示用户；环境不支持时同样降级。
 */
import { useCallback } from 'react';
import { exportPng, exportSvg, type layoutDemo } from '@mindcanvas/react';
import type { TokenSet } from '@mindcanvas/react';
import type { EditableNode } from '@mindcanvas/kernel';

/**
 * 注意不要写成 `ReturnType<typeof layoutDemo>` —— 那是 `DemoLayout` 包装
 * （`{ layout, measure }`）；实际布局是它的 `.layout` 字段，即 `LayoutResult`。
 */
type Layout = ReturnType<typeof layoutDemo>['layout'];

export interface ExportActionsOptions {
  layout: Layout | null;
  token: TokenSet;
  docName: string;
  /** G6″（A6/T23）：跨岛父子连接补线（islandView.boundaryLinks；端点盒缺失自动跳过） */
  boundaryLinks?: ReadonlyArray<{ fromId: string; toId: string }>;
  /**
   * S4：文档根（controller.root）——提供时导出摘要括线。
   * 缺省 undefined = 不画括线（与 S4 之前逐字等价，旧调用方零改动）。
   */
  root?: EditableNode;
  /** A-D2：导出降级提示（缺省 undefined → 静默）。替代被 IDE webview 静默吞掉的原生 alert */
  onNotice?: (message: string) => void;
}

export interface ExportActions {
  handleExport: () => void;
  handleExportPng: () => Promise<void>;
}

export function useExportActions({
  layout,
  token,
  docName,
  boundaryLinks,
  root,
  onNotice,
}: ExportActionsOptions): ExportActions {
  const handleExport = useCallback((): void => {
    if (!layout) return;
    const svg = exportSvg(layout, token, { title: docName, boundaryLinks, root });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = docName.replace(/\.mm\.md$/i, '') + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [layout, token, docName, boundaryLinks, root]);

  const handleExportPng = useCallback(async (): Promise<void> => {
    if (!layout) return;
    const svg = exportSvg(layout, token, { title: docName, boundaryLinks, root }); // B-P9：降级 SVG 与直出 SVG 同口径
    const name = docName.replace(/\.mm\.md$/i, '');
    const download = (blob: Blob, ext: string): void => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name + ext;
      a.click();
      URL.revokeObjectURL(url);
    };
    const r = await exportPng(layout, token, { title: docName, boundaryLinks, root });
    if (r.ok) {
      download(r.blob, '.png');
      return;
    }
    download(new Blob([svg], { type: 'image/svg+xml' }), '.svg');
    if (r.reason === 'tainted') onNotice?.('画布含外部图片，无法导出 PNG，已改为导出 SVG。');
    else onNotice?.('当前环境不支持导出 PNG，已改为导出 SVG。');
  }, [layout, token, docName, onNotice, boundaryLinks, root]);

  return { handleExport, handleExportPng };
}
