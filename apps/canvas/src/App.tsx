import { useState } from 'react';
import { CHROME, ErrorBoundary } from '@mindcanvas/react';
import MindmapStage from './MindmapStage';
import { FreeCanvasStage } from './FreeCanvasStage';

/**
 * apps/canvas：应用组合入口（app = kernel 数据 + react 渲染器 + 玻璃 chrome 壳）。
 * 全屏深色玻璃外壳（ADR-0003 决策 3：外壳恒定，画布主题可换）。
 *
 * C+1：模式态 `mindmap | free-canvas` —— 两个 Stage 平级挂载/卸载，
 * **不共享文档状态**（导图 .mm.md 与自由画布 .mc.canvas.json 各自事实源）。
 */
type AppMode = 'mindmap' | 'free-canvas';

export default function App() {
  const [mode, setMode] = useState<AppMode>('mindmap');

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        background: CHROME.bg,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
      }}
    >
      <ErrorBoundary>
        {mode === 'mindmap' ? (
          <MindmapStage onOpenFreeCanvas={() => setMode('free-canvas')} />
        ) : (
          <FreeCanvasStage onExit={() => setMode('mindmap')} />
        )}
      </ErrorBoundary>
      {mode === 'mindmap' && (
        <button
          type="button"
          data-app-freecanvas
          title="进入自由画布（便签 / 面板翻面 / 连线）"
          onClick={() => setMode('free-canvas')}
          style={{
            position: 'fixed',
            right: 14,
            bottom: 14,
            zIndex: 500,
            padding: '7px 14px',
            border: `1px solid ${CHROME.panelBorder}`,
            borderRadius: 999,
            background: CHROME.panelBg,
            color: CHROME.text,
            fontFamily: CHROME.fontFamily,
            fontSize: CHROME.fontSize,
            cursor: 'pointer',
            backdropFilter: 'blur(14px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
            boxShadow: CHROME.shadow,
          }}
        >
          自由画布
        </button>
      )}
    </main>
  );
}
