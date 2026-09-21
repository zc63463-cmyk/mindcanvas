/**
 * 性能面板（T5）：消费 MapView stats（dirty-flag 单帧调度的可见证据）。
 * 无任何定时器/轮询——仅随 stats 更新而更新，空闲时面板静止（空闲 CPU ≈ 0）。
 */
import type { MapStats } from '@mindcanvas/react';
import { CHROME } from '@mindcanvas/react';

export function PerfPanel({ stats }: { stats: MapStats | null }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        padding: '10px 14px',
        borderRadius: CHROME.radius,
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        color: CHROME.textMuted,
        fontFamily: CHROME.fontFamily,
        fontSize: CHROME.fontSizeSmall,
        lineHeight: 1.7,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {stats === null ? (
        <span>渲染统计：待首帧…</span>
      ) : (
        <>
          <Row k="帧 epoch" v={String(stats.epoch)} />
          <Row k="节点" v={`${stats.visibleNodes} / ${stats.totalNodes}`} />
          <Row k="连线" v={String(stats.visibleLinks)} />
          <Row k="LOD" v={stats.lod} />
          <Row k="后端" v={stats.backend} />
          <Row k="裁剪计算" v={`${stats.viewMs.toFixed(2)} ms`} />
          <div style={{ marginTop: 6, color: CHROME.neon }}>
            ● 调度：dirty-flag 单帧（空闲零 rAF）
          </div>
        </>
      )}
    </div>
  );
}

function Row({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8 }} title={title}>
      <span style={{ color: CHROME.textMuted }}>{k}</span>
      <span style={{ color: CHROME.text }}>{v}</span>
    </div>
  );
}
