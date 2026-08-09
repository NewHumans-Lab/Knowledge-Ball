# 移动端分支问题与合并方案

## 原因分析

此前 Android 变更位于 `android-update-share`，对应 PR #16，目标为 `main`；iOS 变更位于 `ios-app-download`，但 PR #17 的目标分支是 `android-update-share`，而不是 `main`。PR #17 虽然显示为已合并，实际只把 iOS 提交合并进已完成的 Android 功能分支，并没有把 iOS 提交带入 `main`。因此 GitHub Pages 从 `main` 部署时不包含 iOS 下载卡片。

另一个包含 Android/iOS 文件的旧 `work` 分支从更早的提交历史派生，没有吸收 `main` 后续的知识编辑协议、Pages 检查和存储修复。直接使用或合并该分支会与当前 `main` 在 `package.json`、`index.html` 和应用初始化代码上产生冲突，也可能覆盖已经合并的修复。

Android 安装包还沿用了 `versionCode 1` 和旧文件名。设备上已安装旧构建时，浏览器下载的新文件不一定会被系统识别为明确的新版本；若调试签名来自不同环境，Android 还会拒绝覆盖安装，用户看到的仍可能是没有更新/分享入口的旧应用。

## 本次整理

本分支直接从最新 `origin/main` 创建，只移植尚未进入 `main` 的 iOS 提交，并保留 `main` 的全部后续功能。冲突仅在 `package.json` 出现，解决时同时保留知识编辑协议测试与 iOS 构建脚本。

Android/iOS 版本统一提升至 `0.2.0`，Android `versionCode` 提升至 `2`，并重新生成 `knowledge-ball-android-v0.2.0.apk`。移动端按钮不再只依赖 CSS 类推断，而由 `applyPlatformVisibility` 同时设置平台类和 DOM `hidden` 状态；网页端仍同时展示 Android 与 iOS 安装入口。

最终只需合并本分支对应的单一 PR，不需要再次合并旧 `work`、`android-update-share` 或 `ios-app-download` 分支。
