/**
 * 编辑器快捷键表（T1：先做 6 个 + 保存/折叠；批次 1 补：缩进/导航/折叠展开/重置缩放）。
 * 节点级 + 全局级统一判定：editing 时全局快捷键应被输入框拦截（组件层先于本表）。
 */
import type { GrowDir } from '@mindcanvas/kernel';

/**
 * 预方向键位：Alt + 方向键（单键触发、语义直白）。
 *
 * 为什么废弃 PG 的双敲（W W / S S / A A / D D）：
 * 1. 双敲有 400ms 时序窗口，手感不确定、且无中间反馈；
 * 2. 裸 WASD 在未来可能与文本操作冲突；
 * 3. Alt+方向键与既有的「裸方向键 = 导航」天然分层，零冲突、可一眼理解。
 */
const PRE_DIR_ARROWS: Readonly<Record<string, GrowDir>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** 预方向快捷键 → 方向（Alt + 方向键；无匹配 → null）。无状态纯函数。 */
export function matchPreDirKey(e: KeyboardEvent): GrowDir | null {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (!e.altKey) return null;
  return PRE_DIR_ARROWS[e.key] ?? null;
}
export type EditorKeyAction =
  | { type: 'add-child' }
  | { type: 'add-sibling' }
  | { type: 'delete' }
  | { type: 'edit' }
  | { type: 'desc' }
  | { type: 'collapse' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'save' }
  | { type: 'indent' }
  | { type: 'outdent' }
  | { type: 'navigate'; dir: 'up' | 'down' | 'left' | 'right' }
  | { type: 'fold' }
  | { type: 'unfold' }
  | { type: 'reset-zoom' }
  | { type: 'help' }
  | { type: 'search' }
  | { type: 'outline' }
  | { type: 'assets' }
  | { type: 'open' }
  | { type: 'new' }
  | { type: 'relation' };

export const EDITOR_KEY_BINDINGS: ReadonlyArray<{
  key: string;
  label: string;
  action: EditorKeyAction['type'];
}> = [
  { key: 'Tab', label: '新建子节点', action: 'add-child' },
  { key: 'Shift+Tab', label: '缩进', action: 'indent' },
  { key: 'Ctrl+Shift+Tab', label: '反缩进', action: 'outdent' },
  { key: 'Enter', label: '新建同级节点', action: 'add-sibling' },
  { key: 'Delete', label: '删除节点', action: 'delete' },
  { key: 'F2', label: '编辑文本', action: 'edit' },
  { key: 'Shift+Enter', label: '编辑描述', action: 'desc' },
  { key: 'Space', label: '折叠/展开', action: 'collapse' },
  { key: 'Ctrl+[', label: '折叠选中', action: 'fold' },
  { key: 'Ctrl+]', label: '展开选中', action: 'unfold' },
  { key: '↑↓←→', label: '方向导航（就近节点）', action: 'navigate' },
  { key: 'Ctrl+Z', label: '撤销', action: 'undo' },
  { key: 'Ctrl+Shift+Z / Ctrl+Y', label: '重做', action: 'redo' },
  { key: 'Ctrl+S', label: '保存', action: 'save' },
  { key: 'Ctrl+O', label: '打开', action: 'open' },
  { key: 'Ctrl+N', label: '新建', action: 'new' },
  { key: 'Ctrl+0', label: '重置缩放', action: 'reset-zoom' },
  { key: 'Ctrl+F', label: '搜索', action: 'search' },
  { key: 'Ctrl+D', label: '大纲', action: 'outline' },
  { key: 'Ctrl+Shift+A', label: '图库', action: 'assets' },
  { key: 'Ctrl+Shift+R', label: '关系图', action: 'relation' },
  { key: '?', label: '快捷键帮助', action: 'help' },
  {
    key: 'Alt+↑ / Alt+↓ / Alt+← / Alt+→',
    label: '预方向：先按方向，再 Tab/Enter 生长（固化进新节点）',
    action: 'help',
  },
  {
    key: '按住 Alt（≥250ms）',
    label: '环形快捷操作：节点右上角出环（↑新建 / →编辑 / ↓删除 / ←更多；方向键漫游，松键提交，Esc 收起）',
    action: 'help',
  },
  {
    // v1.8.2（T7）：二级环与菜单翻页——席位清单由帮助面板从派生模型列出
    key: '更多 › 450ms',
    label: '二级环展开：←→ 轮转（跳过灰显席）、Enter 提交、点内圈回一级（7 席清单见下方）',
    action: 'help',
  },
  {
    key: '菜单 ← / ‹ 返回',
    label: '右键菜单翻页：方向 / 长度收在子页（← 或「‹ 返回」回上一页；Esc 关闭）',
    action: 'help',
  },
];

/** 键盘事件 → 动作（无匹配 → null；组合键优先于裸键，裸键要求无任何修饰） */
export function matchEditorKey(e: KeyboardEvent): EditorKeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  // 组合键（ctrl/meta）：优先于裸键
  if (mod) {
    const k = key.toLowerCase();
    if (k === 's') return { type: 'save' };
    if (k === 'o' && !e.shiftKey) return { type: 'open' };
    if (k === 'n' && !e.shiftKey) return { type: 'new' };
    if (k === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (k === 'y') return { type: 'redo' };
    if (k === '[') return { type: 'fold' };
    if (k === ']') return { type: 'unfold' };
    if (k === '0') return { type: 'reset-zoom' };
    if (k === 'f') return { type: 'search' };
    if (k === 'd') return { type: 'outline' };
    if (k === 'a' && e.shiftKey) return { type: 'assets' };
    if (k === 'r' && e.shiftKey) return { type: 'relation' };
    if (e.shiftKey && key === 'Tab') return { type: 'outdent' };
    return null;
  }
  // 裸键带 alt → 忽略（避免与浏览器/系统快捷键冲突）
  if (e.altKey) return null;
  // Shift 类裸键
  if (e.shiftKey) {
    if (key === 'Tab') return { type: 'indent' };
    if (key === 'Enter') return { type: 'desc' };
    if (key === '?' || key === '/') return { type: 'help' };
    return null;
  }
  // 纯裸键
  if (key === 'Tab') return { type: 'add-child' };
  if (key === 'Enter') return { type: 'add-sibling' };
  if (key === 'Delete' || key === 'Backspace') return { type: 'delete' };
  if (key === 'F2') return { type: 'edit' };
  if (key === ' ') return { type: 'collapse' };
  if (key === 'ArrowUp') return { type: 'navigate', dir: 'up' };
  if (key === 'ArrowDown') return { type: 'navigate', dir: 'down' };
  if (key === 'ArrowLeft') return { type: 'navigate', dir: 'left' };
  if (key === 'ArrowRight') return { type: 'navigate', dir: 'right' };
  return null;
}
