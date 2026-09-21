# P0-0 计划 v3 定向复核

日期：2026-09-20。结论：CR2-1、CR2-2、CR2-3 在本次设计复核范围内关闭；CR2-4 的两调用方与冲突重试方向接受，但 NC-5 代码仍不成立，P0-0 暂不启动。不要重做已关闭项，只收口下面两点。

## 已关闭项与证据边界

- CR2-1：reuse/register/degrade/refuse 分支已区分明确不同与无法判定；新增 B 的持久登记、active/dormant、裸键、刷新恢复及回到 A 的正确期望。属于计划审阅，不代表未实现功能通过。
- CR2-2：主控提取原文 v3 夹具，运行第二次 put 失败、第二次 delete 失败、读失败、主动 abort、正常提交五个场景。前四种均仅 abort、commitCount=0、两键保持旧值；正常场景仅 complete、两键更新。前两种明确观察到第一条写请求 onsuccess 已发生。该项关于原子回滚的旧阻断关闭，不要求夹具实现完整 IDB。
- CR2-3：已区分“保留 A 裸键”和“本次不写键”，unavailable 已拆成注册表单键读取失败、整个库不可读、picker 已给句柄三种场景；本轮不反转这些正确期望。
- CR2-4：两模块实例共用数据库、独立 writeChain，以及事务外比较/事务内同步复核/conflict 重试的方向接受。下面是其剩余测试问题。

## 剩余修订 A：并发正例产生非法记录（P1）

位置：`p0-0-implementation-plan.md:1237`，同族问题在 `:581`；删除失败用例 `:630` 也有对应问题。

NC-5 的 append 保留旧 entries 的 active 标记，直接追加新的 active 条目。主控提取原文函数运行，得到：

```text
activeScopeId = ws:b
state=active 的条目 = [ws:a, ws:b]
```

契约要求只有 activeScopeId 对应条目为 active，其余 dormant。因此正确的生产校验器应该返回 invalid，正例在进入并发验证前就失败；如果正例反而通过，可能是校验器缺失。

修订：用合法的 upsert 或显式把旧条目置 dormant；两次操作结果都先断言 kind=ok，再核对三个 ID 均保留、唯一 active、其余 dormant。同步补全 isRegistryRecord 的 active/state 一致性、唯一 scopeId 等已声明不变量检查，不能为了让测试通过只检查 active ID 是否存在。

同理，删除失败用例不能只把 activeScopeId 设 null 却保留 active 条目，否则得到的是 invalid，未命中第二次 delete 失败窗口。先构造合法 dormant 记录，再注入删除失败。

## 剩余修订 B：负控用错误结果作为通过期望（P1）

位置：`p0-0-implementation-plan.md:1270`。

原文：

```ts
expect(ids).not.toEqual(['ws:a', 'ws:b', 'ws:c']);
expect(ids).toHaveLength(2);
```

这两条在丢更新发生时都会通过。主控用 `[ws:a, ws:c]` 运行等价断言，两条都通过，不能称为“负控转红”。

修订：正常与中性化运行均保留正确期望 `ids == [a,b,c]`，仅在独占副本中改变读取/构造的位置并使用 barrier。正确实现应通过；中性化后因缺一条而 AssertionError，进程退出非零。不要把 expected failure 捕获成整个负控命令 exit 0 后再宣称测试转红。

现有测试侧复刻可以保留为“事务外旧快照的逻辑反例”；若要证明生产写路径的保护有效，应中性化相应实现副本并保留调用方与正确断言，明确每次证据的对象。

## 次要口径校正（同次完成，不扩包）

- NC-7 的 Promise.resolve 微任务并不普遍等同真实 IDB 事务已经关闭。可把它写成“同步 mutate 不接受 Promise”的契约测试；要证明事务生命周期，应在真实/fake-indexeddb 上使用跨任务延迟并校准，不能只凭自制夹具的时序外推浏览器。
- 当前不少统计和标题仍写三条负控、较旧新增用例数。按最终集合更新，不靠固定数量判通过。
- 本轮夹具仅转译执行定向场景，不是完整 TypeScript 类型检查，也不是产品或真实浏览器验证。

## 证据与下一步

独占目录：`outputs/file-assets-contract-review-20260920-02/`，含 `check-v3.cjs`、`results.json`；记录计划输入 SHA-256，未覆盖上一轮输出。

下一轮只提交 NC-5 与同族非法记录构造的最小修订、正确期望不变的正负对照安排，以及上述口径校正。本轮已关闭 CR2-1…3 不返工，不新增产品能力。实现仍待本项通过；未授权提交、推送或发布。

本轮仅新增复核文档与独占校准证据，未修改产品或执行者设计文档，未运行全仓门禁。
