import { Registry } from './registry.js';

/**
 * Channel —— 外部接入通道。
 * 插件经三通道（REST / MCP / Skill）暴露能力，接入适配层在此登记（spec §8.2）。
 */
export interface Channel {
  /** 通道唯一 id */
  id: string;
  /** 通道类型：三通道之一 */
  kind: 'rest' | 'mcp' | 'skill';
  /** 通道描述 */
  description?: string;
}

/**
 * ChannelRegistry —— 外部接入通道注册表（接口即空实现）。
 * 注册 key 取通道 id（channel.id）。
 */
export class ChannelRegistry extends Registry<Channel> {}
