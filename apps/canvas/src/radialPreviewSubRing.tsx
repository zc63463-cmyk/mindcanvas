/**
 * ② 二级环沙盒 · 控制面板（预览页拆分件，v1.8.2）
 * ══════════════════════════════════════════════════════════════════════
 * 从 `radialPreview.tsx` 抽出的沙盒控件（开关 / 展开延时 / 条件模拟 / 席位清单）——
 * 与 `radialPreviewCss.ts` 同旨：把宿主文件留在 600 行预算内（结构治理）。
 *
 * 席位清单来自**派生模型** `subRingPagesFor(facts)`（单一动作源）；
 * 「条件模拟」用来在沙盒里看灰显（不抽席）与动态文案，真实值在画布接线时从 controller 读。
 */
import {
  floatLabelStyle,
  RADIAL_ACCENT,
  radialGeometryFor,
  SubRing,
  subSeatCenterDeg,
  type RadialSubItem,
  type SubRingGeometry,
} from '@mindcanvas/react';

export interface SubRingSim {
  root: boolean;
  center: boolean;
  hub: boolean;
}

export interface SubRingPanelProps {
  on: boolean;
  dwellMs: number;
  /** 主页席位（含灰显标记，用于清单展示） */
  items: readonly RadialSubItem[];
  /** 页数（>1 表示存在方向页/子页） */
  pageCount: number;
  sim: SubRingSim;
  onToggle: (v: boolean) => void;
  onDwell: (v: number) => void;
  onSim: (patch: Partial<SubRingSim>) => void;
}

/**
 * 外圈子环 + 席位浮标（渲染叠层）：宿主只给几何 / 当前页席位 / 高亮下标。
 * 抽出来是为了让 `radialPreview.tsx` 留在 600 行预算内（结构治理，无行为差异）。
 */
export function SubRingLayer({
  sub,
  items,
  idx,
}: {
  sub: SubRingGeometry | null;
  items: readonly RadialSubItem[];
  idx: number | null;
}) {
  if (!sub) return null;
  return (
    <>
      <SubRing sub={sub} items={items} highlight={idx} />
      {idx !== null && items[idx] && (
        <div
          className="float-label"
          style={floatLabelStyle(
            radialGeometryFor(sub.cx, sub.cy, { outerR: sub.outerR }),
            subSeatCenterDeg(sub, idx),
          )}
        >
          <b style={{ color: RADIAL_ACCENT }}>{items[idx]?.label}</b>
          <kbd>← → 轮转</kbd>
        </div>
      )}
    </>
  );
}

export function SubRingPanel({
  on,
  dwellMs,
  items,
  pageCount,
  sim,
  onToggle,
  onDwell,
  onSim,
}: SubRingPanelProps) {
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span>② 二级环沙盒（悬停「更多」展开外圈）</span>
      </label>
      {on && (
        <>
          <label className="slider">
            <span>展开延时</span>
            <b>{dwellMs}ms</b>
            <input
              type="range"
              min={200}
              max={800}
              step={50}
              value={dwellMs}
              onChange={(e) => onDwell(Number(e.target.value))}
            />
          </label>
          <div className="sub-hint" data-sim-row>
            条件模拟：
            <label className="check">
              <input type="checkbox" checked={sim.root} onChange={(e) => onSim({ root: e.target.checked })} />
              <span>根节点</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={sim.center} onChange={(e) => onSim({ center: e.target.checked })} />
              <span>已是中心（带编号）</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={sim.hub} onChange={(e) => onSim({ hub: e.target.checked })} />
              <span>已是枢纽</span>
            </label>
          </div>
          <div className="sub-hint" data-seat-list>
            主 {items.length} 席：
            {items.map((it, i) => `${i + 1}.${it.label}${it.disabled ? '（灰）' : ''}`).join(' · ')}
            <br />
            第 1 席 = 新建同级；剪贴板席（倒数第 2 席）动态：有中心编号 → 复制中心编号；否则 → 复制节点文本
            （席位恒满，不抽席）
            <br />
            {pageCount > 1 ? '方向页：靠右 / 靠左 / 靠下 / 靠上 / 返回（升为中心 → Enter 进页）' : '（无子页）'}
            <br />
            二级内：←→ 轮转（跳过灰显）· Enter 提交或进页 · 点内圈 = 回上一页/降级 · 松 Alt = 提交或收起
          </div>
        </>
      )}
    </>
  );
}
