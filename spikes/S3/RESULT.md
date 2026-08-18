# S3 激活时序（真实实验）

- T3A：profile 用户补丁层写入 `- id: spike-safe / disabled: true` 后，
  `dsh --profile web --dump-config` 显示该行 disabled:true，boot 不执行插件。
- T3B：成功 `dsh plugin add` 前后 cordis.patch.yml md5 不变 → CLI 不重写用户补丁。
- T3C/T3D：disabled 时 boot 无 spike-safe applied；enabled 时 boot 有 applied。
- T3E：进程运行中修改 profile/home 两级 cordis.patch.yml 的 disable 行，
  40s 内未观察到插件被 HMR dispose。**rc.6 默认运行态下未证明 patch HMR 生效。**
- 决策：安装/启用/禁用/更新后的“激活”在 v1 一律按 **RESTART_REQUIRED** 处理；
  不依赖 live HMR。若后续要热生效，需单独 spike HMR 服务为何未触发，并作为 P1。
