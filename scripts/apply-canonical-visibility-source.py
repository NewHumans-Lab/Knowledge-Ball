from pathlib import Path

index = Path('index.html')
html = index.read_text()
old_button = '<button class="btn" id="btnPersonal" title="隐藏/恢复未接触的知识节点">个人</button>'
new_button = '<button class="btn" id="btnPersonal" data-visibility-mode="current" title="当前：只显示每个主题的当前知识；点击切换到个人">当前</button>'
if html.count(old_button) != 1:
    raise SystemExit(f'expected exactly one legacy visibility button, found {html.count(old_button)}')
index.write_text(html.replace(old_button, new_button))

vite = Path('vite.config.ts')
text = vite.read_text()
old_constant = 'const canonicalVisibilityButton = \'<button class="btn" id="btnPersonal" data-visibility-mode="current" title="当前：只显示每个主题的当前知识；点击切换到个人">当前</button>\';\n'
if text.count(old_constant) != 1:
    raise SystemExit('canonical visibility button constant not found exactly once')
text = text.replace(old_constant, '')
old_plugin = '''    {
      name: 'knowledge-ball-canonical-visibility-shell',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const normalized = html.replace(
            /<button\\s+class="btn"\\s+id="btnPersonal"[^>]*>[^<]*<\\/button>/,
            canonicalVisibilityButton,
          );
          if (normalized === html) {
            throw new Error('Cannot locate #btnPersonal while canonicalizing the built visibility shell');
          }
          return normalized;
        },
      },
    },
'''
if text.count(old_plugin) != 1:
    raise SystemExit('canonical visibility Vite plugin not found exactly once')
vite.write_text(text.replace(old_plugin, ''))

verify = Path('scripts/verify-visibility-runtime-architecture.mjs')
check = verify.read_text()
old_read = "const vite = await readFile('vite.config.ts', 'utf8');\n"
new_read = "const vite = await readFile('vite.config.ts', 'utf8');\nconst index = await readFile('index.html', 'utf8');\n"
if check.count(old_read) != 1:
    raise SystemExit('visibility verifier Vite read anchor not found exactly once')
check = check.replace(old_read, new_read)
old_assert = "assert(vite.includes('knowledge-ball-canonical-visibility-shell'), 'built HTML must canonicalize the Current shell before runtime boot');\n"
new_assert = "assert(index.includes('id=\\\"btnPersonal\\\" data-visibility-mode=\\\"current\\\" title=\\\"当前：只显示每个主题的当前知识；点击切换到个人\\\">当前</button>'), 'index.html must own the canonical Current visibility shell');\nassert(!index.includes('隐藏/恢复未接触的知识节点'), 'index.html must not retain the legacy binary visibility shell');\nassert(!vite.includes('knowledge-ball-canonical-visibility-shell'), 'Vite must not rewrite product visibility HTML at build time');\nassert(!vite.includes('canonicalVisibilityButton'), 'Vite must not duplicate the visibility button source of truth');\n"
if check.count(old_assert) != 1:
    raise SystemExit('legacy visibility architecture assertion not found exactly once')
verify.write_text(check.replace(old_assert, new_assert))
