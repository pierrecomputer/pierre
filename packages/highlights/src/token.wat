(module
  (import "./memory.wat")
  (import "@pierre/wat-tools/token.wat")

  ;; [ptr:u16, length:u8] records over the kebab-case CSS-variable suffixes
  (css-variable-table $Token $mem.tokenCssTable $mem.tokenCssTable+912)

  ;; theme record for a $Token member: [r][g][b][a][style], where style
  ;; packs italic in bit 4 and font-weight/100 in the low nibble;
  ;; all-zero = unthemed
  (func $themeRec (param $hl i32) (result i32)
    (i32.add
      (i32.const $mem.themeTable)
      (i32.add (i32.shl (local.get $hl) (i32.const 2)) (local.get $hl)))) ;; hl * 5
)
