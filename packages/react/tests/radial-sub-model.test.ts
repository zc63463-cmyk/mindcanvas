/**
 * ② 二级环 · 席位模型（派生）测试（v1.8.2）
 * ══════════════════════════════════════════════════════════════════════
 * 锁定三组不变量：
 * 1. 纯：facts → 页席位（主 7 席顺序固定 = 角度序；末席恒为「打开完整菜单」；方向页末席恒为「返回」）；
 * 2. 条件灰显**不抽席**（根 / 未注入入口）+ 动态文案（升为中心 ↔ 降格、枢纽 ↔ 取消枢纽、
 *    剪贴板席：复制中心编号 ↔ 复制节点文本——**七席恒无空缺**）；
 * 3. 适配器：事实从 controller 读、**动作与右键菜单同源**（onPromote/onDemote/onCopyCid/onStart/updateNote；
 *    第 1 席「新建同级节点」与剪贴板席「复制节点文本」走 `sharedCommands` 同一实现）。
 */
import { describe, expect, it, vi } from 'vitest';
import { astToEditable, getNode, parseMm } from '@mindcanvas/kernel';
import {
  subRingPagesFor,
  submenuItemsFor,
  type CenterMenuActions,
  type SubRingFacts,
} from '../src/edit/contextMenuItems.js';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';

function build(mm: string): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(astToEditable(parseMm(mm).root!)!, {}, frame);
}

/** 典型事实：非根 / 非中心 / 无 cid / 非枢纽 / 两个入口都注入 */
const FACTS: SubRingFacts = {
  isRoot: false,
  isCenter: false,
  hasCid: false,
  isHub: false,
  hasDesc: true,
  hasNote: true,
};

/** 中心动作袋（默认「非中心」；按需 patch） */
const centerBag = (patch: Partial<CenterMenuActions> = {}): CenterMenuActions => ({
  onPromote: vi.fn(),
  onDemote: vi.fn(),
  isCenter: () => false,
  parentLinkOf: () => 'hide',
  onToggleParentLink: vi.fn(),
  isDetached: () => false,
  onAttach: vi.fn(),
  ...patch,
});

describe('② 二级环席位模型 · 纯（facts → 页）', () => {
  it('主 7 席顺序固定（数据序 = 角度序），末席恒为「打开完整菜单」', () => {
    const [page0, page1] = subRingPagesFor(FACTS);
    expect(page0?.map((i) => i.id)).toEqual([
      'sub:add-sibling',
      'sub:edit-desc',
      'sub:edit-note',
      'sub:center',
      'sub:hub',
      'sub:copy-text',
      'sub:more-menu',
    ]);
    expect(page1?.map((i) => i.id)).toEqual([
      'sub:center-right',
      'sub:center-left',
      'sub:center-down',
      'sub:center-up',
      'sub:back',
    ]);
    expect(page1?.[4]?.opensPage).toBe(0); // 末席「返回」→ 主页
  });

  it('第 1 席「新建同级节点」：非根可用；根灰显（与菜单同条件）', () => {
    expect(subRingPagesFor(FACTS)[0]?.[0]).toMatchObject({ id: 'sub:add-sibling', hint: 'Enter' });
    expect(subRingPagesFor(FACTS)[0]?.[0]?.disabled).toBe(false);
    expect(subRingPagesFor({ ...FACTS, isRoot: true })[0]?.[0]?.disabled).toBe(true);
  });

  it('席位 4 动态：非中心 = 升为中心（翻页席）；是中心 = 降格为普通节点（直接提交）', () => {
    expect(subRingPagesFor(FACTS)[0]?.[3]).toMatchObject({ id: 'sub:center', opensPage: 1 });
    const centered = subRingPagesFor({ ...FACTS, isCenter: true })[0]?.[3];
    expect(centered).toMatchObject({ id: 'sub:demote' });
    expect(centered?.opensPage).toBeUndefined();
  });

  it('剪贴板席动态：有 cid = 复制中心编号；否则 = 复制节点文本（恒可用 → 无空缺）', () => {
    const plain = subRingPagesFor(FACTS)[0]?.[5];
    expect(plain?.id).toBe('sub:copy-text');
    expect(plain?.disabled).toBeUndefined(); // 恒可用：七席不会出现「洞」
    const withCid = subRingPagesFor({ ...FACTS, isCenter: true, hasCid: true })[0]?.[5];
    expect(withCid?.id).toBe('sub:copy-cid');
    // 是中心但无 cid（旧数据）→ 退化为复制文本，仍不留空席
    expect(subRingPagesFor({ ...FACTS, isCenter: true, hasCid: false })[0]?.[5]?.id).toBe('sub:copy-text');
  });

  it('条件灰显不抽席：根（同级·center·hub 灰）/ 未注入（desc·note 灰）/ 剪贴板席恒可用', () => {
    const p0 =
      subRingPagesFor({ isRoot: true, isCenter: false, hasCid: false, isHub: false, hasDesc: false, hasNote: false })[0] ??
      [];
    expect(p0).toHaveLength(7); // 灰显 ≠ 抽席（顺序/角度稳定）
    expect(p0.map((i) => Boolean(i.disabled))).toEqual([true, true, true, true, true, false, false]);
    const centered = subRingPagesFor({ ...FACTS, isCenter: true, hasCid: true })[0] ?? [];
    expect(centered[5]?.disabled).toBeUndefined(); // 中心 + 有 cid → 复制编号
    expect(centered[3]?.disabled).toBe(false); // 非根 → 可降格
  });

  it('枢纽席文案动态（升级 ↔ 取消）', () => {
    expect(subRingPagesFor(FACTS)[0]?.[4]?.label).toBe('升级为出线枢纽');
    expect(subRingPagesFor({ ...FACTS, isHub: true })[0]?.[4]?.label).toBe('取消出线枢纽');
  });
});

describe('② 二级环席位模型 · 适配器（controller + 动作袋）', () => {
  it('事实从 controller 读取；动作与右键菜单同源（onPromote 收到方向、updateNote 写 hub）', () => {
    const c = build('# 根\n\n- A\n');
    const id = c.root.children[0]!.id;
    const onPromote = vi.fn();
    const onStartDesc = vi.fn();
    const model = submenuItemsFor(c, id, {
      descActions: { onStart: onStartDesc },
      centerActions: centerBag({ onPromote, cidOf: () => undefined }),
    });
    expect(model.pages[0]?.[1]?.disabled).toBe(false); // 注入了 desc → 可用
    expect(model.pages[0]?.[5]?.id).toBe('sub:copy-text'); // 非中心 → 剪贴板席退化为「复制节点文本」
    expect(model.pages[0]?.[5]?.disabled).toBeUndefined(); // 不再出现「灰显空洞」
    expect(model.pages[0]?.[4]?.label).toBe('升级为出线枢纽');

    model.actions['sub:center-right']?.();
    expect(onPromote).toHaveBeenCalledWith(id, 'right');
    model.actions['sub:edit-desc']?.();
    expect(onStartDesc).toHaveBeenCalledWith(id);
    model.actions['sub:hub']?.(); // 与菜单同命令：写 note.hub
    const hub: unknown = getNode(c.root, id)?.note?.hub; // .mm.md 标量可能是布尔或字符串（两态都接受）
    expect(hub === true || hub === 'true').toBe(true);
  });

  it('第 1 席动作 = 与菜单同一命令：新建同级 → 选中 → 进入编辑（根节点无此路径）', () => {
    const c = build('# 根\n\n- A\n');
    const id = c.root.children[0]!.id;
    const model = submenuItemsFor(c, id, {});
    model.actions['sub:add-sibling']?.();
    expect(c.root.children).toHaveLength(2); // 新兄弟已建
    const sib = c.root.children[1]!.id;
    expect(c.selectedId).toBe(sib); // 且已选中（菜单同行为）
    // 根节点：该席灰显（不吃动作）
    expect(submenuItemsFor(c, c.root.id, {}).pages[0]?.[0]?.disabled).toBe(true);
  });

  it('hub 容错（自菜单迁入）：存档里 hub: "true"（字符串标量）→ 环第 5 席显示「取消出线枢纽」', () => {
    // `.mm.md` 解析不做类型收敛（hub: true → 'true'）——判态走 readHubFlag，与内核同源
    const c = build('# 根\n\n<!--\ndir: right\nhub: true\n-->\n## 枢纽\n');
    const id = c.root.children[0]!.id;
    expect(c.root.children[0]!.note?.hub).toBe('true'); // 存档形态前提
    expect(submenuItemsFor(c, id, {}).pages[0]?.[4]?.label).toBe('取消出线枢纽');
  });

  it('剪贴板席换文案：是中心且有 cid → 复制中心编号（动作同源 onCopyCid）', () => {
    const c = build('# 根\n\n- A\n');
    const id = c.root.children[0]!.id;
    const onCopyCid = vi.fn();
    const model = submenuItemsFor(c, id, {
      centerActions: centerBag({ isCenter: () => true, cidOf: () => 'c123', onCopyCid }),
    });
    expect(model.pages[0]?.[5]?.id).toBe('sub:copy-cid');
    model.actions['sub:copy-cid']?.();
    expect(onCopyCid).toHaveBeenCalledWith(id);
  });

  it('复制节点文本：注入 copyActions 优先；缺省直接写剪贴板', () => {
    const c = build('# 根\n\n- A\n');
    const id = c.root.children[0]!.id;
    const onCopyText = vi.fn();
    submenuItemsFor(c, id, { copyActions: { onCopyText } }).actions['sub:copy-text']?.();
    expect(onCopyText).toHaveBeenCalledWith(id);

    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    submenuItemsFor(c, id, {}).actions['sub:copy-text']?.();
    expect(writeText).toHaveBeenCalledWith('A');
  });
});
