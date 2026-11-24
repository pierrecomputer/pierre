(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.nsisWords 256)

  (import "@pierre/wat-tools/common.wat")

  ;; Words are looked up lowercase. The high byte names the kind of the next
  ;; word: 1 a function definition, 2 a function, 3 a label, 4 a variable,
  ;; 5 a define. Preprocessor words count only after `!`, and LogicLib words
  ;; (6) only inside `${...}`.
  (keyword-table $nsisWords $mem.nsisWords $mem.nsisWords+256
    (group $Token.keyword.declaration
      "section" "sectionend" "sectiongroup" "sectiongroupend" "functionend" "pageex" "pageexend")
    (group $Token.keyword.declaration+256 "function")
    (group $Token.keyword.declaration+1024 "var")
    (group $Token.keyword.control+768 "goto")
    (group $Token.keyword.control+512 "call")
    (group $Token.keyword.control "return" "abort" "quit")
    (group $Token.keyword.control+1536
      "if" "elseif" "else" "endif" "unless" "andif" "orif" "while"
      "endwhile" "do" "loop" "loopuntil" "loopwhile" "dowhile" "dountil" "for" "foreach" "next"
      "exitfor" "exitdo" "exitwhile" "break" "continue" "select" "case" "caseelse" "endselect"
      "switch" "default" "endswitch")
    (group $Token.preproc+1280 "define" "undef" "ifdef" "ifndef")
    (group $Token.preproc+256 "macro")
    (group $Token.preproc+512 "insertmacro"))

  (func $nsisLookup (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (keyword-table.value $nsisWords (i32.const $mem.lexLowerScratch)
      (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))

  ;; The end of the `$` form at $p: `$\n` and `$$` escapes, `${define}`,
  ;; `$(langstring)`, or `$name`. A lone `$` ends at $p + 1.
  (func $nsisDollarEnd (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "(")))
      (then
        ;; the closing byte: `{` + 2 is `}`, `(` + 1 is `)`
        (local.set $c (i32.add (local.get $c) (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "{")))))
        (local.set $p
          (call $scanFind3 (i32.add (local.get $p) (i32.const 2)) (local.get $c) (i32.const 10) (i32.const 13)))
        (return (i32.add (local.get $p) (i32.eq (call $templateByte (local.get $p)) (local.get $c))))))
    (if (i32.eq (local.get $c) (i32.const "$"))
      (then (return (i32.add (local.get $p) (i32.const 2)))))
    (if (i32.eq (local.get $c) (i32.const 92))
      (then
        (local.set $c (call $templateByte (i32.add (local.get $p) (i32.const 2))))
        (return (i32.add (local.get $p)
          (select (i32.const 3) (i32.const 1) (byteset.get "\22'`nrt" (local.get $c)))))))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (call $scanIdentRun (i32.const "_"))
    (global.get $ptr))

  ;; The kind of the `$` form [$p,$e) outside `${...}` names.
  (func $nsisDollarKind (param $p i32) (result i32)
    (local $c i32)
    (local.set $c (i32.load8_u offset=1 (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const 92)) (i32.eq (local.get $c) (i32.const "$")))
      (then (return (enum.get $Token.string.escape))))
    (select (enum.get $Token.constant) (enum.get $Token.variable) (i32.eq (local.get $c) (i32.const "(")))
  )

  ;; A one-line string in any of the three quotes, with `$` forms inside.
  (func $nsisString
    (local $q i32)
    (local $seg i32)
    (local $p i32)
    (local $e i32)
    (local.set $seg (global.get $ptr))
    (local.set $q (i32.load8_u (local.get $seg)))
    (global.set $ptr (i32.add (local.get $seg) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $scanFind3 (global.get $ptr) (local.get $q) (i32.const "$") (i32.const 10)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (local.get $q))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (br $done)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const 10))
          (then
            ;; leave the CR of a CRLF out of the string
            (global.set $ptr (i32.sub (local.get $p)
              (i32.and (i32.gt_u (local.get $p) (local.get $seg))
                (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 13)))))
            (br $done)))
        (local.set $e (call $nsisDollarEnd (local.get $p)))
        (if (i32.gt_u (local.get $e) (i32.add (local.get $p) (i32.const 1)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (call $emitTok
              (select (enum.get $Token.constant) (call $nsisDollarKind (local.get $p))
                (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "{")))
              (local.get $p) (local.get $e))
            (local.set $seg (local.get $e))))
        (global.set $ptr (local.get $e))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  ;; $pos is 0 at a statement start. $expect holds the kind code of the next
  ;; word (see $nsisWords). A `\` before a line break consumes the break, so
  ;; the next line continues the statement.
  (func $hlNsis
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $gap i32)
    (local $v i32)
    (local $hl i32)
    (local $pos i32)
    (local $expect i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $pos (i32.const 0))
            (local.set $expect (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (byteset.get ";#" (local.get $c))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 92)) (byteset.get "\0a\0d" (local.get $c2)))
          (then
            (global.set $ptr (call $lexEscapeEnd (local.get $lhs)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitGap (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr))
            (br $next)))
        (local.set $hl (local.get $pos))
        (local.set $pos (i32.const 1))
        (if (byteset.get "\22'`" (local.get $c))
          (then
            (call $nsisString)
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (call $nsisDollarEnd (local.get $lhs)))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (local.set $v (call $nsisLookup (i32.add (local.get $lhs) (i32.const 2))
                  (i32.sub (global.get $ptr) (i32.eq (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const "}")))))
                (local.set $hl
                  (select
                    (enum.get $Token.keyword.control)
                    (select (enum.get $Token.constant) (enum.get $Token.function) (local.get $hl))
                    (i32.eq (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.keyword.control)))))
              (else
                (local.set $hl
                  (select (call $nsisDollarKind (local.get $lhs)) (enum.get $Token.none)
                    (i32.gt_u (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (call $lexIsNameStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok (enum.get $Token.variable.parameter) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "!")) (call $lexIsNameStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (local.set $v (call $nsisLookup (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr)))
            (if (i32.eq (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.preproc))
              (then (local.set $expect (i32.shr_u (local.get $v) (i32.const 8)))))
            (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.or (call $lexIsNameStart (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsNameStart (local.get $c2))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "."))
            (if (local.get $expect)
              (then
                (local.set $hl
                  (select (enum.get $Token.function.definition)
                    (select (enum.get $Token.function)
                      (select (enum.get $Token.label)
                        (select (enum.get $Token.variable) (enum.get $Token.constant)
                          (i32.eq (local.get $expect) (i32.const 4)))
                        (i32.eq (local.get $expect) (i32.const 3)))
                      (i32.eq (local.get $expect) (i32.const 2)))
                    (i32.eq (local.get $expect) (i32.const 1))))
                (local.set $expect (i32.const 0)))
              (else
                (if (local.get $hl)
                  (then
                    (local.set $hl
                      (select (enum.get $Token.constant) (enum.get $Token.none)
                        (call $lexIsConstCase (local.get $lhs) (global.get $ptr)))))
                  (else
                    (local.set $hl (enum.get $Token.function))
                    (local.set $c2 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                    (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const ":"))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        ;; a plug-in call `nsExec::Exec`, or a label
                        (if (i32.eq (local.get $c2) (i32.const ":"))
                          (then
                            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                            (call $scanIdentRun (i32.const "_")))
                          (else
                            (local.set $hl (enum.get $Token.label))
                            (local.set $pos (i32.const 0)))))
                      (else
                        (local.set $v (call $nsisLookup (local.get $lhs) (global.get $ptr)))
                        (if (i32.and (i32.ge_s (local.get $v) (i32.const 0))
                              (i32.and (i32.ne (i32.and (local.get $v) (i32.const 255)) (enum.get $Token.preproc))
                                (i32.lt_u (local.get $v) (i32.const 1536))))
                          (then
                            (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                            (local.set $expect (i32.shr_u (local.get $v) (i32.const 8)))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]{}" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.bracket))))
        (if (byteset.get "!%&*+-/:<=>?^|~" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/:<=>?^|~" (local.get $c))))
                (br_if $opDone (i32.eq (local.get $c) (i32.const "/")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
