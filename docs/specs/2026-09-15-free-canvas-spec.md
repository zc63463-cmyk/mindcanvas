# Free Canvas 子模式规格（mindcanvas Canvas Document v1）

- **日期**：2026-09-15
- **状态**：实施中（C+1）
- **定位**：与导图（`.mm.md`）**并列**的自由画布子模式；事实源独立；对标 markvault native 翻卡 UX。

## 1. 边界

| 做 | 不做 |
|---|---|
| `sticky-classic` / `card-panel` 两壳 | 标注素材库 / AnnotationPlacement 管线 |
| CSS 3D 整卡翻面；`face` 落盘 | 把 NotePopover / `note.md` 当产品翻卡 |
| 「添加背面」；空 back 也可翻 | tldraw / Excalidraw / xyflow 依赖 |
| 卡间自由连线（直线 MVP） | 导图级边避障 |
| `*.mc.canvas.json` 打开/保存/最近 | 把自由卡塞进 `.mm.md` |

## 2. 文件格式

- 扩展名：`.mc.canvas.json`
- MIME / 打开：JSON 文本；`schemaVersion: 1`
- 未知字段：**透传**（parse→serialize 保真，与 `.mm.md` 铁律同纪律）

```ts
interface McCanvasDocument {
  schemaVersion: 1;
  canvasId: string;
  title: string;
  placements: NativePlacement[];
  edges: McCanvasEdge[];
  viewport: { panX: number; panY: number; scale: number };
  updatedAt: number;
  // …未知键透传
}
```

### Placement（仅 native）

- `kind: 'native'`
- `shell: 'sticky-classic' | 'card-panel'`
- `face: 'front' | 'back'`
- `front`: `{ contentKind: 'plain', text }` | `{ contentKind: 'markdown', body }`
- `back?`: `{ contentKind: 'markdown', body }` — **存在即启用翻面**（空 body 也可翻）
- `transform: { x, y, w, h }`
- `zIndex`, `placementUuid`, timestamps

### Edge

- `edgeUuid`
- `fromPlacementUuid` / `toPlacementUuid`
- 可选 `fromAnchor` / `toAnchor`（缺省 `center`）
- 可选 `label`

## 3. 交互契约

1. 悬停显示翻面钮；仅 `back !== undefined`
2. 「添加背面」→ `back = { contentKind:'markdown', body:'' }` → 自动 `face:'back'` → 编辑
3. 翻面：整卡 `preserve-3d` + `rotateY(180deg)` ≈ 0.4s；`face` 写入文档
4. 双击：编辑**当前面**（不翻面）
5. 拖卡 / 空白 pan / 滚轮 zoom；删卡级联删边
6. 连线工具：从卡拖到另一卡

## 4. 包边界

- `@mindcanvas/free-canvas`：纯模型（零 React）
- `@mindcanvas/react`：`free-canvas/` 视图与手势
- `apps/canvas`：`FreeCanvasStage` + 模式切换 + DocumentHost 平行宿主
