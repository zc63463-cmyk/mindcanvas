/**
 * ErrorBoundary（S3：应用级崩溃边界 + 恢复引导）。
 * React 渲染崩溃（含 Stage 内任何子树）→ 玻璃风格 fallback：
 * 错误摘要 + 「重载页面」（整页刷新，自动保存已落盘的文档不丢失）+ 最近文档提示。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CHROME } from '../theme/tokens.js';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 恢复后提示打开最近文档（默认引导文案） */
  recoveryHint?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 崩溃日志：留给宿主上报（本地开发看 console）
    console.error('[mindcanvas] 渲染崩溃', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          background: CHROME.bg,
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: CHROME.warn }}>
          画布遇到问题，已停止渲染
        </div>
        <div
          style={{ fontSize: 13, color: CHROME.textMuted, maxWidth: 520, wordBreak: 'break-all' }}
        >
          {error.message}
        </div>
        <div style={{ fontSize: 12, color: CHROME.textMuted }}>
          {this.props.recoveryHint ?? '已自动保存的文档不会丢失；重载后可从「最近」菜单重新打开。'}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            border: `1px solid ${CHROME.panelBorderStrong}`,
            background: 'transparent',
            color: CHROME.text,
            borderRadius: CHROME.radiusSmall,
            padding: '6px 16px',
            fontSize: 13,
            fontFamily: CHROME.fontFamily,
            cursor: 'pointer',
          }}
        >
          重载页面
        </button>
      </div>
    );
  }
}
