/**
 * apps/canvas：应用组合入口（app = kernel 数据 + react 渲染器 + 玻璃 chrome 壳）。
 * 全屏深色玻璃外壳（ADR-0003 决策 3：外壳恒定，画布主题可换）。
 *
 * C+1：模式态 `mindmap | free-canvas` —— 两个 Stage 平级挂载/卸载，
 * **不共享文档状态**（导图 .mm.md 与自由画布 .mc.canvas.json 各自事实源）。
 *
 * MODE-GUARD（包 2）：App 只做**离开协调** ——
 * - 持有当前 Stage 登记的 `DocumentLeavePort`（`useUnsavedTransition`），
 *   模式切换入口一律经 `requestLeave`，不直接 `setMode`；
 * - 三选项确认模态挂在应用层（覆盖两模式工具栏）；
 * - App **不持有**任一模式的内容，不同时挂载两个 Stage，也不另建保存队列
 *   （保存复用包 1 的会话协调器，经 Stage 登记的端口调用）。
 */
import { useCallback, useState } from 'react';
import { CHROME, ErrorBoundary } from '@mindcanvas/react';
import { FreeCanvasStage } from './FreeCanvasStage';
import MindmapStage from './MindmapStage';
import { UnsavedPrompt } from './UnsavedPrompt';
import { useUnsavedTransition } from './hooks/useUnsavedTransition.js';

type AppMode = 'mindmap' | 'free-canvas';

export default function App() {
  const [mode, setMode] = useState<AppMode>('mindmap');
  // MODE-GUARD：单实例离开决策器（登记端口 + 三选项模态 + 单请求保护）
  const { ready, prompt, blockedNotice, requestLeave, choose, registerPort } = useUnsavedTransition();

  const openFreeCanvas = useCallback((): void => {
    void requestLeave(() => setMode('free-canvas'));
  }, [requestLeave]);

  const backToMindmap = useCallback((): void => {
    void requestLeave(() => setMode('mindmap'));
  }, [requestLeave]);

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
          <MindmapStage
            onOpenFreeCanvas={openFreeCanvas}
            requestLeave={requestLeave}
            registerLeavePort={registerPort}
          />
        ) : (
          <FreeCanvasStage
            onExit={backToMindmap}
            requestLeave={requestLeave}
            registerLeavePort={registerPort}
          />
        )}
      </ErrorBoundary>
      {mode === 'mindmap' && (
        <button
          type="button"
          data-app-freecanvas
          title="进入自由画布（便签 / 面板翻面 / 连线）"
          // 未就绪（当前 Stage 尚未登记端口）时禁用：不制造「缺省即放行」的短窗口
          disabled={!ready}
          onClick={openFreeCanvas}
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
            cursor: ready ? 'pointer' : 'default',
            opacity: ready ? 1 : 0.55,
            backdropFilter: 'blur(14px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
            boxShadow: CHROME.shadow,
          }}
        >
          自由画布
        </button>
      )}
      {/*
        非模态提示（MG-R1）：组合输入未结束时**不弹模态** —— 模态会抢焦点、让编辑器失焦，
        把未确认的候选串当正文提交。这里只用不可交互的浮层告知「完成输入后自动继续」。
      */}
      {blockedNotice !== null && (
        <div
          data-unsaved-blocked
          role="status"
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 620,
            maxWidth: 560,
            padding: '8px 14px',
            border: `1px solid ${CHROME.panelBorder}`,
            borderRadius: 10,
            background: CHROME.panelBg,
            color: CHROME.text,
            fontFamily: CHROME.fontFamily,
            fontSize: CHROME.fontSize,
            boxShadow: CHROME.shadow,
            backdropFilter: 'blur(14px) saturate(1.3)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
            pointerEvents: 'none', // 绝不拦截编辑器的点击/焦点
          }}
        >
          {blockedNotice}
        </div>
      )}
      <UnsavedPrompt
        open={prompt !== null}
        busy={prompt?.busy ?? false}
        notice={prompt?.notice ?? null}
        onChoice={choose}
      />
    </main>
  );
}
