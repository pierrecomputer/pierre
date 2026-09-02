(module
  (import "../common.wat")

  (func $hlslByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlslWordHl below. The scalar
  ;; families with open-ended suffixes - `float4x4`, `min16float2`,
  ;; `sampler2D`, `int16_t` - are prefix checks in $hlslTypeHl: their members
  ;; share hash features the table cannot separate. The capitalized resource
  ;; types such as `Texture2D` fall to the capitalization rule.
  (keyword-table $hlslWords $mem.hlslWords $mem.hlslWords+1152 64 256
    (group "true" "false") ;; 1: booleans
    (group ;; 2: control
      "if" "do" "for" "case" "else" "break" "while" "return" "switch"
      "default" "discard" "continue")
    (group ;; 3: declaration, next name is a type
      "class" "struct" "cbuffer" "tbuffer" "typedef" "interface")
    (group "namespace") ;; 4: declaration, next name is a namespace
    (group ;; 5: scalar and opaque built-in types
      "int" "bool" "half" "uint" "void" "dword" "float" "double" "string"
      "vector" "matrix" "sampler" "sampler_state" "float16_t")
    (group ;; 6: storage, interpolation, and layout qualifiers
      "in" "out" "pass" "const" "inout" "snorm" "unorm" "export" "inline"
      "linear" "sample" "shared" "static" "extern" "precise" "uniform"
      "centroid" "register" "volatile" "technique" "row_major" "packoffset"
      "groupshared" "column_major" "noperspective" "nointerpolation"
      "globallycoherent")
    (group "this")) ;; 7: special variable

  ;; The built-in type families the table cannot hold, for a name that
  ;; missed it: `int16_t`-style widths, `sampler2D`, `min16float`, and the
  ;; vector and matrix suffixes `2`..`4` and `2x2`..`4x4` on any scalar.
  ;; Returns type.builtin or none.
  (func $hlslTypeHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i32)
    (local $stem i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.lt_u (local.get $len) (i32.const 4))
      (then (return (enum.get $Token.none))))
    ;; the wide loads stay inside the input slack
    (if (i32.and
          (i32.ge_u (local.get $len) (i32.const 7))
          (i64.eq
            (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
            (i64.const "sampler")))
      (then (return (enum.get $Token.type.builtin))))
    (local.set $w (i32.load (i32.sub (local.get $rhs) (i32.const 4))))
    (if (i32.and
          (i32.or
            (i32.or
              (i32.eq (local.get $w) (i32.const "16_t"))
              (i32.eq (local.get $w) (i32.const "32_t")))
            (i32.eq (local.get $w) (i32.const "64_t")))
          (i32.or
            (i32.and
              (i32.eq (local.get $len) (i32.const 7))
              (i32.eq
                (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff))
                (i32.const "int")))
            (i32.and
              (i32.eq (local.get $len) (i32.const 8))
              (i32.eq (i32.load (local.get $lhs)) (i32.const "uint")))))
      (then (return (enum.get $Token.type.builtin))))
    ;; `min10float`, `min12int`, `min16uint`, and their vector forms
    (if (i32.eq (i32.load (local.get $lhs)) (i32.const "min1"))
      (then (return (enum.get $Token.type.builtin))))
    ;; strip a `2`..`4` or `2x2`..`4x4` suffix and look the scalar stem up
    (local.set $stem (local.get $rhs))
    (if (i32.le_u (i32.sub (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "1")) (i32.const 3))
      (then
        (local.set $stem (i32.sub (local.get $rhs) (i32.const 1)))
        (if (i32.and
              (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 2))) (i32.const "x"))
              (i32.le_u
                (i32.sub (i32.load8_u (i32.sub (local.get $rhs) (i32.const 3))) (i32.const "1"))
                (i32.const 3)))
          (then (local.set $stem (i32.sub (local.get $rhs) (i32.const 3)))))))
    (if (i32.eq (local.get $stem) (local.get $rhs))
      (then (return (enum.get $Token.none))))
    (if (i32.eq
          (keyword-table.get $hlslWords (local.get $lhs) (local.get $stem))
          (i32.const 5))
      (then (return (enum.get $Token.type.builtin))))
    (enum.get $Token.none))

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=type, 2=namespace. -1 means an ordinary identifier.
  (func $hlslWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $hl i32)
    (local.set $g (keyword-table.get $hlslWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        (local.set $hl (call $hlslTypeHl (local.get $lhs) (local.get $rhs)))
        (if (local.get $hl) (then (return (local.get $hl))))
        (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 4))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 2)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword))))
    (enum.get $Token.variable.special))

  (func $hlslIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))))))))

  ;; $expect is the pending next-name capture from $hlslWordHl. $afterType
  ;; is 1 right after a type and rides through the `<`, `>`, `[`, `]`, and
  ;; `,` of a template or array type, so the name before a `(` after it is a
  ;; function definition rather than a call. $member is 1 after `.`, `->`,
  ;; or `::`. $attr is 1 inside a `[...]` that opened a line - `[unroll]`,
  ;; `[numthreads(8, 8, 1)]` - whose names are attributes, and $lineHead is
  ;; 1 until the first token of a line. $include is 1 after `#include`, so
  ;; an angle-bracket path lexes as a string. All are checkpointed.
  (func $hlHlsl
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $afterType i32) (local $attr i32) (local $lineHead i32)
    (local $atHead i32) (local $include i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            (local.set $attr (i32.const 0))
            (local.set $include (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $hlslByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $hlslByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.or
                (i32.eq (local.get $c3) (i32.const "!"))
                (i32.and (i32.eq (local.get $c3) (i32.const "*"))
                  (i32.ne (call $hlslByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "/"))))))
            (br $next)))

        ;; `#directive`, with the blanks before its name, is one preproc token
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (i32.add (global.get $ptr) (i32.const 1))))
            (local.set $p (global.get $ptr))
            (call $lexScanIdent)
            (local.set $include (i32.and
              (i32.eq (i32.sub (global.get $ptr) (local.get $p)) (i32.const 7))
              (i64.eq
                (i64.and (i64.load (local.get $p)) (i64.const 0x00ffffffffffffff))
                (i64.const "include"))))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))
        ;; an angle-bracket include path is a string, not two operators
        (if (i32.and (local.get $include) (i32.eq (local.get $c) (i32.const "<")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $pathDone
              (loop $path
                (br_if $pathDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $pathDone (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $pathDone (i32.eq (local.get $c) (i32.const ">")))
                (br $path)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $include (i32.const 0))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $kind (select (i32.const -1)
              (call $hlslWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))
                (local.set $afterType (i32.eq (local.get $hl) (enum.get $Token.type.builtin))))
              (else
                (if (local.get $attr)
                  (then
                    (local.set $hl (enum.get $Token.attribute))
                    (local.set $afterType (i32.const 0)))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.type) (enum.get $Token.namespace)
                          (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $afterType (i32.eq (local.get $expect) (i32.const 1)))
                        (local.set $expect (i32.const 0)))
                      (else
                        ;; `SV_Position` and its kin are system-value semantics
                        (if (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "SV_"))
                          (then
                            (local.set $hl (enum.get $Token.variable.special))
                            (local.set $afterType (i32.const 0)))
                          (else
                            (if (local.get $member)
                              (then
                                (local.set $hl (select
                                  (enum.get $Token.function.method) (enum.get $Token.property)
                                  (i32.eq (call $hlslByte (local.get $p)) (i32.const "("))))
                                (local.set $afterType (i32.const 0)))
                              (else
                                (if (i32.eq (call $hlslByte (local.get $p)) (i32.const "("))
                                  (then
                                    ;; after a type, `name(` declares a function;
                                    ;; elsewhere it calls one or constructs a type
                                    (if (local.get $afterType)
                                      (then (local.set $hl (enum.get $Token.function.definition)))
                                      (else (local.set $hl (select (enum.get $Token.type) (enum.get $Token.function)
                                        (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))))))
                                    (local.set $afterType (i32.const 0)))
                                  (else
                                    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                      (then
                                        (local.set $hl (enum.get $Token.constant))
                                        (local.set $afterType (i32.const 0)))
                                      (else
                                        (local.set $afterType (i32.le_u
                                          (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25)))
                                        (local.set $hl (select (enum.get $Token.type) (enum.get $Token.variable)
                                          (local.get $afterType)))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            ;; a bracket opening a line starts an attribute list
            (if (i32.eq (local.get $c) (i32.const "["))
              (then (local.set $attr (local.get $atHead))))
            (if (i32.eq (local.get $c) (i32.const "]"))
              (then (local.set $attr (i32.const 0))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; array brackets keep a type pending; the others end it along
            ;; with any declaration head
            (if (i32.and (i32.ne (local.get $c) (i32.const "[")) (i32.ne (local.get $c) (i32.const "]")))
              (then
                (local.set $afterType (i32.const 0))
                (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.eq (local.get $c2) (i32.const ":")))
            (local.set $afterType (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "."))
              (i32.and (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c2) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c) (i32.const "-")))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c) (i32.const "-"))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (local.set $afterType (i32.const 0))
            (br $next)))

        (if (call $hlslIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                            (i32.or
                              (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                              (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                      (i32.eq (call $hlslByte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; the angles of a template type keep it pending; any other
            ;; operator ends it
            (if (i32.eqz (call $lexIsTypeGlue (local.get $lhs) (global.get $ptr)))
              (then (local.set $afterType (i32.const 0))))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $afterType (i32.const 0))
        (br $next))))
)
