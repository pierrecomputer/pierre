(module
  (import "../common.wat")

  ;; Lowercase words. Bits 8-9 capture the next word: 1 a paragraph after
  ;; PERFORM, THRU, or GO TO, 3 a PIC string. Bit 10 (IS, TO) keeps a capture
  ;; armed. `than`, `indexed`, and `returning` collide and are matched directly.
  (keyword-table $cobolWords $mem.cobolWords $mem.adaWords
    (group $Token.keyword.control
      "if" "else" "evaluate" "when" "other" "until" "varying" "stop" "run" "exit" "goback"
      "continue" "next" "sentence" "call" "then" "invalid")
    (group $Token.keyword.control+256 "perform" "thru" "through" "go")
    (group $Token.keyword.declaration+256 "function")
    (group $Token.keyword.declaration+768 "pic" "picture")
    (group $Token.keyword.declaration
      "identification" "id" "environment" "data" "procedure" "division" "section" "configuration"
      "input-output" "file-control" "working-storage" "local-storage" "linkage" "file" "fd" "sd"
      "screen" "program-id" "author" "date-written" "source-computer" "object-computer"
      "special-names" "select" "assign" "organization" "access" "record" "key" "status" "copy"
      "filler" "redefines" "occurs" "depending" "value" "values" "usage" "external" "global"
      "ascending" "descending" "program" "sequential" "random" "dynamic")
    (group $Token.keyword
      "exec" "move" "add" "subtract" "multiply" "divide" "compute" "display" "accept" "open" "close"
      "read" "write" "rewrite" "delete" "start" "return" "sort" "merge" "string" "unstring"
      "inspect" "initialize" "set" "search" "tallying" "replacing" "converting" "delimited" "by"
      "size" "pointer" "into" "from" "giving" "remainder" "rounded" "on" "error" "overflow"
      "exception" "using" "reference" "content" "input" "output" "extend" "i-o" "with" "no"
      "advancing" "after" "before" "page" "upon" "counting" "initial" "characters" "for" "of" "in"
      "are" "equal" "greater" "less" "line" "lines" "end" "corresponding" "times" "leading"
      "trailing")
    (group $Token.keyword+1024 "is" "to")
    (group $Token.keyword.operator "and" "or" "not")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin
      "zero" "zeros" "zeroes" "space" "spaces" "high-value" "high-values" "low-value" "low-values"
      "quote" "quotes" "null" "nulls" "all")
    (group $Token.type.builtin
      "binary" "comp" "comp-3" "comp-5" "computational" "packed-decimal" "index"))

  (func $cobolWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $v i32)
    (local $w i64)
    (local.set $n
      (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (local.set $v
      (keyword-table.value $cobolWords
        (i32.const $mem.lexLowerScratch)
        (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
    (if (i32.ge_s (local.get $v) (i32.const 0))
      (then (return (local.get $v))))
    (local.set $w (i64.load (i32.const $mem.lexLowerScratch)))
    ;; `END-OF-FILE` is a name
    (if
      (i32.and
        (i32.gt_u (local.get $n) (i32.const 4))
        (i32.eq (i32.wrap_i64 (local.get $w)) (i32.const "end-")))
      (then
        (local.set $v
          (i32.and
            (keyword-table.value $cobolWords
              (i32.const $mem.lexLowerScratch+4)
              (i32.add (i32.const $mem.lexLowerScratch) (local.get $n)))
            (i32.const 255)))
        (if
          (i32.or
            (i32.eq (local.get $v) (enum.get $Token.keyword))
            (i32.eq (local.get $v) (enum.get $Token.keyword.control)))
          (then (return (enum.get $Token.keyword.control))))
        (return (i32.const -1))))
    (if
      (i32.or
        (i32.and (i32.eq (local.get $n) (i32.const 4)) (i32.eq (i32.wrap_i64 (local.get $w)) (i32.const "than")))
        (i32.and
          (i32.eq (local.get $n) (i32.const 9))
          (i32.and
            (i64.eq (local.get $w) (i64.const "returnin"))
            (i32.eq (i32.load8_u (i32.const $mem.lexLowerScratch+8)) (i32.const "g")))))
      (then (return (enum.get $Token.keyword))))
    (if
      (i32.and
        (i32.eq (local.get $n) (i32.const 7))
        (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "indexed")))
      (then (return (enum.get $Token.keyword.declaration))))
    (i32.const -1))

  ;; A line is fixed format when columns 1-6 hold digits or blanks and column 7
  ;; an indicator; then columns 1-6 and 73+ are comments. $col: 0 at a line
  ;; start, 1 before a first token in area A, 2 else. $area: the end of the
  ;; fixed-format code area, or 0.
  (func $hlCobol
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $n i32)
    (local $kind i32)
    (local $hl i32)
    (local $lim i32)
    (local $outer i32)
    (local $want i32)
    (local $first i32)
    (local $col i32)
    (local $area i32)
    (local $expect i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (i32.and (i32.ne (local.get $area) (i32.const 0)) (i32.ge_u (global.get $ptr) (local.get $area)))
          (then
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (call $lexLineComment (i32.const 0) (enum.get $Token.comment))
            (local.set $area (i32.const 0))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (byteset.get "\n\r" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (local.set $col (i32.const 0))
            (local.set $area (i32.const 0))
            (br $next)))

        (if (i32.eqz (local.get $col))
          (then
            (local.set $p (local.get $lhs))
            (local.set $n (i32.const 0))
            (block $free
              (loop $sequence
                (local.set $c2 (call $templateByte (local.get $p)))
                (br_if $free
                  (i32.eqz (i32.or (i32.eq (local.get $c2) (i32.const 32)) (call $lexIsDigit (local.get $c2)))))
                (local.set $n (i32.or (local.get $n) (i32.ne (local.get $c2) (i32.const 32))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $sequence (i32.lt_u (local.get $p) (i32.add (local.get $lhs) (i32.const 6)))))
              (local.set $c2 (call $templateByte (local.get $p)))
              (br_if $free (i32.eqz (byteset.get " *-/Dd" (local.get $c2))))
              (br_if $free
                (i32.and
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "d"))
                  (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const 32))))
              (if (local.get $n)
                (then (call $emitTok (enum.get $Token.comment) (local.get $lhs) (local.get $p)))
                (else (call $emitGap (local.get $lhs) (local.get $p))))
              (global.set $ptr (local.get $p))
              (if (i32.or (i32.eq (local.get $c2) (i32.const "*")) (i32.eq (local.get $c2) (i32.const "/")))
                (then
                  (call $lexLineComment (i32.const 0) (enum.get $Token.comment))
                  (local.set $col (i32.const 2))
                  (br $next)))
              (local.set $area (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 72)) (global.get $end)))
              (if (i32.ne (local.get $c2) (i32.const 32))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok
                    (select (enum.get $Token.operator) (enum.get $Token.preproc) (i32.eq (local.get $c2) (i32.const "-")))
                    (local.get $p)
                    (global.get $ptr))))
              ;; a continuation line has no area A
              (local.set $col
                (select
                  (i32.const 1)
                  (i32.const 2)
                  (i32.and
                    (i32.ne (local.get $c2) (i32.const "-"))
                    (i32.le_u
                      (i32.sub (call $lexSkipSpaceAt (global.get $ptr)) (local.get $lhs))
                      (i32.const 10)))))
              (br $next))
            (local.set $col
              (select
                (i32.const 1)
                (i32.const 2)
                (i32.le_u (i32.sub (call $lexSkipSpaceAt (local.get $lhs)) (local.get $lhs)) (i32.const 3))))))

        (if (call $lexIsSpace (local.get $c))
          (then
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (if (i32.eq (global.get $ptr) (local.get $lhs))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br $next)))

        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $lim (select (local.get $area) (global.get $end) (local.get $area)))
        (local.set $first (i32.eq (local.get $col) (i32.const 1)))
        (local.set $col (i32.const 2))
        (local.set $want (local.get $expect))
        (local.set $expect (i32.const 0))

        (if
          (i32.or
            (i32.and (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c2) (i32.const ">")))
            (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c2) (i32.const ">"))))
          (then
            (call $lexLineComment
              (i32.const 2)
              (select (enum.get $Token.comment) (enum.get $Token.preproc) (i32.eq (local.get $c) (i32.const "*"))))
            (local.set $expect (local.get $want))
            (br $next)))

        ;; a period, comma, or semicolon after a PIC string is a separator
        (if
          (i32.and
            (i32.eq (local.get $want) (i32.const 3))
            (i32.eqz
              (i32.and
                (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "i"))
                (i32.and
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "s"))
                  (call $lexIsSpace (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))))))
          (then
            (block $picDone
              (loop $pic
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br_if $picDone (i32.ge_u (global.get $ptr) (local.get $lim)))
                (br_if $pic (i32.eqz (call $lexIsSpace (i32.load8_u (global.get $ptr)))))))
            (local.set $c (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
            (if
              (i32.and
                (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
                (byteset.get ",.:;" (local.get $c)))
              (then (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $outer (global.get $end))
            (global.set $end (local.get $lim))
            (call $lexRawString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (global.set $end (local.get $outer))
            (br $next)))

        ;; a hyphen joins a digit run to a name; not after a leading `.`, or the name
        ;; scan would not advance
        (local.set $n (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$"))))
        (if (i32.or (call $lexIsDigit (local.get $c)) (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (local.set $n
              (i32.and
                (call $lexIsDigit (local.get $c))
                (i32.and
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "-"))
                  (call $lexIsIdentContinue (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))))
            (if (i32.eqz (local.get $n))
              (then
                (global.set $ptr (select (local.get $lim) (global.get $ptr) (i32.gt_u (global.get $ptr) (local.get $lim))))
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (br $next)))))

        (if (local.get $n)
          (then
            (global.set $ptr (local.get $lhs))
            (call $scanIdentRun (i32.const "-"))
            (global.set $ptr (select (local.get $lim) (global.get $ptr) (i32.gt_u (global.get $ptr) (local.get $lim))))
            ;; a name never ends with a hyphen: `A -` is a subtraction
            (block $trimmed
              (loop $trim
                (br_if $trimmed (i32.le_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1))))
                (br_if $trimmed (i32.ne (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "-")))
                (global.set $ptr (i32.sub (global.get $ptr) (i32.const 1)))
                (br $trim)))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (if
              (i32.and
                (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1)))
                (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (local.set $outer (global.get $end))
                (global.set $end (local.get $lim))
                (call $lexRawString (local.get $c2) (i32.const 0) (enum.get $Token.string))
                (global.set $end (local.get $outer))
                (br $next)))
            (local.set $kind (call $cobolWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $expect
                  (select
                    (local.get $want)
                    (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 3))
                    (i32.and (local.get $kind) (i32.const 1024)))))
              (else
                (local.set $hl (enum.get $Token.variable))
                (if (local.get $want)
                  (then (local.set $hl (enum.get $Token.function))))
                (if (local.get $first)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                    (if
                      (i32.or
                        (i32.eq (local.get $c2) (i32.const "."))
                        (i32.and
                          (i32.le_u (i32.add (local.get $p) (i32.const 7)) (local.get $lim))
                          (i64.eq
                            (i64.and
                              (i64.or (i64.load (local.get $p)) (i64.const 0x2020202020202020))
                              (i64.const 0xffffffffffffff))
                            (i64.const "section"))))
                      (then (local.set $hl (enum.get $Token.function.definition))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (byteset.get ",.:;" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "+-*/=<>&%" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            ;; never the start of a `*>` comment
            (local.set $p (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
            (if
              (i32.and
                (byteset.get "+-*/=<>&%" (local.get $c2))
                (i32.eqz (i32.and (i32.eq (local.get $c2) (i32.const "*")) (i32.eq (local.get $p) (i32.const ">")))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (local.get $lim)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
