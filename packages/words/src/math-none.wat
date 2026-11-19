(module
  ;; The module of `@pierre/words/no-math` (`node scripts/build.ts --no-math`)
  ;; builds with this file in place of math.wat. The `math` option still finds math, and every formula renders as
  ;; code, as one that does not fit does with math.wat.
  (func $mathInline (param $b i32) (param $e i32) (param $display i32) (result i32)
    (i32.const 0))
  (func $mathBlock (param $r i32) (result i32)
    (i32.const 0))
)
