/**
 * entity-ref v0.2.1 golden tests 用例数据（T01–T30）
 * 来源：specs/entity-ref-v0.2-spec.md 第 4 章（T01–T25）
 *      + specs/entity-ref-v0.2.1-idea-amendment.md 第 5 章（T26–T30）
 *
 * erratum（T15）：规格中 T15 的输入把 H5 行放在 H4 之后，但期望输出
 * 与其自身装配算法（2.1.3 伪代码 + 2.3 表）矛盾（栈算法下 H5 应挂 H4 下），
 * 规格括注「H1 后直接 H5 → 挂到根下」才是作者意图。此处按文档化意图修正：
 * H5 行移至 H1 之后，期望随输入修正（同时覆盖「深层节点不吞噬后续兄弟」）。
 *
 * erratum（T23）：规格伪代码「level ← 2」会使后续 H2 成为降级根的兄弟，
 * 与 T23 期望（H2 挂到降级根下）矛盾。实现按期望：重复 H1 诊断后保持
 * 栈语义 level 1（挂到根下、后续标题归其名下）。
 */
import type { MindNode, Note } from './types.js';

export interface GoldenCase {
  id: string;
  name: string;
  input: string;
  expected: {
    root: MindNode | null;
    refs: { kind: string; id: string }[];
    diagnostics: { code: string; line: number }[];
  };
}

const t = (text: string, children: MindNode[] = [], note?: Note): MindNode =>
  note === undefined ? { type: 'text', text, children } : { type: 'text', text, children, note };
const e = (kind: string, id: string, children: MindNode[] = []): MindNode => ({
  type: 'entity',
  ref: { kind, id },
  children,
});
const img = (url: string, children: MindNode[] = []): MindNode => ({
  type: 'image',
  url,
  children,
});
const d = (code: string, line: number) => ({ code, line });
const r = (kind: string, id: string) => ({ kind, id });

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: 'T01',
    name: '空文件',
    input: String.raw``,
    expected: { root: null, refs: [], diagnostics: [] },
  },
  {
    id: 'T02',
    name: '仅空白行',
    input: '\n\n   \n\t',
    expected: { root: null, refs: [], diagnostics: [] },
  },
  {
    id: 'T03',
    name: '最简文件：仅根节点',
    input: String.raw`# Agent Gateway`,
    expected: { root: t('Agent Gateway'), refs: [], diagnostics: [] },
  },
  {
    id: 'T04',
    name: '根节点带笔记',
    input: String.raw`<!--
one_liner: 这是根节点的笔记
-->
# Agent Gateway
## 分支`,
    expected: {
      root: t('Agent Gateway', [t('分支')], { one_liner: '这是根节点的笔记' }),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T05',
    name: '笔记绑定到列表项（而非其后同级项）',
    input: String.raw`# 根
<!--
one_liner: 关于子项甲
-->
- 子项甲
- 子项乙`,
    expected: {
      root: t('根', [t('子项甲', [], { one_liner: '关于子项甲' }), t('子项乙')]),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T06',
    name: '笔记：单行 YAML 体',
    input: String.raw`# 根
<!--
one_liner: 修复同步游标
-->
## 分支`,
    expected: {
      root: t('根', [t('分支', [], { one_liner: '修复同步游标' })]),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T07',
    name: '笔记：多行全字段',
    input: String.raw`# 根
<!--
one_liner: 修复同步游标
decisions:
  - 游标必须复合 (updated_at, id)
  - tombstone 使用独立游标
status: in-progress
next: 补齐 golden tests
reminder: 别忘了检查 Windows 路径
-->
## 分支`,
    expected: {
      root: t('根', [
        t('分支', [], {
          one_liner: '修复同步游标',
          decisions: ['游标必须复合 (updated_at, id)', 'tombstone 使用独立游标'],
          status: 'in-progress',
          next: '补齐 golden tests',
          reminder: '别忘了检查 Windows 路径',
        }),
      ]),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T08',
    name: '笔记：YAML 特殊字符（冒号/方括号/引号/反斜杠）',
    input: String.raw`# 根
<!--
one_liner: "含: 冒号 与 [方括号] 与 '单引号'"
decisions:
  - '路径: docs/a.md [已归档]'
status: "review: pass"
next: 检查 C:\temp 与 "双引号"
-->
## 分支`,
    expected: {
      root: t('根', [
        t('分支', [], {
          one_liner: "含: 冒号 与 [方括号] 与 '单引号'",
          decisions: ['路径: docs/a.md [已归档]'],
          status: 'review: pass',
          next: '检查 C:\\temp 与 "双引号"',
        }),
      ]),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T09',
    name: 'v0.1 完整示例 gateway.mm.md → 完整 AST',
    input: String.raw`# Agent Gateway
## 协议层
- REST / OpenAPI
- MCP 适配
## 身份授权

- @doc:docs/architecture/gateway-design.md
- @issue:42
- 仓库级 token + Space 边界
## 只读工具
- list_documents
- search
- get_content
## 写入门禁
- @pr:17
- 提案 → 人工批准 → CAS
## 我的想法
- 只读先行，别被 AI 带偏`,
    expected: {
      root: t('Agent Gateway', [
        t('协议层', [t('REST / OpenAPI'), t('MCP 适配')]),
        t('身份授权', [
          e('doc', 'docs/architecture/gateway-design.md'),
          e('issue', '42'),
          t('仓库级 token + Space 边界'),
        ]),
        t('只读工具', [t('list_documents'), t('search'), t('get_content')]),
        t('写入门禁', [e('pr', '17'), t('提案 → 人工批准 → CAS')]),
        t('我的想法', [t('只读先行，别被 AI 带偏')]),
      ]),
      refs: [r('doc', 'docs/architecture/gateway-design.md'), r('issue', '42'), r('pr', '17')],
      diagnostics: [],
    },
  },
  {
    id: 'T10',
    name: '五类合法实体引用',
    input: String.raw`# 引用集
- @issue:42
- @pr:17
- @doc:docs/architecture/gateway-design.md
- @milestone:2026-W36
- @note:meeting-2026-w36`,
    expected: {
      root: t('引用集', [
        e('issue', '42'),
        e('pr', '17'),
        e('doc', 'docs/architecture/gateway-design.md'),
        e('milestone', '2026-W36'),
        e('note', 'meeting-2026-w36'),
      ]),
      refs: [
        r('issue', '42'),
        r('pr', '17'),
        r('doc', 'docs/architecture/gateway-design.md'),
        r('milestone', '2026-W36'),
        r('note', 'meeting-2026-w36'),
      ],
      diagnostics: [],
    },
  },
  {
    id: 'T11',
    name: '中文 doc 路径 + 特殊字符标题 + 中文文本',
    input: String.raw`# 中文根节点
## C# 与冒号: 的标题
- 中文文本节点
- @doc:文档/架构/网关设计.md`,
    expected: {
      root: t('中文根节点', [
        t('C# 与冒号: 的标题', [t('中文文本节点'), e('doc', '文档/架构/网关设计.md')]),
      ]),
      refs: [r('doc', '文档/架构/网关设计.md')],
      diagnostics: [],
    },
  },
  {
    id: 'T12',
    name: '未注册 kind：保留实体节点 + 警告',
    input: String.raw`# 根
- @task:5`,
    expected: {
      root: t('根', [e('task', '5')]),
      refs: [r('task', '5')],
      diagnostics: [d('W-UNKNOWN-KIND', 2)],
    },
  },
  {
    id: 'T13',
    name: '非法 kind 与非引用的 @ 文本',
    input: String.raw`# 根
- @ISSUE:42
- @团队`,
    expected: {
      root: t('根', [t('@ISSUE:42'), t('@团队')]),
      refs: [],
      diagnostics: [d('W-INVALID-REF', 2)],
    },
  },
  {
    id: 'T14',
    name: '非法 id（四种）',
    input: String.raw`# 根
- @issue:abc
- @issue:42 备注
- @doc:../secrets.md
- @pr:0`,
    expected: {
      root: t('根', [t('@issue:abc'), t('@issue:42 备注'), t('@doc:../secrets.md'), t('@pr:0')]),
      refs: [],
      diagnostics: [
        d('W-INVALID-REF', 2),
        d('W-INVALID-REF', 3),
        d('W-INVALID-REF', 4),
        d('W-INVALID-REF', 5),
      ],
    },
  },
  {
    id: 'T15',
    name: '3 层嵌套 + 标题层级跳跃（已按规格意图修正，见文件头 erratum）',
    input: String.raw`# 根
##### 直接从根跳到五级
## 一级分支
### 二级分支
### 同级
## 另一分支
### 深层
#### 更深`,
    expected: {
      root: t('根', [
        t('直接从根跳到五级'),
        t('一级分支', [t('二级分支'), t('同级')]),
        t('另一分支', [t('深层', [t('更深')])]),
      ]),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T16',
    name: '标题超上限：7 个 #',
    input: String.raw`# 根
####### 七级标题
## 分支`,
    expected: {
      root: t('根', [t('分支')]),
      refs: [],
      diagnostics: [d('E-DEPTH-EXCEEDED', 2)],
    },
  },
  {
    id: 'T17',
    name: 'AST 总深度超 16：列表嵌套上溢',
    input: String.raw`# D
## L2
### L3
#### L4
##### L5
###### L6
- i7
  - i8
    - i9
      - i10
        - i11
          - i12
            - i13
              - i14
                - i15
                  - i16
                    - i17`,
    expected: {
      root: t('D', [
        t('L2', [
          t('L3', [
            t('L4', [
              t('L5', [
                t('L6', [
                  t('i7', [
                    t('i8', [
                      t('i9', [
                        t('i10', [
                          t('i11', [t('i12', [t('i13', [t('i14', [t('i15', [t('i16')])])])])]),
                        ]),
                      ]),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
      refs: [],
      diagnostics: [d('E-DEPTH-EXCEEDED', 17)],
    },
  },
  {
    id: 'T18',
    name: '空行 / 一行式注释 / 杂散行',
    input: String.raw`# 根

<!-- 这是一行式注释，应被整体忽略 -->

  <!-- 缩进的一行式注释同样忽略 -->

杂散文本行
## 分支
- 项`,
    expected: {
      root: t('根', [t('分支', [t('项')])]),
      refs: [],
      diagnostics: [d('W-STRAY-LINE', 7)],
    },
  },
  {
    id: 'T19',
    name: '未闭合注释块',
    input: String.raw`# 根
<!--
one_liner: 未闭合的笔记
- 这行也在笔记体内`,
    expected: {
      root: t('根'),
      refs: [],
      diagnostics: [d('E-UNCLOSED-NOTE', 2)],
    },
  },
  {
    id: 'T20',
    name: '图像节点（含 URL 带空格的回退）',
    input: String.raw`# 根
- ![](images/架构图.png)
- ![logo](img/logo.png)
- ![坏](images/a b.png)`,
    expected: {
      root: t('根', [img('images/架构图.png'), img('img/logo.png'), t('![坏](images/a b.png)')]),
      refs: [],
      diagnostics: [],
    },
  },
  {
    id: 'T21',
    name: '实体引用节点带子节点',
    input: String.raw`# 根
- @issue:42
  - 复现步骤
  - @doc:docs/bug.md`,
    expected: {
      root: t('根', [e('issue', '42', [t('复现步骤'), e('doc', 'docs/bug.md')])]),
      refs: [r('issue', '42'), r('doc', 'docs/bug.md')],
      diagnostics: [],
    },
  },
  {
    id: 'T22',
    name: '同一实体被多次引用',
    input: String.raw`# 根
- @issue:42
## 分支
- @issue:42`,
    expected: {
      root: t('根', [e('issue', '42'), t('分支', [e('issue', '42')])]),
      refs: [r('issue', '42'), r('issue', '42')],
      diagnostics: [],
    },
  },
  {
    id: 'T23',
    name: '多根节点（降级根保持 H1 栈语义，见文件头 erratum）',
    input: String.raw`# 第一根
## A
# 第二根
## B`,
    expected: {
      root: t('第一根', [t('A'), t('第二根', [t('B')])]),
      refs: [],
      diagnostics: [d('E-MULTI-ROOT', 3)],
    },
  },
  {
    id: 'T24',
    name: '无根节点',
    input: String.raw`## B
- x`,
    expected: {
      root: t('', [t('B', [t('x')])]),
      refs: [],
      diagnostics: [d('E-NO-ROOT', 1)],
    },
  },
  {
    id: 'T25',
    name: '连续两个笔记块 + 孤儿笔记',
    input: String.raw`# 根
<!--
one_liner: 第一段（将被遮蔽）
-->
<!--
one_liner: 第二段（生效）
-->
## 分支
<!--
one_liner: 孤儿（其后无节点）
-->`,
    expected: {
      root: t('根', [t('分支', [], { one_liner: '第二段（生效）' })]),
      refs: [],
      diagnostics: [d('W-NOTE-SHADOWED', 2), d('W-ORPHAN-NOTE', 9)],
    },
  },
  {
    id: 'T26',
    name: 'idea 引用（本项目作用域）',
    input: String.raw`# 灵感看板
- @idea:42
- @idea:7`,
    expected: {
      root: t('灵感看板', [e('idea', '42'), e('idea', '7')]),
      refs: [r('idea', '42'), r('idea', '7')],
      diagnostics: [],
    },
  },
  {
    id: 'T27',
    name: '跨项目 idea 引用（作用域前缀）',
    input: String.raw`# 根
- @idea:markvault:42
- @idea:pomodoroXII:7`,
    expected: {
      root: t('根', [e('idea', 'markvault:42'), e('idea', 'pomodoroXII:7')]),
      refs: [r('idea', 'markvault:42'), r('idea', 'pomodoroXII:7')],
      diagnostics: [],
    },
  },
  {
    id: 'T28',
    name: '非法 idea id（四类）',
    input: String.raw`# 根
- @idea:abc
- @idea:MARKVAULT:42
- @idea:markvault:42:extra
- @idea:0`,
    expected: {
      root: t('根', [
        t('@idea:abc'),
        t('@idea:MARKVAULT:42'),
        t('@idea:markvault:42:extra'),
        t('@idea:0'),
      ]),
      refs: [],
      diagnostics: [
        d('W-INVALID-REF', 2),
        d('W-INVALID-REF', 3),
        d('W-INVALID-REF', 4),
        d('W-INVALID-REF', 5),
      ],
    },
  },
  {
    id: 'T29',
    name: 'idea 引用带子节点（列表嵌套）',
    input: String.raw`# 根
- @idea:42
  - 培育中：与 AI 讨论事件溯源
  - @doc:docs/ideas/event-sourcing.md`,
    expected: {
      root: t('根', [
        e('idea', '42', [
          t('培育中：与 AI 讨论事件溯源'),
          e('doc', 'docs/ideas/event-sourcing.md'),
        ]),
      ]),
      refs: [r('idea', '42'), r('doc', 'docs/ideas/event-sourcing.md')],
      diagnostics: [],
    },
  },
  {
    id: 'T30',
    name: '混合场景：idea 与 issue 同图 + 重复',
    input: String.raw`# Agent Gateway
## 灵感来源
- @idea:42
## 落地任务
- @issue:48
- @idea:42`,
    expected: {
      root: t('Agent Gateway', [
        t('灵感来源', [e('idea', '42')]),
        t('落地任务', [e('issue', '48'), e('idea', '42')]),
      ]),
      refs: [r('idea', '42'), r('issue', '48'), r('idea', '42')],
      diagnostics: [],
    },
  },
];
