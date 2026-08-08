# 知识球 Android 应用需求与实现目录

## 1. 代码扫描结论

当前项目是 Vite + TypeScript + Three.js 的事件溯源知识图谱 Web 应用。核心能力包括：3D 知识球浏览、节点搜索与创建、编辑、争议/证伪/悬置/解决、掌握度设置、个人统计、显示设置、持久化与 GitHub 同步适配。Android 版本应复用同一领域模型和 WebGL 场景，避免维护第二套业务逻辑。

## 2. Android MVP 需求

### 功能

1. 全屏展示知识球，支持单指旋转、点按节点、双指缩放。
2. 支持知识节点的搜索、创建、编辑、状态变更和掌握度设置。
3. 支持个人面板、图形显示设置以及离线浏览。
4. Android 返回键依次关闭弹窗、关闭详情面板，最后退出应用。
5. 网络断开时显示非阻塞提示；本地图谱操作不被打断。

### 移动端体验与非功能要求

1. 适配状态栏、刘海、圆角屏和底部手势安全区。
2. 主要触控目标不小于 44px；禁用页面橡皮筋和误触缩放。
3. 通过 Capacitor 打包，最低系统版本由 Capacitor Android 工程统一管理。
4. 原生包不得依赖远程站点启动；所有 Web 资源随 APK/AAB 离线打包。
5. 每次同步原生工程前必须完成 TypeScript 构建和全部回归测试。

## 3. 目录设计

```text
android/                    # Gradle/Android Studio 原生壳工程
  app/src/main/             # Manifest、资源和 MainActivity
src/
  mobile/                   # 原生运行时桥接、返回键/网络状态及其测试
  ui/                       # Web 与 Android 共用界面及 Three.js 场景
  command,event,graph,...   # Web 与 Android 共用领域逻辑
docs/
  android-requirements.md   # 本需求与维护说明
capacitor.config.ts         # 应用 ID、名称、Web 产物目录和 Android 配置
```

## 4. 构建与验收

```bash
npm ci
npm test
npm run android:sync
cd android && ./gradlew test assembleDebug
```

`android:sync` 会使用相对资源路径生成 `dist` 并同步插件/资源。发布时在 Android Studio 中配置正式签名并生成 AAB；密钥不得提交到仓库。
