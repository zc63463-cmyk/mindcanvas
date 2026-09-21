/** 环形预览页样式（预览页拆分件：页面/节点卡/浮标/面板/六项交互视觉）。 */
export const RADIAL_PREVIEW_CSS = `
.page { position: fixed; inset: 0; overflow: hidden; user-select: none; color: #d9e5e3;
  background:
    radial-gradient(900px 520px at 22% 14%, rgba(56,196,154,.10), transparent 62%),
    radial-gradient(880px 540px at 82% 86%, rgba(64,140,255,.07), transparent 60%),
    radial-gradient(1200px 700px at 30% 20%, #1d282d 0%, #151d21 55%, #0f1518 100%);
  font: 13px/1.55 system-ui, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased; }

.hud-top { position: fixed; left: 22px; top: 18px; display: grid; gap: 5px; max-width: 660px; }
.hud-top b { font-size: 15px; font-weight: 650; letter-spacing: .3px; color: #f0f7f5; }
.hud-top span { color: #8ba1a6; font-size: 12.5px; }

.node-card { position: absolute; display: flex; align-items: center; gap: 10px; padding: 13px 19px;
  border: 1px solid rgba(61,211,160,.65); border-radius: 12px;
  background: linear-gradient(180deg, rgba(36,50,55,.96), rgba(24,34,38,.96));
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 10px 26px rgba(0,0,0,.42), 0 0 0 3px rgba(61,211,160,.07);
  cursor: grab; touch-action: none; }
.node-card:active { cursor: grabbing; }
.node-text { font-size: 15px; color: #edf7f3; letter-spacing: .4px; }
.node-dot { width: 7px; height: 7px; border-radius: 50%; background: #3dd3a0; box-shadow: 0 0 8px rgba(61,211,160,.9); }

.anchor-dot { position: fixed; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%;
  background: rgba(61,211,160,.9); box-shadow: 0 0 10px rgba(61,211,160,.95); pointer-events: none; }
.anchor-pulse { position: fixed; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
  border: 2px solid rgba(61,211,160,.85); animation: radial-pulse .55s ease-out infinite; pointer-events: none; }
@keyframes radial-pulse { 0% { transform: scale(.55); opacity: .95 } 100% { transform: scale(2.2); opacity: 0 } }

.hud-right { position: fixed; right: 18px; top: 18px; width: 286px; display: grid; gap: 11px;
  background: rgba(14,20,23,.62); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255,255,255,.09); border-radius: 14px; padding: 14px 15px 15px;
  box-shadow: 0 18px 44px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.05) inset; }
.panel-title { font-size: 11px; letter-spacing: 1.4px; color: #6f888e; }
.stat-row { display: flex; gap: 14px; flex-wrap: wrap; }
.stat { display: inline-flex; align-items: baseline; gap: 6px; }
.stat i { font-style: normal; color: #8199a0; font-size: 12px; }
.stat b { color: #eef7f4; font: 12.5px/1 ui-monospace, Consolas, monospace; }
.hud-right .slider { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; color: #a8bec2; }
.hud-right .slider b { color: #dcebe8; font: 12px/1.4 ui-monospace, Consolas, monospace; }
.hud-right .slider input { grid-column: 1 / -1; width: 100%; accent-color: #3dd3a0; height: 18px; }
.hold-btn { cursor: pointer; border: 1px solid rgba(61,211,160,.5); border-radius: 9px; padding: 8px 10px;
  background: linear-gradient(180deg, rgba(61,211,160,.2), rgba(61,211,160,.1)); color: #ddf3ea;
  font: inherit; font-weight: 550; letter-spacing: .2px;
  box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 4px 14px rgba(61,211,160,.12); }
.hold-btn:hover { background: linear-gradient(180deg, rgba(61,211,160,.26), rgba(61,211,160,.13)); }
.hold-btn:active { background: rgba(61,211,160,.34); }
.tip { color: #e6c66d; font-size: 12px; line-height: 1.5; }
.log { margin: 0; padding: 0; list-style: none; display: grid; }
.log li { padding: 5px 0; color: #b7cbce; font-size: 12px; border-top: 1px solid rgba(255,255,255,.05); }
.log li:first-child { border-top: 0; color: #d9e8e5; }

/* 幽灵预览：高亮「新建」时在出线方向显示即将创建的节点 */
.ghost-node { position: fixed; display: flex; align-items: center; justify-content: center; box-sizing: border-box;
  border: 1.5px dashed rgba(61,211,160,.6); border-radius: 12px; background: rgba(61,211,160,.06);
  animation: ghost-in .16s ease-out both; pointer-events: none; }
.ghost-node .node-text { font-size: 13px; color: rgba(190,235,220,.55); }
@keyframes ghost-in { from { opacity: 0; transform: translateY(-3px) scale(.97); } to { opacity: 1; transform: none; } }

/* 卡片删除预览：高亮「删除」时节点变红半透明 */
.node-card { transition: border-color .12s ease, opacity .12s ease, box-shadow .12s ease; }
.node-card.preview-delete { border-color: rgba(255,120,110,.9); opacity: .45;
  box-shadow: 0 0 0 3px rgba(255,107,107,.14), 0 10px 26px rgba(0,0,0,.42); }
.node-card.preview-delete .node-dot { background: #ff7a6e; box-shadow: 0 0 8px rgba(255,122,110,.9); }

.check { display: flex; align-items: center; gap: 8px; color: #a8bec2; cursor: pointer; }
.check input { accent-color: #3dd3a0; width: 14px; height: 14px; }

/* ② 二级环沙盒（并入本页）：顶栏说明 + 席位清单提示。
   子环视觉（.sub-ring / .ring-dim）在包内 RADIAL_SURFACE_CSS —— 与主环同源，画布可直接复用 */
.hud-note { display: block; margin-top: 3px; color: #7fd7b4; font-weight: 500; }
.sub-hint { color: #7e969b; font-size: 11.5px; line-height: 1.55; }
`;
