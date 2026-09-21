import { describe, expect, it } from 'vitest';
import { createKernelRegistries, registerBuiltinKinds } from '../src/registry/index.js';

describe('registerBuiltinKinds：内置默认注册（K1 接线）', () => {
  it('注册协议层九类 kind，label/color 与 KIND_META 对齐', () => {
    const r = createKernelRegistries();
    registerBuiltinKinds(r.kinds);
    expect(r.kinds.list()).toHaveLength(9);
    expect(r.kinds.get('issue')).toEqual({ label: 'issue', color: '#d97706' });
    expect(r.kinds.get('annotation')).toEqual({ label: 'annotation', color: '#5c7cfa' });
    expect(r.kinds.get('idea')).toEqual({ label: 'idea', color: '#e8590c' });
  });

  it('未调用时注册表保持为空（空注册表 = 纯文本内核语义不变）', () => {
    const r = createKernelRegistries();
    expect(r.kinds.list()).toHaveLength(0);
  });
});
