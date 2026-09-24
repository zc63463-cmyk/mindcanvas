/**
 * 「改为归档」的**编排**（P1-A ⑥ · file-management §3.6 / §4 DS-13）。
 * ══════════════════════════════════════════════════════════════════════
 * 语义（派单书 §3.1 预裁决）：归档**不是**新存储概念，就是**一次可靠移动** ——
 * `moveFileSafe(src → _归档/<name>)`。因此本模块：
 *  - 复用 P0-A 的 `FileOpOutcome` 四态（ok / cancelled / partial / failed）；
 *  - 复用既有的互斥域（当前文档走租约，非当前文档走既有 `moveFile`）；
 *  - **不**新增索引字段、**不**新增存储键、**不**写平行编排器。
 *
 * 两个入口（删除确认条旁的次要动作 + 右键菜单）调**同一个函数**（派单书 §3.2），
 * 差别只在 `isCurrent` 的取值 —— 它决定走租约编排还是既有移动。
 *
 * `_归档/` 按**普通目录**呈现（派单书 §3.1：不隐藏、不特殊渲染）；
 * 目录不存在则创建（`getDirectoryHandle(..., {create:true})` 是 FSA 的标准能力，
 * 由宿主的 `moveFileSafe` 内部保证）。已核实扫描对 `_` 前缀无特殊过滤
 * （`directoryHostConstants.SCAN_SKIP_DIRS` 只有 node_modules/.git/.obsidian/
 * .vscode/dist/build/.cache）——预裁决 §3.1 的自检点成立。
 */

/** 归档目录名（原样出现在树中，故是用户可见字节） */
export const ARCHIVE_DIR = '_归档';

/**
 * 文件是否**已经在**归档目录里（含嵌套：`_归档/2024/x.mm.md` 也算）。
 * 判据是「路径的任一段等于 `_归档`」，不是「以 `_归档/` 开头」——
 * 后者会漏掉 `a/_归档/b.mm.md` 这种嵌套归档目录。
 */
export function isArchivedPath(relPath: string): boolean {
  return relPath.split('/').includes(ARCHIVE_DIR);
}

/** 归档落点：与源同名、放进 `_归档/`（冲突由 §5.2 三选处理，不静默加序号） */
export function archiveTargetDir(relPath: string): string {
  const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  // 嵌套归档：把源所在目录的层级带进 `_归档/`，避免不同子目录的同名文件互相撞名
  return parent === '' ? ARCHIVE_DIR : `${ARCHIVE_DIR}/${parent}`;
}

/**
 * 归档动作被拒的理由。
 *
 * `already-archived` 单独列：重复归档是**用户可理解的空操作**（不是故障），
 * 文案说明「已在归档里」即可，零 I/O。
 */
export type ArchiveRefusal = 'already-archived' | 'no-workspace' | 'not-a-file';

/**
 * 归档的用户可见文案（与 `assetNotices` 同纪律：唯一事实源，勿在别处就地拼串）。
 * 成功无 toast 是**刻意的**：与改名/拖拽移动同惯例（成功 = 树刷新本身可见；
 * 失败/空操作才给提示）。因此这里只有「确认动作标签 + 三类拒绝理由」。
 */
export const ARCHIVE_COPY: Record<ArchiveRefusal | 'confirm', string> = {
  confirm: '改为归档（移入「_归档/」，可随时移回来）',
  'already-archived': '这份文档已经在「_归档/」里了。',
  'no-workspace': '工作区未挂载，无法移动磁盘文件。',
  'not-a-file': '只有文档可以归档（文件夹暂不支持移动）。',
};

/** 归档前的前置校验：返回 null = 可以执行；否则是拒绝理由（零 I/O） */
export function archiveRefusalOf(input: {
  relPath: string | null;
  mounted: boolean;
  isDir: boolean;
}): ArchiveRefusal | null {
  if (!input.mounted) return 'no-workspace';
  if (input.isDir) return 'not-a-file';
  if (input.relPath === null) return 'not-a-file';
  if (isArchivedPath(input.relPath)) return 'already-archived';
  return null;
}
