import { describe, expect, it } from 'vitest';
import {
  KIND_META,
  REGISTERED_KINDS,
  astToEditable,
  editableToAst,
  parseMm,
  serializeMm,
  validateId,
} from '../src/index.js';
import { refKey } from '../src/protocol/types.js';

describe('资产 kind（@img / @draw）注册与解析', () => {
  it('REGISTERED_KINDS 含 img / draw，且 KIND_META 有元信息', () => {
    expect(REGISTERED_KINDS).toContain('img');
    expect(REGISTERED_KINDS).toContain('draw');
    expect(KIND_META['img']).toBeDefined();
    expect(KIND_META['draw']).toBeDefined();
  });

  it('validateId：合法资产路径放行（含扩展名/子目录）', () => {
    expect(validateId('img', 'demo-assets/demo-diagram.svg')).toBe(true);
    expect(validateId('draw', 'assets/board.svg')).toBe(true);
  });

  it('validateId：拒绝 ../ 逃逸、空段、反斜杠、空串', () => {
    expect(validateId('img', '../secret.png')).toBe(false);
    expect(validateId('draw', 'a//b.svg')).toBe(false);
    expect(validateId('img', 'a/../b.svg')).toBe(false);
    expect(validateId('draw', '')).toBe(false);
    expect(validateId('img', 'a\\b.png')).toBe(false);
  });

  it('解析 @img 引用为已知 kind 实体（不再 W-UNKNOWN-KIND）', () => {
    const { root, refs, diagnostics } = parseMm(
      '# 根\n- @img:demo-assets/demo-diagram.svg\n- @draw:assets/board.svg\n',
    );
    expect(diagnostics.length).toBe(0);
    expect(refs.map(refKey)).toEqual(['img:demo-assets/demo-diagram.svg', 'draw:assets/board.svg']);
    expect(root?.children?.[0]?.type).toBe('entity');
    expect(root?.children?.[0]?.ref?.kind).toBe('img');
  });

  it('serialize round-trip：@img/@draw 引用原样保留', () => {
    const src = '# 根\n- @img:demo-assets/demo-diagram.svg\n- @draw:assets/board.svg\n';
    const { root } = parseMm(src);
    const text = serializeMm(editableToAst(astToEditable(root)!));
    expect(text).toContain('@img:demo-assets/demo-diagram.svg');
    expect(text).toContain('@draw:assets/board.svg');
  });
});
