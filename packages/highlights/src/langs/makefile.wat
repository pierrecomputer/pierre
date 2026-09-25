(module
  (import "../common.wat")
  ;; `\` line joins share $dockerLineJoin
  (import "./dockerfile.wat")

  (func $makeByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlMakefile. Groups 1-4 are the
  ;; directives that may head a line; group 5 holds the built-in functions
  ;; looked up after `$(`. `endef` shares its hash features with `endif` and
  ;; `addprefix` with `addsuffix`, so both are matched directly.
  (keyword-table $makefileWords $mem.makefileWords $mem.matlabWords
    (group ;; 1: conditionals
      "ifeq" "ifneq" "ifdef" "ifndef" "else" "endif")
    (group "include" "sinclude" "-include") ;; 2: includes
    (group "define")                        ;; 3: a multi-line variable
    (group ;; 4: variable directives, the next word is the variable
      "export" "unexport" "override" "private" "undefine" "vpath")
    (group ;; 5: built-in functions
      "subst" "patsubst" "strip" "findstring" "filter" "filter-out" "sort" "word" "wordlist"
      "words" "firstword" "lastword" "dir" "notdir" "suffix" "basename" "addsuffix" "join"
      "wildcard" "realpath" "abspath" "error" "warning" "info" "shell" "origin" "flavor" "foreach"
      "if" "or" "and" "call" "eval" "value" "file" "let"))

  ;; Whether [lhs,rhs) spells the 5-byte `endef`; the table cannot hold it
  (func $makeIsEndef (param $lhs i32) (param $rhs i32) (result i32)
    (i32.and
      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
      (i32.and
        (i32.eq (i32.load (local.get $lhs)) (i32.const "ende"))
        (i32.eq (i32.load8_u offset=4 (local.get $lhs)) (i32.const "f")))))

  ;; Whether $c ends a word: blanks, line breaks (TAB through CR, as in
  ;; $lexIsSpace), and the punctuation that separates targets, variables, and
  ;; values
  (func $makeIsWordEnd (param $c i32) (result i32)
    (byteset.get "\00\09\0a\0b\0c\0d \22#$'(),:;=\5c|" (local.get $c)))

  ;; Advance $ptr over a word: any bytes until a word end, except that a
  ;; `+`, `?`, or `!` right before `=` is the assignment operator's. Word
  ;; ends are ASCII, so UTF-8 bytes step one at a time and stay in the word.
  (func $makeScanWord
    (local $c i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (call $makeIsWordEnd (local.get $c)))
        (br_if $done
          (i32.and
            (byteset.get "!+?" (local.get $c))
            (i32.eq (call $makeByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "="))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; Whether a target-specific assignment follows a rule's `:` at $p:
  ;; blanks, a variable name, blanks, and `=`, `:=`, `::=`, `+=`, `?=`, or
  ;; `!=` (`debug: CFLAGS += -g`). Only the first word is examined, so
  ;; ordinary prerequisite lists cost a few bytes and a substitution
  ;; reference such as `$(SRCS:.c=.o)` never looks like one.
  (func $makeTargetVar (param $p i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local.set $p (call $lexSkipSpaceAt (local.get $p)))
    (local.set $q (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $q) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $q)))
        (br_if $done
          (i32.eqz
            (i32.or
              (call $lexIsIdentContinue (local.get $c))
              (i32.or (i32.eq (local.get $c) (i32.const "-")) (i32.eq (local.get $c) (i32.const "."))))))
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (br $l)))
    (if (i32.eq (local.get $q) (local.get $p))
      (then (return (i32.const 0))))
    (local.set $q (call $lexSkipSpaceAt (local.get $q)))
    (local.set $c (call $makeByte (local.get $q)))
    (if (byteset.get "!+?" (local.get $c))
      (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))
    (if (i32.eq (local.get $c) (i32.const ":"))
      (then
        (local.set $q (i32.add (local.get $q) (i32.const 1)))
        (if (i32.eq (call $makeByte (local.get $q)) (i32.const ":"))
          (then (local.set $q (i32.add (local.get $q) (i32.const 1)))))))
    (i32.eq (call $makeByte (local.get $q)) (i32.const "=")))

  ;; Classify the logical line starting at $p by its first unbracketed
  ;; separator: 1 for a rule - a `:` that is not `:=` or `::=` - 2 for an
  ;; assignment, 3 for a rule whose prerequisite list is a target-specific
  ;; assignment (see $makeTargetVar), 0 for none. `$(...)` and `${...}`
  ;; groups are skipped so a `:` inside a reference does not make a rule.
  ;; The scan never crosses a line break or a comment.
  (func $makeLineKind (param $p i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (local $open i32)
    (local $close i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $done
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
            (i32.eq (local.get $c) (i32.const "#"))))
        (if (local.get $depth)
          (then
            (if (i32.eq (local.get $c) (local.get $open))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (i32.eq (local.get $c) (local.get $close))
              (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (local.set $open (call $makeByte (i32.add (local.get $p) (i32.const 1))))
            (if
              (i32.or (i32.eq (local.get $open) (i32.const "(")) (i32.eq (local.get $open) (i32.const "{")))
              (then
                (local.set $close
                  (select (i32.const ")") (i32.const "}") (i32.eq (local.get $open) (i32.const "("))))
                (local.set $depth (i32.const 1))
                (local.set $p (i32.add (local.get $p) (i32.const 2)))
                (br $l)))))
        (if (i32.eq (local.get $c) (i32.const "="))
          (then (return (i32.const 2))))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (local.set $c (call $makeByte (local.get $p)))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (local.set $c (call $makeByte (local.get $p)))))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then (return (i32.const 2))))
            (return (select (i32.const 3) (i32.const 1) (call $makeTargetVar (local.get $p))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; Emit the reference or escape whose `$` sits at $ptr. `$(name)` and
  ;; `${name}` are references: the opener and closer are punctuation, a
  ;; built-in function name is a function and any other head word a
  ;; variable; the rest of the body is plain text with nested `$` forms and
  ;; `,` argument separators, which recurses. `$@`, `$<`, and the other
  ;; automatic variables - also `$(@D)` - are variable.special, `$x` is a
  ;; one-letter variable, and `$$` passes a dollar to the shell, so a name
  ;; after it is a shell variable. A body never crosses a line break, so a
  ;; whole-buffer run and a line-fed stream agree. $nest counts the enclosing
  ;; references: past 64 levels a nested `$` stays plain text, so a line of
  ;; thousands of `$(` cannot exhaust the call stack.
  (func $makeDollar (param $nest i32)
    (local $lhs i32)
    (local $c i32)
    (local $open i32)
    (local $close i32)
    (local $depth i32)
    (local $rhs i32)
    (local $p i32)
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $makeByte (i32.add (global.get $ptr) (i32.const 1))))
    (if (i32.eq (local.get $c) (i32.const "$"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (if
          (i32.and
            (call $lexIsIdentStart (i32.load8_u (global.get $ptr)))
            (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "$")))
          (then (call $scanIdentRun (i32.const "_"))))
        (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
        (return)))
    (if
      (i32.eqz
        (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "{"))))
      (then
        (if (byteset.get "%*+<?@^|" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (return)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (global.set $ptr
              (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (return)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (return)))
    (local.set $open (local.get $c))
    (local.set $close
      (select (i32.const ")") (i32.const "}") (i32.eq (local.get $c) (i32.const "("))))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
    (call $emitGap (local.get $lhs) (global.get $ptr))
    (local.set $lhs (global.get $ptr))
    (local.set $c (call $makeByte (global.get $ptr)))
    ;; the head: an automatic variable with its D/F modifier, or a word
    (if (byteset.get "%*+<?@^|" (local.get $c))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        ;; `D` and `F` differ only in bit 1
        (if (i32.eq (i32.or (call $makeByte (global.get $ptr)) (i32.const 2)) (i32.const "F"))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr)))
      (else
        (call $scanIdentRun (i32.const "-"))
        (local.set $rhs (global.get $ptr))
        (if (i32.gt_u (local.get $rhs) (local.get $lhs))
          (then
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; `addprefix` cannot sit in the table beside `addsuffix`
            (if
              (i32.and
                (i32.ne (call $makeByte (local.get $p)) (local.get $close))
                (i32.or
                  (i32.eq
                    (keyword-table.get $makefileWords (local.get $lhs) (local.get $rhs))
                    (i32.const 5))
                  (i32.and
                    (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 9))
                    (i32.and
                      (i64.eq (i64.load (local.get $lhs)) (i64.const "addprefi"))
                      (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "x"))))))
              (then (call $emitTok (enum.get $Token.function) (local.get $lhs) (local.get $rhs)))
              (else
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (local.get $rhs))))))))
    ;; the body up to the balancing closer: nested references, argument
    ;; separators, and plain runs
    (local.set $lhs (global.get $ptr))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "$"))
            (i32.lt_u (local.get $nest) (i32.const 64)))
          (then
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (call $makeDollar (i32.add (local.get $nest) (i32.const 1)))
            (local.set $lhs (global.get $ptr))
            (br $l)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ",")) (i32.eqz (local.get $depth)))
          (then
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (br $l)))
        (if (i32.eq (local.get $c) (local.get $open))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (if (i32.eqz (local.get $depth))
              (then
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.special)
                  (local.get $lhs)
                  (global.get $ptr))
                (return)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (br $l)))
    (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr)))

  ;; A double-quoted string in a recipe: `$` references keep their meaning
  ;; inside it and `\` escapes the next byte. It ends at the quote or the
  ;; line break.
  (func $makeQuoted
    (local $seg i32)
    (local $c i32)
    (local $e i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (call $makeDollar (i32.const 0))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  (func $makeIsShellOp (param $c i32) (result i32)
    (byteset.get "&;<>|" (local.get $c)))

  ;; A makefile is line-oriented. $lineHead is 1 until the first token of a
  ;; line, where the line is classified into $mode: 1 a recipe (a TAB-led
  ;; line under a rule, or the text after a rule's `;`), 2 an assignment, 3
  ;; a rule, 4 a directive or other plain line, 5 a line of a `define`
  ;; body, 6 a rule whose `:` leads into a target-specific assignment
  ;; (mode 2 after the `:`). $targets is 1 over the target words of a rule
  ;; until its `:`, $expectVar over the name of an assignment or variable
  ;; directive, and $cmdHead over the command word of a recipe. $inRule is 1
  ;; after a rule line and its recipe, so a TAB still opens a recipe;
  ;; $define is 1 inside `define` ... `endef`. A `\` before the line break
  ;; joins the next line, keeping the mode. All are checkpointed.
  (func $hlMakefile
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $hl i32)
    (local $kind i32)
    (local $lineHead i32)
    (local $mode i32)
    (local $targets i32)
    (local $expectVar i32)
    (local $cmdHead i32)
    (local $inRule i32)
    (local $define i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; the gap crossed a line break when a CR or LF sits in it: $p stops
        ;; after the last one - the line's first byte - or at $gap. Gaps are
        ;; usually 0-1 bytes, so a scalar scan back from $ptr beats a SIMD
        ;; search forward.
        (local.set $p (global.get $ptr))
        (block $brDone
          (loop $br
            (br_if $brDone (i32.le_u (local.get $p) (local.get $gap)))
            (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
            (br_if $brDone
              (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
            (local.set $p (i32.sub (local.get $p) (i32.const 1)))
            (br $br)))
        (if (i32.gt_u (local.get $p) (local.get $gap))
          (then (local.set $lineHead (i32.const 1))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $makeByte (i32.add (global.get $ptr) (i32.const 1))))

        (if (local.get $lineHead)
          (then
            (local.set $lineHead (i32.const 0))
            (local.set $mode (i32.const 4))
            (local.set $targets (i32.const 0))
            (local.set $expectVar (i32.const 0))
            (local.set $cmdHead (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "#"))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
                (br $next)))
            ;; the line's first byte: after the last break in the gap, or the
            ;; gap start when the chunk began this line (see the gap scan)
            (local.set $rhs (local.get $p))
            (if
              (i32.and
                (i32.lt_u (local.get $rhs) (global.get $ptr))
                (i32.eq (i32.load8_u (local.get $rhs)) (i32.const 9)))
              (then
                ;; a TAB-led line is a recipe under a rule and a body line
                ;; inside a define
                (if (local.get $inRule)
                  (then
                    (local.set $mode (i32.const 1))
                    (local.set $cmdHead (i32.const 1))))
                (if (local.get $define)
                  (then (local.set $mode (i32.const 5))))))
            (if (i32.ne (local.get $mode) (i32.const 1))
              (then
                (local.set $kind (call $makeLineKind (global.get $ptr)))
                (if (local.get $define)
                  (then
                    (local.set $mode (i32.const 5))
                    (call $makeScanWord)
                    (if (call $makeIsEndef (local.get $lhs) (global.get $ptr))
                      (then
                        (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                        (local.set $define (i32.const 0)))
                      (else (global.set $ptr (local.get $lhs))))
                    (if (i32.gt_u (global.get $ptr) (local.get $lhs))
                      (then (br $next))))
                  (else
                    (local.set $inRule (i32.eq (local.get $kind) (i32.const 1)))
                    (if (i32.eq (local.get $kind) (i32.const 1))
                      (then
                        (local.set $mode (i32.const 3))
                        (local.set $targets (i32.const 1))))
                    (if (i32.eq (local.get $kind) (i32.const 3))
                      (then
                        (local.set $mode (i32.const 6))
                        (local.set $targets (i32.const 1))))
                    (if (i32.eq (local.get $kind) (i32.const 2))
                      (then
                        (local.set $mode (i32.const 2))
                        (local.set $expectVar (i32.const 1))))
                    ;; a directive word heads the line
                    (if
                      (i32.or
                        (call $lexIsIdentStart (local.get $c))
                        (i32.eq (local.get $c) (i32.const "-")))
                      (then
                        (call $makeScanWord)
                        (local.set $g
                          (keyword-table.get $makefileWords (local.get $lhs) (global.get $ptr)))
                        (if
                          (i32.and
                            (i32.ge_u (local.get $g) (i32.const 1))
                            (i32.le_u (local.get $g) (i32.const 4)))
                          (then
                            (call $emitTok
                              (select
                                (enum.get $Token.keyword.control)
                                (select
                                  (enum.get $Token.keyword.import)
                                  (enum.get $Token.keyword)
                                  (i32.eq (local.get $g) (i32.const 2)))
                                (i32.eq (local.get $g) (i32.const 1)))
                              (local.get $lhs)
                              (global.get $ptr))
                            (local.set $inRule (i32.const 0))
                            (local.set $targets (i32.const 0))
                            (if (i32.ge_u (local.get $g) (i32.const 3))
                              (then
                                (local.set $expectVar (i32.const 1))
                                (if (i32.ne (local.get $mode) (i32.const 2))
                                  (then (local.set $mode (i32.const 4))))))
                            (if (i32.eq (local.get $g) (i32.const 3))
                              (then (local.set $define (i32.const 1))))
                            ;; `else ifeq (...)`: the next word heads the line
                            (if
                              (i32.and
                                (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 4))
                                (i32.eq (i32.load (local.get $lhs)) (i32.const "else")))
                              (then (local.set $lineHead (i32.const 1))))
                            (br $next)))
                        (if (call $makeIsEndef (local.get $lhs) (global.get $ptr))
                          (then
                            (call $emitTok
                              (enum.get $Token.keyword)
                              (local.get $lhs)
                              (global.get $ptr))
                            (br $next)))
                        (global.set $ptr (local.get $lhs))))))))))

        ;; `\` before the line break continues the logical line; the break
        ;; is consumed here so the gap scan above does not start a new line
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (br_if $next (call $dockerLineJoin))
            ;; `\#` is a literal `#`, not a comment
            (if (i32.eq (local.get $c2) (i32.const "#"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr
              (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (call $makeDollar (i32.const 0))
            (local.set $cmdHead (i32.const 0))
            (local.set $expectVar (i32.const 0))
            (br $next)))

        ;; the assignment operator: `=`, `:=`, `::=`, `?=`, `+=`, `!=`
        (if
          (i32.and
            (i32.eq (local.get $mode) (i32.const 2))
            (i32.or
              (i32.eq (local.get $c) (i32.const "="))
              (i32.and
                (byteset.get "!+:?" (local.get $c))
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "="))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const ":"))
                    (i32.eq
                      (call $makeByte (i32.add (global.get $ptr) (i32.const 2)))
                      (i32.const "=")))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $eqDone
              (loop $eq
                (br_if $eqDone (i32.ne (call $makeByte (global.get $ptr)) (i32.const ":")))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $eq)))
            (if (i32.eq (call $makeByte (global.get $ptr)) (i32.const "="))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $expectVar (i32.const 0))
            (br $next)))
        ;; a rule's separator, order-only bar, and inline recipe
        (if (i32.or (i32.eq (local.get $mode) (i32.const 3)) (i32.eq (local.get $mode) (i32.const 6)))
          (then
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const ":"))
                (i32.eq (local.get $c) (i32.const "&")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (call $makeByte (global.get $ptr)) (i32.const ":"))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $targets (i32.const 0))
                ;; a target-specific assignment follows its rule's `:`
                (if (i32.eq (local.get $mode) (i32.const 6))
                  (then
                    (local.set $mode (i32.const 2))
                    (local.set $expectVar (i32.const 1))))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "|"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.delimiter)
                  (local.get $lhs)
                  (global.get $ptr))
                (local.set $mode (i32.const 1))
                (local.set $cmdHead (i32.const 1))
                (br $next)))))
        ;; recipe text is shell: strings, operators, and command words
        (if (i32.eq (local.get $mode) (i32.const 1))
          (then
            (if (i32.and (byteset.get "+-@" (local.get $c)) (local.get $cmdHead))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const 39))
              (then
                (call $lexRawString (i32.const 39) (i32.const 0) (enum.get $Token.string))
                (local.set $cmdHead (i32.const 0))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const 34))
              (then
                (call $makeQuoted)
                (local.set $cmdHead (i32.const 0))
                (br $next)))
            (if (call $makeIsShellOp (local.get $c))
              (then
                (block $opDone
                  (loop $op
                    (br_if $opDone
                      (i32.eqz (call $makeIsShellOp (call $makeByte (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (if
                  (i32.or
                    (i32.eq (local.get $c) (i32.const ";"))
                    (i32.or
                      (i32.eq (local.get $c) (i32.const "&"))
                      (i32.eq (local.get $c) (i32.const "|"))))
                  (then (local.set $cmdHead (i32.const 1))))
                (br $next)))
            (if (byteset.get "()" (local.get $c))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.bracket)
                  (local.get $lhs)
                  (global.get $ptr))
                (br $next)))))
        (if (byteset.get "()," (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (select
                (enum.get $Token.punctuation.delimiter)
                (enum.get $Token.punctuation.bracket)
                (i32.eq (local.get $c) (i32.const ",")))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))

        ;; a word: target, variable name, command, or plain text
        (if (i32.eqz (call $makeIsWordEnd (local.get $c)))
          (then
            (call $makeScanWord)
            (if (i32.eq (global.get $ptr) (local.get $lhs))
              (then
                (global.set $ptr
                  (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))))
            (local.set $rhs (global.get $ptr))
            (local.set $hl (enum.get $Token.none))
            (if (local.get $expectVar)
              (then
                (local.set $hl (enum.get $Token.variable))
                (local.set $expectVar (i32.const 0)))
              (else
                (if (local.get $targets)
                  (then
                    ;; `.PHONY` and the other special targets
                    (local.set $hl
                      (select
                        (enum.get $Token.keyword)
                        (enum.get $Token.function)
                        (i32.and
                          (i32.eq (local.get $c) (i32.const "."))
                          (i32.le_u (i32.sub (local.get $c2) (i32.const "A")) (i32.const 25))))))
                  (else
                    (if (i32.and (i32.eq (local.get $mode) (i32.const 1)) (local.get $cmdHead))
                      (then
                        (local.set $hl (enum.get $Token.function))
                        (local.set $cmdHead (i32.const 0)))
                      (else
                        (if
                          (i32.and
                            (i32.eq (local.get $mode) (i32.const 1))
                            (i32.and
                              (call $lexIsDigit (local.get $c))
                              (i32.eqz
                                (call $lexIsIdentContinue (call $makeByte (local.get $rhs))))))
                          (then
                            (global.set $ptr (local.get $lhs))
                            (call $lexScanNumber)
                            (if (i32.eq (global.get $ptr) (local.get $rhs))
                              (then (local.set $hl (enum.get $Token.number)))
                              (else (global.set $ptr (local.get $rhs))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $cmdHead (i32.const 0))
        (br $next))))
)
