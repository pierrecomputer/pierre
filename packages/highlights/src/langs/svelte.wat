(module
  (import "../common.wat")
  (import "./brace-markup.wat")

  ;; Svelte: html with `{...}` expressions and `{#if}`-style blocks (see
  ;; brace-markup.wat, dialect 0).
  (func $hlSvelte
    (call $lexEmitLeadingContinuation)
    (call $braceMarkup (i32.const 0)))
)
