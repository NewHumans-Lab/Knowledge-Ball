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

网页设置面板提供同源 APK 下载地址 `./downloads/knowledge-ball-android-v0.1.0.apk`。安装包随网页静态产物一起部署，不依赖 Google Play、GitHub Releases 或其他需要跳转的下载服务；用户打开网页后即可直接下载。`CAPACITOR_BUILD=true` 时会禁用 Vite 的 `public` 目录复制，避免把 APK 再嵌套进 Android 应用自身。

Android 原生应用中不会显示“下载”按钮，而会显示“检查更新”和“分享当前版本”。检查更新每次都以 `no-store` 请求 `downloads/latest.json`，比较语义版本后打开最新 APK；Android 安全机制仍会要求用户确认安装。分享会下载当前版本 APK 到应用缓存，再把实际 APK 文件交给系统分享面板，用户可选择社交媒体、邮件、蓝牙或其他已安装应用。

iOS 同时提供 Capacitor/Xcode 原生工程和无需境外 App Store 的可安装 Web App。网页设置中 iOS 与 Android 并列；iPhone 用户使用 Safari 的“添加到主屏幕”即可安装。iOS 原生壳内同样只显示“检查更新”和“分享当前版本”，更新由同一份 `latest.json` 清单指向最新安装入口，分享调用 iOS 系统分享面板发送当前版本安装地址。原生 IPA 的签名发布仍需在 macOS/Xcode 中使用有效 Apple Developer 身份完成，仓库不提交证书和描述文件。

## 5. Android SDK 配置与故障排除

`SDK location not found` 不是项目编译错误，而是 Gradle 找不到本机 Android SDK。本工程需要 JDK 21、Android SDK Platform 35，以及 Build Tools 34.0.0/35.0.0（应用及 Capacitor 依赖可能分别选择其中一个版本）。

### 推荐方式：Android Studio

1. 安装 Android Studio，在 SDK Manager 中安装 **Android SDK Platform 35**、**Android SDK Build-Tools 34.0.0/35.0.0** 和 **Android SDK Platform-Tools**。
2. 在 Android Studio 中打开本仓库的 `android/` 目录。IDE 通常会生成仅供本机使用的 `android/local.properties`。
3. 若没有自动生成，创建该文件并写入 SDK 的绝对路径：

```properties
# Linux 示例
sdk.dir=/home/your-name/Android/Sdk
# macOS 通常为 /Users/your-name/Library/Android/sdk
# Windows 属性文件需转义反斜杠，例如 C\:\\Users\\your-name\\AppData\\Local\\Android\\Sdk
```

`local.properties` 已被忽略，不能提交，因为不同开发机的 SDK 路径不同。

### 纯命令行/容器方式

安装 Google Android Command-line Tools 后，执行：

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;34.0.0" "build-tools;35.0.0"
npm ci
npm run android:sync
cd android
./gradlew test assembleDebug
```

也可以不设置环境变量，而是在 `android/local.properties` 中设置 `sdk.dir`。两者至少配置一种。首次原生构建前必须运行 `npm run android:sync`，否则被 Git 忽略的 Capacitor 插件生成目录尚不存在，Gradle 会报告缺少 `capacitor-cordova-android-plugins/cordova.variables.gradle`。

### CI 方式

仓库的 `validate.yml` 会安装 JDK、Android SDK 35 与 Build Tools，随后执行 Web 测试、Capacitor 同步、Android 单元测试和 Debug APK 构建。因此开发机暂时没有 SDK 时，可以推送分支并以 Android CI job 作为可复现的原生构建验收；正式签名包仍应由受控的发布流程生成。
