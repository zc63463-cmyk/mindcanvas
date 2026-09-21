// @vitest-environment jsdom
// biome-ignore-all format: 本文件的 @ts-expect-error 依赖「单行对象」结构 ——
// 一旦被格式化展开为多行，类型错误会落在对象内部属性上，@ts-expect-error 覆盖不到 →
// 抑制失效 → typecheck 报 TS2578/TS2741，类型守护反而失效。故本文件禁止格式化。
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { DEFAULT_THEME, THEMES } from '../src/theme/tokens.js'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext.js'
import type { TokenSet } from '../src/theme/types.js'

/**
 * 类型完整性守护（编译期）：
 * 以下对象缺 TokenSet 必填字段 → 各自被 @ts-expect-error 消费。
 * 若 TokenSet 允许缺字段（接口被改宽松），@ts-expect-error 未使用 → typecheck 失败（守护回退）。
 */
// @ts-expect-error 缺 color 字段应编译报错
const _missingColor: TokenSet = { id: 'classic', radius: { node: 1, leaf: 1, panel: 1 }, spacing: { padX: 1, padY: 1 }, font: { family: '', size: 1, sizeLeaf: 1, weight: 1, weightRoot: 1 }, motion: { duration: '', easing: '' }, lineStyle: { language: 'soft', width: 1 }, nodeStyle: { shape: 'glass', strokeWidth: 1, shadow: '' }, shadow: { panel: '' } }
// @ts-expect-error 缺 branches 色板应编译报错
const _missingBranches: TokenSet = { id: 'classic', color: { canvas: '', text: '', textMuted: '', entityFill: '', entityText: '', accent: null, linkStroke: '' }, radius: { node: 1, leaf: 1, panel: 1 }, spacing: { padX: 1, padY: 1 }, font: { family: '', size: 1, sizeLeaf: 1, weight: 1, weightRoot: 1 }, motion: { duration: '', easing: '' }, lineStyle: { language: 'soft', width: 1 }, nodeStyle: { shape: 'glass', strokeWidth: 1, shadow: '' }, shadow: { panel: '' } }
void _missingColor
void _missingBranches

describe('令牌系统：三套主题令牌（ADR-0003）', () => {
  it('THEMES 含三套且默认 glass', () => {
    expect(Object.keys(THEMES)).toEqual(['classic', 'sticker', 'glass'])
    expect(DEFAULT_THEME).toBe('glass')
  })

  it('classic（V1）：圆角矩形 + 彩色曲线 + 每分支一色（对照设计报告 SVG）', () => {
    const t = THEMES.classic
    expect(t.nodeStyle.shape).toBe('roundedRect')
    expect(t.lineStyle.language).toBe('color-curve')
    expect(t.lineStyle.width).toBe(2.2)
    expect(t.color.branches[0]!.stroke).toBe('#d97706')
    expect(t.color.branches[0]!.fill).toBe('#fef2e4')
    expect(t.color.branches[1]!.stroke).toBe('#2f9e44')
    expect(t.color.branches[2]!.stroke).toBe('#0c8599')
    expect(t.color.accent).toBeNull()
    expect(t.radius.node).toBe(9)
  })

  it('sticker（V7）：贴纸卡片阴影 + 任意曲线 + 多彩（对照设计报告 SVG）', () => {
    const t = THEMES.sticker
    expect(t.nodeStyle.shape).toBe('sticker')
    expect(t.lineStyle.language).toBe('wavy')
    expect(t.nodeStyle.shadow).toContain('drop-shadow')
    expect(t.color.linkStroke).toBe('#c9c4b8')
    expect(t.color.branches.length).toBeGreaterThanOrEqual(4)
    expect(t.radius.node).toBe(10)
  })

  it('glass（V8）：半透明卡 + 柔和贝塞尔 + 霓虹（对照设计报告 SVG）', () => {
    const t = THEMES.glass
    expect(t.nodeStyle.shape).toBe('glass')
    expect(t.lineStyle.language).toBe('soft')
    expect(t.color.canvas).toBe('#16181d')
    expect(t.color.branches[0]!.fill).toBe('rgba(255,255,255,.05)')
    expect(t.color.accent).toBe('#7ae9c4')
    // 连线对比度基线：对 canvas #16181d 需 ≥3:1（WCAG 非文本）；旧值 #3a3f4d 为 2.3:1 已修正
    expect(t.color.linkStroke).toBe('#646b7d')
    expect(t.radius.node).toBe(10)
  })
})

/** 测试用消费组件：显示当前主题 + 切换按钮 */
function ThemeProbe() {
  const { token, setTheme } = useTheme()
  const [n, setN] = useState(0)
  void n
  return (
    <div>
      <p data-testid="theme-id">{token.id}</p>
      <p data-testid="theme-canvas">{token.color.canvas}</p>
      <button onClick={() => setTheme('sticker')}>switch</button>
      <button onClick={() => setN((x) => x + 1)}>bump</button>
    </div>
  )
}

describe('主题上下文：运行时切换', () => {
  it('useTheme 提供令牌；切换后令牌更新（不重挂载——state 保留验证）', () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme-id').textContent).toBe('glass')
    expect(screen.getByTestId('theme-canvas').textContent).toBe('#16181d')
    const buttons = container.querySelectorAll('button')
    fireEvent.click(buttons[1] as HTMLButtonElement)
    fireEvent.click(buttons[0] as HTMLButtonElement)
    expect(screen.getByTestId('theme-id').textContent).toBe('sticker')
    expect(screen.getByTestId('theme-canvas').textContent).toBe('#fdfdfb')
  })

  it('useTheme 在 Provider 外抛错', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => void 0)
    let err: unknown = null
    function Boom() {
      try {
        // biome-ignore lint/correctness/useHookAtTopLevel: 本用例即验证 useTheme 在 ThemeProvider 外抛错，必须置于 try 内调用
        useTheme();
      } catch (e) {
        err = e
      }
      return null
    }
    render(<Boom />)
    expect(String(err)).toContain('ThemeProvider')
    spy.mockRestore()
  })
})