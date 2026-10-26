(module
  (import "../common.wat")
  (import "./jinja.wat")

  (func $hlTwig
    (call $hlJinjaImpl (i32.const 1)))
)
