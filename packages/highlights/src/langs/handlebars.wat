(module
  (import "../common.wat")
  (import "./jinja.wat")

  (func $hlHandlebars
    (call $hlJinjaImpl (i32.const 3)))
)
