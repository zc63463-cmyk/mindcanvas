/**
 * MindCanvas 架构依赖守护（dependency-cruiser）
 *
 * 这是**机器可执行的架构决策** —— 把 ADR 里写下的分层约定变成 CI/hook 能自动拦截的规则。
 * 运行：pnpm depcruise （或 pnpm gate / gate:fast 会连带执行）
 * 首次看全量依赖图：pnpm depcruise:graph
 *
 * 设计原则（对齐 ADR-0005）：
 * 1. 规则只守护「不可协商的架构资产」，不做风格lint（风格交给 Biome）
 * 2. 每条规则必须有 comment 说明「为什么」——规则即文档
 * 3. 误报优先于漏报：只加确信的规则，宁可少加也不制造噪音
 */
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    // ─────────────────────────────────────────────────────────────
    // 1. 内核纯净性（最宝贵的架构资产，见 ADR-0005）
    // ─────────────────────────────────────────────────────────────
    {
      name: 'kernel-pure',
      comment:
        'kernel 是只读底座：零运行时依赖、无 DOM。禁止依赖 react / react-dom / @mindcanvas/react / apps。' +
        '一旦破防，内核就无法在 headless（测试/Node/CI）环境复用，也会把 DOM 泄漏进纯计算层。',
      severity: 'error',
      from: { path: '^packages/kernel/src' },
      to: {
        path: '^(react|react-dom|@mindcanvas/react|apps/)',
      },
    },
    {
      name: 'free-canvas-pure',
      comment:
        'free-canvas 是自由画布 headless 模型：零 React。禁止依赖 react / @mindcanvas/react / apps。',
      severity: 'error',
      from: { path: '^packages/free-canvas/src' },
      to: {
        path: '^(react|react-dom|@mindcanvas/react|apps/)',
      },
    },
    {
      name: 'kernel-no-node-builtin',
      comment:
        'kernel 不依赖 Node 内置模块（fs/path/os 等）——保持同构，浏览器与 Node 都能跑。',
      severity: 'error',
      from: { path: '^packages/kernel/src' },
      to: {
        dependencyTypes: ['core'],
        path: '^(fs|path|os|child_process|crypto|http|https|url|util|events|stream)$',
      },
    },

    // ─────────────────────────────────────────────────────────────
    // 2. 依赖方向（分层单向）
    // ─────────────────────────────────────────────────────────────
    {
      name: 'no-kernel-depends-on-outer',
      comment: '依赖只能向内：kernel 不能被 react/apps 反向依赖之外的方向污染（即 kernel 不得依赖外层）。',
      severity: 'error',
      from: { path: '^packages/kernel/' },
      to: { path: '^(packages/react/|apps/)' },
    },
    {
      name: 'no-cross-app',
      comment:
        'apps 之间互不依赖（每个 app 是独立部署单元，共享代码必须下沉到 packages/）。' +
        'pathNot 排除「同 app 内部」引用——只拦跨 app（apps/canvas → apps/other）。',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },

    // ─────────────────────────────────────────────────────────────
    // 3. 结构卫生
    // ─────────────────────────────────────────────────────────────
    {
      name: 'no-circular',
      comment: '禁止循环依赖——会导致初始化顺序不确定、tree-shaking 失效、增量布局缓存难推理。',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        '孤立模块（无人引用且非入口）提示死代码。warn 而非 error：研究中产物允许暂时孤立。',
      severity: 'warn',
      from: {
        orphan: true,
        path: '^packages/(kernel|react|free-canvas)/src',
        pathNot: '\\.(test|spec)\\.(ts|tsx)$|^packages/[^/]+/src/index\\.ts$',
      },
      to: {},
    },
    {
      name: 'no-duplicate-dep',
      comment: '防止同一依赖多版本共存（体积膨胀 + 实例不共享）。',
      severity: 'warn',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypes: ['npm', 'npm-dev'] },
    },
  ],

  options: {
    doNotFollow: {
      // node_modules 不展开（性能）
      path: 'node_modules',
    },
    exclude: {
      // 构建产物与分析对象不参与守护
      path: '(^|/)(dist|build|coverage|\\.workbuddy|bench-assets|dogfood-output|llm|scripts)/',
    },
    // TS/TSX 用 tsconfig 的 paths 解析（本项目用相对路径 .js 互引，仍需正确解析扩展名）
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
}
