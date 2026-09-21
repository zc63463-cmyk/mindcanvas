/**
 * mind-node 协议类型 · entity-ref v0.2.1 对齐（v0.2.2 增补跨库前缀校验）
 * 三项目（Forge 知识画布 / markvault-js MindFlow / markvault-reborn）共享的协议层
 */

/** 已注册 kind（v0.2 六类 + v0.2.1 增补 idea + 资产 img/draw = 九类） */
export type RegisteredKind =
  | 'issue'
  | 'pr'
  | 'doc'
  | 'milestone'
  | 'note'
  | 'idea'
  | 'annotation'
  | 'img'
  | 'draw';

export const REGISTERED_KINDS: readonly RegisteredKind[] = [
  'issue',
  'pr',
  'doc',
  'milestone',
  'note',
  'idea',
  'annotation',
  'img',
  'draw',
];

/**
 * 轻量实体引用。kind 保持 string：未知 kind 依协议保留
 * （W-UNKNOWN-KIND，前向兼容 v0.3 新增 kind 的存量文件）。
 */
export interface EntityRef {
  kind: string;
  id: string;
}

/** 节点笔记（.mm.md 笔记块 YAML；未知字段容忍透传） */
export interface Note {
  one_liner?: string;
  decisions?: string[];
  status?: string;
  next?: string | string[];
  reminder?: string;
  /**
   * 幕布风格「描述」（v1.3.0）：对某一主题的解释和说明，纯文本，显示在节点下方。
   * 对齐幕布官方（mubu.com/help/20）：Shift+Enter 编辑，支持自动收缩（默认一行 / 点击展开全文）。
   * 与 note.qa（快速注释：多条目列表，点击展开）是两套并存机制——描述常驻可见，qa 按需展开。
   * 多行以 \n 分隔；空串视为无描述（写回时置 undefined 删除）。
   */
  desc?: string;
  /**
   * 节点注释 · **序列区域**（v1.4.0）：条目列表，浮窗内以编号列表渲染。取代 `qa`。
   *
   * 与 `desc` 的分工：`desc` 是简短说明，常驻节点盒内；`note` 是更丰富的补充内容，
   * 浮窗展示、不占节点空间。
   *
   * 迁移：旧文件的 `qa` 在**读取时**视为 `note` 的回退值（见 `noteOf()`），
   * 写入一律写 `note`。
   */
  note?: string[];
  /**
   * 节点注释 · **纯文本区域**（v1.4.0）：一整段多行文本，浮窗内以段落渲染。
   *
   * 与 `note`（序列区域）是**同一浮窗内的两个区域**，不是二选一的类型 ——
   * 两者可同时存在，也可只填其一。
   */
  note_text?: string;
  /**
   * Section 空间分区清单（v1.5.0 · Phase 1 子树锚定）：仅文档根节点的 note 使用。
   * 每项锚定一棵子树（root 字段写入一律 `cid:`，读取兼容 `node:` 路径），
   * 渲染层据子树 AABB 自动算框——树内容增删改后框自动跟随，零引用同步成本。
   * 读写访问器见 `section.ts` 的 `sectionsOf()`。
   */
  sections?: SectionSpec[];
  /**
   * 出线长度（v1.6.0）：本节点与父节点连线的**直线段长度**（盒边到盒边的距离）。
   *
   * 按本节点有效生长方向解释：`down` = 父盒底边到本盒顶边（垂直）、`up` = 本盒底边
   * 到父盒顶边（垂直）、`right`/`left` = 水平距离。缺省用布局常量（V_GAP=14 /
   * H_GAP=64）；非法值（非正数/非有限数）忽略；下限 SEPARATE_MARGIN=14——
   * 过小会被钳回，防止连线两端盒重叠。
   *
   * **组缺省（up/down 专属）**：父节点的 `len` 同时是其 up/down 组的缺省层距——
   * up/down 的转折弯（子树竖段 → 共享梁 → 父中线段）距离是「父盒边到子树」的距离，
   * 语义归父：在父上设一处，整组上下子树连同共享梁一起抬升/下移；子节点自己的
   * `len` 优先覆盖自己的连线，孙层（子树内部）层距不受牵连。left/right 组不消费
   * 父级缺省（贝塞尔出线无共享梁，逐子节点自设即可）。
   *
   * 定位是**软约束**：只调「这条线的层距」，不改居中（up/down 组仍以父 cx 居中、
   * left/right 组仍垂直居中）、不改避让/消解——布局引擎仍是权威。用它做层次
   * 节奏（一级线长、二级线短）或给拥挤区域留白，无需引入绝对坐标。
   *
   * 仅分支布局（文档内存在任一 note.dir）消费；经典布局与 anchored 基线节点忽略。
   */
  len?: number;
  /**
   * 逐方向组缺省出线长度（v1.7.0）：父节点四个方向组各自的「共享梁层距」。
   *
   * 优先级：子节点自身 `len` > 父 `lens[dir]` > 父 `len`（仅 up/down，向后兼容）>
   * 布局常量（V_GAP/H_GAP）。键为四个生长方向；缺省键回落上述链；非法值同 `len`
   * 口径忽略、下限钳到 SEPARATE_MARGIN。
   *
   * 是共享梁拖拽（hub 交互）的落盘形态：拖哪根梁写哪个方向。
   */
  lens?: Partial<Record<'up' | 'down' | 'left' | 'right', number>>;
  /**
   * 梁比例位（v1.11.0）：共享梁在「父出边 ↔ 最近子入边」空隙中的比例位（0..1）。
   *
   * 与 `lens` 正交：`lens` 是整段层距（拖梁中段，松手后子组外推）；`beamAt` 是梁在
   * 该空隙里的位置（拖主干，父/子盒都不动，只改短桩长度）。缺省/非法 = 0.5（中点，
   * 与旧几何**逐位**兼容）；读侧钳到两侧各留 ≥ LINK_CLEAR_MARGIN（trunk/stub 不塌到 0）。
   * 键为四个生长方向；`≈ 0.5` 的方向键**不落盘**（写侧删键，保持手写文件干净）。
   */
  beamAt?: Partial<Record<'up' | 'down' | 'left' | 'right', number>>;
  /**
   * 出线枢纽（v1.7.0）：本节点的 left/right 组从贝塞尔切换为**共享竖梁** bus 线型
   * （父中线段 → 横段 → 竖梁 → 横段 → 子中线段），与 up/down 共享梁对称；
   * up/down 组本就是共享梁，不受此标记影响。
   *
   * 选择性启用：未标记的节点 left/right 仍是贝塞尔，老文档**一根线都不变**
   * （逐像素回归闸门依赖于此）。渲染层据此显示箭头与可拖拽的梁。
   */
  hub?: boolean;
  /**
   * 子树框编辑（持久框 · `FrameSpec`）：存在即该节点为**框根**；缺省 = 非框。
   * 成框只写元数据（子树仍在本节点 `children`，全保真往返）；拆框 = 删本键，
   * 其它 note 字段不动。读写访问器见 `protocol/frame.ts`。
   */
  frame?: FrameSpec;
  [key: string]: unknown;
}

/** Section 配色 token（渲染层映射具体色值；未知 token 透传不丢，渲染回退 slate） */
export const SECTION_COLORS = ['blue', 'amber', 'green', 'violet', 'rose', 'slate'] as const;
export type SectionColor = (typeof SECTION_COLORS)[number];
export const DEFAULT_SECTION_COLOR: SectionColor = 'slate';

/**
 * Section 空间分区（v1.5.0 · Phase 1 = 带装饰的 Center Island，D1 裁决）。
 *
 * Phase 1 仅 `root` 子树锚定形态：设 Section 即升格为 center，不存在非 center 的
 * Section（自由落位仅 center 级）。`members`/`collapsed` 为 Phase 2 预留字段——
 * Phase 1 不解析、不渲染、不写入。
 */
export interface SectionSpec {
  /** 实体身份：`sec_` + 短随机（供 `kind:id` 引用与 Phase 2 反向索引） */
  id: string;
  /** 标题栏文本；缺省渲染层取 root 节点标题 */
  title?: string;
  /** 配色 token；缺省 slate，未知值透传保留（前向兼容） */
  color?: SectionColor;
  /** 子树根锚：`cid:xxx`（写入一律落 cid）或 `node:根/分支/名`（读取兼容） */
  root: string;
  /** Phase 2 预留（D4 裁决 · C-a 形态）：管道分隔 cid 列表，如 "cid:a|cid:b" */
  members?: string;
  /** Phase 2+ 预留（D2 裁决）：折叠持久化；Phase 1 折叠为会话态不落盘 */
  collapsed?: boolean;
}

/**
 * 子树框编辑（局部大纲 · 按深度挂载）的**持久框标记**：挂在成框节点自身的 `note.frame`。
 *
 * 框不是新 `type`：成框只写元数据，子树仍挂在成框节点的 `children`（全保真往返，
 * 不重建第二份 AST）。`depth` 从框根起算（框根 `d = 0`）：`0…depth` 层收进框内
 * 大纲，`> depth` 层仍以空间节点挂在 `d = depth` 那一行的挂点上。只重排不改拓扑。
 *
 * 设计：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §3.1；
 * 读写访问器：`protocol/frame.ts`；协议登记：`.mm.md` 协议规格 §5.2。
 */
export interface FrameSpec {
  /** 协议版本：读侧必须严格 `=== 1`（结构升级走新版本号；旧客户端忽略未知键） */
  version: 1;
  /** 大纲层深度：有限整数且 ≥ 1（非法值读侧不认原值透传 / 写侧拒绝，见 `frame.ts`） */
  depth: number;
}

/** MindNode 三分结构（v0.2.1） */
export interface MindNode {
  type: 'text' | 'image' | 'entity';
  text?: string;
  url?: string;
  ref?: EntityRef;
  note?: Note;
  children: MindNode[];
}

/** 诊断（line 为 1 起原始行号；message 不参与 golden 比较） */
export interface Diagnostic {
  code: string;
  line: number;
  message: string;
}

export interface ParseResult {
  root: MindNode | null;
  refs: EntityRef[];
  diagnostics: Diagnostic[];
}

/** Entity 统一形状（resolver 输出；v0.2 加法扩展 meta） */
export interface Entity {
  kind: string;
  id: string;
  title: string | null;
  status: string | null;
  ref: string | null;
  meta?: Record<string, unknown> & { unresolved_reason?: string };
}

export type UnresolvedReason =
  | 'not-found'
  | 'unreachable'
  | 'unsupported-environment'
  | 'unknown-kind';

/** 构造 unresolved Entity（resolver 失败统一返回，不抛异常） */
export function unresolvedEntity(ref: EntityRef, reason: UnresolvedReason): Entity {
  return {
    kind: ref.kind,
    id: ref.id,
    title: null,
    status: 'unresolved',
    ref: null,
    meta: { unresolved_reason: reason },
  };
}

/** resolveMany 的 Map key 形式（v0.2 固化） */
export function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

const ISSUE_PR_ID_RE = /^[1-9][0-9]*$/;
// erratum(v0.2.1)：增补案前缀正则为全小写，但其 T27 用例 pomodoroXII（混合大小写）期望合法、
// T28 的 MARKVAULT（大写起始）期望非法 —— 按 golden 判定口径修正为：小写起始、混合大小写允许。
const IDEA_ID_RE = /^([a-z][a-zA-Z0-9_-]*:)?[1-9][0-9]*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 此处 \x00-\x1F 是刻意排除（字符类取反 [^...]，语义「id 不得含 @、冒号与控制字符」），非意外写入控制字符
const NAME_ID_RE = /^[^@:\x00-\x1F]+$/;
const ANNOTATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// v0.2.2 跨库引用前缀：`org` 单段或 `org/repo` 双段（Forgejo 仓库命名符 [A-Za-z0-9_.-]）+ 冒号
const ORG_PREFIX_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?:/;

/** 剥离可选跨库前缀，返回实体本体 id（无前缀 → 原样） */
export function stripOrgPrefix(id: string): string {
  const m = id.match(ORG_PREFIX_RE);
  return m ? id.slice(m[0].length) : id;
}

/** 资产/文档相对路径校验：非空、无逃逸段（. / .. / 空段）、无反斜杠、段命名合法 */
function isAssetPath(body: string): boolean {
  if (!body || body.startsWith('/') || body.includes('\\') || body.length > 512) return false;
  const segs = body.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  return segs.every((s) => NAME_ID_RE.test(s));
}

/** kind 级 id 校验（v0.2 各 kind + v0.2.1 idea 特例 + v0.2.2 跨库前缀） */
export function validateId(kind: string, id: string): boolean {
  if (kind === 'idea') {
    // v0.2.1 受控特例：可选 project 前缀（org 名），含恰好一个冒号；跨库前缀语法不作用于 idea
    return IDEA_ID_RE.test(id);
  }
  // v0.2.2：跨库前缀（org 单段 / org/repo 双段）剥离后校验实体本体
  const body = stripOrgPrefix(id);
  switch (kind) {
    case 'issue':
    case 'pr':
      return ISSUE_PR_ID_RE.test(body);
    case 'doc':
    case 'img':
    case 'draw':
      return isAssetPath(body);
    case 'milestone':
    case 'note': {
      const t = body.trim();
      return t.length > 0 && NAME_ID_RE.test(t);
    }
    case 'annotation':
      return ANNOTATION_ID_RE.test(id);
    default:
      // 未注册 kind：不做 id 校验（原样保留 + W-UNKNOWN-KIND）
      return true;
  }
}

/** kind 元信息（resolver / UI 共用：类型色与显示名） */
export const KIND_META: Record<string, { color: string; label: string }> = {
  issue: { color: '#d97706', label: 'issue' },
  pr: { color: '#6741d9', label: 'pr' },
  doc: { color: '#2f9e44', label: 'doc' },
  milestone: { color: '#0c8599', label: 'milestone' },
  note: { color: '#888780', label: 'note' },
  idea: { color: '#e8590c', label: 'idea' },
  annotation: { color: '#5c7cfa', label: 'annotation' },
  img: { color: '#12b886', label: 'img' },
  draw: { color: '#e64980', label: 'draw' },
};

/** 未知 kind 的降级色 */
export const KIND_FALLBACK_COLOR = '#888780';
