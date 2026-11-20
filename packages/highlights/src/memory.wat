(module
  (import "@pierre/wat-tools/memory.wat")

  (memory-region $mem.themeTable 384)
  (memory-region $mem.tokenCssTable 912)
  (memory-region $mem.emitterHtml 152)
  (memory-region $mem.emitterSpanCache 4824)
  (memory-region $mem.emitterThemeCache 384)

  (global (export "themePtr") i32 (i32.const $mem.themeTable))
)
