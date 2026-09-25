(module
  (import "../common.wat")

  (func $protoByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Each value is the token in the low byte and the next-name capture
  ;; above it: 1 type, 2 function, 3 namespace. `required` and `reserved`
  ;; are absent on purpose: the table hash sees only the first two bytes,
  ;; the last byte, and the length, which `repeated` shares, so
  ;; $protoWordHl matches both directly.
  (keyword-table $protoWords $mem.protoWords $mem.pythonWords
    (group $Token.keyword.declaration+256 "enum" "extend" "message" "service")
    (group $Token.keyword.declaration+512 "rpc")
    (group $Token.keyword.declaration+768 "package")
    (group $Token.keyword.import "import")
    (group $Token.keyword
      "to" "map" "max" "weak" "group" "oneof" "syntax" "option" "public" "stream" "edition"
      "returns" "optional" "repeated" "extensions")
    (group $Token.type.builtin
      "bool" "bytes" "float" "int32" "int64" "double" "string" "sint32" "sint64" "uint32" "uint64"
      "fixed32" "fixed64" "sfixed32" "sfixed64")
    (group $Token.boolean "true" "false"))

  ;; The table value of [lhs,rhs), or -1 for an ordinary identifier.
  (func $protoWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $w i64)
    (local.set $g (keyword-table.value $protoWords (local.get $lhs) (local.get $rhs)))
    (if (i32.lt_s (local.get $g) (i32.const 0))
      (then
        ;; the two words the table cannot hold; the wide load stays inside
        ;; the input slack, as in the table's own compare
        (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 8))
          (then
            (local.set $w (i64.load (local.get $lhs)))
            (if
              (i32.or
                (i64.eq (local.get $w) (i64.const "required"))
                (i64.eq (local.get $w) (i64.const "reserved")))
              (then (return (enum.get $Token.keyword))))))))
    (local.get $g))

  ;; $expect is the pending next-name capture from $protoWordHl and $member
  ;; is 1 after `.`, where a lowercase name is a package segment and a
  ;; capitalized one a message type. A name before `=` is a field or option
  ;; name, one in SCREAMING_CASE an enum value.
  (func $hlProto
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $protoByte (i32.add (global.get $ptr) (i32.const 1))))

        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; the byte after the name and its blanks
            (local.set $c2 (call $protoByte (local.get $p)))
            (local.set $kind
              (select
                (i32.const -1)
                (call $protoWordHl (local.get $lhs) (local.get $rhs))
                (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))
              (else
                (if (local.get $expect)
                  (then
                    (local.set $hl
                      (select
                        (enum.get $Token.type)
                        (select
                          (enum.get $Token.function.definition)
                          (enum.get $Token.namespace)
                          (i32.eq (local.get $expect) (i32.const 2)))
                        (i32.eq (local.get $expect) (i32.const 1))))
                    ;; a dotted package keeps its capture
                    (if
                      (i32.or
                        (i32.ne (local.get $expect) (i32.const 3))
                        (i32.ne (local.get $c2) (i32.const ".")))
                      (then (local.set $expect (i32.const 0)))))
                  (else
                    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                      (then (local.set $hl (enum.get $Token.constant)))
                      (else
                        (if (i32.eq (local.get $c2) (i32.const "="))
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if
                              (i32.le_u
                                (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                                (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type)))
                              (else
                                (local.set $hl
                                  (select
                                    (enum.get $Token.namespace)
                                    (enum.get $Token.variable)
                                    (i32.or
                                      (local.get $member)
                                      (i32.eq
                                        (local.get $c2)
                                        (i32.const ".")))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and
              (i32.or
                (i32.eq (local.get $c) (i32.const "-"))
                (i32.eq (local.get $c) (i32.const "+")))
              (call $lexIsDigit (local.get $c2))))
          (then
            (if (i32.eqz (call $lexIsDigit (local.get $c)))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()<>[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
            (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
