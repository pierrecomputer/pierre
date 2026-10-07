(module
  ;; Track parameter lists to approximate Zed's variable.parameter captures.
  ;; Mark a parenthesis depth in $sigMask after a definition head such as
  ;; `function`, `def`, `fn`, `func`, `catch`, or `constructor`.
  ;; Also mark lists whose first name has an annotation that a call cannot
  ;; contain. Names at the top level of a marked list are parameters.
  ;; Each lexer updates the registers. See $sigStep in ts.wat for ECMAScript.
  ;;
  ;; Globals preserve state between chunks. live.wat captures every register.
  ;; Registers track parenthesis depth, marked depths, brace/bracket nesting,
  ;; type-argument depth, and a pending definition head with type parameters.
  ;; The position flag marks destructuring in ECMAScript. In other languages,
  ;; it marks a parameter position after the previous token.
  (global $sigParens (mut i32) (i32.const 0))
  (global $sigMask (mut i32) (i32.const 0))
  (global $sigObscure (mut i32) (i32.const 0))
  (global $sigPattern (mut i32) (i32.const 0))
  (global $sigAngle (mut i32) (i32.const 0))
  (global $sigFnPend (mut i32) (i32.const 0))
  (global $sigFnAngle (mut i32) (i32.const 0))

  ;; clear every parameter-list machine register
  (func $sigReset
    (global.set $sigParens (i32.const 0))
    (global.set $sigMask (i32.const 0))
    (global.set $sigObscure (i32.const 0))
    (global.set $sigPattern (i32.const 0))
    (global.set $sigAngle (i32.const 0))
    (global.set $sigFnPend (i32.const 0))
    (global.set $sigFnAngle (i32.const 0)))

  ;; the innermost open paren is a marked parameter list
  (func $sigActive (result i32)
    (if (i32.ge_u (global.get $sigParens) (i32.const 32))
      (then (return (i32.const 0))))
    (i32.and (i32.shr_u (global.get $sigMask) (global.get $sigParens)) (i32.const 1)))

  ;; mark the innermost paren as a parameter list with fresh nesting state
  (func $sigMark
    (if (i32.lt_u (global.get $sigParens) (i32.const 32))
      (then
        (global.set $sigMask
          (i32.or (global.get $sigMask) (i32.shl (i32.const 1) (global.get $sigParens))))))
    (global.set $sigObscure (i32.const 0))
    (global.set $sigPattern (i32.const 0))
    (global.set $sigAngle (i32.const 0)))

  ;; unmark the innermost paren: its close paren arrived, or a top-level `;`
  ;; proved the parameter-list guess wrong - real lists never contain one
  (func $sigUnmark
    (if (i32.lt_u (global.get $sigParens) (i32.const 32))
      (then
        (global.set $sigMask
          (i32.and
            (global.get $sigMask)
            (i32.xor (i32.shl (i32.const 1) (global.get $sigParens)) (i32.const -1))))))
    (global.set $sigObscure (i32.const 0))
    (global.set $sigPattern (i32.const 0))
    (global.set $sigAngle (i32.const 0)))

  ;; clamped decrement for the type-argument angle depth inside a list;
  ;; `>>` and `>>>` close several generic levels at once
  (func $sigAngleDrop (param $n i32)
    (if (i32.lt_u (global.get $sigAngle) (local.get $n))
      (then (global.set $sigAngle (i32.const 0)))
      (else (global.set $sigAngle (i32.sub (global.get $sigAngle) (local.get $n))))))

  ;; clamped decrement for the type-parameter angle depth of a pending head
  (func $sigFnAngleDrop (param $n i32)
    (if (i32.lt_u (global.get $sigFnAngle) (local.get $n))
      (then (global.set $sigFnAngle (i32.const 0)))
      (else (global.set $sigFnAngle (i32.sub (global.get $sigFnAngle) (local.get $n))))))

  ;; adjust the pending-head angle depth by the `<` and `>` bytes of one
  ;; operator token - rust and swift lex `>>` and friends as one token - and
  ;; cancel the pending head when another operator appears outside angles
  (func $sigAngleOps (param $p i32) (param $e i32)
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then (global.set $sigFnAngle (i32.add (global.get $sigFnAngle) (i32.const 1))))
          (else
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then (call $sigFnAngleDrop (i32.const 1)))
              (else
                (if (i32.eqz (global.get $sigFnAngle))
                  (then (global.set $sigFnPend (i32.const 0))))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l))))
)
