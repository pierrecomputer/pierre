(module
  (import "@pierre/wat-tools/memory.wat")

  (memory-region $mem.themeTable 384)
  (memory-region $mem.tokenCssTable 976)
  (memory-region $mem.emitterHtml 192)
  (memory-region $mem.emitterSpanCache 4976)
  (memory-region $mem.emitterThemeCache 384)
  (memory-region $mem.markdownFont 80)

  (global (export "themePtr") i32 (i32.const $mem.themeTable))
)
