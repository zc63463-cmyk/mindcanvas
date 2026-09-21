/**
 * 框深度 · 数值步进气泡（FO-UI1）：右键「改框深度…」的值输入，
 * 取代 `frameCommands.requestFrameDepth` 的原生 `prompt`（裁决 M3 同款：
 * 原生弹窗在 IDE 内嵌 webview 下会被静默吞掉，表现为「点了没反应」）。
 *
 * 交互（对齐 LenBubble，另加步进）：
 * - 预填当前 `note.frame.depth`；挂载即**强制聚焦**（右键菜单卸载会把焦点抢回画布）；
 * - `−` / `+` 步进按 1 **立即提交**（钳在 `[1, max]`）——省掉「还得再按 Enter」的认知负担，
 *   也避免焦点落在按钮上导致下次 Enter 继续漏给画布；多级调整重开气泡或直接手输；
 *   （上面两条聚焦 / 即时提交口径属 FO-UI1.1）
 * - Enter 提交（输入值同样钳进 `[1, max]`）；非法输入（空 / 非数）不提交，气泡保持；
 * - Esc / 点 backdrop 取消，不写盘。
 *
 * 键位归属（FO-UI1.1 修复）：气泡打开期间键盘**由气泡消费**——Enter/Esc 在
 * `window` **capture** 阶段被拦下（`preventDefault` + `stopPropagation`），
 * 焦点在画布 / 框内行 / body 上都不会漏到 `MindmapStage` 的全局键位
 * （那条链路里 Enter = 建同级，实测症状是「深度没落盘、旁边却多出一个节点」）。
 * 监听随气泡挂载/卸载，关闭后画布键位原样恢复。
 *
 * 落盘交宿主：`setFrameDepth(controller, id, n)`（同一 OpHistory 撤销栈，内核再 clamp 一次）。
 */
import { useEffect, useRef, useState } from 'react';

export interface FrameDepthBubbleProps {
  /** 气泡位置（客户端坐标；= 原右键菜单位置） */
  x: number;
  y: number;
  /** 当前深度（预填值） */
  current: number;
  /** 合法上界（含）；下界恒为 1 */
  max: number;
  onCommit: (depth: number) => void;
  onCancel: () => void;
}

/** 深度下界（规格 §4.1：范围 1 … min(8, 子树最大深度)） */
const MIN_DEPTH = 1;

/** 已解析的合法整数（空 / 非数 → null） */
function parsedDepth(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function FrameDepthBubble({ x, y, current, max, onCommit, onCancel }: FrameDepthBubbleProps) {
  const [text, setText] = useState(String(current));
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 捕获阶段键位只挂一次，需读「最新输入」→ 用 ref 镜像（onChange 同步写） */
  const textRef = useRef(text);
  /** 一次性出口：提交 / 取消只允许发生一次（防 capture 与输入框两条路径重复） */
  const doneRef = useRef(false);

  const clamp = (n: number): number => Math.min(Math.max(MIN_DEPTH, Math.round(n)), max);
  const commit = (n: number): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(n);
  };
  const cancel = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };
  /** 提交手输值（非法 → 不动作，气泡保持） */
  const commitTyped = (): void => {
    const n = parsedDepth(textRef.current);
    if (n !== null) commit(clamp(n));
  };
  /** ± 步进：以输入框当前值为基准 ±1 → 钳位 → **立即提交** */
  const step = (delta: number): void =>
    commit(clamp((parsedDepth(textRef.current) ?? current) + delta));
  const setValue = (v: string): void => {
    textRef.current = v;
    setText(v);
  };

  /**
   * 强制聚焦（含兜底再拉一拍）：`autoFocus` 只保证挂载瞬间，右键菜单卸载时常把焦点
   * 抢回画布（body / 选中节点）——那正是「按 Enter 变成建同级」的现场。
   * 兜底只在焦点掉到 body/documentElement 时拉回（用户已点到别处则不抢）。
   */
  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    const focus = (): void => {
      el.focus();
      try {
        el.setSelectionRange(0, el.value.length); // 全选便于覆盖输入
      } catch {
        /* type=number 才抛；此处是 text */
      }
    };
    const refocusIfLost = (): void => {
      const active = document.activeElement;
      if (active === el) return;
      if (active === null || active === document.body || active === document.documentElement) {
        focus();
      }
    };
    focus();
    if (typeof requestAnimationFrame === 'function') {
      const h = requestAnimationFrame(refocusIfLost);
      return () => cancelAnimationFrame(h);
    }
    // 无 rAF 的环境（canvas 套件 pretendToBeVisual:false）退回 microtask
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) refocusIfLost();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 气泡打开期间消费 Enter / Esc（window **capture**，先于画布冒泡阶段拿到）：
   * - `preventDefault`：挡原生默认（Enter 激活聚焦按钮 / 表单提交）；
   * - `stopPropagation`：挡画布全局键位（Enter=建同级、Shift+Enter=描述、Esc=取消选择）；
   * - 监听随挂载/卸载，气泡关闭后画布键位原样恢复（不当全局禁令）。
   * 依赖安全：handler 只读 ref（最新输入）与气泡生命周期内恒定的 props。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: handler 只读 ref（最新输入）与气泡生命周期内恒定的 props（上段注释详述）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') commitTyped();
      else cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const btnStyle = {
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    font: 'inherit',
    color: 'inherit',
    background: 'rgba(255,255,255,.08)',
    border: '1px solid rgba(255,255,255,.18)',
    borderRadius: 7,
    cursor: 'pointer',
    padding: 0,
  } as const;

  return (
    <div
      data-frame-depth-backdrop
      onPointerDown={cancel}
      style={{ position: 'fixed', inset: 0, zIndex: 40 }}
    >
      <div
        data-frame-depth-bubble
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 11,
          color: '#e4f2ef',
          background: 'rgba(13,19,21,.9)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          font: '12.5px/1.4 system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap',
        }}
      >
        <span>框内大纲深度</span>
        <button
          type="button"
          data-frame-depth-dec
          title="−1（立即生效）"
          style={btnStyle}
          onClick={() => step(-1)}
        >
          −
        </button>
        <input
          ref={inputRef}
          // 焦点说明：气泡是用户刚点开的直接操作入口 → 聚焦输入框是预期行为
          autoFocus
          data-frame-depth-input
          value={text}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter/Esc 已由 capture 监听消费（含本输入框上的按键）；其余键只做
            // 「不进画布快捷键链」的止损（stopPropagation 同样作用于原生事件）。
            e.stopPropagation();
          }}
          style={{
            width: 44,
            font: 'inherit',
            color: 'inherit',
            textAlign: 'center',
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.18)',
            borderRadius: 7,
            padding: '3px 7px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          data-frame-depth-inc
          title="+1（立即生效）"
          style={btnStyle}
          onClick={() => step(1)}
        >
          +
        </button>
        <span style={{ color: '#9fb4b8' }}>（{MIN_DEPTH}…{max}）</span>
      </div>
    </div>
  );
}
