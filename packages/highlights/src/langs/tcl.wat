(module
  (import "../common.wat")

  ;; Bit 8: `proc`, whose next words are a definition and its parameters. Bit 9:
  ;; the next word names a variable. Bit 10: a keyword in any position.
  (keyword-table $tclWords $mem.tclWords $mem.vimlWords
    (group $Token.keyword.control
      "if" "while" "for" "foreach" "switch" "return" "break" "continue" "catch" "try" "throw"
      "error" "exit" "default")
    (group $Token.keyword.control+1024 "else" "elseif" "then" "finally")
    (group $Token.keyword.declaration+256 "proc" "method")
    (group $Token.keyword.declaration+512 "set" "variable" "global" "unset")
    (group $Token.keyword+512 "incr" "append" "lappend")
    (group $Token.keyword.import "package" "source")
    (group $Token.keyword
      "puts" "expr" "list" "lindex" "llength" "lrange" "lsearch" "lsort" "lreplace" "lset"
      "linsert" "lassign" "lmap" "concat" "join" "split" "string" "dict" "array" "regexp"
      "regsub" "format" "scan" "eval" "uplevel" "upvar" "namespace" "info" "rename" "open"
      "close" "gets" "read" "file" "exec" "after" "update" "vwait" "clock" "subst" "binary"
      "encoding" "chan" "flush" "glob" "pwd" "cd" "time" "trace" "apply" "interp")
    (group $Token.keyword.operator+1024 "eq" "ne" "in" "ni"))

  ;; Returns 0 and keeps $ptr when no name follows, so the `$` is literal.
  (func $tclVariable (result i32)
    (local $lhs i32)
    (local $c i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (global.set $ptr
          (call $scanFind3 (i32.add (local.get $lhs) (i32.const 2)) (i32.const "}") (i32.const 10) (i32.const 13)))
        (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "}"))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
        (return (i32.const 1))))
    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
    (call $tclScanName)
    (if (i32.eq (global.get $ptr) (i32.add (local.get $lhs) (i32.const 1)))
      (then
        (global.set $ptr (local.get $lhs))
        (return (i32.const 0))))
    (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
    (i32.const 1))

  ;; A lone `:` ends a name, so `"$code: failed"` keeps its colon.
  (func $tclScanName
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "_"))
        (br_if $done (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
        (br_if $done
          (i32.ne (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ":")))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (br $l))))

  ;; Returns 0 past the closing quote, 1 at a `[` command, 2 at $end. A search
  ;; result is reused until $ptr passes it, so a body is scanned once.
  (func $tclStringBody (param $seg i32) (result i32)
    (local $a i32)
    (local $b i32)
    (local $p i32)
    (local $c i32)
    (block $done
      (loop $l
        (if (i32.lt_u (local.get $a) (global.get $ptr))
          (then
            (local.set $a (call $scanFind3 (global.get $ptr) (i32.const 34) (i32.const 92) (i32.const "$")))))
        (if (i32.lt_u (local.get $b) (global.get $ptr))
          (then
            (local.set $b (call $lexFindEither (global.get $ptr) (i32.const "[") (i32.const 34)))))
        (local.set $p (select (local.get $a) (local.get $b) (i32.lt_u (local.get $a) (local.get $b))))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 0))))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (call $lexCEscapeEnd (local.get $p)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr)))
          (else
            (if (i32.eqz (call $tclVariable))
              (then (global.set $ptr (i32.add (local.get $p) (i32.const 1)))))))
        (local.set $seg (select (global.get $ptr) (local.get $p) (i32.ne (local.get $c) (i32.const "$"))))
        (if (i32.gt_u (global.get $ptr) (i32.add (local.get $p) (i32.const 1)))
          (then (local.set $seg (global.get $ptr))))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 2))

  ;; $pos: 0 at a command start, 1 among arguments, 2 inside a `{` with no blank
  ;; after it (maybe data: only built-ins are colored). $expect: 1 a `proc` name,
  ;; 2 its parameters, 3 a variable name. $bits holds, per open `[`, whether it
  ;; opened inside a quoted word, so its `]` can return to the string.
  (func $hlTcl
    (local $c i32)
    (local $gap i32)
    (local $lhs i32)
    (local $v i32)
    (local $hl i32)
    (local $e i32)
    (local $pos i32)
    (local $expect i32)
    (local $param i32)
    (local $inStr i32)
    (local $depth i32)
    (local $bits i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $inStr)
          (then
            (local.set $v (call $tclStringBody (global.get $ptr)))
            (br_if $done (i32.eq (local.get $v) (i32.const 2)))
            (local.set $inStr (i32.const 0))
            (if (local.get $v)
              (then
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (local.set $bits (i32.or (i32.shl (local.get $bits) (i32.const 1)) (i32.const 1)))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (local.set $pos (i32.const 0))))
            (br $next)))
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
        (local.set $e (local.get $expect))
        (local.set $expect (i32.const 0))
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.ne (local.get $pos) (i32.const 1)))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (local.set $hl (local.get $pos))
        (local.set $pos (i32.const 1))
        ;; a quote opens a quoted word only at the start of a word
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $v (i32.const 0))
            (if (i32.gt_u (local.get $lhs) (global.get $srcBase))
              (then (local.set $v (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))))))
            (if (i32.eqz (call $lexIsIdentContinue (local.get $v)))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $inStr (i32.const 1))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then (br_if $next (call $tclVariable))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (global.set $ptr (call $lexCEscapeEnd (local.get $lhs)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $v (call $templateByte (global.get $ptr)))
        (if (i32.or
              (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
              (i32.or
                (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $v) (i32.const ":")))
                (i32.and
                  (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "-")))
                  (i32.and (call $lexIsIdentStart (local.get $v)) (i32.ne (local.get $v) (i32.const "$"))))))
          (then
            (global.set $ptr (local.get $lhs))
            (if (i32.eq (local.get $c) (i32.const "-"))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))))
            (block $wordDone
              (loop $word
                (call $tclScanName)
                (br_if $wordDone (i32.ne (call $templateByte (global.get $ptr)) (i32.const ".")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $word)))
            (local.set $v (keyword-table.value $tclWords (local.get $lhs) (global.get $ptr)))
            (if (i32.and (i32.eq (local.get $hl) (i32.const 1)) (i32.eqz (i32.and (local.get $v) (i32.const 1024))))
              (then (local.set $v (i32.const -1))))
            (local.set $hl
              (select
                (enum.get $Token.function)
                (enum.get $Token.none)
                (i32.and (i32.eqz (local.get $hl)) (i32.ne (local.get $c) (i32.const "-")))))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $v) (i32.const 255)))
                (if (i32.and (local.get $v) (i32.const 256))
                  (then (local.set $expect (i32.const 1))))
                (if (i32.and (local.get $v) (i32.const 512))
                  (then (local.set $expect (i32.const 3))))))
            (if (local.get $e)
              (then
                (local.set $hl (enum.get $Token.variable))
                (if (i32.eq (local.get $e) (i32.const 1))
                  (then
                    (local.set $hl (enum.get $Token.function.definition))
                    (local.set $expect (i32.const 2))))
                (if (i32.eq (local.get $e) (i32.const 2))
                  (then (local.set $hl (enum.get $Token.variable.parameter))))))
            (if (local.get $param)
              (then (local.set $hl (enum.get $Token.variable.parameter))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then
                (local.set $bits (i32.shl (local.get $bits) (i32.const 1)))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (local.set $pos (i32.const 0))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "]")) (i32.ne (local.get $depth) (i32.const 0)))
              (then
                (local.set $inStr (i32.and (local.get $bits) (i32.const 1)))
                (local.set $bits (i32.shr_u (local.get $bits) (i32.const 1)))
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (if (i32.or (local.get $param) (i32.eq (local.get $e) (i32.const 2)))
                  (then (local.set $param (i32.add (local.get $param) (i32.const 1))))
                  (else
                    ;; a blank after the brace marks a script body
                    (local.set $pos
                      (select
                        (i32.const 0)
                        (i32.const 2)
                        (i32.or (i32.eqz (local.get $v)) (call $lexIsSpace (local.get $v)))))))))
            (if (i32.and (i32.eq (local.get $c) (i32.const "}")) (i32.ne (local.get $param) (i32.const 0)))
              (then (local.set $param (i32.sub (local.get $param) (i32.const 1)))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $pos (i32.const 0))
            (br $next)))
        (if (byteset.get "!%&*+-/:<=>?^|~" (local.get $c))
          (then
            (block $opDone
              (loop $op
                (local.set $v (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/:<=>?^|~" (local.get $v))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
