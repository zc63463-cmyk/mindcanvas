/**
 * 内置矢量图标集（FA1-T4）：20+ 个思维导图常用单色图标。
 *
 * 为什么内置而不是只让用户上传：图库空态时新用户一个图标都没有，
 * 「设为节点图标」这条路径无从起步；内置集让功能开箱可用。
 *
 * 全部为 **24×24 viewBox + currentColor 单色描边** —— 内联进主文档后
 * 自动跟随主题色（见 `render/svgTint.ts`），不需要为深色/浅色各存一份。
 */

/** 内联 SVG 的体积上限（字节）：15KB。超过则以 <image> 加载，不内联进文档 */
export const INLINE_SVG_LIMIT = 15 * 1024;

export interface BuiltinIcon {
  /** 稳定 id（写入 note.icon 时经 data URL 自包含，不依赖本文件存在） */
  id: string;
  /** 展示名（搜索/Tooltip 用） */
  name: string;
  /** 分类标签（面板 Tabs 过滤用） */
  tags: string[];
  /** SVG 源码（单色，currentColor） */
  svg: string;
}

/** 统一外壳：24 格 viewBox + currentColor 描边（各图标只写内容） */
function icon(body: string, filled = false): string {
  const paint = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ${paint}>${body}</svg>`;
}

/** 优先级图标：N 级 = N 条递增竖条（一眼可辨，不依赖文字） */
function priorityBars(level: number): string {
  const bars = [
    { x: 4, h: 5 },
    { x: 8.5, h: 9 },
    { x: 13, h: 13 },
    { x: 17.5, h: 17 },
    { x: 22, h: 21 },
  ].slice(0, Math.max(1, Math.min(5, level)));
  const step = 18 / bars.length;
  return bars
    .map((_, i) => {
      const x = 3 + i * step;
      const h = 4 + i * 4;
      return `<rect x="${x.toFixed(1)}" y="${(21 - h).toFixed(1)}" width="${(step - 2.5).toFixed(1)}" height="${h}" rx="1.2"/>`;
    })
    .join('');
}

export const BUILTIN_ICONS: readonly BuiltinIcon[] = [
  { id: 'check', name: '完成', tags: ['状态'], svg: icon('<path d="M5 13l4 4L19 7"/>') },
  {
    id: 'checkbox',
    name: '待办',
    tags: ['状态'],
    svg: icon('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  },
  {
    id: 'warning',
    name: '警告',
    tags: ['状态'],
    svg: icon('<path d="M12 3.5L21.5 20H2.5z"/><path d="M12 9.5v4.2"/><path d="M12 16.8h.01"/>'),
  },
  {
    id: 'ban',
    name: '禁止',
    tags: ['状态'],
    svg: icon('<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>'),
  },
  {
    id: 'question',
    name: '疑问',
    tags: ['状态'],
    svg: icon(
      '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.3a2.7 2.7 0 1 1 3.6 2.6c-.7.3-1 .9-1 1.6v.4"/><path d="M12 16.9h.01"/>',
    ),
  },
  {
    id: 'star',
    name: '星标',
    tags: ['标记'],
    svg:
      icon(
        '<path d="M12 3.6l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.6l-5.4 2.9 1-6.1L3.2 10l6.1-.9z"/>',
      ),
  },
  {
    id: 'heart',
    name: '关注',
    tags: ['标记'],
    svg: icon('<path d="M12 20.2S4.6 16 4.6 11a4.1 4.1 0 0 1 7.4-2.4 4.1 4.1 0 0 1 7.4 2.4c0 5-7.4 9.2-7.4 9.2z"/>'),
  },
  {
    id: 'bookmark',
    name: '书签',
    tags: ['标记'],
    svg: icon('<path d="M7 3.5h10v17l-5-4-5 4z"/>'),
  },
  {
    id: 'flag',
    name: '旗帜',
    tags: ['标记'],
    svg: icon('<path d="M5.5 21V3.5h13l-3.2 4.3 3.2 4.3h-13"/>'),
  },
  { id: 'p1', name: '优先级 1', tags: ['优先级'], svg: icon(priorityBars(1)) },
  { id: 'p2', name: '优先级 2', tags: ['优先级'], svg: icon(priorityBars(2)) },
  { id: 'p3', name: '优先级 3', tags: ['优先级'], svg: icon(priorityBars(3)) },
  { id: 'p4', name: '优先级 4', tags: ['优先级'], svg: icon(priorityBars(4)) },
  { id: 'p5', name: '优先级 5', tags: ['优先级'], svg: icon(priorityBars(5)) },
  {
    id: 'person',
    name: '负责人',
    tags: ['协作'],
    svg: icon('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5c0-3.7 3.2-5.6 7.2-5.6s7.2 1.9 7.2 5.6"/>'),
  },
  {
    id: 'bulb',
    name: '想法',
    tags: ['内容'],
    svg: icon('<path d="M9.5 18.2h5"/><path d="M10.6 21h2.8"/><path d="M12 3.4a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.6v.4h5.6v-.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3.4z"/>'),
  },
  {
    id: 'target',
    name: '目标',
    tags: ['内容'],
    svg: icon('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1"/>'),
  },
  {
    id: 'clock',
    name: '时间',
    tags: ['内容'],
    svg: icon('<circle cx="12" cy="12" r="8.6"/><path d="M12 6.8V12l3.2 2"/>'),
  },
  {
    id: 'fire',
    name: '紧急',
    tags: ['内容'],
    svg: icon('<path d="M12 21.5c3.6 0 5.8-2.4 5.8-5.6 0-3.8-3.8-4.7-3.8-8.4 0 0-2.8 1.3-2.8 4.6 0 1.5-.9 2.3-1.9 1.5-.6-.5-.8-1.3-.8-2C6.7 13 6.2 14.3 6.2 15.9c0 3.2 2.2 5.6 5.8 5.6z"/>'),
  },
  {
    id: 'bolt',
    name: '快速',
    tags: ['内容'],
    svg: icon('<path d="M13.4 2.5L4.6 14h5.6l-1 7.5L18 10h-5.6z"/>'),
  },
  {
    id: 'doc',
    name: '文档',
    tags: ['文件'],
    svg: icon('<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>'),
  },
  {
    id: 'folder',
    name: '文件夹',
    tags: ['文件'],
    svg: icon('<path d="M3.5 7.5h5.6l2 2h9.4v9.5H3.5z"/>'),
  },
  {
    id: 'tag',
    name: '标签',
    tags: ['文件'],
    svg: icon('<path d="M20.5 13.2l-7.3 7.3-8.7-8.7V3.5h8.3z"/><path d="M16.2 7.8h.01"/>'),
  },
  {
    id: 'link',
    name: '链接',
    tags: ['文件'],
    svg: icon('<path d="M9.6 14.4l4.8-4.8"/><path d="M11 7.2l1.7-1.7a3.6 3.6 0 0 1 5.1 5.1L16.1 12"/><path d="M13 16.8l-1.7 1.7a3.6 3.6 0 0 1-5.1-5.1L7.9 12"/>'),
  },
  {
    id: 'image',
    name: '图片',
    tags: ['文件'],
    svg: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17.5l4.7-4.3 3.4 3 3-2.6 3.9 3.5"/>'),
  },
  {
    id: 'code',
    name: '代码',
    tags: ['文件'],
    svg: icon('<path d="M9 8l-4 4 4 4"/><path d="M15 8l4 4-4 4"/>'),
  },
  {
    id: 'gear',
    name: '设置',
    tags: ['文件'],
    svg:
      icon(
        '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
      ),
  },
  {
    id: 'arrow',
    name: '下一步',
    tags: ['流程'],
    svg: icon('<path d="M4 12h15"/><path d="M13.5 6.5l6 5.5-6 5.5"/>'),
  },
  { id: 'plus', name: '新增', tags: ['流程'], svg: icon('<path d="M12 5.5v13"/><path d="M5.5 12h13"/>') },
];

/** 按 id 取内置图标（无 → undefined） */
export function builtinIconById(id: string): BuiltinIcon | undefined {
  return BUILTIN_ICONS.find((i) => i.id === id);
}

/**
 * 名称/标签模糊匹配（面板搜索用）。
 * 大小写不敏感，命中 id 优先（精确感更强）。
 */
export function matchBuiltinIcons(query: string): readonly BuiltinIcon[] {
  const q = query.trim().toLowerCase();
  if (q === '') return BUILTIN_ICONS;
  return BUILTIN_ICONS.filter(
    (i) => i.name.toLowerCase().includes(q) || i.id.includes(q) || i.tags.some((t) => t.includes(q)),
  );
}
