(module
  (import "../common.wat")
  (import "./html.wat")

  ;; Svelte: html with `{...}` expressions and `{#if}`-style blocks (see
  ;; $braceMarkup in html.wat, dialect 0).
  (func $hlSvelte
    (call $lexEmitLeadingContinuation)
    (call $braceMarkup (i32.const 0)))
)
