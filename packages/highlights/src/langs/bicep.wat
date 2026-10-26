(module
  (import "../common.wat")

  ;; Bits 8 and up queue the next declaration words, four bits each: 1 a name, 2
  ;; a type, 3 a resource type string, 4 a type name, 5 a function name.
  (keyword-table $bicepWords $mem.bicepWords $mem.plsqlWords
    (group $Token.keyword.declaration+8448 "param" "output")
    (group $Token.keyword.declaration+12544 "resource" "module")
    (group $Token.keyword.declaration+256 "var" "metadata")
    (group $Token.keyword.declaration+1024 "type")
    (group $Token.keyword.declaration+1280 "func")
    (group $Token.keyword.import "import" "using" "extension" "extends" "from")
    (group $Token.keyword.control "for" "in" "if")
    (group $Token.keyword "existing" "targetScope" "assert" "with" "as")
    (group $Token.type.builtin "string" "int" "bool" "object" "array" "any")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null"))

  ;; Returns 1 past the closing quote, 2 past a `${`, 0 at a line break or $end.
  ;; $nested keeps `${` plain, so one depth suffices. Shared with gherkin.
  (func $bicepStringBody (param $q i32) (param $seg i32) (param $hl i32) (param $nested i32) (result i32)
    (local $c i32)
    (local $stop i32)
    (local $status i32)
    (block $done
      (loop $scan
        (local.set $stop
          (call $scanFindSpecial (global.get $ptr) (global.get $end) (local.get $q) (i32.const 1) (i32.const 1)))
        (global.set $ptr
          (call $scanFindSpecial (global.get $ptr) (local.get $stop) (i32.const "$") (i32.const 0) (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            ;; a backslash before a line break stays in the string, which ends there
            (local.set $c (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
            (if (byteset.get "\n\r" (local.get $c))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $done)))
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $seg (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $seg))
            (global.set $ptr (local.get $seg))
            (br $scan)))
        (br_if $done (i32.ne (local.get $c) (i32.const "$")))
        (if
          (i32.and
            (i32.eqz (local.get $nested))
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{")))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))
            (local.set $status (i32.const 2))
            (local.set $seg (global.get $ptr))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; $interp: braces open inside a `${`. $expect: queued declaration words.
  ;; $head: 1 at a line start or after `{` or `,`, where `name:` is a key.
  (func $hlBicep
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $pc i32)
    (local $g i32)
    (local $hl i32)
    (local $atHead i32)
    (local $interp i32)
    (local $expect i32)
    (local $head i32)
    (local $member i32)
    (local.set $head (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then (local.set $head (i32.const 1))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $atHead (local.get $head))
        (local.set $head (i32.const 0))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.preproc))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if
              (i32.and
                (i32.eq (local.get $c2) (i32.const 39))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 3)))
                (local.set $g (i32.const 0))
                (block $found
                  (loop $find
                    (global.set $ptr (call $lexFindByte (global.get $ptr) (i32.const 39)))
                    (br_if $found (i32.ge_u (global.get $ptr) (global.get $end)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br_if $find (i32.ne (call $templateByte (global.get $ptr)) (i32.const 39)))
                    (br_if $find
                      (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 39)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                    (local.set $g (i32.const 1))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (if (i32.eqz (local.get $g))
                  (then (call $streamSetFixed32 (i32.const 0x272727) (i32.const 3) (enum.get $Token.string))))
                (local.set $expect (i32.const 0))
                (br $next)))
            (local.set $hl
              (select
                (enum.get $Token.string.special)
                (enum.get $Token.string)
                (i32.eq (i32.and (local.get $expect) (i32.const 15)) (i32.const 3))))
            (local.set $expect (i32.shr_u (local.get $expect) (i32.const 4)))
            (if
              (i32.eq
                (call $bicepStringBody (i32.const 39) (local.get $lhs) (local.get $hl) (local.get $interp))
                (i32.const 2))
              (then (local.set $interp (i32.const 1))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "."))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $pc (call $templateByte (call $lexSkipSpaceAt (local.get $rhs))))
            (local.set $g (i32.and (local.get $expect) (i32.const 15)))
            (local.set $expect (i32.shr_u (local.get $expect) (i32.const 4)))
            (local.set $hl
              (select
                (enum.get $Token.function.definition)
                (select
                  (enum.get $Token.type)
                  (select (enum.get $Token.property) (enum.get $Token.variable) (local.get $member))
                  (i32.or (i32.eq (local.get $g) (i32.const 2)) (i32.eq (local.get $g) (i32.const 4))))
                (i32.eq (local.get $g) (i32.const 5))))
            (if (i32.and (local.get $atHead) (i32.eq (local.get $pc) (i32.const ":")))
              (then (local.set $hl (enum.get $Token.property)))
              (else
                (if (i32.eqz (local.get $member))
                  (then
                    (local.set $g (keyword-table.value $bicepWords (local.get $lhs) (local.get $rhs)))
                    (if (i32.ge_s (local.get $g) (i32.const 0))
                      (then
                        (local.set $hl (i32.and (local.get $g) (i32.const 255)))
                        (if (i32.gt_u (local.get $g) (i32.const 255))
                          (then (local.set $expect (i32.shr_u (local.get $g) (i32.const 8)))))))))))
            ;; not `if (...)` or a declared function's name
            (if
              (i32.and
                (i32.eq (local.get $pc) (i32.const "("))
                (i32.and
                  (i32.ne (local.get $hl) (enum.get $Token.keyword.control))
                  (i32.ne (local.get $hl) (enum.get $Token.function.definition))))
              (then (local.set $hl (enum.get $Token.function))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (local.set $member (i32.const 0))
        (local.set $expect (i32.const 0))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $head (i32.eq (local.get $c) (i32.const "{")))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        (call $emitTok
                          (enum.get $Token.punctuation.special)
                          (local.get $lhs)
                          (global.get $ptr))
                        (local.set $interp
                          (i32.eq
                            (call $bicepStringBody
                              (i32.const 39)
                              (global.get $ptr)
                              (enum.get $Token.string)
                              (i32.const 0))
                            (i32.const 2)))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
          (then
            (local.set $head (i32.eq (local.get $c) (i32.const ",")))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (local.set $member (i32.const 1))
            (if (i32.eq (local.get $c2) (i32.const "?"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!%&*+-/<=>?|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?|~" (local.get $c))))
                (br_if $opDone (i32.eq (local.get $c) (i32.const "/")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
