(module
  (import "../common.wat")

  (keyword-table $gdTypes $mem.gdTypes $mem.gdPackedWords
    (group $Token.type.builtin
      "void" "bool" "int" "float" "String" "StringName" "NodePath" "Vector2"
      "Vector3" "Vector4" "Rect2" "Rect2i" "Transform2D"
      "Plane" "Quaternion" "AABB" "Basis" "Projection" "Color" "RID" "Object" "Callable"
      "Signal" "Dictionary" "Array" "Variant"))

  (keyword-table $gdPackedWords $mem.gdPackedWords $mem.gdscriptWords
    (group $Token.type.builtin
      "Byte" "Int32" "Int64" "Float32" "Float64" "String" "Vector2" "Vector3" "Vector4" "Color"))

  ;; Match the type families whose equal-length names collide in the keyword hash.
  (func $gdTypeHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (if
      (i32.and (i32.eq (local.get $len) (i32.const 8))
        (i32.and
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff)) (i64.const "Vector"))
          (i32.eq (i32.load8_u offset=7 (local.get $lhs)) (i32.const "i"))))
      (then (local.set $rhs (i32.sub (local.get $rhs) (i32.const 1)))))
    (if
      (i32.and (i32.eq (local.get $len) (i32.const 11))
        (i32.and
          (i64.eq (i64.load (local.get $lhs)) (i64.const "Transfor"))
          (i32.eq (i32.load offset=7 (local.get $lhs)) (i32.const "rm3D"))))
      (then (return (enum.get $Token.type.builtin))))
    (if
      (i32.and (i32.ge_u (local.get $len) (i32.const 15))
        (i32.and
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffff)) (i64.const "Packed"))
          (i64.eq (i64.and (i64.load (i32.sub (local.get $rhs) (i32.const 5))) (i64.const 0xffffffffff)) (i64.const "Array"))))
      (then
        (return (keyword-table.value $gdPackedWords
          (i32.add (local.get $lhs) (i32.const 6)) (i32.sub (local.get $rhs) (i32.const 5))))))
    (keyword-table.value $gdTypes (local.get $lhs) (local.get $rhs)))

  (keyword-table $gdWords $mem.gdscriptWords $mem.gdshaderWords
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null" "PI" "TAU" "INF" "NAN")
    (group $Token.variable.special "self" "super")
    (group $Token.keyword.operator "and" "or" "not" "in" "is" "as")
    (group $Token.keyword.control
      "if" "elif" "else" "for" "while" "match" "when" "break" "continue" "pass"
      "return" "await" "yield" "breakpoint")
    (group $Token.keyword.declaration "var" "const")
    (group $Token.keyword.declaration+256 "func" "signal")
    (group $Token.keyword.declaration+512 "class" "class_name" "enum")
    (group $Token.keyword "extends" "static")
    (group $Token.function "preload" "assert"))

  ;; Script and resource strings share escapes, including Godot's six-digit \U.
  (func $gdStringBody
    (param $quote i32) (param $raw i32) (param $width i32) (param $multiline i32)
    (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (block $done
      (loop $scan
        (global.set $ptr
          (call $scanFindSpecial (global.get $ptr) (global.get $end)
            (local.get $quote) (i32.const 1) (i32.eqz (local.get $multiline))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if
          (i32.and
            (i32.eq (local.get $c) (local.get $quote))
            (i32.or
              (i32.eq (local.get $width) (i32.const 1))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (i32.and
                  (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
                  (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (local.get $width)))
            (local.set $status (i32.const 1))
            (br $done)))
        (br_if $done
          (i32.and (i32.eqz (local.get $multiline))
            (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (if (i32.eqz (local.get $raw))
              (then
                (if (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                  (then
                    (local.set $c (i32.load8_u offset=1 (global.get $ptr)))
                    (if (i32.or (i32.eq (local.get $c) (i32.const "u")) (i32.eq (local.get $c) (i32.const "U")))
                      (then
                        (local.set $e
                          (call $scanHexRun (local.get $e)
                            (select (i32.const 4) (i32.const 6) (i32.eq (local.get $c) (i32.const "u")))))))))
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
                (local.set $seg (local.get $e))))
            (global.set $ptr (local.get $e))
            (if
              (i32.and
                (i32.eq (global.get $ptr) (global.get $end))
                (i32.or
                  (i32.eq (i32.load8_u (i32.sub (local.get $e) (i32.const 1))) (i32.const 10))
                  (i32.eq (i32.load8_u (i32.sub (local.get $e) (i32.const 1))) (i32.const 13))))
              (then (local.set $status (i32.const 2)))))
          (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  (func $hlGdscript
    (local $c i32)
    (local $n i32)
    (local $lhs i32)
    (local $p i32)
    (local $hl i32)
    (local $group i32)
    (local $decl i32)
    (local $member i32)
    (local $operand i32)
    (local $quote i32)
    (local $raw i32)
    (local $width i32)
    (local $status i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (block $string
          (br_if $string (local.get $quote))
          (block $spaceDone
            (loop $space
              (br_if $spaceDone (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $c (i32.load8_u (global.get $ptr)))
              (br_if $spaceDone (i32.eqz (byteset.get " \09\0a\0d" (local.get $c))))
              (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
                (then
                  (local.set $operand (i32.const 0))
                  (local.set $decl (i32.const 0))))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (br $space)))
          (call $emitGap (local.get $lhs) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (global.get $ptr)))
          (local.set $n
            (select (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (call $lexLineComment (i32.const 1)
                (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                  (i32.eq (local.get $n) (i32.const "#"))))
              (br $token)))
          (local.set $raw (i32.eq (local.get $c) (i32.const "r")))
          (if
            (i32.and
              (i32.or (i32.eq (local.get $n) (i32.const 34)) (i32.eq (local.get $n) (i32.const 39)))
              (i32.or (byteset.get "r&^$" (local.get $c))
                (i32.and (i32.eqz (local.get $operand)) (i32.eq (local.get $c) (i32.const "%")))))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (local.set $c (local.get $n))))
          (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
            (then
              (local.set $quote (local.get $c))
              (local.set $width (i32.const 1))
              (if
                (i32.and
                  (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                  (i32.and
                    (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
                    (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote))))
                (then (local.set $width (i32.const 3))))
              (global.set $ptr (i32.add (global.get $ptr) (local.get $width)))
              (br $string)))
          (if (i32.eq (local.get $c) (i32.const "@"))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $lexScanIdent)
              (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
              (br $token)))
          (if
            (i32.or
              (i32.eq (local.get $c) (i32.const "$"))
              (i32.and (i32.eqz (local.get $operand))
                (i32.and (i32.eq (local.get $c) (i32.const "%")) (call $lexIsIdentStart (local.get $n)))))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $lexScanIdent)
              (block $pathDone
                (loop $path
                  (br_if $pathDone (i32.ge_u (global.get $ptr) (global.get $end)))
                  (br_if $pathDone (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "/")))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $lexScanIdent)
                  (br $path)))
              (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
              (local.set $operand (i32.const 1))
              (local.set $member (i32.const 0))
              (br $token)))
          (if
            (i32.or (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $n))))
            (then
              (call $lexScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (local.set $operand (i32.const 1))
              (local.set $member (i32.const 0))
              (br $token)))
          (if (call $lexIsIdentStart (local.get $c))
            (then
              (call $lexScanIdent)
              (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
              (local.set $n
                (i32.and (i32.lt_u (local.get $p) (global.get $end))
                  (i32.eq (i32.load8_u (local.get $p)) (i32.const "("))))
              (local.set $group (keyword-table.value $gdWords (local.get $lhs) (global.get $ptr)))
              (local.set $hl (i32.and (local.get $group) (i32.const 255)))
              (if (i32.lt_s (local.get $group) (i32.const 0))
                (then
                  (local.set $hl (call $gdTypeHl (local.get $lhs) (global.get $ptr)))
                  (if (i32.lt_s (local.get $hl) (i32.const 0))
                    (then
                      (local.set $hl (enum.get $Token.variable))
                      (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                        (then (local.set $hl (enum.get $Token.constant)))
                        (else
                          (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                            (then (local.set $hl (enum.get $Token.type)))
                            (else
                              (if (local.get $n) (then (local.set $hl (enum.get $Token.function))))))))))))
              (if (local.get $decl)
                (then
                  (local.set $hl
                    (select (enum.get $Token.function.definition) (enum.get $Token.type)
                      (i32.eq (local.get $decl) (i32.const 1))))))
              (if (local.get $member)
                (then
                  (local.set $hl
                    (select (enum.get $Token.function.method) (enum.get $Token.property) (local.get $n)))))
              (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
              (local.set $decl
                (select (i32.shr_u (local.get $group) (i32.const 8)) (i32.const 0)
                  (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))))
              (local.set $member (i32.const 0))
              (local.set $operand
                (i32.and
                  (i32.ne (local.get $hl) (enum.get $Token.keyword.operator))
                  (i32.and
                    (i32.ne (local.get $hl) (enum.get $Token.keyword.control))
                    (i32.ne (local.get $hl) (enum.get $Token.keyword.declaration)))))
              (br $token)))
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (local.set $hl (enum.get $Token.operator))
          (if (byteset.get "()[]{}" (local.get $c))
            (then (local.set $hl (enum.get $Token.punctuation.bracket)))
            (else
              (if (byteset.get ",;:." (local.get $c))
                (then (local.set $hl (enum.get $Token.punctuation.delimiter))))))
          (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $n) (i32.const "=")))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (local.set $hl (enum.get $Token.operator))))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (local.set $operand (byteset.get ")]}" (local.get $c)))
          (local.set $member (i32.eq (local.get $c) (i32.const ".")))
          (local.set $decl (i32.const 0))
          (br $token))
        (local.set $status
          (call $gdStringBody (local.get $quote) (local.get $raw) (local.get $width)
            (i32.eq (local.get $width) (i32.const 3)) (local.get $lhs)))
        (if
          (i32.or (i32.eq (local.get $status) (i32.const 1))
            (i32.and (i32.eq (local.get $width) (i32.const 1)) (i32.ne (local.get $status) (i32.const 2))))
          (then (local.set $quote (i32.const 0))))
        (local.set $operand (i32.const 1))
        (local.set $member (i32.const 0))
        (local.set $decl (i32.const 0))
        (br $token))))
)
