(module
  (import "../common.wat")

  ;; String-body helpers shared by the Java, Kotlin, Scala, Groovy, Dart, and
  ;; Swift lexers. Each lexer keeps its own inline scan loop, which runs per
  ;; string - a call there measurably slows string-heavy code - while these
  ;; cover the rarer escape and `$` steps, where a call costs nothing
  ;; measurable and every inline copy cost 50 to 150 bytes.

  (func $templateByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Emit the backslash escape at $ptr, after the string run [$seg,$ptr)
  ;; before it, and step past it. Returns 1 when the escape ends exactly at
  ;; $end on a line break - an escaped line break continuing the string into
  ;; the next chunk - else 0.
  (func $stringEscapeAt (param $seg i32) (result i32)
    (local $e i32)
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.set $e (call $lexEscapeEnd (global.get $ptr)))
    (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
    (global.set $ptr (local.get $e))
    (i32.and
      (i32.eq (global.get $ptr) (global.get $end))
      (i32.or
        (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 10))
        (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 13)))))

  ;; Lex the `$` at $ptr in a template string body whose run [$seg,$ptr) is
  ;; still unemitted: a `${` interpolation opener - unless $nested, inside an
  ;; interpolation, where a nested string keeps it plain - a `$name`
  ;; template, or a plain `$`. $dialect 8 makes `$$` an escaped dollar
  ;; (Scala) and 16 lets a name run on through `.name` segments (Groovy);
  ;; with either, a name holds no `$`, while Kotlin and Dart (0) read `$$x`
  ;; as a name. Returns -1 after emitting a `${` opener as
  ;; punctuation.special, else the start of the body's unemitted bytes.
  (func $stringDollarAt (param $seg i32) (param $dialect i32) (param $nested i32) (result i32)
    (local $at i32)
    (local $c2 i32)
    (local.set $at (global.get $ptr))
    (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
    (if (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.eqz (local.get $nested)))
      (then
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        ;; the `{` was read below $end, so this cannot overshoot
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $at) (global.get $ptr))
        (return (i32.const -1))))
    (if (i32.and (i32.eq (local.get $c2) (i32.const "$")) (i32.ne (local.get $dialect) (i32.const 0)))
      (then
        (if (i32.eq (local.get $dialect) (i32.const 16))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (return (local.get $seg))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $at) (global.get $ptr))
        (return (global.get $ptr))))
    (if (call $lexIsIdentStart (local.get $c2))
      (then
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $nameDone
          (loop $name
            (call $scanIdentRun (select (i32.const "_") (i32.const "$") (local.get $dialect)))
            (br_if $nameDone
              (i32.eqz
                (i32.and
                  (i32.eq (local.get $dialect) (i32.const 16))
                  (i32.and
                    (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                    (i32.and
                      (call $lexIsIdentStart
                        (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                      (i32.ne
                        (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                        (i32.const "$")))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $name)))
        (call $emitTok (enum.get $Token.variable) (local.get $at) (global.get $ptr))
        (return (global.get $ptr))))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (local.get $seg))
)
