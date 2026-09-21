# ADR-0007 · StageInner 组件拆分（消除 Hooks 条件调用）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-01 |
| 决策人 | 蒋指导、WorkBuddy（工程执笔） |
| 状态 | **方案已定，待执行**（高风险重构，需确认后动手） |
| 上游 | ADR-0005（依赖方向守护）· ADR-0006（渲染后端策略） |

## 背景

`apps/canvas/src/MindmapStage.tsx` 的 `StageInner`（1627 行文件的主体，L107–1553）存在
**21 处 React Hooks 条件调用** —— 早退 `if (!controller) return null`（L176）位于 Hook 序列中间，
其后 L180–660 仍有 21 个 Hook。

⚠️ **这个早退不能简单删除**（ADR-0005「P2 深挖结论」已论证）：

```
149: const controllerRef = useRef<EditorController | null>(null);
150: if (controllerRef.current === null && editable) { ... }   // editable 为 null 时不初始化
164: const controller = useEditor(controllerRef.current ?? (null as unknown as EditorController));
176: if (!controller) return null;                              // ← 解析失败时的降级保护
180: const firstDocEffectRef = useRef(true);                    // ← 第一个违规 Hook
481: useMemo(...) 读 controller.root                            // ← 删早退会在此 TypeError
647: useEffect(() => installBeforeUnload(() => controller.dirty))
```

当数据管线解析失败（`editable` 为 null）→ controller 为 null → 删掉早退会让 L481/L647 直接崩溃。
**controller 确实可能为 null，早退有实际意义，不是纯防御代码。**

## 决策

**采用 React 官方推荐解法：把 `StageInner` 拆成「数据加载层」+「渲染层」两个组件。**

- 外层负责创建 controller 并在 null 时降级；
- 内层接收**非 null** 的 controller，其后所有 Hook 无条件调用。

## 拆分方案（精确边界）

### 外层 `StageInner`（L107–176，保留 7 个安全 Hook）

```tsx
function StageInner() {
  const { token } = useTheme();                                   // L108
  const [pluginActive, setPluginActive] = useState(false);         // L110
  const [stats, setStats] = useState<MapStats | null>(null);       // L111
  const regs = useMemo(() => createReactRegistries(), []);         // L114
  useEffect(() => { ...插件宿主... }, []);                          // L120
  const [docMenuOpen, setDocMenuOpen] = useState(false);           // L136
  const data = useMemo(() => buildEditable(doc.source), [...]);    // L141
  const controllerRef = useRef<EditorController | null>(null);     // L149
  if (controllerRef.current === null && editable) { ... }          // L150-163
  const controller = useEditor(controllerRef.current ?? (null as unknown as EditorController)); // L164

  // 早退：此时上面 7 个 Hook 均已无条件调用 ✓
  if (!controller) return <解析失败提示 UI />;                       // L176（改为 UI 而非 null）

  return <StageContent ...18 个 props />;
}
```

### 内层 `StageContent`（L178–1553，21 个 Hook 全无条件）

```tsx
function StageContent(props: StageContentProps) {
  const firstDocEffectRef = useRef(true);     // L180
  useEffect(() => { ...文档切换... }, [...]);  // L181
  // ... 其余 19 个 Hook（L180–660）...

  if (!layout) return null;                   // L673 —— 在所有 Hook 之后，位置正确 ✓
  return (<div>...</div>);                    // L679–1553（JSX 874 行）
}
```

### 需传递的 props（18 个，脚本核实）

| 类别 | props |
|---|---|
| 主题与统计 | `token`、`stats`、`setStats` |
| 插件与文档 | `pluginActive`、`doc`、`setDoc`、`docMenuOpen`、`setDocMenuOpen`、`docHost`、`fileInputRef` |
| 数据管线 | `data`、`editable`、`refs`、`entities`、`setEntities` |
| 控制器 | `controller`（非 null）、`controllerRef` |
| 其他 | `apiRef` |

留在外层（内层不用，5 个）：`setPluginActive`、`regs`、`hostRef`、`host`、`docHostRef`

## 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 移动 ~1400 行代码出错 | 中高 | git 已有 3 个 commit，可 `git checkout .` 回滚 |
| Hook 依赖顺序搞错 | 中 | 严格保持原有行序，只做整体搬迁不重排 |
| props 遗漏 | 中 | 脚本已核实 18 个；typecheck 会立刻暴露遗漏 |
| 行为改变 | 低 | 纯搬迁，不改逻辑；739 测试 + UI 截图双重验证 |
| 早退 UI 从 `null` 改为提示 | 低 | 解析失败时用户看到错误提示而非空白，体验更好 |

## 验证清单

1. `pnpm typecheck`（3 包全绿）
2. `pnpm test`（739 全绿：kernel 296 + react 443）
3. `pnpm depcruise`（0 违规）
4. `pnpm lint`（0 error）
5. `pnpm build`
6. **UI 截图**（dev server 5201）—— 确认画布/工具条/面板正常
7. `biome lint` 复查 `useHookAtTopLevel` 从 38 → 预期降至个位数

## 不做的事

- ❌ 不顺带重排 Hook 顺序（只搬迁，最小变更原则）
- ❌ 不顺带拆 MapView（1455 行，那是 P2-3，独立一轮）
- ❌ 不顺带清 warning（保持单一职责）

## 后续（P2-3）

`MapView.tsx`（1455 行）拆 `interactions/` —— 6 类指针事件（pan/zoom/drag/click/右键/双击）
是内聚度最高、最容易独立的一块。
