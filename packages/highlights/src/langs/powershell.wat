(module
  (import "../common.wat")

  (func $psByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; PowerShell is case-insensitive, so the table holds lowercase words and
  ;; $psWordGroup probes it with a lowercased copy of the input word. Group
  ;; order is the dispatch order in $hlPowershell. Group 6 holds the
  ;; operators spelled `-eq`, `-and`, `-match`, and so on, looked up after
  ;; a `-`; any other `-Name` is a parameter. Groups 7-9 are looked up
  ;; after a `$`.
  (keyword-table $powershellWords $mem.powershellWords $mem.powershellWords+1280
    (group ;; 1: control
      "if" "else" "elseif" "switch" "for" "foreach" "while" "do" "until"
      "break" "continue" "return" "exit" "throw" "try" "catch" "finally"
      "trap" "begin" "process" "end" "dynamicparam" "default" "clean")
    (group ;; 2: declaration, next name is a function
      "function" "filter" "workflow" "configuration")
    (group "class" "enum") ;; 3: declaration, next name is a type
    (group ;; 4: declaration
      "param" "hidden" "static" "data" "define" "var" "inlinescript"
      "parallel" "sequence")
    (group "using") ;; 5: import
    (group ;; 6: dash operators, and the `in` of foreach
      "eq" "ne" "gt" "ge" "lt" "le" "like" "notlike" "match" "notmatch"
      "contains" "notcontains" "in" "notin" "replace" "creplace" "ireplace"
      "split" "join" "and" "or" "not" "xor" "band" "bor" "bxor" "bnot" "shl"
      "shr" "is" "isnot" "as" "ceq" "cne" "clike" "cmatch" "ieq" "ine"
      "ilike" "imatch")
    (group "true" "false") ;; 7: booleans, after `$`
    (group "null")         ;; 8: built-in constant, after `$`
    (group ;; 9: automatic variables, after `$`
      "this" "args" "input" "psitem" "pscmdlet" "psboundparameters" "matches"
      "error" "host" "pid" "pwd" "home" "psversiontable"))

  ;; The table group of the word [lhs,rhs) compared case-insensitively
  (func $psWordGroup (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n (call $lexLowerCopy
      (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (keyword-table.get $powershellWords
      (i32.const $mem.lexLowerScratch)
      (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))

  ;; End of the variable whose `$` sits at $p: the name, then any
  ;; `scope:name` tail such as `$env:PATH`.
  (func $psVarEnd (param $p i32) (result i32)
    (local $e i32)
    (local $c i32)
    (local.set $e (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $e) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $e)))
        (if (i32.and (call $lexIsIdentContinue (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (local.set $e (i32.add (local.get $e) (i32.const 1)))
            (br $l)))
        (br_if $done (i32.ne (local.get $c) (i32.const ":")))
        (local.set $c (call $psByte (i32.add (local.get $e) (i32.const 1))))
        (br_if $done (i32.eqz (i32.and
          (call $lexIsIdentStart (local.get $c))
          (i32.ne (local.get $c) (i32.const "$")))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (local.get $e))

  ;; Scan a string body from $ptr with the bytes since $seg still unemitted.
  ;; $kind is 1 for `"`, 2 for `'`, 3 for a `@"` here-string, and 4 for
  ;; `@'`; every kind may span lines. Double-quoted bodies expand backtick
  ;; escapes, `$name` variables, and `$(...)` subexpressions, and a here-
  ;; string closes only with `"@` at the start of a line. Returns 1 past
  ;; the closer, 2 past a `$(` that opens a subexpression - emitted as
  ;; punctuation.special, the caller lexes the code - and 0 at $end.
  (func $psStringBody (param $kind i32) (param $seg i32) (result i32)
    (local $c i32) (local $e i32) (local $p i32) (local $q i32)
    (local $expand i32) (local $status i32)
    (local.set $q (select (i32.const 39) (i32.const 34)
      (i32.eq (i32.and (local.get $kind) (i32.const 1)) (i32.const 0))))
    (local.set $expand (i32.and (local.get $kind) (i32.const 1)))
    (block $done
      (loop $scan
        (if (local.get $expand)
          (then (local.set $p (call $scanFind3 (global.get $ptr) (local.get $q) (i32.const 96) (i32.const "$"))))
          (else (local.set $p (call $lexFindByte (global.get $ptr) (local.get $q)))))
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (local.get $p))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (if (i32.ge_u (local.get $kind) (i32.const 3))
              (then
                ;; `"@` closes a here-string only at the start of a line
                (if (i32.and
                      (i32.eq (call $psByte (i32.add (local.get $p) (i32.const 1))) (i32.const "@"))
                      (i32.or
                        (i32.eq (local.get $p) (global.get $srcBase))
                        (i32.or
                          (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 10))
                          (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 13)))))
                  (then
                    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                    (local.set $status (i32.const 1))
                    (br $done)))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (br $scan)))
            ;; a doubled quote escapes itself
            (if (i32.eq (call $psByte (i32.add (local.get $p) (i32.const 1))) (local.get $q))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
                (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (br $scan)))
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (if (i32.eq (local.get $c) (i32.const 96))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (local.set $e (call $utf8SpanEnd (i32.add (local.get $p) (i32.const 2)) (global.get $end)))
            ;; a backtick before CRLF continues the line like one before LF
            (if (i32.and
                  (i32.eq (local.get $e) (i32.add (local.get $p) (i32.const 2)))
                  (i32.and
                    (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 13))
                    (i32.eq (call $psByte (local.get $e)) (i32.const 10))))
              (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        ;; `$`
        (local.set $c (call $psByte (i32.add (local.get $p) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (return (i32.const 2))))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $e (call $scanFindSpecial
              (i32.add (local.get $p) (i32.const 2)) (global.get $end)
              (i32.const "}") (i32.const 0) (i32.const 1)))
            (if (i32.and
                  (i32.lt_u (local.get $e) (global.get $end))
                  (i32.eq (i32.load8_u (local.get $e)) (i32.const "}")))
              (then (local.set $e (i32.add (local.get $e) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (call $emitTok (enum.get $Token.variable) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (local.set $e (call $psVarEnd (local.get $p)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (call $emitTok (enum.get $Token.variable) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "?")))
              (i32.eq (local.get $c) (i32.const "^")))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.variable.special) (local.get $p) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  (func $psIsOp (param $c i32) (result i32)
    (byteset.get "!%&*+-/<=>?|" (local.get $c)))

  ;; $strKind is the open string body - see $psStringBody - with $seg the
  ;; start of its bytes not yet emitted; $interp counts parens inside a
  ;; `$(` subexpression and $interpKind remembers which body to return to.
  ;; $cmdPos is 1 where a bare word is a command name: at the start of a
  ;; statement, after a pipe, and after an assignment. $expect is 1 after
  ;; `function` and 2 after `class`; $member is 1 after `.` or `::`. All
  ;; are checkpointed.
  (func $hlPowershell
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $g i32) (local $hl i32) (local $expect i32) (local $member i32)
    (local $cmdPos i32) (local $strKind i32) (local $seg i32)
    (local $interp i32) (local $interpKind i32) (local $status i32) (local $closed i32)
    (local.set $cmdPos (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $strKind)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $psStringBody (local.get $strKind) (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                ;; `$(` opened a subexpression: code until the matching `)`
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0))
                (local.set $cmdPos (i32.const 1)))
              (else
                (if (i32.eq (local.get $status) (i32.const 1))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; a line break starts a statement
        (if (i32.lt_u
              (call $scanFindSpecial (local.get $gap) (global.get $ptr)
                (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then
            (local.set $cmdPos (i32.const 1))
            (local.set $member (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $psByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $psByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "#")))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
            (local.set $closed (i32.const 0))
            (block $commentDone
              (loop $comment
                (local.set $p (call $lexFindByte (local.get $p) (i32.const "#")))
                (br_if $commentDone (i32.ge_u (local.get $p) (global.get $end)))
                (if (i32.eq (call $psByte (i32.add (local.get $p) (i32.const 1))) (i32.const ">"))
                  (then
                    (local.set $closed (i32.const 1))
                    (br $commentDone)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $comment)))
            (global.set $ptr (select
              (i32.add (local.get $p) (i32.const 2)) (global.get $end) (local.get $closed)))
            (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
            (if (i32.eqz (local.get $closed))
              (then (call $streamSetFixed32 (i32.const "#>") (i32.const 2) (enum.get $Token.comment))))
            (br $next)))

        ;; string openers are emitted at once; the body is scanned at the top
        ;; of the loop, where it can also resume after a chunk boundary
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strKind (select (i32.const 1) (i32.const 2) (i32.eq (local.get $c) (i32.const 34))))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.const 0))
            (br $next)))
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "@"))
              (i32.or (i32.eq (local.get $c2) (i32.const 34)) (i32.eq (local.get $c2) (i32.const 39))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $strKind (select (i32.const 3) (i32.const 4) (i32.eq (local.get $c2) (i32.const 34))))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.const 0))
            (br $next)))
        ;; `@(...)` arrays, `@{...}` hashtables, `@args` splatting
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (if (i32.or (i32.eq (local.get $c2) (i32.const "(")) (i32.eq (local.get $c2) (i32.const "{")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (local.set $cmdPos (i32.const 0))
                (br $next)))
            (if (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
              (then
                (global.set $ptr (call $psVarEnd (global.get $ptr)))
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                (local.set $cmdPos (i32.const 0))
                (br $next)))))

        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.const 0))
            (if (i32.eq (local.get $c2) (i32.const "("))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (if (local.get $interp)
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (local.set $cmdPos (i32.const 1))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "{"))
              (then
                (global.set $ptr (call $scanFindSpecial
                  (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)
                  (i32.const "}") (i32.const 0) (i32.const 1)))
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "}")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (i32.or
                  (i32.or (i32.eq (local.get $c2) (i32.const "$")) (i32.eq (local.get $c2) (i32.const "?")))
                  (i32.eq (local.get $c2) (i32.const "^")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (global.set $ptr (call $psVarEnd (global.get $ptr)))
                (local.set $g (call $psWordGroup (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr)))
                (local.set $hl (enum.get $Token.variable))
                (if (i32.eq (local.get $g) (i32.const 7)) (then (local.set $hl (enum.get $Token.boolean))))
                (if (i32.eq (local.get $g) (i32.const 8)) (then (local.set $hl (enum.get $Token.constant.builtin))))
                (if (i32.or
                      (i32.eq (local.get $g) (i32.const 9))
                      (i32.and
                        (i32.eq (local.get $c2) (i32.const "_"))
                        (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))))
                  (then (local.set $hl (enum.get $Token.variable.special))))
                (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; `[type]` literals and `[Attribute(...)]`
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "["))
              (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $scanIdentRun (i32.const "."))
            (if (i32.eq (call $psByte (global.get $ptr)) (i32.const "("))
              (then
                ;; the attribute's arguments are values, not commands
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr)))
              (else
                (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))))
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.const 0))
            (br $next)))

        ;; `-eq` operators and `-Name` parameters
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (local.set $g (call $psWordGroup (i32.add (local.get $lhs) (i32.const 1)) (global.get $ptr)))
            (call $emitTok
              (select (enum.get $Token.keyword.operator) (enum.get $Token.variable.parameter)
                (i32.or
                  (i32.eq (local.get $g) (i32.const 6))
                  (i32.and
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 2))
                    (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "f")))))
              (local.get $lhs) (global.get $ptr))
            (local.set $cmdPos (i32.const 0))
            (br $next)))

        ;; a backtick escapes the next byte, or joins the next line
        (if (i32.eq (local.get $c) (i32.const 96))
          (then
            (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
            (if (i32.and
                  (i32.eq (local.get $c2) (i32.const 13))
                  (i32.eq (call $psByte (global.get $ptr)) (i32.const 10)))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "-"))
            (local.set $rhs (global.get $ptr))
            (local.set $g (local.get $expect))
            (local.set $expect (i32.const 0))
            (if (i32.lt_u (call $lexFindByte (local.get $lhs) (i32.const "-")) (local.get $rhs))
              (then
                ;; a `Verb-Noun` cmdlet name
                (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.function)
                  (i32.eq (local.get $g) (i32.const 1)))))
              (else
                (if (local.get $member)
                  (then (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                    (i32.eq (call $psByte (local.get $rhs)) (i32.const "(")))))
                  (else
                    (if (local.get $g)
                      (then (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                        (i32.eq (local.get $g) (i32.const 1)))))
                      (else
                        (local.set $g (call $psWordGroup (local.get $lhs) (local.get $rhs)))
                        (local.set $hl (enum.get $Token.none))
                        (if (i32.eq (local.get $g) (i32.const 1)) (then (local.set $hl (enum.get $Token.keyword.control))))
                        (if (i32.eq (local.get $g) (i32.const 2))
                          (then
                            (local.set $hl (enum.get $Token.keyword.declaration))
                            (local.set $expect (i32.const 1))))
                        (if (i32.eq (local.get $g) (i32.const 3))
                          (then
                            (local.set $hl (enum.get $Token.keyword.declaration))
                            (local.set $expect (i32.const 2))))
                        (if (i32.eq (local.get $g) (i32.const 4)) (then (local.set $hl (enum.get $Token.keyword.declaration))))
                        (if (i32.eq (local.get $g) (i32.const 5)) (then (local.set $hl (enum.get $Token.keyword.import))))
                        ;; `in` is the only dash operator that also stands bare
                        (if (i32.and
                              (i32.eq (local.get $g) (i32.const 6))
                              (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2)))
                          (then (local.set $hl (enum.get $Token.keyword.operator))))
                        (if (i32.and
                              (i32.eq (local.get $hl) (enum.get $Token.none))
                              (i32.or
                                (local.get $cmdPos)
                                (i32.eq (call $psByte (local.get $rhs)) (i32.const "("))))
                          (then (local.set $hl (enum.get $Token.function))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "("))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the paren matching `$(` returns to the string body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (local.set $expect (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (local.set $cmdPos (i32.or
              (i32.eq (local.get $c) (i32.const "("))
              (i32.eq (local.get $c) (i32.const "{"))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $cmdPos (i32.eq (local.get $c) (i32.const ";")))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eq (local.get $c2) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.and
                  (call $lexIsIdentStart (local.get $c2))
                  (i32.ne (local.get $c2) (i32.const "$"))))))
            (local.set $cmdPos (i32.const 0))
            (br $next)))

        (if (call $psIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $psIsOp (call $psByte (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; a pipeline, a call operator, and an assignment start a command
            (local.set $cmdPos (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "&")))
              (i32.eq (local.get $c) (i32.const "="))))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (local.set $cmdPos (i32.const 0))
        (br $next))))
)
