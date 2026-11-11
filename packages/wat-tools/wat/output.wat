(module
  (import "./input.wat")
  (global $out (mut i32) (i32.const 0))

  (global $cap (mut i32) (i32.const 0))

  (global $recCarryHl (mut i32) (i32.const -1))

  (func $ensureCap (param $n i32)
    (if (i32.le_u (i32.add (global.get $out) (local.get $n)) (global.get $cap))
      (then (return)))
    ;; a failed grow (output would pass the wasm32 4 GB ceiling) traps here on
    ;; purpose: the host sees a RuntimeError and the instance stays reusable
    (if
      (i32.eq
        (memory.grow
          (i32.add
            (i32.shr_u
              (i32.sub
                (i32.add (i32.add (global.get $out) (local.get $n)) (i32.const 65551))
                (i32.mul (memory.size) (i32.const 65536)))
              (i32.const 16))
            (i32.const 4)))
        (i32.const -1))
      (then (unreachable)))
    (global.set $cap (i32.sub (i32.mul (memory.size) (i32.const 65536)) (i32.const 16))))

  (func $recTok (param $hl i32) (param $rhs i32)
    (if
      (i32.and
        (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
        (i32.eq (i32.load (i32.sub (global.get $out) (i32.const 4))) (local.get $hl)))
      (then
        (i32.store
          (i32.sub (global.get $out) (i32.const 8))
          (i32.sub (local.get $rhs) (global.get $srcBase)))
        (return)))
    (call $ensureCap (i32.const 16))
    (i32.store (global.get $out) (i32.sub (local.get $rhs) (global.get $srcBase)))
    (i32.store offset=4 (global.get $out) (local.get $hl))
    (global.set $out (i32.add (global.get $out) (i32.const 8))))

  (func $recStreamBegin (param $reset i32)
    (if (local.get $reset)
      (then
        (global.set $recCarryHl (i32.const -1))
        (return)))
    (if (i32.ge_s (global.get $recCarryHl) (i32.const 0))
      (then
        (call $ensureCap (i32.const 16))
        (i32.store (global.get $out) (i32.const 0))
        (i32.store offset=4 (global.get $out) (global.get $recCarryHl))
        (global.set $out (i32.add (global.get $out) (i32.const 8))))))

  (func $recStreamEnd
    (if (i32.gt_u (global.get $out) (i32.load (i32.const 6)))
      (then (global.set $recCarryHl (i32.load (i32.sub (global.get $out) (i32.const 4)))))))
)
