(module
  (import "../common.wat")
  (import "./jinja.wat")

  (func $hlLiquid
    (call $hlJinjaImpl (i32.const 2)))
)
