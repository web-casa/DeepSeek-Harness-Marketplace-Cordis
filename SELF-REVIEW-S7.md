# S7 自审报告

## 本轮完成
1. **G7 统一 schema 模块**：src/schema.mjs 集中校验 FileState、baseline、
   manifest、outcome、conflict report、resolution manifest、validation。
   Journal / ResolutionJournal 的加载、扫描、恢复路径全部接入。
2. **G1 supersede 崩溃测试**：新 manifest 已 publish、旧 SUPERSEDED 未写时
   子进程 exit；新进程 ResolutionJournal.recover() 正确识别新 head 并完成恢复。
3. **G2 祖先清理崩溃测试**：三连 resolution 链，第一个祖先 tombstone 后崩溃；
   recover 允许已 tombstone 祖先断链，继续清理剩余祖先与 head，最终
   resolutions 目录为空。
4. **G6/G10 矩阵扩到 13 场景**：新增 forward-before-rename、append-before-
   dirfsync、unlink-before、G1、G2 场景；全部由公开 API 生成状态并由子进程
   真实 exit 注入。
5. 修复 graph 校验对 tombstone 中祖先的误判（trash 中按 `resolution-<rid>-`
   前缀识别为已清理断链）。

## 测试
- 71 tests / 71 pass。

## 自审发现并已修复
- G2 测试初版把 rid1 完整恢复导致 head 为 RESOLVED，无法构造冲突链；改为
  complete-without-resolve 生成 RESOLUTION_CONFLICTED。
- G1 同理，rid1 未恢复直接 complete 生成冲突 head。
- ancestor tombstone 崩溃后旧 rid 已移入 trash，graph 校验原先报 dangling；
  增加 trash 前缀识别并允许断链。

## 仍未闭环
- G5：validation ticket 能防 plain object，但进程内调用方仍可 import creator；
  威胁模型已排除恶意进程内调用，若需严格关闭需由 JournalPort 内部持有
  validator。
- G6/G10：failpoint 点尚未逐点与矩阵一一对齐；仍缺 atomic exclusive publish、
  validation publish、resolution confirmed marker 等全部窗口。
- Windows BEST_EFFORT 未在 Windows CI 实证。
- trash 清理与 lock debris 清理的错误处理仍为 best-effort。
