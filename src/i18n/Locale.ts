export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type AppLocale = typeof SUPPORTED_LOCALES[number];
export const LOCALE_STORAGE_KEY = 'knowledge-ball.locale.v1';

const en = {
  'app.account': 'Account', 'app.settings': 'Settings', 'app.current': 'Current',
  'app.search': 'Ask a question or search knowledge…', 'app.send': 'Search',
  'app.close': 'Back to Knowledge Ball', 'app.cancel': 'Cancel', 'app.submit': 'Submit knowledge',
  'app.brandTagline': 'Living relational field',
  'settings.title': 'Settings', 'settings.appearance': 'Knowledge node sphere',
  'settings.radius': 'Sphere radius (mm)', 'settings.labels': 'Knowledge node labels',
  'settings.fontSize': 'Font size', 'settings.color': 'Color', 'settings.font': 'Font',
  'settings.brightness': 'Brightness', 'settings.font.default': 'Default sans serif',
  'settings.font.serif': 'Serif', 'settings.font.mono': 'Monospace',
  'settings.language': 'Language', 'settings.downloads': 'Downloads',
  'settings.downloads.hint': 'Get Knowledge Ball for your platform',
  'downloads.title': 'Downloads', 'downloads.back': 'Back to Settings',
  'downloads.ios.title': 'Apple / iOS', 'downloads.ios.meta': 'Version 0.2.0 · iOS 14 or later. Install with Safari.',
  'downloads.ios.action': 'Install iOS app', 'downloads.android.title': 'Android',
  'downloads.android.meta': 'Version 0.2.0 · Android 7.0 or later.',
  'downloads.android.action': 'Download Android APK', 'downloads.windows.title': 'Windows',
  'downloads.windows.meta': 'A Windows installer is not available in this repository.',
  'downloads.unavailable': 'Not available yet', 'downloads.update': 'Check for updates',
  'downloads.share': 'Share current version',
  'legend.title': 'Knowledge Layers', 'legend.inner': 'Layer 1 · Semantics and foundational facts',
  'legend.middle': 'Layer 2 · Rigorous reasoning', 'legend.outer': 'Layer 3 · Probability and dispute',
  'legend.help': 'Layer 1 contains static semantic relations; Layer 2 expresses reasoning structures; Layer 3 expresses disputed or explicitly uncertain/probabilistic knowledge.',
  'account.title': 'Account', 'account.auth': 'Authentication status', 'account.verified': 'Verified · credential-based',
  'account.reputation': 'Reputation', 'account.lit': 'Knowledge nodes explored', 'account.contributions': 'My contributions',
  'create.title': 'Submit a new knowledge node', 'create.name': 'Knowledge title', 'create.name.placeholder': 'Enter a knowledge title',
  'create.layer': 'Knowledge layer', 'create.description': 'Knowledge description',
  'create.description.placeholder': 'Enter the complete knowledge description…', 'create.reasoning': 'Reasoning',
  'create.reasoning.placeholder': 'Explain how the selected premises lead to this conclusion…',
  'create.premises': 'Prerequisite knowledge (multiple allowed)', 'create.rule': 'Logic symbol (reasoning classification)',
  'create.rule.hint': 'Optionally identify an existing formal rule; this is not required for submission.',
  'taxonomy.inner': 'Layer 1 · Semantics and foundational facts', 'taxonomy.middle': 'Layer 2 · Rigorous reasoning',
  'taxonomy.outer': 'Layer 3 · Probability and dispute',
  'mobile.offline': 'Offline · local knowledge remains available',
  'mobile.checking': 'Checking for the latest version…', 'mobile.latest': 'You have the latest version v{version}',
  'mobile.found': 'Found v{version}; opening the installer…', 'mobile.updateError': 'Update check failed. Check your network and try again.',
  'mobile.preparing': 'Preparing the current installer…', 'mobile.shared': 'The installer was sent to the system share sheet.',
  'mobile.shareError': 'Could not prepare sharing. Check network and storage, then retry.',
  'mobile.iosShared': 'The install link was sent to the system share sheet.', 'mobile.iosShareError': 'Sharing failed. Please try again.',
  'mobile.androidShareTitle': 'Knowledge Ball Android v{version}',
  'mobile.androidShareText': 'Knowledge Ball Android current version v{version}',
  'mobile.androidShareDialog': 'Share Knowledge Ball installer',
  'mobile.iosShareTitle': 'Knowledge Ball iOS v{version}',
  'mobile.iosShareText': 'Knowledge Ball iOS current version v{version}. Open with Safari to install.',
  'mobile.iosShareDialog': 'Share Knowledge Ball iOS app',
  'sync.unavailableTitle': 'Remote database not configured · public knowledge is read-only and local public data is not authoritative',
  'sync.status': 'Sync status: {status}',
  'sync.unavailableToast': 'Remote database is not configured; only cloud public knowledge is authoritative, so this page cannot submit public changes.',
  'sync.conflictToast': 'Server data changed. Retry the public operation.',
} as const;

export type TranslationKey = keyof typeof en;
const zhCN: Record<TranslationKey, string> = {
  'app.account':'个人账户','app.settings':'设置','app.current':'当前','app.search':'输入问题，或搜索知识节点…','app.send':'搜索','app.close':'返回知识球','app.cancel':'取消','app.submit':'提交知识','app.brandTagline':'动态关系知识场',
  'settings.title':'设置','settings.appearance':'知识节点球体','settings.radius':'球体半径 (mm)','settings.labels':'知识节点文字标签','settings.fontSize':'字号','settings.color':'颜色','settings.font':'字体','settings.brightness':'亮度','settings.font.default':'默认无衬线','settings.font.serif':'衬线（宋体风格）','settings.font.mono':'等宽','settings.language':'语言','settings.downloads':'下载','settings.downloads.hint':'获取适合你平台的知识球',
  'downloads.title':'下载','downloads.back':'返回设置','downloads.ios.title':'Apple / iOS','downloads.ios.meta':'版本 0.2.0 · iOS 14 及以上。使用 Safari 安装。','downloads.ios.action':'安装 iOS 应用','downloads.android.title':'Android','downloads.android.meta':'版本 0.2.0 · Android 7.0 及以上。','downloads.android.action':'下载 Android 安装包（APK）','downloads.windows.title':'Windows','downloads.windows.meta':'此仓库目前没有 Windows 安装程序。','downloads.unavailable':'暂未提供','downloads.update':'检查更新','downloads.share':'分享当前版本',
  'legend.title':'知识层级','legend.inner':'第一层 · 语义与基础事实','legend.middle':'第二层 · 严谨推理','legend.outer':'第三层 · 概率与争议','legend.help':'第一层包括静态语义关系；第二层只表达推理结构；第三层表达争议或提交时明确声明的不确定 / 概率知识。',
  'account.title':'个人账户','account.auth':'身份验证状态','account.verified':'已验证 · 凭证式','account.reputation':'声誉积分','account.lit':'已点亮知识节点','account.contributions':'本人贡献节点数',
  'create.title':'提交新知识节点','create.name':'知识标题','create.name.placeholder':'填写知识标题','create.layer':'知识层级','create.description':'知识描述','create.description.placeholder':'填写知识本身的完整描述…','create.reasoning':'推理过程','create.reasoning.placeholder':'逐步说明如何从所选前提推出该结论…','create.premises':'前置知识点（依赖边，可多选）','create.rule':'逻辑符号（推理分类）','create.rule.hint':'若该推理使用已有正式规则，可在这里标记；不作为提交门槛。','taxonomy.inner':'第一层 · 语义与基础事实','taxonomy.middle':'第二层 · 严谨推理','taxonomy.outer':'第三层 · 概率与争议',
  'mobile.offline':'当前离线 · 本地知识图谱仍可浏览','mobile.checking':'正在检查最新版…','mobile.latest':'当前已是最新版 v{version}','mobile.found':'发现 v{version}，正在打开安装页面…','mobile.updateError':'检查更新失败，请确认网络后重试。','mobile.preparing':'正在准备当前版本安装包…','mobile.shared':'安装包已交给系统分享面板。','mobile.shareError':'准备分享失败，请确认网络和存储空间后重试。','mobile.iosShared':'安装地址已交给系统分享面板。','mobile.iosShareError':'分享失败，请稍后重试。',
  'mobile.androidShareTitle':'知识球 Android v{version}','mobile.androidShareText':'知识球 Android 当前版本 v{version}','mobile.androidShareDialog':'分享知识球安装包','mobile.iosShareTitle':'知识球 iOS v{version}','mobile.iosShareText':'知识球 iOS 当前版本 v{version}，使用 Safari 打开即可安装。','mobile.iosShareDialog':'分享知识球 iOS 应用',
  'sync.unavailableTitle':'远程数据库未配置 · 公共知识只读，本地公共数据不被承认','sync.status':'同步状态：{status}','sync.unavailableToast':'远程数据库未配置；公共知识只认云端，当前页面不能提交公共修改','sync.conflictToast':'服务器数据已变化，请重试刚才的公共操作',
};
export const catalogs: Readonly<Record<AppLocale, Readonly<Record<TranslationKey, string>>>> = { 'zh-CN': zhCN, en };

export const legacySystemTextCatalog = {
  'visibility.personal': { 'zh-CN':'个人', en:'Personal' },
  'visibility.all': { 'zh-CN':'全部', en:'All' },
  'visibility.currentTitle': { 'zh-CN':'当前：只显示每个主题的当前知识；点击切换到个人', en:'Current: show the current knowledge for each topic; click for Personal' },
  'visibility.personalTitle': { 'zh-CN':'个人：显示你接触过的知识；点击切换到全部', en:'Personal: show knowledge you have interacted with; click for All' },
  'visibility.allTitle': { 'zh-CN':'全部：显示当前、灰色历史和红色对立知识；点击切换到当前', en:'All: show current, gray history, and red opposition knowledge; click for Current' },
  'common.close': { 'zh-CN':'关闭', en:'Close' },
  'common.back': { 'zh-CN':'返回上一层', en:'Back' },
  'common.backKnowledge': { 'zh-CN':'返回知识球', en:'Back to Knowledge Ball' },
  'common.none': { 'zh-CN':'（未填写）', en:'(Not provided)' },
  'common.cancel': { 'zh-CN':'取消', en:'Cancel' },
  'common.confirm': { 'zh-CN':'确认', en:'Confirm' },
  'common.edit': { 'zh-CN':'编辑', en:'Edit' },
  'common.agree': { 'zh-CN':'同意', en:'Agree' },
  'common.disagree': { 'zh-CN':'反对', en:'Disagree' },
  'common.unavailableHere': { 'zh-CN':'此处不可用', en:'Unavailable here' },
  'search.none': { 'zh-CN':'未找到匹配的知识节点', en:'No matching knowledge nodes found' },
  'legend.layersInternal': { 'zh-CN':'层级（内部坐标，无可见边界）', en:'Layers (internal coordinates, no visible boundary)' },
  'legend.mastery': { 'zh-CN':'掌握程度', en:'Mastery' },
  'legend.types': { 'zh-CN':'节点类型', en:'Node types' },
  'legend.innerOld': { 'zh-CN':'内层空间：已验证事实/定义', en:'Inner space: verified facts / definitions' },
  'legend.middleOld': { 'zh-CN':'中层空间：已验证公理/定理', en:'Middle space: verified axioms / theorems' },
  'legend.outerOld': { 'zh-CN':'外层空间：假说/预测/观点/悬置/争议', en:'Outer space: hypotheses / predictions / opinions / suspended / disputed' },
  'legend.masteredOld': { 'zh-CN':'强光＝完全掌握（辉光溢出球体）', en:'Bright glow = mastered' },
  'legend.touchedOld': { 'zh-CN':'荧光＝接触过（柔和光晕）', en:'Fluorescent glow = touched' },
  'legend.noneOld': { 'zh-CN':'无光点＝未接触', en:'No glow = untouched' },
  'hint.rotate': { 'zh-CN':'拖空白：旋转整球', en:'Drag empty space: rotate the sphere' },
  'hint.back': { 'zh-CN':'单击空白：退一层视角', en:'Tap empty space: move one view level back' },
  'hint.forward': { 'zh-CN':'双击空白：进一层视角', en:'Double-tap empty space: move one view level in' },
  'hint.zoom': { 'zh-CN':'滚轮/双指捏合：连续缩放', en:'Wheel / pinch: continuous zoom' },
  'type.axiom': { 'zh-CN':'公理', en:'Axiom' },
  'type.definition': { 'zh-CN':'定义', en:'Definition' },
  'type.fact': { 'zh-CN':'事实', en:'Fact' },
  'type.theorem': { 'zh-CN':'定理', en:'Theorem' },
  'type.hypothesis': { 'zh-CN':'假说', en:'Hypothesis' },
  'type.prediction': { 'zh-CN':'预测', en:'Prediction' },
  'type.opinion': { 'zh-CN':'观点', en:'Opinion' },
  'type.value': { 'zh-CN':'价值判断', en:'Value judgment' },
  'type.reasoning': { 'zh-CN':'推理过程', en:'Reasoning' },
  'type.logicSymbol': { 'zh-CN':'逻辑符号', en:'Logic symbol' },
  'status.verified': { 'zh-CN':'已验证', en:'Verified' },
  'status.pending': { 'zh-CN':'等待验证', en:'Pending review' },
  'status.suspended': { 'zh-CN':'悬置', en:'Suspended' },
  'status.disputed': { 'zh-CN':'争议中', en:'Disputed' },
  'status.falsified': { 'zh-CN':'已证伪', en:'Falsified' },
  'mastery.none': { 'zh-CN':'未接触', en:'Untouched' },
  'mastery.touched': { 'zh-CN':'接触过', en:'Touched' },
  'mastery.mastered': { 'zh-CN':'完全掌握', en:'Mastered' },
  'mastery.noneFull': { 'zh-CN':'未接触（无光点）', en:'Untouched (no glow)' },
  'mastery.touchedFull': { 'zh-CN':'接触过（荧光）', en:'Touched (fluorescent)' },
  'mastery.masteredFull': { 'zh-CN':'完全掌握（强光）', en:'Mastered (bright glow)' },
  'account.myEnergy': { 'zh-CN':'我的能量', en:'My energy' },
  'account.totalEnergy': { 'zh-CN':'总能量', en:'Total energy' },
  'account.accuracy': { 'zh-CN':'准确率', en:'Accuracy' },
  'account.registerLogin': { 'zh-CN':'注册 / 登录', en:'Register / Sign in' },
  'account.editProfile': { 'zh-CN':'修改资料', en:'Edit profile' },
  'account.login': { 'zh-CN':'登录', en:'Sign in' },
  'account.register': { 'zh-CN':'注册', en:'Register' },
  'account.username': { 'zh-CN':'用户名', en:'Username' },
  'account.password': { 'zh-CN':'密码', en:'Password' },
  'account.confirmPassword': { 'zh-CN':'确认密码', en:'Confirm password' },
  'account.back': { 'zh-CN':'返回账户', en:'Back to account' },
  'account.usernamePlaceholder': { 'zh-CN':'3-24 位小写字母、数字或下划线', en:'3–24 lowercase letters, numbers, or underscores' },
  'account.passwordPlaceholder': { 'zh-CN':'请输入密码', en:'Enter password' },
  'account.confirmPasswordPlaceholder': { 'zh-CN':'再次输入密码', en:'Enter password again' },
  'account.registerHint': { 'zh-CN':'注册后即可修改个人资料，并可在其他浏览器登录同一账户。', en:'After registering, you can edit your profile and sign in to the same account in other browsers.' },
  'account.loginHint': { 'zh-CN':'使用已经注册的用户名和密码登录。', en:'Sign in with an existing username and password.' },
  'account.usernameError': { 'zh-CN':'用户名必须是 3-24 位小写字母、数字或下划线', en:'Username must be 3–24 lowercase letters, numbers, or underscores' },
  'account.passwordMismatch': { 'zh-CN':'两次输入的密码不一致', en:'The passwords do not match' },
  'account.registering': { 'zh-CN':'正在注册账户…', en:'Registering account…' },
  'account.signingIn': { 'zh-CN':'正在登录…', en:'Signing in…' },
  'account.registerSuccess': { 'zh-CN':'注册成功', en:'Registration successful' },
  'account.loginSuccess': { 'zh-CN':'登录成功', en:'Signed in successfully' },
  'account.registerFailed': { 'zh-CN':'注册失败', en:'Registration failed' },
  'account.badCredentials': { 'zh-CN':'用户名或密码错误', en:'Incorrect username or password' },
  'account.editTitle': { 'zh-CN':'修改个人资料', en:'Edit profile' },
  'account.displayName': { 'zh-CN':'显示名称', en:'Display name' },
  'account.avatarUrl': { 'zh-CN':'头像地址', en:'Avatar URL' },
  'account.bio': { 'zh-CN':'个人简介', en:'Bio' },
  'account.displayNamePlaceholder': { 'zh-CN':'公开显示的名称', en:'Public display name' },
  'account.bioPlaceholder': { 'zh-CN':'最多 280 字', en:'Up to 280 characters' },
  'account.saveProfile': { 'zh-CN':'保存资料', en:'Save profile' },
  'account.saveHint': { 'zh-CN':'一次填写并保存全部资料。', en:'Edit and save all profile fields together.' },
  'account.displayNameError': { 'zh-CN':'显示名称最多 60 字', en:'Display name is limited to 60 characters' },
  'account.avatarError': { 'zh-CN':'头像地址必须是 HTTPS 链接', en:'Avatar URL must use HTTPS' },
  'account.bioError': { 'zh-CN':'个人简介最多 280 字', en:'Bio is limited to 280 characters' },
  'account.saving': { 'zh-CN':'正在保存资料…', en:'Saving profile…' },
  'account.saved': { 'zh-CN':'资料已保存', en:'Profile saved' },
  'account.saveFailed': { 'zh-CN':'资料保存失败', en:'Could not save profile' },
  'account.loginRequired': { 'zh-CN':'请先登录账户', en:'Please sign in first' },
  'account.guest': { 'zh-CN':'游客', en:'Guest' },
  'account.defaultBio': { 'zh-CN':'个人资料、账户和知识节点掌握状态均绑定到唯一 user_id。', en:'Profile, account, and knowledge mastery state are bound to one unique user_id.' },
  'account.signedIn': { 'zh-CN':'已登录账户', en:'Signed in' },
  'account.guestMode': { 'zh-CN':'游客模式 · 修改资料前请先注册或登录', en:'Guest mode · register or sign in before editing your profile' },
  'account.remoteMissing': { 'zh-CN':'远程服务未配置；个人状态只能留在当前设备。', en:'Remote service is not configured; personal state remains on this device only.' },
  'account.avatarTitle': { 'zh-CN':'个人空间 · 账户与知识记录', en:'Personal space · account and knowledge records' },
  'account.demoAccepted': { 'zh-CN':'贡献被接受率', en:'Contribution acceptance rate' },
  'account.demoPrediction': { 'zh-CN':'预测准确率（历史）', en:'Prediction accuracy (history)' },
  'account.demoNote': { 'zh-CN':'此面板为演示占位数据，实际协议中声誉应来自贡献质量、预测准确性、同行认可、长期稳定性与引用影响力的动态加权，而非固定数值。', en:'This panel contains demo placeholder values. In the real protocol, reputation should be dynamically weighted from contribution quality, prediction accuracy, peer recognition, long-term stability, and citation impact rather than fixed values.' },
  'create.addKnowledge': { 'zh-CN':'新增知识', en:'Add knowledge' },
  'create.addReasoning': { 'zh-CN':'新增推理', en:'Add reasoning' },
  'create.nameShort': { 'zh-CN':'名称', en:'Name' },
  'create.reasoningName': { 'zh-CN':'名字', en:'Name' },
  'create.layerShort': { 'zh-CN':'层级', en:'Layer' },
  'create.content': { 'zh-CN':'内容', en:'Content' },
  'create.contentPlaceholder': { 'zh-CN':'填写知识本身的完整内容…', en:'Enter the complete knowledge content…' },
  'create.nameShortPlaceholder': { 'zh-CN':'填写知识名称', en:'Enter a knowledge name' },
  'create.reasoningNamePlaceholder': { 'zh-CN':'填写这个推理过程的名称', en:'Name this reasoning process' },
  'create.reasoningBodyPlaceholder': { 'zh-CN':'逐步写清楚从前提到结论的推理过程…', en:'Explain the reasoning from premises to conclusions step by step…' },
  'create.premise': { 'zh-CN':'前提', en:'Premise' },
  'create.conclusion': { 'zh-CN':'结论', en:'Conclusion' },
  'create.searchPremise': { 'zh-CN':'搜索已有前提节点…', en:'Search existing premise nodes…' },
  'create.searchConclusion': { 'zh-CN':'搜索已有结论节点…', en:'Search existing conclusion nodes…' },
  'create.standaloneNote': { 'zh-CN':'新增只创建一个独立知识球，不自动建立任何前提、推理或结论连线。', en:'Add creates one standalone knowledge ball and does not automatically create premise, reasoning, or conclusion links.' },
  'create.searchNote': { 'zh-CN':'搜索框只用于筛选已有节点，不能把输入文字直接当作新节点。选中的节点会固定显示在列表顶部。', en:'Search only filters existing nodes; typed text is never created as a node. Selected nodes stay pinned at the top.' },
  'create.submitReasoning': { 'zh-CN':'提交推理', en:'Submit reasoning' },
  'create.noneSelected': { 'zh-CN':'尚未选择', en:'Nothing selected' },
  'create.remove': { 'zh-CN':'点击移除', en:'Click to remove' },
  'create.selectedCancel': { 'zh-CN':'已选择 · 点击取消', en:'Selected · click to remove' },
  'create.select': { 'zh-CN':'点击选择', en:'Click to select' },
  'create.noExisting': { 'zh-CN':'没有匹配的已有节点', en:'No matching existing nodes' },
  'create.nameRequired': { 'zh-CN':'请填写名称。', en:'Enter a name.' },
  'create.layerRequired': { 'zh-CN':'请选择知识层级。', en:'Select a knowledge layer.' },
  'create.contentRequired': { 'zh-CN':'请填写内容。', en:'Enter content.' },
  'create.premiseRequired': { 'zh-CN':'请从已有节点中选择至少一个前提。', en:'Select at least one existing premise.' },
  'create.reasoningRequired': { 'zh-CN':'请填写推理过程。', en:'Enter the reasoning.' },
  'create.conclusionRequired': { 'zh-CN':'请从已有节点中选择至少一个结论。', en:'Select at least one existing conclusion.' },
  'create.sameNodeError': { 'zh-CN':'同一个节点不能同时作为这条推理的前提和结论。', en:'The same node cannot be both a premise and a conclusion in one reasoning chain.' },
  'create.submitFailed': { 'zh-CN':'提交失败', en:'Submission failed' },
  'panel.layerUnknown': { 'zh-CN':'层级未计算', en:'Layer not calculated' },
  'panel.legacy': { 'zh-CN':'历史兼容', en:'Legacy compatibility' },
  'panel.noPremise': { 'zh-CN':'无已记录前置知识', en:'No recorded prerequisite knowledge' },
  'panel.noDownstream': { 'zh-CN':'暂无下游依赖节点', en:'No downstream dependent nodes' },
  'panel.twin': { 'zh-CN':'孪生证明', en:'Twin proof' },
  'panel.logicClass': { 'zh-CN':'逻辑符号 / 推理分类', en:'Logic symbol / reasoning class' },
  'panel.noRule': { 'zh-CN':'未指定正式规则', en:'No formal rule specified' },
  'panel.layerAdjusted': { 'zh-CN':'当前显示层级调整', en:'Current display layer adjustment' },
  'panel.submittedAt': { 'zh-CN':'提交时：', en:'Submitted: ' },
  'panel.currentAt': { 'zh-CN':'当前：', en:'Current: ' },
  'panel.disputeReason': { 'zh-CN':'原因：该知识当前处于争议状态，因此显示在第三层；原始声明分类仍被保留。', en:'Reason: this knowledge is currently disputed, so it is displayed in Layer 3; the original declared classification is preserved.' },
  'panel.stateReason': { 'zh-CN':'当前状态触发了显示层级规则；原始声明分类不会被静默改写。', en:'The current state triggered a display-layer rule; the original declared classification is not silently rewritten.' },
  'panel.internalType': { 'zh-CN':'内部细分类', en:'Internal subtype' },
  'panel.privateState': { 'zh-CN':'PRIVATE STATE · 仅你可见，不影响公共知识有效性', en:'PRIVATE STATE · visible only to you; does not affect public knowledge validity' },
  'panel.currentNode': { 'zh-CN':'当前节点', en:'Current node' },
  'panel.connected': { 'zh-CN':'已连接', en:'Connected' },
  'panel.downstream': { 'zh-CN':'下游', en:'Downstream' },
  'panel.description': { 'zh-CN':'知识描述', en:'Knowledge description' },
  'panel.prerequisites': { 'zh-CN':'前置知识点', en:'Prerequisite knowledge' },
  'panel.dependencies': { 'zh-CN':'下游依赖节点', en:'Downstream dependent nodes' },
  'panel.optimize': { 'zh-CN':'Optimize · 优化', en:'Optimize' },
  'panel.add': { 'zh-CN':'Add · 新增', en:'Add' },
  'panel.decompose': { 'zh-CN':'Decompose · 分解', en:'Decompose' },
  'panel.merge': { 'zh-CN':'Merge · 合并', en:'Merge' },
  'panel.oppose': { 'zh-CN':'Oppose · 提出对立观点', en:'Oppose' },
  'panel.resolve': { 'zh-CN':'✓ 标记重新验证通过', en:'✓ Mark revalidation passed' },
  'panel.dispute': { 'zh-CN':'✓ 标记争议中', en:'✓ Mark disputed' },
  'panel.serverNote': { 'zh-CN':'公共知识由服务器确认后进入共享事件流；浏览器只渲染当前内存投影。', en:'Public knowledge enters the shared event stream only after server confirmation; the browser renders the current in-memory projection.' },
  'panel.logicOptional': { 'zh-CN':'逻辑 / 推理规则（可选）', en:'Logic / reasoning rule (optional)' },
  'panel.newFromExisting': { 'zh-CN':'基于现有知识提交新节点', en:'Submit a new node from existing knowledge' },
  'panel.preselectedGeneric': { 'zh-CN':'已预选一个推理前提；因此默认进入第二层。', en:'One reasoning premise is preselected, so Layer 2 is selected by default.' },
  'panel.layerHint': { 'zh-CN':'选择统一三层分类：第一层是语义/基础事实，第二层是严谨推理，第三层是概率/不确定/争议知识。', en:'Choose the unified three-layer classification: Layer 1 semantics/foundational facts, Layer 2 rigorous reasoning, Layer 3 probabilistic/uncertain/disputed knowledge.' },
  'detail.previous': { 'zh-CN':'上一个节点', en:'Previous node' },
  'detail.history': { 'zh-CN':'历史版本', en:'History' },
  'detail.next': { 'zh-CN':'下一个节点', en:'Next node' },
  'detail.oppositionHistory': { 'zh-CN':'否定历史', en:'Opposition history' },
  'detail.close': { 'zh-CN':'关闭知识节点详情', en:'Close knowledge details' },
  'detail.vote': { 'zh-CN':'投票', en:'Vote' },
  'detail.energyMinus1': { 'zh-CN':'能量 −1', en:'Energy −1' },
  'detail.syncingVote': { 'zh-CN':'正在同步投票状态…', en:'Syncing vote status…' },
  'detail.voteUnavailable': { 'zh-CN':'共享服务未配置，暂不能投票', en:'Shared service is not configured; voting is unavailable' },
  'detail.setBest': { 'zh-CN':'设为当前最优', en:'Set as current best' },
  'detail.confirmBest': { 'zh-CN':'请确认该知识点为当前最优', en:'Confirm this knowledge is the current best' },
  'detail.syncingEnergy': { 'zh-CN':'正在同步本轮能量…', en:'Syncing round energy…' },
  'detail.revalidationUnavailable': { 'zh-CN':'共享服务未配置，暂不能重新验证', en:'Shared service is not configured; revalidation is unavailable' },
  'detail.cascadeWaiting': { 'zh-CN':'前提的当前版本已经变化，此知识正在等待重新验证。', en:'The current premise version changed; this knowledge is waiting for revalidation.' },
  'detail.contributor': { 'zh-CN':'贡献者 ·', en:'Contributor ·' },
  'detail.time': { 'zh-CN':'时间 ·', en:'Time ·' },
  'detail.revalidationReady': { 'zh-CN':'确认后启动重新验证', en:'Confirm to start revalidation' },
  'detail.energySyncFailed': { 'zh-CN':'本轮能量同步失败', en:'Could not sync round energy' },
  'detail.startingRevalidation': { 'zh-CN':'正在启动重新验证…', en:'Starting revalidation…' },
  'detail.revalidationStartFailed': { 'zh-CN':'重新验证启动失败', en:'Could not start revalidation' },
  'detail.revalidationTitle': { 'zh-CN':'重新验证 · ORIGINAL_DESIGN_V1', en:'Revalidation · ORIGINAL_DESIGN_V1' },
  'detail.syncingRevalidation': { 'zh-CN':'正在同步重新验证状态…', en:'Syncing revalidation status…' },
  'detail.revalidationSyncFailed': { 'zh-CN':'重新验证状态同步失败', en:'Could not sync revalidation status' },
  'detail.revalidationVoteFailed': { 'zh-CN':'重新验证投票失败', en:'Revalidation vote failed' },
  'detail.timeout': { 'zh-CN':'时间到期', en:'Timed out' },
  'detail.voteReached': { 'zh-CN':'达到票数', en:'Vote threshold reached' },
  'detail.oldCurrent': { 'zh-CN':'旧知识重新成为当前', en:'Old knowledge became current again' },
  'detail.currentUnchanged': { 'zh-CN':'当前知识保持不变', en:'Current knowledge remains unchanged' },
  'detail.started': { 'zh-CN':'已发起', en:'Started' },
  'detail.voteSuccess': { 'zh-CN':'投票成功', en:'Vote successful' },
  'detail.autoCascade': { 'zh-CN':'自动级联重审', en:'Automatic cascade review' },
  'detail.actionOptimize': { 'zh-CN':'优化', en:'Optimize' },
  'detail.actionAdd': { 'zh-CN':'新增', en:'Add' },
  'detail.actionAddReasoning': { 'zh-CN':'新增推理', en:'Add reasoning' },
  'detail.actionOppose': { 'zh-CN':'提出对立观点', en:'Oppose' },
  'detail.actionDecompose': { 'zh-CN':'分解', en:'Decompose' },
  'detail.actionMerge': { 'zh-CN':'合并', en:'Merge' },
  'detail.actionRevalidate': { 'zh-CN':'重新验证', en:'Revalidate' },
  'detail.actionDispute': { 'zh-CN':'争议', en:'Dispute' },
  'app.unsupportedAction': { 'zh-CN':'当前知识节点不支持这个编辑操作', en:'This knowledge node does not support that edit operation' },
  'app.remoteNotReady': { 'zh-CN':'公共知识远程通道尚未初始化', en:'The public knowledge remote channel is not initialized' },
  'app.layer1NoPremise': { 'zh-CN':'第一层是非推导性的语义 / 基础事实层，不能直接带推理前提', en:'Layer 1 is non-inferential semantics/foundational facts and cannot directly contain reasoning premises' },
  'app.layer1NoChain': { 'zh-CN':'第一层不能建立派生链', en:'Layer 1 cannot create a derived chain' },
  'app.decomposeTarget': { 'zh-CN':'分解目标必须是推理过程', en:'The decompose target must be a reasoning process' },
} as const;
export type LegacySystemTextKey = keyof typeof legacySystemTextCatalog;

let locale = initialLocale();
const listeners = new Set<(locale: AppLocale) => void>();
let runtimeObserver: MutationObserver | null = null;
const translatedTextNodes = new WeakMap<Text, TranslationKey | LegacySystemTextKey>();
const translatedAttributes = new WeakMap<Element, Map<string, TranslationKey | LegacySystemTextKey>>();

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function initialLocale(): AppLocale {
  const stored = safeStorage()?.getItem(LOCALE_STORAGE_KEY);
  return stored === 'zh-CN' || stored === 'en' ? stored : 'zh-CN';
}

export const getLocale = (): AppLocale => locale;
export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  return interpolate(catalogs[locale][key], values);
}
function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

function systemText(key: TranslationKey | LegacySystemTextKey): string {
  if (key in catalogs.en) return catalogs[locale][key as TranslationKey];
  return legacySystemTextCatalog[key as LegacySystemTextKey][locale];
}

const literalLookup = new Map<string, TranslationKey | LegacySystemTextKey>();
for (const key of Object.keys(en) as TranslationKey[]) {
  literalLookup.set(en[key], key);
  literalLookup.set(zhCN[key], key);
}
for (const key of Object.keys(legacySystemTextCatalog) as LegacySystemTextKey[]) {
  literalLookup.set(legacySystemTextCatalog[key].en, key);
  literalLookup.set(legacySystemTextCatalog[key]['zh-CN'], key);
}

const USER_CONTENT_SELECTOR = [
  '#panelTitle', '.field .val', '.chip[data-jump]',
  '.node-detail-title', '.node-detail-content', '[data-related-node-id]', '.node-detail-meta b',
  '#kbProfileName', '#kbProfileUsername', '#kbProfileBio',
  '.knowledge-picker-chip', '.knowledge-picker-option > span',
  '.search-item[data-node-id] > span',
  'input', 'textarea',
].join(',');

function isUserContentElement(element: Element | null): boolean {
  return Boolean(element?.closest(USER_CONTENT_SELECTOR));
}

function withOuterWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

function translatePattern(value: string): string | null {
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = locale === 'en'
    ? [
        [/^节点已提交：(.*)$/s, m => `Node submitted: ${m[1]}`],
        [/^推理已提交：(.*)$/s, m => `Reasoning submitted: ${m[1]}`],
        [/^已预选「(.*)」作为推理前提；因此默认进入第二层。$/s, m => `“${m[1]}” is preselected as a reasoning premise, so Layer 2 is selected by default.`],
        [/^同步状态：(.*)$/s, m => `Sync status: ${m[1]}`],
        [/^能量 −(.*)$/s, m => `Energy −${m[1]}`],
        [/^同步失败：(.*)$/s, m => `Sync failed: ${m[1]}`],
        [/^启动失败：(.*)$/s, m => `Start failed: ${m[1]}`],
        [/^投票失败：(.*)$/s, m => `Vote failed: ${m[1]}`],
        [/^同意票提交中(.*)$/s, m => `Submitting Agree vote${m[1]}`],
        [/^反对票提交中(.*)$/s, m => `Submitting Disagree vote${m[1]}`],
        [/^同意 (\d+)\/(\d+) · 反对 (\d+)\/(\d+)$/s, m => `Agree ${m[1]}/${m[2]} · Disagree ${m[3]}/${m[4]}`],
        [/^第 (\d+) 阶段(.*)$/s, m => `Stage ${m[1]}${m[2]}`],
        [/^已投同意(.*)$/s, m => `Voted Agree${m[1]}`],
        [/^已投反对(.*)$/s, m => `Voted Disagree${m[1]}`],
      ]
    : [
        [/^Node submitted: (.*)$/s, m => `节点已提交：${m[1]}`],
        [/^Reasoning submitted: (.*)$/s, m => `推理已提交：${m[1]}`],
        [/^“(.*)” is preselected as a reasoning premise, so Layer 2 is selected by default\.$/s, m => `已预选「${m[1]}」作为推理前提；因此默认进入第二层。`],
        [/^Sync status: (.*)$/s, m => `同步状态：${m[1]}`],
        [/^Energy −(.*)$/s, m => `能量 −${m[1]}`],
        [/^Sync failed: (.*)$/s, m => `同步失败：${m[1]}`],
        [/^Start failed: (.*)$/s, m => `启动失败：${m[1]}`],
        [/^Vote failed: (.*)$/s, m => `投票失败：${m[1]}`],
        [/^Submitting Agree vote(.*)$/s, m => `同意票提交中${m[1]}`],
        [/^Submitting Disagree vote(.*)$/s, m => `反对票提交中${m[1]}`],
        [/^Agree (\d+)\/(\d+) · Disagree (\d+)\/(\d+)$/s, m => `同意 ${m[1]}/${m[2]} · 反对 ${m[3]}/${m[4]}`],
        [/^Stage (\d+)(.*)$/s, m => `第 ${m[1]} 阶段${m[2]}`],
        [/^Voted Agree(.*)$/s, m => `已投同意${m[1]}`],
        [/^Voted Disagree(.*)$/s, m => `已投反对${m[1]}`],
      ];
  for (const [pattern, render] of patterns) {
    const match = value.match(pattern);
    if (match) return render(match);
  }
  return null;
}

export function translateRuntimeSystemText(value: string): string {
  const direct = literalLookup.get(value);
  if (direct) return systemText(direct);
  return translatePattern(value) ?? value;
}

function localizeTextNode(node: Text): void {
  if (isUserContentElement(node.parentElement)) return;
  const original = node.nodeValue ?? '';
  const core = original.trim();
  if (!core) return;
  const remembered = translatedTextNodes.get(node);
  if (remembered) {
    node.nodeValue = withOuterWhitespace(original, systemText(remembered));
    return;
  }
  const key = literalLookup.get(core);
  if (key) {
    translatedTextNodes.set(node, key);
    node.nodeValue = withOuterWhitespace(original, systemText(key));
    return;
  }
  const patterned = translatePattern(core);
  if (patterned !== null) node.nodeValue = withOuterWhitespace(original, patterned);
}

function localizeAttribute(element: Element, name: 'placeholder' | 'aria-label' | 'title'): void {
  if (isUserContentElement(element)) return;
  const value = element.getAttribute(name)?.trim();
  if (!value) return;
  const remembered = translatedAttributes.get(element)?.get(name);
  if (remembered) {
    element.setAttribute(name, systemText(remembered));
    return;
  }
  const key = literalLookup.get(value);
  if (!key) {
    const patterned = translatePattern(value);
    if (patterned !== null) element.setAttribute(name, patterned);
    return;
  }
  let byName = translatedAttributes.get(element);
  if (!byName) {
    byName = new Map();
    translatedAttributes.set(element, byName);
  }
  byName.set(name, key);
  element.setAttribute(name, systemText(key));
}

function applyRuntimeTranslations(root: ParentNode): void {
  if (typeof document === 'undefined') return;
  const processElement = (element: Element) => {
    localizeAttribute(element, 'placeholder');
    localizeAttribute(element, 'aria-label');
    localizeAttribute(element, 'title');
  };
  if (root instanceof Element) processElement(root);
  root.querySelectorAll?.('*').forEach(processElement);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) localizeTextNode(current as Text);
}

export function applyDocumentTranslations(root: ParentNode = document): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n as TranslationKey); });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder as TranslationKey)); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => { const value=t(el.dataset.i18nAria as TranslationKey); el.setAttribute('aria-label', value); el.setAttribute('title', value); });
  applyRuntimeTranslations(root);
}

function ensureRuntimeObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || runtimeObserver) return;
  runtimeObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        const name = record.attributeName;
        if (name === 'placeholder' || name === 'aria-label' || name === 'title') localizeAttribute(record.target, name);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Text) localizeTextNode(node);
        else if (node instanceof Element) applyRuntimeTranslations(node);
      }
    }
  });
  runtimeObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title'],
  });
}

export function setLocale(next: AppLocale): void {
  if (!SUPPORTED_LOCALES.includes(next)) return;
  locale = next;
  try { safeStorage()?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* optional preference */ }
  if (typeof document !== 'undefined') applyDocumentTranslations();
  listeners.forEach(listener => listener(next));
}
export function subscribeLocale(listener: (locale: AppLocale) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function initializeLocale(): void {
  if (typeof document === 'undefined') return;
  applyDocumentTranslations();
  ensureRuntimeObserver();
}
