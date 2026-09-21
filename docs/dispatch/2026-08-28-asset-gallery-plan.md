# 笔记图库（资产实体化）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 mindcanvas 增加 `@img` / `@draw` 资产实体 kind + 资产预览渲染 + 图库侧栏面板，把资产引用实体化（本地 assets 优先，resolver 预留插拔）。

**Architecture:** 全走 v1.0 冻结 API 的最小落地——协议层 `REGISTERED_KINDS`/`KIND_META`/`validateId` 增两条目（无签名变更）；react 侧 NodeG 对 `img`/`draw` 实体渲染 `<image>` 资产预览（复用 nodeCardStyle 令牌）；新增 `AssetPanel` 图库侧栏（与 OutlinePanel 同构）点击插入 `@img` 引用；`EditorController.addEntityChild` 走 TreeOp 保证 undo。资产清单首期来自打包 demo 资产（浏览器沙箱无法扫本地目录）。

**Tech Stack:** TypeScript / pnpm workspace（kernel headless / react 渲染 / canvas 组合）/ Vitest + jsdom / React 19 / SVG

---

## 实现前必读

- spec：`docs/specs/2026-08-28-asset-gallery-design.md`
- 现状：`packages/kernel/src/protocol/types.ts`（kind 注册）、`packages/react/src/render/NodeG.tsx`（节点渲染）、`packages/react/src/edit/controller.ts`（TreeOp 入口）、`packages/react/src/demo/pipeline.ts`（buildEntities）
- 约定：JSDoc 中文注释；每任务一个 commit（`feat(assets): Tn ...`）；测试文件 `tests/{模块}-{场景}.test.ts(x)`

---

### Task 1: kernel 注册 `img` / `draw` kind

**Files:**
- Modify: `packages/kernel/src/protocol/types.ts`
- Modify: `packages/kernel/tests/registry-builtin.test.ts`
- Create: `packages/kernel/tests/kind-asset.test.ts`

- [ ] **Step 1: 写失败测试 `packages/kernel/tests/kind-asset.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { KIND_META, REGISTERED_KINDS, parseMm, validateId } from '../src/index.js'
import { refKey } from '../src/protocol/types.js'

describe('资产 kind（@img / @draw）注册与解析', () => {
  it('REGISTERED_KINDS 含 img / draw，且 KIND_META 有元信息', () => {
    expect(REGISTERED_KINDS).toContain('img')
    expect(REGISTERED_KINDS).toContain('draw')
    expect(KIND_META['img']).toBeDefined()
    expect(KIND_META['draw']).toBeDefined()
  })

  it('validateId：合法资产路径放行（含扩展名/子目录）', () => {
    expect(validateId('img', 'demo-assets/demo-diagram.svg')).toBe(true)
    expect(validateId('draw', 'assets/board.svg')).toBe(true)
  })

  it('validateId：拒绝 ../ 逃逸、空段、反斜杠、空串', () => {
    expect(validateId('img', '../secret.png')).toBe(false)
    expect(validateId('draw', 'a//b.svg')).toBe(false)
    expect(validateId('img', 'a/../b.svg')).toBe(false)
    expect(validateId('draw', '')).toBe(false)
    expect(validateId('img', 'a\\b.png')).toBe(false)
  })

  it('解析 @img 引用为已知 kind 实体（不再 W-UNKNOWN-KIND）', () => {
    const { root, refs, diagnostics } = parseMm('# 根\n- @img:demo-assets/demo-diagram.svg\n- @draw:assets/board.svg\n')
    expect(diagnostics.length).toBe(0)
    expect(refs.map(refKey)).toEqual(['img:demo-assets/demo-diagram.svg', 'draw:assets/board.svg'])
    expect(root?.children?.[0]?.type).toBe('entity')
    expect(root?.children?.[0]?.ref?.kind).toBe('img')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @mindcanvas/kernel test kind-asset`
Expected: FAIL（img/draw 未注册，validateId 对未注册 kind 走 default 返回 true，`../` 不会被拒）

- [ ] **Step 3: 修改 `packages/kernel/src/protocol/types.ts`**

三处改动：

```ts
export type RegisteredKind =
  | 'issue'
  | 'pr'
  | 'doc'
  | 'milestone'
  | 'note'
  | 'idea'
  | 'annotation'
  | 'img'
  | 'draw'

export const REGISTERED_KINDS: readonly RegisteredKind[] = [
  'issue', 'pr', 'doc', 'milestone', 'note', 'idea', 'annotation', 'img', 'draw',
]
```

`KIND_META` 增两条目：

```ts
export const KIND_META: Record<string, { color: string; label: string }> = {
  // ...既有七类不动...
  img: { color: '#12b886', label: 'img' },
  draw: { color: '#e64980', label: 'draw' },
}
```

`validateId`：把 doc 的路径校验抽成助手并复用于 img/draw：

```ts
/** 资产/文档相对路径校验：非空、无逃逸段（. / .. / 空段）、无反斜杠、段命名合法 */
function isAssetPath(body: string): boolean {
  if (!body || body.startsWith('/') || body.includes('\\') || body.length > 512) return false
  const segs = body.split('/')
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false
  return segs.every((s) => NAME_ID_RE.test(s))
}
```

并把 doc case 改为 `case 'doc': return isAssetPath(body)`，新增 `case 'img': case 'draw': return isAssetPath(body)`。

- [ ] **Step 4: 更新 `packages/kernel/tests/registry-builtin.test.ts` 计数 7 → 9**

把 `expect(r.kinds.list()).toHaveLength(7)` 改为 `toHaveLength(9)`，描述"七类"改"九类"。

- [ ] **Step 5: 跑 kernel 全量测试确认绿**

Run: `pnpm --filter @mindcanvas/kernel test`
Expected: 全部 PASS（含既有 266，新增 kind-asset 4 例）

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/protocol/types.ts packages/kernel/tests/registry-builtin.test.ts packages/kernel/tests/kind-asset.test.ts
git commit -m "feat(assets): T1 内核注册 img/draw kind——REGISTERED_KINDS/KIND_META/validateId（资产路径校验，拒 ../ 逃逸）；registry-builtin 计数 7→9"
```

---

### Task 2: react `EditorController.addEntityChild`

**Files:**
- Modify: `packages/react/src/edit/controller.ts`
- Modify: `packages/react/tests/editor-controller.test.ts`

- [ ] **Step 1: 写失败测试（追加到 `editor-controller.test.ts`）**

```ts
it('addEntityChild：新建实体子节点经 TreeOp，undo 可回退', () => {
  const c = buildController()
  const a = c.root.children[0]!
  const id = c.addEntityChild(a.id, { kind: 'img', id: 'demo-assets/x.svg' })
  const n = getNode(c.root, id)
  expect(n?.type).toBe('entity')
  expect(n?.ref).toEqual({ kind: 'img', id: 'demo-assets/x.svg' })
  expect(c.dirty).toBe(true)
  expect(c.undo()).toBe(true)
  expect(getNode(c.root, id)).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @mindcanvas/react test editor-controller`
Expected: FAIL（addEntityChild 不存在）

- [ ] **Step 3: 实现（controller.ts，import 补 makeEntityNode）**

```ts
/** 新建实体子节点（图库插入 @img/@draw 引用）；返回新节点 id */
addEntityChild(parentId: string, ref: { kind: string; id: string }): string {
  const child = makeEntityNode(ref)
  this.apply({ type: 'add-child', parentId, child })
  return child.id
}
```

（`makeEntityNode` 已从 `@mindcanvas/kernel` 导出。）

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @mindcanvas/react test editor-controller`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/edit/controller.ts packages/react/tests/editor-controller.test.ts
git commit -m "feat(assets): T2 EditorController.addEntityChild——实体子节点经 TreeOp + undo 可回退"
```

---

### Task 3: react NodeG 资产预览渲染

**Files:**
- Modify: `packages/react/src/render/NodeG.tsx`
- Modify: `packages/react/src/render/MapView.tsx`
- Create: `packages/react/tests/nodeg-asset.test.tsx`

- [ ] **Step 1: 写失败测试 `packages/react/tests/nodeg-asset.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { astToEditable, layoutMindmap, makeEntityNode, makeTextNode } from '@mindcanvas/kernel'
import { ThemeProvider } from '../src/theme/ThemeContext.js'
import { MapView } from '../src/render/MapView.js'
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js'

function assetLayout() {
  const root = makeTextNode('根', [
    makeEntityNode({ kind: 'img', id: 'demo-assets/demo-diagram.svg' }),
    makeEntityNode({ kind: 'draw', id: 'demo-assets/board.svg' }),
    makeEntityNode({ kind: 'issue', id: '1' }),
  ])
  const editable = astToEditable(root)!
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null)
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char }
}

describe('NodeG：@img/@draw 资产预览渲染', () => {
  it('img/draw 实体节点渲染 <image> 且 href 拼接 assetBaseUrl', () => {
    const { layout, char } = assetLayout()
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/demo-assets/" />
      </ThemeProvider>,
    )
    const imgs = container.querySelectorAll('image')
    const hrefs = Array.from(imgs).map((i) => i.getAttribute('href'))
    expect(hrefs).toContain('/demo-assets/demo-assets/demo-diagram.svg')
    expect(hrefs).toContain('/demo-assets/demo-assets/board.svg')
  })

  it('非资产实体（@issue）不渲染 <image>', () => {
    const { layout, char } = assetLayout()
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/demo-assets/" />
      </ThemeProvider>,
    )
    expect(container.querySelectorAll('image').length).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @mindcanvas/react test nodeg-asset`
Expected: FAIL（NodeG 无 image）

- [ ] **Step 3: 实现**

NodeG.tsx：`NodeGProps` 加 `assetBaseUrl?: string`。在 `<g>` 内（卡片 rect 之后）加分支：

```tsx
const assetKind =
  node.node.type === 'entity' && node.node.ref?.kind && (node.node.ref.kind === 'img' || node.node.ref.kind === 'draw')
    ? node.node.ref.kind
    : null
const assetHref = assetKind && assetBaseUrl ? assetBaseUrl + (node.node.ref?.id ?? '') : null
```

rect 之后、文本 group 之前：

```tsx
{assetHref !== null && (
  <image
    href={assetHref}
    x={4}
    y={4}
    width={Math.max(0, b.w - 8)}
    height={Math.max(0, bodyH - 8)}
    preserveAspectRatio="xMidYMid meet"
    opacity={0.92}
  />
)}
```

MapView.tsx：`MapViewProps` 加 `assetBaseUrl?: string`；传给每个 NodeG：`assetBaseUrl={assetBaseUrl}`。

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm --filter @mindcanvas/react test nodeg-asset`
Expected: PASS

- [ ] **Step 5: 跑 react 全量 + typecheck**

Run: `pnpm --filter @mindcanvas/react test` && `pnpm --filter @mindcanvas/react typecheck`
Expected: 全 PASS / Done

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/render/NodeG.tsx packages/react/src/render/MapView.tsx packages/react/tests/nodeg-asset.test.tsx
git commit -m "feat(assets): T3 NodeG 资产预览——@img/@draw 实体渲染 <image>（assetBaseUrl 拼接），非资产实体不受影响"
```

---

### Task 4: react AssetPanel 图库侧栏

**Files:**
- Create: `packages/react/src/chrome/AssetPanel.tsx`
- Modify: `packages/react/src/index.ts`（barrel 导出）
- Create: `packages/react/tests/asset-panel.test.tsx`

- [ ] **Step 1: 写失败测试 `packages/react/tests/asset-panel.test.tsx`**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { AssetPanel, type AssetItem } from '../src/chrome/AssetPanel.js'

const ASSETS: AssetItem[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg', name: 'demo-diagram.svg', type: 'svg' },
  { kind: 'draw', id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
]

describe('AssetPanel：图库侧栏', () => {
  it('渲染资产列表（名称 + 类型徽章）', () => {
    const { container } = render(<AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={vi.fn()} />)
    expect(container.textContent).toContain('demo-diagram.svg')
    expect(container.textContent).toContain('board.svg')
  })

  it('点击资产 → onInsert 回调该资产项', () => {
    const insert = vi.fn()
    const { getByText } = render(<AssetPanel assets={ASSETS} onInsert={insert} onClose={vi.fn()} />)
    fireEvent.click(getByText('demo-diagram.svg'))
    expect(insert).toHaveBeenCalledWith(ASSETS[0])
  })

  it('点击关闭 → onClose', () => {
    const close = vi.fn()
    const { container } = render(<AssetPanel assets={ASSETS} onInsert={vi.fn()} onClose={close} />)
    fireEvent.click(container.querySelector('[data-asset-close]')!)
    expect(close).toHaveBeenCalled()
  })

  it('空资产 → 空态引导', () => {
    const { container } = render(<AssetPanel assets={[]} onInsert={vi.fn()} onClose={vi.fn()} />)
    expect(container.textContent).toContain('assets/')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @mindcanvas/react test asset-panel`
Expected: FAIL（AssetPanel 未定义）

- [ ] **Step 3: 实现 `packages/react/src/chrome/AssetPanel.tsx`**

```tsx
/**
 * AssetPanel —— 笔记图库侧栏（右侧玻璃浮层，与 OutlinePanel 同构）。
 * 资产清单首期来自打包 demo 资产（浏览器沙箱无法扫本地目录；真实 FS 接入属后续迭代）。
 * 点击资产 → onInsert（宿主负责插入 @img/@draw 引用）；空态引导。
 */
import { CHROME } from '../theme/tokens.js'

export interface AssetItem {
  kind: 'img' | 'draw'
  id: string
  name: string
  type: string
}

export interface AssetPanelProps {
  assets: AssetItem[]
  onInsert: (item: AssetItem) => void
  onClose: () => void
}

export function AssetPanel({ assets, onInsert, onClose }: AssetPanelProps) {
  return (
    <div
      data-asset-panel
      style={{
        position: 'absolute',
        right: 18,
        top: 76,
        width: 230,
        maxHeight: '60vh',
        overflowY: 'auto',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px) saturate(1.3)',
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        padding: 8,
        zIndex: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px 8px' }}>
        <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>图库</span>
        <span style={{ flex: 1 }} />
        <span
          data-asset-close
          onClick={onClose}
          style={{ color: CHROME.textMuted, cursor: 'pointer', fontSize: CHROME.fontSize }}
        >
          ×
        </span>
      </div>
      {assets.length === 0 ? (
        <div style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, padding: '8px 6px' }}>
          暂无资产。将图片放入导图同目录 assets/ 后刷新。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {assets.map((a) => (
            <div
              key={`${a.kind}:${a.id}`}
              data-asset-item
              onClick={() => onInsert(a)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 6px',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  fontSize: CHROME.fontSizeSmall,
                  color: a.kind === 'img' ? CHROME.neon : CHROME.textMuted,
                  fontWeight: 600,
                  width: 36,
                  flex: 'none',
                }}
              >
                {a.kind}
              </span>
              <span style={{ fontSize: CHROME.fontSizeSmall, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 从包入口导出**（`packages/react/src/index.ts` 加 `export * from './chrome/AssetPanel.js'`）

- [ ] **Step 5: 跑测试确认绿**

Run: `pnpm --filter @mindcanvas/react test asset-panel`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/chrome/AssetPanel.tsx packages/react/src/index.ts packages/react/tests/asset-panel.test.tsx
git commit -m "feat(assets): T4 AssetPanel 图库侧栏——资产列表 + 点击插入回调 + 空态引导（玻璃浮层与 OutlinePanel 同构）"
```

---

### Task 5: apps/canvas 数据管线接线 + demo 资产

**Files:**
- Create: `apps/canvas/public/demo-assets/demo-diagram.svg`
- Create: `apps/canvas/public/demo-assets/board.svg`
- Modify: `apps/canvas/src/demo/gateway.mm.md`
- Modify: `apps/canvas/src/MindmapStage.tsx`
- Modify: `packages/react/src/edit/keys.ts`（加图库快捷键）

- [ ] **Step 1: 建 demo 资产 SVG**

`apps/canvas/public/demo-assets/demo-diagram.svg`（架构图示意）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect x="1" y="1" width="198" height="118" rx="8" fill="#1f242f" stroke="#2f9e44" stroke-width="2"/>
  <rect x="16" y="16" width="70" height="34" rx="6" fill="#d97706" opacity="0.85"/>
  <rect x="114" y="16" width="70" height="34" rx="6" fill="#0c8599" opacity="0.85"/>
  <rect x="16" y="70" width="168" height="34" rx="6" fill="#5c7cfa" opacity="0.7"/>
  <line x1="86" y1="33" x2="114" y2="33" stroke="#e9ecef" stroke-width="2"/>
  <line x1="50" y1="50" x2="50" y2="70" stroke="#e9ecef" stroke-width="2"/>
  <line x1="150" y1="50" x2="150" y2="70" stroke="#e9ecef" stroke-width="2"/>
</svg>
```

`apps/canvas/public/demo-assets/board.svg`（白板草稿示意）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect x="1" y="1" width="198" height="118" rx="8" fill="#232830" stroke="#e64980" stroke-width="2"/>
  <path d="M 30 80 Q 70 20 120 60 T 180 40" fill="none" stroke="#e9ecef" stroke-width="2"/>
  <circle cx="40" cy="88" r="5" fill="#e64980"/>
  <circle cx="120" cy="60" r="5" fill="#12b886"/>
  <circle cx="180" cy="40" r="5" fill="#d97706"/>
</svg>
```

- [ ] **Step 2: gateway.mm.md 加资产分支**

文件末尾追加：

```markdown
## 图库（资产实体化）
- @img:demo-assets/demo-diagram.svg
- @draw:demo-assets/board.svg
```

- [ ] **Step 3: MindmapStage.tsx 接线**

1. `GATEWAY_TITLES` 增两条目：

```ts
'img:demo-assets/demo-diagram.svg': { title: '演示架构图', status: 'ready' },
'draw:demo-assets/board.svg': { title: '白板草稿', status: 'ready' },
```

2. `entities` 由 useMemo 常量改为 state：

```ts
const [entities, setEntities] = useState<Map<string, Entity>>(() => buildEntities(refs, GATEWAY_TITLES))
```

`layout` useMemo 依赖数组加入 `entities`。

3. 图库开关 + 资产清单 + 插入回调 + 工具栏按钮 + AssetPanel 渲染 + MapView 传 `assetBaseUrl="/demo-assets/"`。

插入回调：

```ts
onInsert={(item) => {
  if (!controller.selectedId) return
  const id = controller.addEntityChild(controller.selectedId, { kind: item.kind, id: item.id })
  setEntities((prev) => {
    const next = new Map(prev)
    next.set(`${item.kind}:${item.id}`, { kind: item.kind, id: item.id, title: item.name, status: 'ready', ref: null })
    return next
  })
  controller.select(id)
  setAssetOpen(false)
}}
```

- [ ] **Step 4: keys.ts 加图库快捷键（Ctrl+Shift+A）**

`packages/react/src/edit/keys.ts`：`EditorKeyAction` 加 `| { type: 'assets' }`；`EDITOR_KEY_BINDINGS` 加 `{ key: 'Ctrl+Shift+A', label: '图库', action: 'assets' }`；`matchEditorKey` 组合键分支加：

```ts
if (k === 'a' && e.shiftKey) return { type: 'assets' }
```

MindmapStage 快捷键 switch 加：

```ts
case 'assets':
  e.preventDefault()
  setAssetOpen((v) => !v)
  return
```

- [ ] **Step 5: typecheck + 浏览器实测**

Run: `pnpm -r typecheck`
Expected: 三包 Done

浏览器（dev 已跑则热更新）：
1. 页面含「图库（资产实体化）」分支，`@img` / `@draw` 节点渲染 SVG 预览
2. 选中任意节点 → Ctrl+Shift+A 或点工具栏「图库」→ 侧栏显示两资产 → 点击 → 选中节点下插入 `@img` 引用实体节点并渲染图片
3. 保存导图（Ctrl+S 下载）→ 文本含 `@img:demo-assets/demo-diagram.svg`，重导往返一致

- [ ] **Step 6: Commit**

```bash
git add apps/canvas/public/demo-assets apps/canvas/src/demo/gateway.mm.md apps/canvas/src/MindmapStage.tsx packages/react/src/edit/keys.ts
git commit -m "feat(assets): T5 canvas 接线——demo 资产 SVG + gateway 资产分支 + AssetPanel 插入流程（addEntityChild + entities 动态扩展）+ Ctrl+Shift+A 图库快捷键"
```

---

### Task 6: 全量验证 + 收尾

**Files:** 无新增（仅验证）

- [ ] **Step 1: 全量测试 + typecheck + build**

Run: `pnpm -r test` && `pnpm -r typecheck` && `pnpm -r build`
Expected: kernel 270（266+4）/ react 136（129+7）全绿；三包 typecheck/build Done

- [ ] **Step 2: 回归确认**

- `pnpm why react --filter @mindcanvas/kernel` 仍无匹配（kernel 零 react/DOM 不变量）
- kernel 无插件构建（空注册表测试）仍绿

- [ ] **Step 3: round-trip 断言补充**（若 Task 1 未覆盖，加到 `kind-asset.test.ts`）

```ts
import { astToEditable, editableToAst, serializeMm } from '../src/index.js'

it('serialize round-trip：@img/@draw 引用原样保留', () => {
  const src = '# 根\n- @img:demo-assets/demo-diagram.svg\n- @draw:assets/board.svg\n'
  const { root } = parseMm(src)
  const text = serializeMm(editableToAst(astToEditable(root)!))
  expect(text).toContain('@img:demo-assets/demo-diagram.svg')
  expect(text).toContain('@draw:assets/board.svg')
})
```

- [ ] **Step 4: git log 复核**

Run: `git log --oneline -6`
Expected: `feat(assets): T1..T5` 五条 + 可能收尾提交

---

## Self-Review 结论

- **Spec 覆盖**：@img/@draw kind（T1）、NodeG 资产预览（T3）、AssetPanel 侧栏（T4）、插入管线（T2/T5）、demo 资产（T5）、round-trip（T1/T6）——spec §1-§5 全覆盖；§6 不做项均未实现
- **冻结合规**：kernel 零签名变更（KIND_META/REGISTERED_KINDS 为数据增补）；renderer 槽位 `KindBadgeRenderer` 类型不动（NodeG 内容分支为 react 内部实现）——与 spec 第 3 节「渲染器槽位注入」措辞的实现澄清，按"以仓库现状为准"记录
- **类型一致性**：`AssetItem.kind: 'img'|'draw'`、`addEntityChild(parentId, ref)`、`assetBaseUrl` 各 Task 间一致
