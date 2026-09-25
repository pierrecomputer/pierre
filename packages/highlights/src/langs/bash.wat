(module
  (import "../common.wat")

  ;; the byte at $p, or 0 at or past $end
  (func $bashByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; open `$((` arithmetic expansions: inside one, `<<` is a left shift and
  ;; must not be mistaken for a heredoc opener
  (global $bashArith (mut i32) (i32.const 0))

  ;; group order is the dispatch order in $bashWordHl below; the control
  ;; groups differ only in what may follow them (see $hlBash)
  (keyword-table $bashWords $mem.bashWords $mem.batchWords
    (group ;; 1: control, a command follows
      "do" "if" "elif" "else" "then" "until" "while")
    (group ;; 2: control, arguments follow
      "fi" "done" "break" "return" "continue")
    (group "esac")             ;; 3: control, the only keyword among case patterns
    (group "in")               ;; 4: control after `for NAME` or `case WORD` only
    (group "for" "select")     ;; 5: control, a name then `in` follow
    (group "case")             ;; 6: control, a word, `in`, then patterns
    (group ;; 7: declaration, names follow
      "local" "export" "declare" "readonly" "typeset")
    (group "function")         ;; 8: declaration, next name is a function
    (group "time" "coproc"))   ;; 9: plain keyword, a command follows

  ;; Map a $bashWords group index to its token. Group 0 - a table miss - is an
  ;; ordinary word, which $hlBash may still promote to a command or a name.
  (func $bashWordHl (param $group i32) (result i32)
    (if (i32.eqz (local.get $group))
      (then (return (enum.get $Token.variable))))
    (if (i32.le_u (local.get $group) (i32.const 6))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $group) (i32.const 8))
      (then (return (enum.get $Token.keyword.declaration))))
    (enum.get $Token.keyword))

  ;; Besides identifier bytes, a word starts at the punctuation $c - one of
  ;; `-`, `.`, `/`, `~` - that opens the flag, path, and home forms `-x`,
  ;; `--flag`, `./run.sh`, `/usr/bin`, and `~/src` when $c2 continues it; a
  ;; lone `-`, `.`, `/`, or `~` stays an operator or none.
  (func $bashIsPunctWordStart (param $c i32) (param $c2 i32) (result i32)
    (i32.or
      (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
      (select
        (i32.eq (local.get $c2) (i32.const "-"))
        ;; `.` or `/` (46-47)
        (i32.le_u (i32.sub (local.get $c2) (i32.const ".")) (i32.const 1))
        (i32.eq (local.get $c) (i32.const "-")))))

  ;; `$@`, `$*`, `$#`, `$?`, `$!`, `$-` and `$1`..`$9`. A `$` before anything
  ;; else - a quote, a space, end of input - is a literal dollar sign.
  (func $bashIsSpecialParam (param $c i32) (result i32)
    (i32.or (call $lexIsDigit (local.get $c)) (byteset.get "!#*-?@" (local.get $c))))

  ;; A word is an identifier run extended over `-`, `/` and `.` - `apt-get`,
  ;; `./run.sh`, `a.b` - so paths and dashed commands stay one token. `$` ends
  ;; a word so a glued expansion still lexes as one: `abc$def` is the word
  ;; `abc` followed by `$def`. The SIMD run covers `-` directly; `/` and `.`
  ;; restart it, which keeps the loop off the per-byte path for plain names.
  (func $bashScanWord
    (local $c i32)
    (block $done
      (loop $l
        (call $scanIdentRun (i32.const "-"))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done
          (i32.and (i32.ne (local.get $c) (i32.const "/")) (i32.ne (local.get $c) (i32.const "."))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; Scan the body of a quoted `$(`/`$((` substitution from $ptr with $depth
  ;; parens open, emitting it as string.special and the closing paren as
  ;; punctuation. Only the parentheses move $depth, so hop straight to the
  ;; next one. Returns the depth still open when $end arrived first, 0 when
  ;; the substitution closed.
  (func $bashSubstScan (param $depth i32) (result i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (block $done
      (loop $sub
        (global.set $ptr (call $lexFindEither (global.get $ptr) (i32.const "(") (i32.const ")")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "("))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
          (else
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (if (i32.eqz (local.get $depth))
              (then (br $done)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $sub)))
    (call $emitTok (enum.get $Token.string.special) (local.get $seg) (global.get $ptr))
    (if (i32.lt_u (global.get $ptr) (global.get $end))
      (then
        (local.set $seg (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))))
    (local.get $depth))

  ;; Scan the inside of a `${` expansion from $ptr up to its `}`, emitting the
  ;; name as a variable and the brace as punctuation. The name ends at the
  ;; brace or at the line break: an expansion cut by a line break is over
  ;; without its brace, so a whole-buffer run and a line-fed stream agree.
  ;; Returns 1 when the expansion ended (brace found or line break reached),
  ;; 0 when $end arrived first.
  (func $bashBraceScan (result i32)
    (local $seg i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr
      (call $scanFind3 (global.get $ptr) (i32.const "}") (i32.const 10) (i32.const 13)))
    (call $emitTok (enum.get $Token.variable) (local.get $seg) (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "}"))
      (then (return (i32.const 1))))
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $seg) (global.get $ptr))
    (i32.const 1))

  ;; Emit a parameter expansion beginning at `$`. In a double-quoted string,
  ;; command substitutions are kept together so the quote remains owned by the
  ;; outer lexer; unquoted substitutions return after their opener. Returns 0
  ;; when the expansion is complete, the open paren depth when a quoted `$(`
  ;; ran into $end, or -1 when a `${` did - the double-quoted string
  ;; checkpoints that so the next chunk finishes the expansion first.
  (func $bashDollar (param $quoted i32) (result i32)
    (local $c i32)
    (local $close i32)
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then
        (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
        (return (i32.const 0))))
    (local.set $c (i32.load8_u (global.get $ptr)))
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (if (call $bashBraceScan)
          (then (return (i32.const 0))))
        (return (i32.const -1))))
    (if (i32.eq (local.get $c) (i32.const "("))
      (then
        (local.set $close (i32.const 1))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (if
          (i32.eq (call $bashByte (global.get $ptr)) (i32.const "("))
          (then
            (local.set $close (i32.const 2))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
        (if (i32.eqz (local.get $quoted))
          (then
            (if (i32.eq (local.get $close) (i32.const 2))
              (then (global.set $bashArith (i32.add (global.get $bashArith) (i32.const 1)))))
            (return (i32.const 0))))
        (return (call $bashSubstScan (local.get $close)))))
    (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
      (then (call $scanIdentRun (i32.const 0)))
      (else
        (if
          (i32.or (i32.eq (local.get $c) (i32.const "$")) (call $bashIsSpecialParam (local.get $c)))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
    (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
    (i32.const 0))

  ;; Scan a double-quoted string body from $ptr; $seg includes the opening
  ;; quote for a new literal and starts at $ptr when resuming a stream chunk.
  ;; The string ends at `"`, and only a backslash escape or a `$` expansion
  ;; interrupts it, so each step hops to the first of the three: one SIMD pass
  ;; locates the quote or the backslash, then a second - bounded by that hit,
  ;; so it never runs past the string - locates an earlier `$`. The quote or
  ;; backslash hit stays valid until $ptr passes it, so it is searched again
  ;; only then: a fresh search per `$` made long strings quadratic. Returns 1
  ;; after the closing quote, else 0 with the expansion left open at $end
  ;; recorded in $streamA (paren depth) and $streamB (inside `${`).
  (func $bashDoubleBody (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $open i32)
    (local $stop i32)
    (block $done
      (loop $l
        ;; an expansion such as `$(...)` may consume past the old hit
        (if (i32.or (i32.eqz (local.get $stop)) (i32.gt_u (global.get $ptr) (local.get $stop)))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (i32.const 34)
                (i32.const 1)
                (i32.const 0)))))
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (local.get $stop)
            (i32.const "$")
            (i32.const 0)
            (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e
              (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $open (call $bashDollar (i32.const 1)))
            (local.set $seg (global.get $ptr))
            (br $l)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    ;; $open is only nonzero when the last expansion ran into $end
    (global.set $streamA
      (select (local.get $open) (i32.const 0) (i32.gt_s (local.get $open) (i32.const 0))))
    (global.set $streamB (i32.eq (local.get $open) (i32.const -1)))
    (i32.const 0))

  ;; A double-quoted string beginning at $ptr. An unclosed body at a chunk end
  ;; becomes bash-owned stream mode 12, resumed by $bashStreamResume.
  (func $bashDouble
    (local $lhs i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if
      (i32.and
        (i32.eqz (call $bashDoubleBody (local.get $lhs)))
        (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $end))))
      (then
        (global.set $streamMode (i32.const 12))
        (global.set $streamHl (enum.get $Token.string)))))

  (func $bashRangeEq (param $a i32) (param $b i32) (param $n i32) (result i32)
    (local $i i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (if
          (i32.ne
            (i32.load8_u (i32.add (local.get $a) (local.get $i)))
            (i32.load8_u (i32.add (local.get $b) (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $l)))
    (i32.const 1))

  ;; A bare heredoc delimiter is a word: bash ends it at whitespace or at a
  ;; metacharacter, so `<<EOF|tr` and `<<EOF;echo` take `EOF` alone.
  (func $bashIsWordEnd (param $c i32) (result i32)
    (i32.or (call $lexIsSpace (local.get $c)) (byteset.get "&();<>|" (local.get $c))))

  ;; Consume the body of a here-document from $ptr, the start of the line
  ;; after its opener, through the line holding the $n-byte delimiter at
  ;; $delim; `$strip` permits leading tabs on that line. An unterminated body
  ;; runs to $end and, in streaming, checkpoints the delimiter so the next
  ;; chunk keeps looking for it.
  (func $bashHeredocBody (param $delim i32) (param $n i32) (param $strip i32)
    (local $body i32)
    (local $lhs i32)
    (local $line i32)
    (local.set $body (global.get $ptr))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $line (global.get $ptr))
        (if (local.get $strip)
          (then
            (block $tabsDone
              (loop $tabs
                (br_if $tabsDone (i32.ge_u (local.get $line) (global.get $end)))
                (br_if $tabsDone (i32.ne (i32.load8_u (local.get $line)) (i32.const 9)))
                (local.set $line (i32.add (local.get $line) (i32.const 1)))
                (br $tabs)))))
        (if
          (i32.and
            (i32.le_u (i32.add (local.get $line) (local.get $n)) (global.get $end))
            (i32.and
              (call $bashRangeEq (local.get $line) (local.get $delim) (local.get $n))
              (i32.or
                (i32.eq (i32.add (local.get $line) (local.get $n)) (global.get $end))
                (i32.or
                  (i32.eq (i32.load8_u (i32.add (local.get $line) (local.get $n))) (i32.const 10))
                  (i32.eq
                    (i32.load8_u (i32.add (local.get $line) (local.get $n)))
                    (i32.const 13))))))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $scanToLineEnd)
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (return)))
        (call $scanToLineEnd)
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br $lines)))
    (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $ptr))
    (call $streamSetLine
      (local.get $delim)
      (local.get $n)
      (local.get $strip)
      (enum.get $Token.string)))

  (func $bashIsOp (param $c i32) (result i32)
    (byteset.get "!&;<=>|~" (local.get $c)))

  ;; Does the `(` at $p open an array, `NAME=(`, `NAME+=(`, or `a[i]=(`,
  ;; outside arithmetic? Its lines then hold elements, not commands.
  (func $bashIsArrayOpen (param $p i32) (result i32)
    (local $c i32)
    (if
      (i32.or
        (global.get $bashArith)
        (i32.lt_u (local.get $p) (i32.add (global.get $srcBase) (i32.const 2))))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "="))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 2))))
    (i32.or
      (call $lexIsIdentContinue (local.get $c))
      (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "]")))))

  ;; $cmd is 1 where a word is a command: at a line start, after `;`, `&`,
  ;; `|`, a command-list keyword, an unquoted `$(`, a subshell or process
  ;; substitution `(`, a group `{`, a case arm's `)`, and after a `VAR=x`
  ;; prefix. Keywords apply only there, except an awaited `in`. $flow packs
  ;; the rest of the statement state, carried across chunks in one local:
  ;; bits 0-1 are the case state - 1 after `case` until its `in`, 2 at a
  ;; pattern (no commands, only `esac`), 3 in an arm body - bit 2 (4) marks
  ;; the `in` awaited after `for NAME`/`case WORD`, and bit 3 (8) an
  ;; assignment at command position waiting for the blank that starts its
  ;; command. $arrayOpen counts the parens of an open `NAME=(` array, whose
  ;; lines hold elements rather than commands.
  (func $hlBash
    (local $c i32)
    (local $c2 i32)
    (local $cmd i32)
    (local $flow i32)
    (local $arrayOpen i32)
    (local $decl i32)
    (local $gap i32)
    (local $group i32)
    ;; a here-document opened on the current line: its delimiter bytes, their
    ;; count, and whether `<<-` allows leading tabs; the body is consumed at
    ;; the line break. Chunks end at line breaks, so the delimiter pointer is
    ;; always used within the chunk that produced it.
    (local $hdDelim i32)
    (local $hdLen i32)
    (local $hdStrip i32)
    (local $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local $quote i32)
    (local $rhs i32)
    ;; a whole-buffer run, a stream reset, or an embedded range starts outside
    ;; any `$((`; a continued stream chunk keeps the count from the last one
    (if
      (i32.or
        (i32.eqz (global.get $streaming))
        (i32.or (global.get $streamReset) (global.get $streamDepth)))
      (then (global.set $bashArith (i32.const 0))))
    (call $lexEmitLeadingContinuation)
    ;; command position holds at a line start outside an array; a chunk that
    ;; resumes after a string closed mid-line - `"a\n"# c` - continues that
    ;; line instead
    (local.set $cmd (i32.eqz (local.get $arrayOpen)))
    (if (i32.gt_u (global.get $ptr) (global.get $srcBase))
      (then
        (local.set $c (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))))
        (local.set $cmd
          (i32.and
            (local.get $cmd)
            (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))))))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (if (local.get $hdLen)
          (then
            ;; the pending heredoc body starts after this line's break, so
            ;; skip blanks only and consume just the LF or CRLF
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (if
              (i32.and
                (i32.lt_u (global.get $ptr) (global.get $end))
                (i32.and
                  (i32.le_u (i32.add (local.get $hdDelim) (local.get $hdLen)) (global.get $ptr))
                  (i32.or
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 10))
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 13)))))
              (then
                (local.set $c (i32.load8_u (global.get $ptr)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 13))
                    (i32.eq (call $bashByte (global.get $ptr)) (i32.const 10)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitGap (local.get $gap) (global.get $ptr))
                (call $bashHeredocBody (local.get $hdDelim) (local.get $hdLen) (local.get $hdStrip))
                (local.set $hdLen (i32.const 0))
                (local.set $cmd (i32.const 1))
                (br $next)))))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $cmd (i32.eqz (local.get $arrayOpen)))
            ;; `case WORD` and `for NAME` may put `in` on the next line
            (local.set $flow (i32.and (local.get $flow) (i32.const 7)))
            ;; a line break without a body - the opener was the final line
            ;; of a bounded range - drops the pending heredoc
            (local.set $hdLen (i32.const 0)))
          (else
            ;; the blank after `VAR=x` starts the command it prefixes (bit 3
            ;; is the top bit of $flow)
            (if (i32.ge_u (local.get $flow) (i32.const 8))
              (then
                (if (i32.lt_u (local.get $gap) (global.get $ptr))
                  (then
                    (local.set $cmd (i32.const 1))
                    (local.set $flow (i32.and (local.get $flow) (i32.const -9)))))))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "#"))
            (i32.or (local.get $cmd) (i32.lt_u (local.get $gap) (global.get $ptr))))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexRawString (i32.const 39) (i32.const 1) (enum.get $Token.string))
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $bashDouble)
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexString (i32.const "`") (i32.const 1) (enum.get $Token.string.special))
            (local.set $cmd (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (if (i32.eq (local.get $c2) (i32.const 39))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (call $lexString (i32.const 39) (i32.const 1) (enum.get $Token.string))
                (local.set $cmd (i32.const 0))
                (br $next)))
            (local.set $p (global.get $bashArith))
            (drop (call $bashDollar (i32.const 0)))
            ;; an unquoted `$(` opens a command; `$((` (which counted itself
            ;; into $bashArith) opens arithmetic
            (local.set $cmd
              (i32.and
                (i32.eq (local.get $c2) (i32.const "("))
                (i32.eq (global.get $bashArith) (local.get $p))))
            (if (i32.eq (local.get $c2) (i32.const "("))
              (then
                (local.set $flow (i32.and (local.get $flow) (i32.const -9)))
                ;; both parens of `$((` close separately
                (if (local.get $arrayOpen)
                  (then
                    (local.set $arrayOpen
                      (i32.add
                        (local.get $arrayOpen)
                        (i32.sub (i32.const 2) (local.get $cmd))))))))
            (br $next)))
        ;; `<<` opens a heredoc only as a redirection: `<<<` is a here-string and
        ;; a `<<` inside `$(( ))` is a left shift, and both fall through to the
        ;; operator path instead. The opener emits `<<`, blanks, and the
        ;; delimiter word; the rest of the line lexes normally and the body
        ;; is consumed at the line break (see $hdLen above). A second heredoc
        ;; on the same line keeps its word but the first delimiter wins.
        (if
          (i32.and
            (i32.and
              (i32.eq (local.get $c) (i32.const "<"))
              (i32.eq (local.get $c2) (i32.const "<")))
            (i32.and
              (i32.eqz (global.get $bashArith))
              (i32.or
                (i32.ge_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (i32.ne (i32.load8_u offset=2 (global.get $ptr)) (i32.const "<")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (local.set $p (i32.const 0))
            (if
              (i32.eq (call $bashByte (global.get $ptr)) (i32.const "-"))
              (then
                (local.set $p (i32.const 1))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $gap (global.get $ptr))
            (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
            (call $emitGap (local.get $gap) (global.get $ptr))
            (local.set $cmd (i32.const 0))
            (br_if $next (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $lhs (global.get $ptr))
            (local.set $quote (i32.load8_u (global.get $ptr)))
            (if
              (i32.or
                (i32.eq (local.get $quote) (i32.const 34))
                (i32.eq (local.get $quote) (i32.const 39)))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $rhs (global.get $ptr))
                (global.set $ptr
                  (call $scanFindSpecial
                    (global.get $ptr)
                    (global.get $end)
                    (local.get $quote)
                    (i32.const 0)
                    (i32.const 1)))
                (local.set $group (i32.sub (global.get $ptr) (local.get $rhs)))
                (if
                  (i32.eq (call $bashByte (global.get $ptr)) (local.get $quote))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))))
              (else
                (local.set $rhs (global.get $ptr))
                (block $bareDone
                  (loop $bare
                    (br_if $bareDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (br_if $bareDone (call $bashIsWordEnd (i32.load8_u (global.get $ptr))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $bare)))
                (local.set $group (i32.sub (global.get $ptr) (local.get $rhs)))))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (if (i32.and (i32.eqz (local.get $hdLen)) (local.get $group))
              (then
                (local.set $hdDelim (local.get $rhs))
                (local.set $hdLen (local.get $group))
                (local.set $hdStrip (local.get $p))))
            (br $next)))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $cmd (i32.const 0))
            (br $next)))
        ;; a word; `$` never reaches here
        (if
          (if (result i32) (call $lexIsIdentStart (local.get $c))
            (then (i32.const 1))
            (else
              ;; `-`, `.`, `/` (45-47), or `~`
              (if (result i32)
                (i32.or
                  (i32.le_u (i32.sub (local.get $c) (i32.const "-")) (i32.const 2))
                  (i32.eq (local.get $c) (i32.const "~")))
                (then (call $bashIsPunctWordStart (local.get $c) (local.get $c2)))
                (else (i32.const 0)))))
          (then
            (if (i32.eq (local.get $c) (i32.const "~"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $bashScanWord)
            (local.set $rhs (global.get $ptr))
            ;; keywords only where a command may start, or the awaited `in`;
            ;; among case patterns only `esac`
            (local.set $group (i32.const 0))
            (if (i32.or (local.get $cmd) (i32.and (local.get $flow) (i32.const 4)))
              (then
                (local.set $group (keyword-table.get $bashWords (local.get $lhs) (local.get $rhs)))
                (if (local.get $group)
                  (then
                    (if
                      (i32.or
                        (i32.ne
                          (i32.eq (local.get $group) (i32.const 4))
                          (i32.ne (i32.and (local.get $flow) (i32.const 4)) (i32.const 0)))
                        (i32.and
                          (i32.eq (i32.and (local.get $flow) (i32.const 3)) (i32.const 2))
                          (i32.ne (local.get $group) (i32.const 3))))
                      (then (local.set $group (i32.const 0))))))))
            (local.set $hl (call $bashWordHl (local.get $group)))
            (if (local.get $decl)
              (then
                (local.set $hl (enum.get $Token.function.definition))
                (local.set $decl (i32.const 0)))
              (else
                (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (then
                    (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                    (if
                      (i32.and
                        (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                        (i32.eq (i32.load16_u (local.get $p)) (i32.const "()")))
                      (then (local.set $hl (enum.get $Token.function.definition)))
                      (else
                        (if (local.get $cmd)
                          (then
                            (if
                              (i32.eq (call $bashByte (global.get $ptr)) (i32.const "="))
                              (then (local.set $flow (i32.or (local.get $flow) (i32.const 8))))
                              (else
                                ;; a case pattern is never a command
                                (if (i32.ne (i32.and (local.get $flow) (i32.const 3)) (i32.const 2))
                                  (then (local.set $hl (enum.get $Token.function))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            ;; what may follow: arguments after a plain word or most keywords,
            ;; a command after a command-list keyword (bits 1 and 9 of 0x202)
            (local.set $cmd (i32.and (i32.shr_u (i32.const 0x202) (local.get $group)) (i32.const 1)))
            (if (i32.ge_u (local.get $group) (i32.const 3))
              (then
                ;; `esac` closes the case
                (if (i32.eq (local.get $group) (i32.const 3))
                  (then (local.set $flow (i32.and (local.get $flow) (i32.const -4)))))
                ;; `in` arrives; after `case WORD`, patterns follow
                (if (i32.eq (local.get $group) (i32.const 4))
                  (then
                    (local.set $flow (i32.and (local.get $flow) (i32.const -5)))
                    (if (i32.eq (i32.and (local.get $flow) (i32.const 3)) (i32.const 1))
                      (then (local.set $flow (i32.add (local.get $flow) (i32.const 1)))))))
                (if (i32.ge_u (local.get $group) (i32.const 5))
                  (then
                    ;; `for`, `select`, and `case` await an `in`
                    (local.set $flow
                      (i32.or
                        (i32.and (local.get $flow) (i32.const -5))
                        (select (i32.const 4) (i32.const 0) (i32.le_u (local.get $group) (i32.const 6)))))
                    (if (i32.eq (local.get $group) (i32.const 6))
                      (then
                        (local.set $flow
                          (i32.or (i32.and (local.get $flow) (i32.const -4)) (i32.const 1)))))
                    ;; `function` names the next word; the token test keeps a
                    ;; `function` captured as a definition from opening another
                    (if
                      (i32.and
                        (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                        (i32.eq (local.get $group) (i32.const 8)))
                      (then (local.set $decl (i32.const 1))))))))
            (br $next)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $p (local.get $cmd))
            (local.set $cmd (i32.const 0))
            (if (i32.gt_u (local.get $c) (i32.const ")"))
              (then
                ;; `[[`/`]]` double only when the second bracket is inside the
                ;; range: a bounded scan must never emit a byte the host still
                ;; owns
                (if
                  (i32.eq (call $bashByte (global.get $ptr)) (local.get $c))
                  (then
                    (if (i32.le_u (local.get $c) (i32.const "]"))
                      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
                ;; a `{` group holds commands; `{a,b}` is a brace expansion
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then
                    (local.set $cmd
                      (i32.or
                        (i32.ge_u (global.get $ptr) (global.get $end))
                        (call $lexIsSpace (i32.load8_u (global.get $ptr)))))))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (br $next)))
            ;; `))` closes the innermost counted `$((` or `((`
            (if
              (i32.and
                (i32.and
                  (i32.ne (global.get $bashArith) (i32.const 0))
                  (i32.eq (local.get $c) (i32.const ")")))
                (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ")"))))
              (then (global.set $bashArith (i32.sub (global.get $bashArith) (i32.const 1)))))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (local.set $flow (i32.and (local.get $flow) (i32.const -9)))
                (if
                  (i32.and
                    (i32.or (local.get $p) (i32.ne (i32.and (local.get $flow) (i32.const 4)) (i32.const 0)))
                    (i32.eq (call $bashByte (global.get $ptr)) (i32.const "(")))
                  (then
                    ;; `((` at command position, or the C-style header of a
                    ;; `for ((`, is arithmetic, where `<<` is a shift and not
                    ;; a heredoc and `;` separates expressions
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (global.set $bashArith (i32.add (global.get $bashArith) (i32.const 1)))
                    (local.set $flow (i32.and (local.get $flow) (i32.const -5)))
                    (local.set $p (i32.const 0))))
                (if (call $bashIsArrayOpen (local.get $lhs))
                  (then (local.set $arrayOpen (i32.const 1)))
                  (else
                    (if (local.get $arrayOpen)
                      (then
                        (local.set $arrayOpen
                          (i32.add (local.get $arrayOpen) (i32.sub (global.get $ptr) (local.get $lhs))))))
                    ;; a subshell, or the command of a `<(`/`>(` substitution
                    (local.set $cmd
                      (i32.or
                        (local.get $p)
                        (i32.and
                          (i32.gt_u (local.get $lhs) (global.get $srcBase))
                          (i32.eq
                            (i32.or (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 2))
                            (i32.const ">")))))))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then
                (if (local.get $arrayOpen)
                  (then (local.set $arrayOpen (i32.sub (local.get $arrayOpen) (i32.const 1)))))
                ;; a case pattern's `)` opens its arm
                (if (i32.eq (i32.and (local.get $flow) (i32.const 3)) (i32.const 2))
                  (then
                    (local.set $flow (i32.add (local.get $flow) (i32.const 1)))
                    (local.set $cmd (i32.const 1))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (call $bashIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if
              (i32.and
                (i32.lt_u (global.get $ptr) (global.get $end))
                (i32.or
                  (i32.eq (local.get $c2) (i32.const "="))
                  (i32.eq (local.get $c) (local.get $c2))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if
                  (i32.eq (call $bashByte (global.get $ptr)) (local.get $c))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            ;; separators start a command, except inside `(( ))`/`$(( ))`
            (if
              (i32.and
                (i32.eqz (global.get $bashArith))
                (i32.or
                  (i32.eq (local.get $c) (i32.const ";"))
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "&"))
                    (i32.eq (local.get $c) (i32.const "|")))))
              (then
                (local.set $cmd (i32.const 1))
                (local.set $flow (i32.and (local.get $flow) (i32.const 3)))
                ;; `;;`, `;&`, and `;;&` end a case arm: a pattern follows
                (if (i32.eq (local.get $flow) (i32.const 3))
                  (then
                    (if
                      (i32.and
                        (i32.eq (local.get $c) (i32.const ";"))
                        (i32.or
                          (i32.eq (local.get $c2) (i32.const ";"))
                          (i32.eq (local.get $c2) (i32.const "&"))))
                      (then (local.set $flow (i32.const 2))))))))
            (br $next)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $cmd (i32.const 0))
        (br $next))))

  ;; Resume bash-owned stream mode 12: a double-quoted string body left open
  ;; at the previous chunk end. An expansion the chunk ended inside - a `$(`
  ;; with $streamA parens open or a `${` waiting for its brace ($streamB) -
  ;; finishes first, then the body continues from $ptr so later `$`
  ;; expansions still highlight. Returns 1 when the mode consumed the whole
  ;; chunk, 0 when the language lexer should continue from $ptr.
  (func $bashStreamResume (result i32)
    (if (global.get $streamA)
      (then
        (global.set $streamA (call $bashSubstScan (global.get $streamA)))
        (if (global.get $streamA)
          (then (return (i32.const 1))))))
    (if (global.get $streamB)
      (then
        (if (i32.eqz (call $bashBraceScan))
          (then (return (i32.const 1))))
        (global.set $streamB (i32.const 0))))
    (if (call $bashDoubleBody (global.get $ptr))
      (then
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (i32.const 1))
)
