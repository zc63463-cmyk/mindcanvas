import { describe, expect, it } from 'vitest';
import { isEscapedEntityInput, unescapeEntityInput } from '../src/chrome/entityInput.js';

describe('实体输入转义（N4：`@@` / `\\@` 写纯文本 @ 内容）', () => {
  it('判定：`@@` 与 `\\@` 为转义，`@` 与普通文本不是', () => {
    expect(isEscapedEntityInput('@@备注')).toBe(true);
    expect(isEscapedEntityInput('\\@备注')).toBe(true);
    expect(isEscapedEntityInput('@备注')).toBe(false);
    expect(isEscapedEntityInput('普通文本')).toBe(false);
    expect(isEscapedEntityInput('')).toBe(false);
  });

  it('反转义：去掉首个转义符 → `@` 开头的纯文本', () => {
    expect(unescapeEntityInput('@@备注')).toBe('@备注');
    expect(unescapeEntityInput('\\@备注')).toBe('@备注');
    expect(unescapeEntityInput('@@@a')).toBe('@@a');
  });

  it('非转义输入原样返回（回归：不误伤普通文本）', () => {
    expect(unescapeEntityInput('普通文本')).toBe('普通文本');
    expect(unescapeEntityInput('@备注')).toBe('@备注');
    expect(unescapeEntityInput('')).toBe('');
  });

  it('往返：转义 → 反转义 = 期望的纯文本（M1 picker 不介入）', () => {
    const input = '@@张三负责';
    expect(isEscapedEntityInput(input)).toBe(true);
    expect(unescapeEntityInput(input)).toBe('@张三负责');
  });
});
