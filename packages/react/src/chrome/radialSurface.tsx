/**
 * 环形菜单渲染面（v1.8.0 Phase 2）——段式弧 + 图标 + 缺口 + 蓄力弧 + 共享样式。
 * ══════════════════════════════════════════════════════════════════════
 * 纯展示组件（无状态无事件）：预览页与主画布共用同一实现（单一渲染源）。
 * 宿主职责：放置 `<RadialStyles />`（挂一次）+ 按状态渲染 Ring/ChargeArc/浮标/气泡。
 */
import type { CSSProperties } from 'react';
import {
  RADIAL_SLOTS,
  visibleArcs,
  type RadialGeometry,
  type RadialItem,
  type RadialSlotKey,
  type RadialSubItem,
  type SubRingGeometry,
} from '../edit/radialActions.js';

export const RADIAL_ACCENT = '#3dd3a0';
export const RADIAL_DANGER = '#ff6b6b';
/** 段间呼吸（度）：圆角段式弧之间留一点缝，避免糊成一圈 */
const ARC_PAD_DEG = 2.5;

export function slotCenterDeg(key: RadialSlotKey): number {
  return RADIAL_SLOTS.find((s) => s.key === key)?.centerDeg ?? 0;
}

function pointOf(cx: number, cy: number, r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
}

/** 单线圆弧（段式弧、缺口提示、蓄力弧共用：段以「中线 + 粗描边 + 圆帽」渲染） */
export function ringArcPath(geo: RadialGeometry, startDeg: number, spanDeg: number, r: number): string {
  const large = spanDeg > 180 ? 1 : 0;
  return `M ${pointOf(geo.cx, geo.cy, r, startDeg)} A ${r} ${r} 0 ${large} 1 ${pointOf(geo.cx, geo.cy, r, startDeg + spanDeg)}`;
}

/** 同上的裸坐标版（② 子环没有 RadialGeometry，只有 SubRingGeometry） */
function arcPathOf(cx: number, cy: number, r: number, startDeg: number, spanDeg: number): string {
  const large = spanDeg > 180 ? 1 : 0;
  return `M ${pointOf(cx, cy, r, startDeg)} A ${r} ${r} 0 ${large} 1 ${pointOf(cx, cy, r, startDeg + spanDeg)}`;
}

/** 浮动说明的位置：锚点 + 扇形中心方向 ×（外环 + 28px） */
export function floatLabelStyle(geo: RadialGeometry, centerDeg: number): CSSProperties {
  const a = (centerDeg * Math.PI) / 180;
  const d = geo.cfg.outerR + 28;
  return { left: geo.cx + d * Math.cos(a), top: geo.cy + d * Math.sin(a) };
}

export interface RadialRingProps {
  geo: RadialGeometry;
  highlight: RadialSlotKey | null;
  items: readonly RadialItem[];
}

/** 段式圆环：默认态 / 高亮态（辉光）/ 禁用灰态；缺口 + 图标 */
export function RadialRing({ geo, highlight, items }: RadialRingProps) {
  const arcs = visibleArcs(geo);
  const midR = (geo.cfg.innerR + geo.cfg.outerR) / 2;
  const band = geo.cfg.outerR - geo.cfg.innerR;
  return (
    <svg className="ring" width="100%" height="100%">
      <g className="ring-in" style={{ transformOrigin: `${geo.cx}px ${geo.cy}px` }}>
        {arcs.map((arc) => {
          const anyItem = items.find((it) => it.slot === arc.key);
          const active = highlight === arc.key;
          const color = anyItem?.danger ? RADIAL_DANGER : RADIAL_ACCENT;
          const span = Math.max(6, arc.spanDeg - ARC_PAD_DEG * 2);
          return (
            <path
              key={`seg-${arc.key}`}
              d={ringArcPath(geo, arc.startDeg + ARC_PAD_DEG, span, midR)}
              fill="none"
              stroke={active ? color : anyItem?.disabled === true ? 'rgba(228,242,239,0.07)' : 'rgba(228,242,239,0.15)'}
              strokeWidth={active ? band + 3 : band}
              strokeLinecap="round"
              style={active ? { filter: `drop-shadow(0 0 9px ${color})` } : undefined}
            />
          );
        })}
        <path
          className="gap-hint"
          d={ringArcPath(geo, geo.cfg.gapCenterDeg - geo.cfg.gapWidthDeg / 2, geo.cfg.gapWidthDeg, midR)}
        />
        {arcs.map((arc) => {
          const anyItem = items.find((it) => it.slot === arc.key);
          if (!anyItem) return null;
          const a = (slotCenterDeg(arc.key) * Math.PI) / 180;
          const x = geo.cx + midR * Math.cos(a);
          const y = geo.cy + midR * Math.sin(a);
          const active = highlight === arc.key;
          const k = active ? 1.16 : 1;
          return (
            <g
              key={`ico-${arc.key}`}
              transform={`translate(${(x - 8 * k).toFixed(2)} ${(y - 8 * k).toFixed(2)}) scale(${k})`}
              stroke={
                active
                  ? anyItem.danger
                    ? RADIAL_DANGER
                    : RADIAL_ACCENT
                  : anyItem.disabled === true
                    ? 'rgba(228,242,239,0.22)'
                    : 'rgba(228,242,239,0.55)'
              }
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              {anyItem.icon.map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export interface SubRingProps {
  /** 子环几何（`subRingOf` 派生：N 席沿可用弧均分） */
  sub: SubRingGeometry;
  /** 席位表（数据序 = 角度序） */
  items: readonly RadialSubItem[];
  /** 高亮席位下标（null = 无） */
  highlight: number | null;
}

/**
 * 外圈子环（② 二级环）：N 席沿**可用弧**均分（缺口朝节点角语义继承），数据序 = 角度序。
 * 与主环同视觉规范（段式弧 + 圆帽 + 呼吸缝 + 高亮辉光）。
 */
export function SubRing({ sub, items, highlight }: SubRingProps) {
  const midR = (sub.innerR + sub.outerR) / 2;
  const band = sub.band;
  const gapStart = sub.gapCenterDeg - sub.gapWidthDeg / 2;
  return (
    <svg className="ring sub-ring" width="100%" height="100%">
      <g className="ring-in" style={{ transformOrigin: `${sub.cx}px ${sub.cy}px` }}>
        {items.map((it, i) => {
          const active = highlight === i;
          const start = sub.startDeg + sub.spanDeg * i + ARC_PAD_DEG;
          const span = Math.max(8, sub.spanDeg - ARC_PAD_DEG * 2);
          return (
            <path
              key={it.id}
              d={arcPathOf(sub.cx, sub.cy, midR, start, span)}
              fill="none"
              stroke={
                // 灰显席：可读的暗 + 虚线 = 「锁着的席」，而不是「洞」（0.07 实心几乎不可见 → 观感像空缺）
                active ? RADIAL_ACCENT : it.disabled === true ? 'rgba(228,242,239,0.13)' : 'rgba(228,242,239,0.22)'
              }
              strokeDasharray={it.disabled === true ? '5 7' : undefined}
              strokeWidth={active ? band + 3 : band}
              strokeLinecap="round"
              style={active ? { filter: `drop-shadow(0 0 9px ${RADIAL_ACCENT})` } : undefined}
            />
          );
        })}
        <path className="gap-hint" d={arcPathOf(sub.cx, sub.cy, midR, gapStart, sub.gapWidthDeg)} />
      </g>
    </svg>
  );
}

/** 蓄力进度弧：按住后 0→阈值 逐帧推进，环浮现前把它「充满」 */
export function ChargeArc({ geo, progress }: { geo: RadialGeometry; progress: number }) {
  if (progress <= 0.02) return null;
  return (
    <svg className="ring" width="100%" height="100%">
      <path
        d={ringArcPath(geo, 270, Math.max(1.5, progress * 360), (geo.cfg.innerR + geo.cfg.outerR) / 2)}
        fill="none"
        stroke={RADIAL_ACCENT}
        strokeWidth={2.5}
        strokeLinecap="round"
        opacity={0.8}
        style={{ filter: 'drop-shadow(0 0 6px rgba(61,211,160,.65))' }}
      />
    </svg>
  );
}

/** 渲染面样式（任一宿主挂一次）：环 / 浮标 / 死区提示 / 二次确认气泡 */
export function RadialStyles() {
  return <style>{RADIAL_SURFACE_CSS}</style>;
}

export const RADIAL_SURFACE_CSS = `
.ring { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 60; }
/* ② 二级环：子环在外圈（z 58 = 主环之下），一级降透明（非当前级） */
.sub-ring { z-index: 58; }
.ring-dim { opacity: .3; }
.ring-in { transform-box: view-box; animation: ring-in .16s cubic-bezier(.2,.9,.3,1.2) both; }
@keyframes ring-in { from { opacity: 0; transform: scale(.84); } to { opacity: 1; transform: scale(1); } }
.ring path { transition: stroke .12s ease, stroke-width .12s ease, filter .12s ease, opacity .12s ease; }
.gap-hint { stroke: rgba(255,255,255,.12); stroke-width: 1; stroke-dasharray: 2 6; fill: none; }

.float-label { position: fixed; transform: translate(-50%,-50%); display: flex; align-items: center; gap: 7px;
  padding: 7px 12px 7px 10px; border-radius: 10px; z-index: 61;
  background: rgba(13,19,21,.78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 8px 26px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.05) inset;
  white-space: nowrap; pointer-events: none; animation: label-in .12s ease-out both; }
@keyframes label-in { from { opacity: 0; transform: translate(-50%,-50%) scale(.94); } to { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
.float-label .fl-ico { display: block; flex: none; }
.float-label b { font-size: 13px; font-weight: 600; letter-spacing: .2px; }
.float-label kbd { color: #9fb4b8; font: 11px/1.4 ui-monospace, Consolas, monospace;
  border: 1px solid rgba(255,255,255,.16); border-bottom-width: 2px; border-radius: 5px; padding: 1px 6px;
  background: rgba(255,255,255,.05); }

.dead-hint { position: fixed; transform: translate(-50%,-50%); padding: 3px 9px; border-radius: 7px; z-index: 61;
  color: #9fb4b8; font-size: 11.5px; letter-spacing: .4px; background: rgba(13,19,21,.6);
  border: 1px solid rgba(255,255,255,.1); pointer-events: none; animation: label-in .12s ease-out both; }

.confirm-chip { position: fixed; transform: translate(-50%, 0); display: flex; align-items: center; gap: 8px; z-index: 62;
  padding: 8px 10px 8px 12px; border-radius: 11px; color: #ffd9d4;
  background: rgba(38,16,16,.82); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255,107,107,.4); box-shadow: 0 10px 30px rgba(0,0,0,.5);
  animation: label-in .12s ease-out both; white-space: nowrap; }
.confirm-chip span { font-size: 12.5px; }
.confirm-chip button { cursor: pointer; font: inherit; font-size: 12px; color: #fff;
  border: 1px solid rgba(255,107,107,.6); border-radius: 7px; padding: 3px 10px;
  background: rgba(255,107,107,.28); }
.confirm-chip button.ghost { border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #d7c8c6; }
.confirm-chip button:hover { filter: brightness(1.15); }

/* ① 幽灵预览 / 删除预告（v1.8.0 Phase 3；z-index 59——在环 60 之下、画布之上） */
.ghost-node { position: fixed; z-index: 59; pointer-events: none; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px dashed rgba(61,211,160,.6); border-radius: 12px; background: rgba(61,211,160,.06);
  animation: ghost-in .16s ease-out both; }
.ghost-node span { font-size: 13px; color: rgba(190,235,220,.55); }
@keyframes ghost-in { from { opacity: 0; transform: translateY(-3px) scale(.97); } to { opacity: 1; transform: none; } }
.danger-box { position: fixed; z-index: 59; pointer-events: none; box-sizing: border-box;
  border: 1.5px dashed rgba(255,107,107,.75); border-radius: 12px; background: rgba(255,107,107,.08); }
`;
