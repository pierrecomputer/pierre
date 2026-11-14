(module
  (import "./memory.wat")
  (import "./input.wat")
  (import "./output.wat")

  (func $emitTok (param $hl i32) (param $lhs i32) (param $rhs i32)
    (if (i32.lt_u (local.get $lhs) (local.get $rhs))
      (then (call $recTok (local.get $hl) (local.get $rhs)))))

  (func $emitGap (param $lhs i32) (param $rhs i32)
    (if (i32.ge_u (local.get $lhs) (local.get $rhs))
      (then (return)))
    (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
      (then
        (i32.store
          (i32.sub (global.get $out) (i32.const 8))
          (i32.sub (local.get $rhs) (global.get $srcBase))))
      (else (call $recTok (i32.const 255) (local.get $rhs)))))
)
