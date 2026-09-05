(module
  (import "../common.wat")

  (func $matByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlMatlab. The high byte of a
  ;; declaration value names what follows: 1 a function head, 2 a class name.
  (keyword-table $matlabWords $mem.matlabWords $mem.matlabWords+384
    (group $Token.keyword.control ;; 1: control flow and block ends
      "if" "elseif" "else" "end" "for" "parfor" "while" "switch" "case"
      "otherwise" "break" "continue" "return" "try" "catch" "spmd")
    (group $Token.keyword.declaration+256 "function") ;; 2
    (group $Token.keyword.declaration+512 "classdef") ;; 3
    (group $Token.keyword.declaration ;; 4: class sections and storage
      "properties" "methods" "events" "enumeration" "arguments" "global"
      "persistent")
    (group $Token.keyword.import "import")   ;; 5
    (group $Token.boolean "true" "false")    ;; 6
    (group $Token.constant.builtin ;; 7
      "pi" "Inf" "inf" "NaN" "nan" "eps" "NaT"))

  ;; Token in the low byte and the head capture in the high byte, or -1 for
  ;; an ordinary name.
  (func $matWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $matlabWords (local.get $lhs) (local.get $rhs)))

  ;; Whether only blanks separate $p from the end of its line.
  (func $matRestBlank (param $p i32) (result i32)
    (local $c i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (local.set $c (call $matByte (local.get $p)))
    (i32.or
      (i32.ge_u (local.get $p) (global.get $end))
      (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))))

  ;; A `%{` block comment whose opener sits alone on its line at $ptr. It
  ;; runs through the line holding a lone `%}`; an unterminated body runs to
  ;; $end and, in streaming, checkpoints the closer so the next chunk keeps
  ;; looking for it.
  (func $matBlockComment
    (local $lhs i32) (local $line i32) (local $p i32)
    (local.set $lhs (global.get $ptr))
    (call $scanToLineEnd)
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        ;; step over the break, then test the next line
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $line (call $lexSkipSpaceAt (global.get $ptr)))
        (if (i32.and
              (i32.eq (call $matByte (local.get $line)) (i32.const "%"))
              (i32.and
                (i32.eq (call $matByte (i32.add (local.get $line) (i32.const 1))) (i32.const "}"))
                (call $matRestBlank (i32.add (local.get $line) (i32.const 2)))))
          (then
            (global.set $ptr (i32.add (local.get $line) (i32.const 2)))
            (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
            (return)))
        (call $scanToLineEnd)
        (br $lines)))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
    (i32.store16 (i32.const $mem.streamDelimiter) (i32.const "%}"))
    (call $streamSetLine
      (i32.const $mem.streamDelimiter) (i32.const 2) (i32.const 2)
      (enum.get $Token.comment)))

  ;; A quoted text or char array from $ptr: a doubled quote escapes itself,
  ;; and the literal ends at the quote or the line break.
  (func $matQuoted (param $q i32)
    (local $seg i32) (local $p i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $p (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $q) (i32.const 0) (i32.const 1)))
        (global.set $ptr (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (local.get $p)) (local.get $q)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br_if $done (i32.ne (call $matByte (global.get $ptr)) (local.get $q)))
        (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
        (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
        (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
        (local.set $seg (global.get $ptr))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  (func $matIsOp (param $c i32) (result i32)
    (byteset.get "!&*+-/:<=>\5c^|~" (local.get $c)))

  ;; $fnHead is 1 after `function`, where the names are outputs until one
  ;; is followed by `(` or ends the head, and 2 after that name, waiting
  ;; for its `(`; $fnOut is 1 inside the `[a, b]` output list. $paren counts
  ;; open parentheses and $fnDepth is the depth of a parameter list, where
  ;; bare names are parameters. $afterValue is 1 after a value, where a `'`
  ;; glued to it is the transpose operator rather than a char array.
  ;; $lineHead is 1 before the first token of a line, where `%{` alone
  ;; opens a block comment. $member is 1 after `.`. All are checkpointed.
  (func $hlMatlab
    (local $c i32) (local $c2 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32) (local $pc i32)
    (local $kind i32) (local $hl i32)
    (local $fnHead i32) (local $fnOut i32) (local $paren i32) (local $fnDepth i32)
    (local $afterValue i32) (local $lineHead i32) (local $member i32) (local $atHead i32)
    (local $classLine i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break ends a statement and a function head
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $lineHead (i32.const 1))
            (local.set $afterValue (i32.const 0))
            (local.set $fnHead (i32.const 0))
            (local.set $fnOut (i32.const 0))
            (local.set $classLine (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $matByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $atHead (local.get $lineHead))
        (local.set $lineHead (i32.const 0))

        ;; `%{` alone on a line opens a block comment; any other `%` comments
        ;; out the rest of the line
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (if (i32.and
                  (i32.and (local.get $atHead) (i32.eq (local.get $c2) (i32.const "{")))
                  (call $matRestBlank (i32.add (global.get $ptr) (i32.const 2))))
              (then (call $matBlockComment))
              (else (call $lexLineComment (i32.const 1) (enum.get $Token.comment))))
            (br $next)))
        ;; `...` continues the statement; the rest of the line is a comment
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "."))
              (i32.and
                (i32.eq (local.get $c2) (i32.const "."))
                (i32.eq (call $matByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "."))))
          (then
            (call $lexLineComment (i32.const 3) (enum.get $Token.comment))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $matQuoted (i32.const 34))
            (local.set $afterValue (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `'` glued to a value transposes it; elsewhere it opens a char array
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (if (i32.and (local.get $afterValue) (i32.eq (local.get $gap) (local.get $lhs)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr)))
              (else (call $matQuoted (i32.const 39))))
            (local.set $afterValue (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `@(x) ...` anonymous functions and `@name` handles
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c2) (i32.const "("))
              (then (local.set $fnHead (i32.const 2))))
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (local.set $lhs (global.get $ptr))
                (call $scanIdentRun (i32.const "."))
                (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))))
            (local.set $afterValue (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $matByte (local.get $p)))
            (local.set $kind (select (i32.const -1)
              (call $matWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.eq (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 1))
                  (then (local.set $fnHead (i32.const 1))))
                ;; `classdef Name < Base`: the names on the line are types
                (if (i32.eq (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 2))
                  (then (local.set $classLine (i32.const 1))))
                ;; `end` inside an index is a value
                (local.set $afterValue (i32.or
                  (i32.or
                    (i32.eq (local.get $hl) (enum.get $Token.boolean))
                    (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                    (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "end"))))))
              (else
                (local.set $afterValue (i32.const 1))
                (if (local.get $member)
                  (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                    (i32.eq (local.get $pc) (i32.const "(")))))
                  (else
                    (if (i32.eq (local.get $fnHead) (i32.const 1))
                      (then
                        ;; `function [a, b] = name(x)`: outputs, then the name
                        (if (i32.or (local.get $fnOut) (i32.eq (local.get $pc) (i32.const "=")))
                          (then (local.set $hl (enum.get $Token.variable)))
                          (else
                            (local.set $hl (enum.get $Token.function.definition))
                            (local.set $fnHead (i32.const 2)))))
                      (else
                        (if (i32.and
                              (i32.ne (local.get $fnDepth) (i32.const 0))
                              (i32.eq (local.get $paren) (local.get $fnDepth)))
                          (then (local.set $hl (enum.get $Token.variable.parameter)))
                          (else
                            (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.constant)))
                              (else
                                (local.set $hl (select (enum.get $Token.function) (enum.get $Token.variable)
                                  (i32.eq (local.get $pc) (i32.const "("))))))))))))
                (if (local.get $classLine)
                  (then (local.set $hl (enum.get $Token.type))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $paren (i32.add (local.get $paren) (i32.const 1)))
                (if (i32.eq (local.get $fnHead) (i32.const 2))
                  (then
                    (local.set $fnDepth (local.get $paren))
                    (local.set $fnHead (i32.const 0))))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (i32.eq (local.get $paren) (local.get $fnDepth))
                  (then (local.set $fnDepth (i32.const 0))))
                (if (local.get $paren)
                  (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))))
            (if (i32.eq (local.get $c) (i32.const "["))
              (then (local.set $fnOut (i32.eq (local.get $fnHead) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "]"))
              (then (local.set $fnOut (i32.const 0))))
            (local.set $afterValue (byteset.get ")]}" (local.get $c)))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `.name` selects a field; `.*`, `./`, `.^`, and `.'` are operators
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.or (call $matIsOp (local.get $c2)) (i32.eq (local.get $c2) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.eq (local.get $c2) (i32.const 39))))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))
                (local.set $afterValue (i32.const 0))))
            (br $next)))

        (if (call $matIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $matIsOp (call $matByte (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
