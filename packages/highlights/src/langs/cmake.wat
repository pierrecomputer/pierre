(module
  (import "../common.wat")

  (func $cmakeByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Commands are case-insensitive, so groups 1-3 hold lowercase command
  ;; names that $cmakeCommandGroup probes with a lowercased copy of the word.
  ;; Groups 4 and 5 are uppercase argument words matched exactly: the
  ;; operators of a condition and the boolean constants. Group order is the
  ;; dispatch order in $hlCmake.
  (keyword-table $cmakeWords $mem.cmakeWords $mem.cmakeWords+896
    (group ;; 1: flow control
      "if" "elseif" "else" "endif" "foreach" "endforeach" "while" "endwhile"
      "break" "continue" "return" "function" "endfunction" "macro" "endmacro"
      "block" "endblock")
    (group ;; 2: bringing in modules, packages, and directories
      "include" "find_package" "add_subdirectory" "include_directories"
      "find_library" "find_program" "find_path" "find_file" "include_guard")
    (group "set" "unset" "option") ;; 3: the first argument names a variable
    (group ;; 4: condition operators
      "AND" "OR" "NOT" "EQUAL" "LESS" "GREATER" "LESS_EQUAL" "GREATER_EQUAL"
      "STREQUAL" "STRLESS" "STRGREATER" "VERSION_LESS" "VERSION_GREATER"
      "VERSION_EQUAL" "VERSION_LESS_EQUAL" "VERSION_GREATER_EQUAL" "MATCHES"
      "DEFINED" "EXISTS" "COMMAND" "POLICY" "TARGET" "TEST" "IS_DIRECTORY"
      "IS_ABSOLUTE" "IS_SYMLINK" "IS_NEWER_THAN" "IN_LIST" "PATH_EQUAL")
    (group ;; 5: boolean constants
      "ON" "OFF" "TRUE" "FALSE" "YES" "NO" "IGNORE" "NOTFOUND"))

  ;; The table group of the command word [lhs,rhs) compared
  ;; case-insensitively; the lowercase copy stays in the scratch slot for
  ;; $cmakeIsCondition.
  (func $cmakeCommandGroup (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n (call $lexLowerCopy
      (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (keyword-table.get $cmakeWords
      (i32.const $mem.lexLowerScratch)
      (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))

  ;; Whether the $n-byte lowercased command in the scratch slot is one of
  ;; the condition commands - if, elseif, while - whose arguments carry the
  ;; operator words.
  (func $cmakeIsCondition (param $n i32) (result i32)
    (if (i32.eq (local.get $n) (i32.const 2))
      (then (return (i32.eq
        (i32.load16_u (i32.const $mem.lexLowerScratch)) (i32.const "if")))))
    (if (i32.eq (local.get $n) (i32.const 5))
      (then (return (i32.and
        (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "whil"))
        (i32.eq (i32.load8_u (i32.const $mem.lexLowerScratch+4)) (i32.const "e"))))))
    (if (i32.eq (local.get $n) (i32.const 6))
      (then (return (i32.and
        (i32.eq (i32.load (i32.const $mem.lexLowerScratch)) (i32.const "else"))
        (i32.eq (i32.load16_u (i32.const $mem.lexLowerScratch+4)) (i32.const "if"))))))
    (i32.const 0))

  ;; The number of `=` between the brackets of a `[=*[` opener at $p, or -1
  ;; when the bytes there do not open a bracket comment or argument.
  (func $cmakeBracketEquals (param $p i32) (result i32)
    (local $n i32)
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ne (call $cmakeByte (local.get $p)) (i32.const "=")))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $l)))
    (if (i32.or
          (i32.ne (call $cmakeByte (local.get $p)) (i32.const "["))
          (i32.gt_u (local.get $n) (i32.const 30)))
      (then (return (i32.const -1))))
    (local.get $n))

  ;; Emit the bracket body whose `[=*[` opener with $n equals signs sits at
  ;; $ptr as $hl. The closer `]=*]` is built in the stream delimiter slot and
  ;; found with the shared fixed-delimiter scan, which also checkpoints an
  ;; unterminated body so the next chunk keeps looking for it.
  (func $cmakeBracketBody (param $n i32) (param $hl i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.add (local.get $n) (i32.const 2))))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
    (i32.store8 (i32.const $mem.streamDelimiter) (i32.const "]"))
    (memory.fill (i32.const $mem.streamDelimiter+1) (i32.const "=") (local.get $n))
    (i32.store8 (i32.add (i32.const $mem.streamDelimiter+1) (local.get $n)) (i32.const "]"))
    (global.set $streamA (i32.add (local.get $n) (i32.const 2)))
    (global.set $streamHl (local.get $hl))
    (if (call $streamResumeFixed)
      (then
        (call $streamSetFixed
          (i32.const $mem.streamDelimiter) (i32.add (local.get $n) (i32.const 2))
          (local.get $hl)))
      (else
        (global.set $streamA (i32.const 0))
        (global.set $streamHl (i32.const 0)))))

  ;; Whether the `$` at $p opens a `${name}`, `$ENV{name}`, or `$CACHE{name}`
  ;; reference or a `$<...>` generator expression.
  (func $cmakeIsRefOpen (param $p i32) (result i32)
    (local $c i32)
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $l
        (local.set $c (call $cmakeByte (local.get $p)))
        (br_if $done (i32.gt_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.or
      (i32.eq (local.get $c) (i32.const "{"))
      (i32.eq (local.get $c) (i32.const "<"))))

  ;; Emit the reference opening at $ptr: `${name}`, `$ENV{name}`, and
  ;; `$CACHE{name}` as one variable through the brace balancing the opener,
  ;; a `$<...>` generator expression as string.special through the
  ;; balancing `>`. Neither crosses a line break, so a whole-buffer run and a
  ;; line-fed stream agree; an unbalanced reference ends at the break.
  (func $cmakeReference
    (local $lhs i32) (local $c i32) (local $depth i32)
    (local $open i32) (local $close i32) (local $hl i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $wordDone
      (loop $word
        (br_if $wordDone (i32.gt_u
          (i32.sub (call $cmakeByte (global.get $ptr)) (i32.const "A")) (i32.const 25)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $word)))
    (local.set $open (call $cmakeByte (global.get $ptr)))
    (local.set $close (select (i32.const ">") (i32.const "}")
      (i32.eq (local.get $open) (i32.const "<"))))
    (local.set $hl (select (enum.get $Token.string.special) (enum.get $Token.variable)
      (i32.eq (local.get $open) (i32.const "<"))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if (i32.eq (local.get $c) (local.get $open))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (br_if $done (i32.eqz (local.get $depth)))))
        (br $l)))
    (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr)))

  ;; Scan a quoted argument body from $ptr with the bytes since $seg still
  ;; unemitted. Backslash escapes and `${...}` references are emitted
  ;; separately, and the body may span lines. Returns 1 past the closing
  ;; quote and 0 when the body stops at $end.
  (func $cmakeQuotedBody (param $seg i32) (result i32)
    (local $c i32) (local $e i32) (local $p i32)
    (block $done
      (loop $scan
        (local.set $p (call $scanFind3
          (global.get $ptr) (i32.const 34) (i32.const 92) (i32.const "$")))
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (local.get $p))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (local.set $e (call $lexEscapeEnd (local.get $p)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (if (call $cmakeIsRefOpen (local.get $p))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (call $cmakeReference)
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  ;; An unquoted argument or command word runs over identifier bytes and the
  ;; path and target punctuation `+`, `-`, `.`, `/`, and `:`. A `$` ends it
  ;; so a glued reference lexes on its own.
  (func $cmakeIsWordByte (param $c i32) (result i32)
    (i32.and
      (i32.ne (local.get $c) (i32.const "$"))
      (i32.or
        (call $lexIsIdentContinue (local.get $c))
        (byteset.get "+-./:" (local.get $c)))))

  (func $cmakeScanWord
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "-"))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.eqz (call $cmakeIsWordByte (i32.load8_u (global.get $ptr)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; $depth counts open parentheses: a word at depth zero is a command, a
  ;; deeper one an argument. $cond is 1 inside the arguments of if, elseif,
  ;; or while, where the uppercase operator words apply; $setVar is 1 right
  ;; after `set(`, `unset(`, or `option(`, whose first argument names a
  ;; variable. $strOpen is 1 while a quoted argument continues past a chunk
  ;; boundary. All are checkpointed.
  (func $hlCmake
    (local $c i32) (local $c2 i32) (local $gap i32) (local $lhs i32) (local $rhs i32)
    (local $g i32) (local $n i32) (local $hl i32)
    (local $depth i32) (local $cond i32) (local $setVar i32) (local $strOpen i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; a quoted argument left open by the previous chunk
        (if (local.get $strOpen)
          (then
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (if (call $cmakeQuotedBody (global.get $ptr))
              (then (local.set $strOpen (i32.const 0))))
            (br $next)))
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $cmakeByte (i32.add (global.get $ptr) (i32.const 1))))

        ;; `#[[ ... ]]` bracket comments span lines; any other `#` comments
        ;; out the rest of the line
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (local.set $n (i32.const -1))
            (if (i32.eq (local.get $c2) (i32.const "["))
              (then (local.set $n (call $cmakeBracketEquals (i32.add (global.get $ptr) (i32.const 1))))))
            (if (i32.ge_s (local.get $n) (i32.const 0))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (call $cmakeBracketBody (local.get $n) (enum.get $Token.comment)))
              (else (call $lexLineComment (i32.const 1) (enum.get $Token.comment))))
            (br $next)))
        ;; `[[ ... ]]` bracket arguments are verbatim strings
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (local.set $n (call $cmakeBracketEquals (global.get $ptr)))
            (if (i32.ge_s (local.get $n) (i32.const 0))
              (then
                (call $cmakeBracketBody (local.get $n) (enum.get $Token.string))
                (local.set $setVar (i32.const 0))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eqz (call $cmakeQuotedBody (local.get $lhs)))
              (then (local.set $strOpen (i32.const 1))))
            (local.set $setVar (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "$")) (call $cmakeIsRefOpen (global.get $ptr)))
          (then
            (call $cmakeReference)
            (local.set $setVar (i32.const 0))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const "("))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ")"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (local.get $depth)
              (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
            (if (i32.eqz (local.get $depth))
              (then
                (local.set $cond (i32.const 0))
                (local.set $setVar (i32.const 0))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; a number stands alone: `3.16`, `17`; digits that lead into a name
        ;; such as `2d.cpp` belong to the word
        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (if (i32.eqz (call $cmakeIsWordByte (call $cmakeByte (global.get $ptr))))
              (then
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (local.set $setVar (i32.const 0))
                (br $next)))
            (global.set $ptr (local.get $lhs))))
        (if (call $cmakeIsWordByte (local.get $c))
          (then
            (call $cmakeScanWord)
            (local.set $rhs (global.get $ptr))
            (if (i32.eqz (local.get $depth))
              (then
                (local.set $g (call $cmakeCommandGroup (local.get $lhs) (local.get $rhs)))
                (local.set $cond (call $cmakeIsCondition (i32.sub (local.get $rhs) (local.get $lhs))))
                (local.set $setVar (i32.eq (local.get $g) (i32.const 3)))
                (local.set $hl (enum.get $Token.function))
                (if (i32.eq (local.get $g) (i32.const 1))
                  (then (local.set $hl (enum.get $Token.keyword.control))))
                (if (i32.eq (local.get $g) (i32.const 2))
                  (then (local.set $hl (enum.get $Token.keyword.import)))))
              (else
                (local.set $g (keyword-table.get $cmakeWords (local.get $lhs) (local.get $rhs)))
                (local.set $hl (select (enum.get $Token.constant) (enum.get $Token.none)
                  (call $lexIsConstCase (local.get $lhs) (local.get $rhs))))
                (if (local.get $setVar)
                  (then (local.set $hl (enum.get $Token.variable))))
                (if (i32.and (i32.eq (local.get $g) (i32.const 4)) (local.get $cond))
                  (then (local.set $hl (enum.get $Token.keyword.operator))))
                (if (i32.eq (local.get $g) (i32.const 5))
                  (then (local.set $hl (enum.get $Token.boolean))))
                (local.set $setVar (i32.const 0))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
