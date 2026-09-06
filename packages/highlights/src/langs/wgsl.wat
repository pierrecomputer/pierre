(module
  (import "../common.wat")

  (func $wgslByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $wgslWordHl below. The vector,
  ;; matrix, and texture families are prefix checks in $wgslTypeHl: `mat2x2`
  ;; and `mat3x2` share every hash feature the table can use.
  (keyword-table $wgslWords $mem.wgslWords $mem.wgslWords+640
    (group ;; 1: control
      "if" "for" "case" "else" "loop" "break" "while" "return" "switch"
      "default" "discard" "continue" "continuing")
    (group "fn")              ;; 2: declaration, next name is a function
    (group "alias" "struct")  ;; 3: declaration, next name is a type
    (group ;; 4: declaration
      "let" "var" "const" "enable" "override" "requires" "diagnostic"
      "const_assert")
    (group ;; 5: address spaces and access modes
      "read" "write" "private" "storage" "uniform" "function" "workgroup"
      "read_write")
    (group ;; 6: built-in types without a family suffix
      "ptr" "f16" "f32" "i32" "u32" "bool" "array" "atomic" "sampler"
      "sampler_comparison")
    (group "true" "false")) ;; 7: booleans

  ;; The built-in type families the table cannot hold: `vec2`..`vec4` with
  ;; an optional `f`/`i`/`u`/`h` suffix, `mat2x2`..`mat4x4` with an optional
  ;; `f`/`h` suffix, and every `texture_` type. Returns type.builtin or none.
  (func $wgslTypeHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i32)
    (local $c i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.lt_u (local.get $len) (i32.const 4))
      (then (return (enum.get $Token.none))))
    ;; the wide loads stay inside the input slack
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 9))
          (i64.eq (i64.load (local.get $lhs)) (i64.const "texture_")))
      (then (return (enum.get $Token.type.builtin))))
    (local.set $w (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)))
    (local.set $c (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))))
    ;; an element suffix letter is dropped before the digit check
    (if (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "f")) (i32.eq (local.get $c) (i32.const "h")))
          (i32.and
            (i32.eq (local.get $w) (i32.const "vec"))
            (i32.or (i32.eq (local.get $c) (i32.const "i")) (i32.eq (local.get $c) (i32.const "u")))))
      (then
        (local.set $rhs (i32.sub (local.get $rhs) (i32.const 1)))
        (local.set $len (i32.sub (local.get $len) (i32.const 1)))))
    (if (i32.gt_u
          (i32.sub (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "2"))
          (i32.const 2))
      (then (return (enum.get $Token.none))))
    (if (i32.and (i32.eq (local.get $len) (i32.const 4)) (i32.eq (local.get $w) (i32.const "vec")))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.and
          (i32.eq (local.get $len) (i32.const 6))
          (i32.and
            (i32.eq (local.get $w) (i32.const "mat"))
            (i32.and
              (i32.le_u (i32.sub (i32.load8_u offset=3 (local.get $lhs)) (i32.const "2")) (i32.const 2))
              (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "x")))))
      (then (return (enum.get $Token.type.builtin))))
    (enum.get $Token.none))

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=type. -1 means an ordinary identifier.
  (func $wgslWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $hl i32)
    (local.set $g (keyword-table.get $wgslWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        (local.set $hl (call $wgslTypeHl (local.get $lhs) (local.get $rhs)))
        (if (local.get $hl) (then (return (local.get $hl))))
        (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 1)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.type.builtin))))
    (enum.get $Token.boolean))

  (func $wgslIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>^|~" (local.get $c)))

  ;; $expect is the pending next-name capture from $wgslWordHl and $member
  ;; is 1 after `.`. WGSL has no string literals, so the loop needs no body
  ;; state beyond these.
  (func $hlWgsl
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $wgslByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $wgslByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            ;; WGSL block comments nest
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "*")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))

        ;; `@vertex`, `@location(0)`: the attribute name; its arguments are code
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $wgslWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expect)
                  (then
                    (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                      (i32.eq (local.get $expect) (i32.const 1))))
                    (local.set $expect (i32.const 0)))
                  (else
                    (if (i32.eq (call $wgslByte (local.get $p)) (i32.const "("))
                      (then
                        ;; `Foo(` constructs a struct; `.length(` calls a method
                        (if (local.get $member)
                          (then (local.set $hl (enum.get $Token.function.method)))
                          (else (local.set $hl (select (enum.get $Token.type) (enum.get $Token.function)
                            (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))))))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (local.set $hl (select (enum.get $Token.type) (enum.get $Token.variable)
                                  (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            ;; hex floats keep a fraction that starts with a hex letter
            (if (i32.and
                  (i32.eq (call $wgslByte (global.get $ptr)) (i32.const "."))
                  (i32.and
                    (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "0"))
                    (i32.and
                      (i32.eq (i32.or (call $wgslByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const 32)) (i32.const "x"))
                      (call $lexIsHex (call $wgslByte (i32.add (global.get $ptr) (i32.const 1)))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanNumber)))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))

        (if (call $wgslIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
              (else
                (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                            (i32.and (i32.eq (local.get $c) (local.get $c2))
                              (byteset.get "&+-<>|" (local.get $c))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (if (i32.and
                          (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                          (i32.eq (call $wgslByte (global.get $ptr)) (i32.const "=")))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
