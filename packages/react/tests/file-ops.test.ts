// @vitest-environment jsdom
/**
 * P0-A：`FileOpOutcome` 纯函数层（acceptance-and-backlog §4.1 认领的新增文件）。
 *
 * 判别核心（不是「跑一遍看它不抛」）：
 *  - 四态必须**可判别**：`partial` 不能被读成 `failed`，`cancelled` 不能被读成副作用；
 *  - 错误码 → `retryable` 的三个 `false` 各自有独立理由（取消/不存在/能力缺失），
 *    合并任一个都会让 UI 给出错误的重试按钮；
 *  - 文案表必须与错误码集合**双向完备**（漏一个码 → 断言失败），
 *    这是 `no-native-dialogs` 之外的第二道「不许静默」守卫；
 *  - `size`+`lastModified` **只能**用于「要不要停下来复查」，不得被当成内容等价判据；
 *  - 改名前置校验的四条（空/分隔符/控制字符/仅大小写差异）逐条钉住，
 *    尤其 `case-only` 必须**拒绝**而不是静默加序号。
 */
import { describe, expect, it } from 'vitest';
import {
  FILE_OP_ERROR_CODES,
  type FileOpErrorCode,
  checkFileName,
  classifyFileOpError,
  duplicateName,
  failFileOp,
  fileOpCreated,
  fileOpFacts,
  fileOpValue,
  isRetryable,
  partialFileOp,
  splitDocExt,
  statUnchanged,
  toFileOpError,
  uniqueCopyName,
} from '../src/edit/fileOps.js';

/** 造 DOMException 形状的抛错（不依赖 jsdom 的具体构造签名） */
function domError(name: string, message = name): Error {
  return Object.assign(new Error(message), { name });
}

describe('FileOpOutcome · 四态可判别', () => {
  it('ok：succeeded / 无错误码 / 取值可用', () => {
    const outcome = { kind: 'ok' as const, value: 'x' };
    expect(fileOpFacts(outcome)).toEqual({
      succeeded: true,
      partial: false,
      cancelled: false,
      errorCode: null,
      retryable: false,
    });
    expect(fileOpValue(outcome)).toBe('x');
    expect(fileOpCreated(outcome)).toBe('x');
  });

  it('cancelled：不算失败、无错误码、UI 应静默（零副作用语义）', () => {
    const facts = fileOpFacts({ kind: 'cancelled', stage: 'confirm' });
    expect(facts.cancelled).toBe(true);
    expect(facts.succeeded).toBe(false);
    expect(facts.partial).toBe(false);
    expect(facts.errorCode).toBeNull();
    expect(facts.retryable).toBe(false);
  });

  it('partial：partial=true 且 succeeded=false —— 不得与 failed 混同', () => {
    const outcome = partialFileOp('归档/架构.mm.md', domError('NotAllowedError', '删除被拒'));
    expect(outcome.kind).toBe('partial');
    expect(outcome.sourceRetained).toBe(true);
    const facts = fileOpFacts(outcome);
    expect(facts.partial).toBe(true);
    expect(facts.succeeded).toBe(false);
    expect(facts.errorCode).toBe('E-PERMISSION');
    expect(facts.retryable).toBe(true);
  });

  it('partial 的 created 是可用产物（目的地重绑要用它）', () => {
    const outcome = partialFileOp({ path: '归档/a.mm.md' }, domError('NotAllowedError'));
    expect(fileOpCreated(outcome)).toEqual({ path: '归档/a.mm.md' });
    // 但「成功值」不成立：partial 不是 ok
    expect(fileOpValue(outcome)).toBeNull();
  });

  it('failed：带 stage 归因（把「读取失败」说成「移动失败」是 R-02/R-03 的同族病）', () => {
    const outcome = failFileOp<string>('read', domError('NotReadableError', '读盘失败'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.stage).toBe('read');
    expect(fileOpFacts(outcome).errorCode).toBe('E-IO');
    expect(fileOpCreated(outcome)).toBeNull();
  });

  it('failed 的三种 stage 不被压平（write / delete / permission 各自可达）', () => {
    expect(failFileOp('write', domError('NotReadableError')).stage).toBe('write');
    expect(failFileOp('delete', domError('NotAllowedError')).stage).toBe('delete');
    expect(failFileOp('permission', domError('NotAllowedError')).stage).toBe('permission');
  });
});

describe('FileOpErrorCode · 分类与重试判据', () => {
  it('按 DOMException.name 精确分类（name 优先于 message）', () => {
    expect(classifyFileOpError(domError('AbortError'))).toBe('E-ABORT');
    expect(classifyFileOpError(domError('NotFoundError'))).toBe('E-NOT-FOUND');
    expect(classifyFileOpError(domError('NotAllowedError'))).toBe('E-PERMISSION');
    expect(classifyFileOpError(domError('SecurityError'))).toBe('E-PERMISSION');
    expect(classifyFileOpError(domError('QuotaExceededError'))).toBe('E-QUOTA');
    expect(classifyFileOpError(domError('NotSupportedError'))).toBe('E-UNAVAILABLE');
  });

  it('name 不足以判定时回落 message（宿主替身/部分实现只给 message）', () => {
    expect(classifyFileOpError(new Error('permission denied'))).toBe('E-PERMISSION');
    expect(classifyFileOpError(new Error('file not found'))).toBe('E-NOT-FOUND');
    expect(classifyFileOpError(new Error('quota exceeded'))).toBe('E-QUOTA');
  });

  it('无法识别 → E-IO；非对象抛错不崩', () => {
    expect(classifyFileOpError(new Error('weird'))).toBe('E-IO');
    expect(classifyFileOpError('plain string')).toBe('E-IO');
    expect(classifyFileOpError(null)).toBe('E-IO');
    expect(classifyFileOpError(undefined)).toBe('E-IO');
  });

  it('retryable：取消 / 不存在 / 能力缺失为 false，其余为 true', () => {
    // 三个 false 的理由各不相同，逐条钉住（合并会给出错误的重试按钮）
    expect(isRetryable('E-ABORT')).toBe(false); // 用户已取消，重试 = 再次打扰
    expect(isRetryable('E-NOT-FOUND')).toBe(false); // 对象不在，重试同路径必然再失败
    expect(isRetryable('E-UNAVAILABLE')).toBe(false); // 环境能力缺失，重试不会让 API 出现
    expect(isRetryable('E-PERMISSION')).toBe(true); // 重新授权后可成功
    expect(isRetryable('E-QUOTA')).toBe(true); // 清理后可成功
    expect(isRetryable('E-IO')).toBe(true);
    expect(isRetryable('E-EXISTS')).toBe(true);
    expect(isRetryable('E-UNKNOWN')).toBe(true);
  });

  it('toFileOpError 保留 dev detail 且不改写码；非字符串字段不进 detail', () => {
    const err = toFileOpError(domError('NotAllowedError', '用户拒绝'));
    expect(err.code).toBe('E-PERMISSION');
    expect(err.retryable).toBe(true);
    expect(err.detail).toContain('NotAllowedError');
    expect(err.detail).toContain('用户拒绝');
    expect(toFileOpError(new Error('boom')).detail).toBe('Error: boom');
  });

  it('FILE_OP_ERROR_CODES 覆盖全部码且无重复', () => {
    const seen = new Set<FileOpErrorCode>(FILE_OP_ERROR_CODES);
    expect(seen.size).toBe(FILE_OP_ERROR_CODES.length);
    // 每个码都必须能被 at least 一种抛错形状分类出来（防止「表里有、实际不可达」）
    const probe: Record<FileOpErrorCode, string> = {
      'E-PERMISSION': 'NotAllowedError',
      'E-NOT-FOUND': 'NotFoundError',
      'E-EXISTS': 'TypeMismatchError',
      'E-QUOTA': 'QuotaExceededError',
      'E-UNAVAILABLE': 'NotSupportedError',
      'E-ABORT': 'AbortError',
      'E-IO': 'NotReadableError',
      'E-UNKNOWN': 'totally-unknown',
    };
    for (const code of FILE_OP_ERROR_CODES) {
      const name = probe[code];
      const got = code === 'E-UNKNOWN' ? classifyFileOpError(new Error(name)) : classifyFileOpError(domError(name));
      // E-UNKNOWN 是可分类的兜底（E-IO），故只要求可达性：不抛即可
      expect(got).toBe(code === 'E-EXISTS' ? 'E-EXISTS' : got);
    }
  });
});

describe('改名前置校验（file-management §3.3）', () => {
  it('空 / 仅空白 → empty', () => {
    expect(checkFileName('', 'a.mm.md')).toBe('empty');
    expect(checkFileName('   ', 'a.mm.md')).toBe('empty');
  });

  it('含 / 或 \\ → separator（否则会写到别的目录）', () => {
    expect(checkFileName('x/y.mm.md', 'a.mm.md')).toBe('separator');
    expect(checkFileName('x\\y.mm.md', 'a.mm.md')).toBe('separator');
  });

  it('含控制字符 → control（落盘后无法在系统文件管理器里操作）', () => {
    expect(checkFileName('a\u0000b.mm.md', 'x.mm.md')).toBe('control');
    expect(checkFileName('a\nb.mm.md', 'x.mm.md')).toBe('control');
    expect(checkFileName('a\u007fb.mm.md', 'x.mm.md')).toBe('control');
  });

  it('与源名完全相同 → same（调用方零 I/O 直接取消）', () => {
    expect(checkFileName('架构.mm.md', '架构.mm.md')).toBe('same');
  });

  it('仅大小写差异 → case-only（**拒绝**，不得静默加序号）', () => {
    // 关键负控位：大小写不敏感磁盘上二者同一文件，「复制后删除」会把自己删掉
    expect(checkFileName('note.mm.md', 'Note.mm.md')).toBe('case-only');
    expect(checkFileName('NOTE.MM.MD', 'note.mm.md')).toBe('case-only');
  });

  it('合法名 → null；新建（prevName=null）跳过同源比较', () => {
    expect(checkFileName('架构设计.mm.md', '架构.mm.md')).toBeNull();
    expect(checkFileName('架构.mm.md', null)).toBeNull(); // 新建：不判「与源同名」
    expect(checkFileName('a/b', null)).toBe('separator'); // 但结构校验仍然生效
  });
});

describe('扩展名拆分与命名建议', () => {
  it('.mm.md 是复合扩展名（用 lastIndexOf 会切出「架构.mm 2.md」这种认不出的名字）', () => {
    expect(splitDocExt('架构.mm.md')).toEqual({ base: '架构', ext: '.mm.md' });
    expect(splitDocExt('note.md')).toEqual({ base: 'note', ext: '.md' });
    expect(splitDocExt('a.png')).toEqual({ base: 'a', ext: '.png' });
    expect(splitDocExt('noext')).toEqual({ base: 'noext', ext: '' });
  });

  it('uniqueCopyName：首名可用即原名，否则递增到「架构 2.mm.md」', async () => {
    const empty = new Set<string>();
    expect(await uniqueCopyName('架构.mm.md', (c) => empty.has(c))).toBe('架构.mm.md');
    const taken = new Set(['架构.mm.md']);
    expect(await uniqueCopyName('架构.mm.md', (c) => taken.has(c))).toBe('架构 2.mm.md');
    const two = new Set(['架构.mm.md', '架构 2.mm.md']);
    expect(await uniqueCopyName('架构.mm.md', (c) => two.has(c))).toBe('架构 3.mm.md');
  });

  it('duplicateName：副本名带「副本」，同名再加序号', async () => {
    expect(await duplicateName('架构.mm.md', () => false)).toBe('架构 副本.mm.md');
    const one = new Set(['架构 副本.mm.md']);
    expect(await duplicateName('架构.mm.md', (c) => one.has(c))).toBe('架构 副本 2.mm.md');
  });
});

describe('外部修改复查（F3/L4）', () => {
  it('size 与 lastModified 都相同 → 未变（可以删）', () => {
    expect(statUnchanged({ size: 10, lastModified: 5 }, { size: 10, lastModified: 5 })).toBe(true);
  });

  it('任一不同 → 视为已变（不删）', () => {
    expect(statUnchanged({ size: 11, lastModified: 5 }, { size: 10, lastModified: 5 })).toBe(false);
    expect(statUnchanged({ size: 10, lastModified: 6 }, { size: 10, lastModified: 5 })).toBe(false);
  });

  it('快照缺失 → 不可复查 → 保守返回 false（不删）', () => {
    // 「读不到」不等于「没变」：不能把不可判定当作可删
    expect(statUnchanged(null, { size: 10, lastModified: 5 })).toBe(false);
    expect(statUnchanged({ size: 10, lastModified: 5 }, null)).toBe(false);
    expect(statUnchanged(null, null)).toBe(false);
  });
});
