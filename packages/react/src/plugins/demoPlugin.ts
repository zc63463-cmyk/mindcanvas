/**
 * DemoPlugin —— 最小实验插件（T5：用六注册表演示组合能力，随 @mindcanvas/react 发布）。
 * 组合面：
 * - kinds：注册自定义 kind `session`（语法校验 + 元信息）——实体中心接入的扩展缝
 * - noteKeys：注册自定义透传键语义 `ai_role`（spec §5.5 语义词汇表可扩）
 * - renderers：注册 qa 角标渲染描述（渲染策略槽位可注入/覆盖）
 * - DOM 事件：挂全局事件监听（react 侧生命周期自注销验证点；unload 必须清理）
 * 卸载即自注销：Plugin.unload 自动释放全部 registerInto 条目 + onunload 清理 DOM。
 */
import { Plugin, type KernelRegistries } from '@mindcanvas/kernel';

export class DemoPlugin extends Plugin {
  name = 'demo-plugin';
  private listeners: Array<() => void> = [];

  constructor(private readonly regs: KernelRegistries) {
    super();
  }

  override async onload(): Promise<void> {
    this.registerInto(this.regs.kinds, 'session', {
      label: 'session',
      color: '#6741d9',
      validateId: (id) => /^[A-Za-z0-9_-]+$/.test(id),
    });
    this.registerInto(this.regs.noteKeys, 'ai_role', { description: 'AI 角色标注（插件演示键）' });
    this.registerInto(this.regs.renderers, 'qa-badge', { label: 'qa', color: '#e8590c' });
    const listener = (): void => undefined;
    document.addEventListener('demo-plugin:active', listener);
    this.listeners.push(() => document.removeEventListener('demo-plugin:active', listener));
  }

  override async onunload(): Promise<void> {
    for (const off of this.listeners) off();
    this.listeners = [];
  }
}
