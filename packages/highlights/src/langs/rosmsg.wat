(module
  (import "../common.wat")

  ;; Group value 256 marks the string types, whose constants run to the line end.
  (keyword-table $rosmsgWords $mem.rosmsgWords $mem.fishWords
    (group $Token.type.builtin
      "bool" "byte" "char" "float32" "float64" "int8" "uint8" "int16" "uint16"
      "int32" "uint32" "int64" "uint64" "time" "duration" "Header")
    (group $Token.type.builtin+256 "string" "wstring"))

  ;; ROS .msg, .srv, and .action files. A line holds a field `type name` with
  ;; an optional ROS 2 default value, a constant `type NAME=value`, a `---`
  ;; separator, or a `#` comment. $col: 0 at a line start, 1 after the type,
  ;; 2 after a constant name, 3 in a value. $str: the type is a string.
  (func $hlRosmsg
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $gap i32)
    (local $g i32)
    (local $n i32)
    (local $hl i32)
    (local $col i32)
    (local $str i32)
    (local $w i64)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $col (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (block $emit
          ;; `---` between request, response, and feedback; `===` and `MSG:`
          ;; head each definition in a message with its dependencies
          (local.set $hl (enum.get $Token.punctuation.special))
          (if
            (i32.and
              (i32.and (i32.eqz (local.get $col)) (i32.eq (local.get $c) (local.get $c2)))
              (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "="))))
            (then
              (loop $run
                (if (i32.eq (call $templateByte (global.get $ptr)) (local.get $c))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $run))))
              (local.set $col (i32.const 3))
              (br $emit)))
          (local.set $hl (enum.get $Token.number))
          (if
            (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (byteset.get "+-" (local.get $c)) (i32.eq (local.get $c) (i32.const ".")))
                (call $lexIsDigit (local.get $c2))))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (byteset.get "+-" (local.get $c))))
              (call $lexScanNumber)
              (br $emit)))
          (local.set $hl (enum.get $Token.attribute))
          (if (i32.eq (local.get $c) (i32.const "@"))
            (then
              (call $scanIdentRun (i32.const "_"))
              (br $emit)))
          (local.set $hl (enum.get $Token.operator))
          (if (i32.eq (local.get $c) (i32.const "="))
            (then
              (if (i32.eq (local.get $col) (i32.const 2))
                (then
                  (local.set $col (i32.const 3))
                  ;; a string constant's value is the rest of the line, `#` included
                  (if (local.get $str)
                    (then
                      (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                      (local.set $lhs (call $lexSkipSpaceAt (global.get $ptr)))
                      (call $emitGap (global.get $ptr) (local.get $lhs))
                      (global.set $ptr (local.get $lhs))
                      (call $scanToLineEnd)
                      (local.set $hl (enum.get $Token.string))))))
              (br $emit)))
          (br_if $emit (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">"))))
          (local.set $hl (enum.get $Token.punctuation.bracket))
          (br_if $emit (byteset.get "()[]" (local.get $c)))
          (local.set $hl (enum.get $Token.punctuation.delimiter))
          (br_if $emit (i32.eq (local.get $c) (i32.const ",")))
          (local.set $hl (enum.get $Token.none))
          (global.set $ptr (local.get $lhs))
          (call $scanIdentRun (i32.const "/"))
          (local.set $n (i32.sub (global.get $ptr) (local.get $lhs)))
          (if (i32.eqz (local.get $n))
            (then
              (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
              (br $emit)))
          (if (i32.eqz (local.get $col))
            (then
              (if
                (i32.and
                  (i32.and (i32.eq (local.get $n) (i32.const 3)) (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":")))
                  (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "MSG")))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (local.set $hl (enum.get $Token.keyword))
                  (br $emit)))
              (local.set $g (keyword-table.value $rosmsgWords (local.get $lhs) (global.get $ptr)))
              (local.set $str (i32.ge_s (local.get $g) (i32.const 256)))
              (local.set $hl (select (enum.get $Token.type.builtin) (enum.get $Token.type) (i32.ge_s (local.get $g) (i32.const 0))))
              (local.set $col (i32.const 1))
              (br $emit)))
          (if (i32.eq (local.get $col) (i32.const 1))
            (then
              (local.set $col (i32.const 3))
              (local.set $hl (enum.get $Token.property))
              (if (i32.eq (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))) (i32.const "="))
                (then
                  (local.set $col (i32.const 2))
                  (local.set $hl (enum.get $Token.constant))))
              (br $emit)))
          ;; ROS 2 reads `true`, `True`, and `TRUE` alike
          (br_if $emit (i32.gt_u (i32.sub (local.get $n) (i32.const 4)) (i32.const 1)))
          (local.set $w
            (i64.and
              (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020))
              (i64.sub
                (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
                (i64.const 1))))
          (if (i32.or (i64.eq (local.get $w) (i64.const "true")) (i64.eq (local.get $w) (i64.const "false")))
            (then (local.set $hl (enum.get $Token.boolean)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
