(module
  (import "../common.wat")

  (func $dockerByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Instructions are case-insensitive, so the table holds lowercase words
  ;; and $dockerWordGroup probes it with a lowercased copy of the input word.
  ;; Group order is the dispatch order in $hlDockerfile: shell-form
  ;; instructions, other instructions, the `AS` of a stage name, and the
  ;; instructions that wrap another one after their options.
  (keyword-table $dockerfileWords $mem.dockerfileWords $mem.elixirWords
    (group "run" "cmd" "entrypoint" "shell") ;; 1: shell command follows
    (group ;; 2: other instructions
      "from" "add" "arg" "env" "copy" "user" "label" "expose" "volume" "workdir"
      "stopsignal" "maintainer")
    (group "as")                        ;; 3: stage alias
    (group "onbuild" "healthcheck"))    ;; 4: `HEALTHCHECK CMD ...`, `ONBUILD RUN ...`

  ;; The table group of the word [lhs,rhs) compared case-insensitively
  (func $dockerWordGroup (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local.set $n
      (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (keyword-table.get $dockerfileWords
      (i32.const $mem.lexLowerScratch)
      (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))

  ;; A heredoc body after its opener's line, shared with terraform.wat: skip
  ;; the blanks left on that line and, at its LF or CRLF, emit the break as a
  ;; gap from $gap and consume the body through the line holding the $n-byte
  ;; delimiter at $delim; `$strip` permits leading blanks on that line
  ;; (`<<-`). Returns 0, with $ptr after the blanks, when more text follows
  ;; on the opener's line or the input ends there. An unterminated body runs
  ;; to $end and, in streaming, checkpoints the delimiter so the next chunk
  ;; keeps looking for it.
  (func $dockerHeredoc (param $gap i32) (param $delim i32) (param $n i32) (param $strip i32) (result i32)
    (local $body i32)
    (local $line i32)
    (local $i i32)
    (local $same i32)
    (global.set $ptr (call $lexSkipSpaceAt (global.get $ptr)))
    (if (i32.ge_u (global.get $ptr) (global.get $end))
      (then (return (i32.const 0))))
    (local.set $body (i32.load8_u (global.get $ptr)))
    (if (i32.and (i32.ne (local.get $body) (i32.const 10)) (i32.ne (local.get $body) (i32.const 13)))
      (then (return (i32.const 0))))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (if
      (i32.and
        (i32.eq (local.get $body) (i32.const 13))
        (i32.eq (call $dockerByte (global.get $ptr)) (i32.const 10)))
      (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (call $emitGap (local.get $gap) (global.get $ptr))
    (local.set $body (global.get $ptr))
    (block $done
      (loop $lines
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $line (global.get $ptr))
        (if (local.get $strip)
          (then (local.set $line (call $lexSkipSpaceAt (local.get $line)))))
        (local.set $same (i32.le_u (i32.add (local.get $line) (local.get $n)) (global.get $end)))
        (local.set $i (i32.const 0))
        (block $cmpDone
          (loop $cmp
            (br_if $cmpDone (i32.eqz (local.get $same)))
            (br_if $cmpDone (i32.ge_u (local.get $i) (local.get $n)))
            (local.set $same
              (i32.eq
                (i32.load8_u (i32.add (local.get $line) (local.get $i)))
                (i32.load8_u (i32.add (local.get $delim) (local.get $i)))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $cmp)))
        ;; the delimiter must fill its line, then the line and one break
        ;; byte join the body
        (if (local.get $same)
          (then
            (local.set $same
              (call $lineDelimiterEnds (i32.add (local.get $line) (local.get $n)) (i32.const 0)))))
        (call $scanToLineEnd)
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br_if $lines (i32.eqz (local.get $same)))))
    (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $ptr))
    (if (i32.eqz (local.get $same))
      (then
        (call $streamSetLine
          (local.get $delim)
          (local.get $n)
          (i32.shl (local.get $strip) (i32.const 1))
          (enum.get $Token.string))))
    (i32.const 1))

  ;; A `\` at $ptr followed by blanks and a line break (or $end) joins the
  ;; next line, shared with makefile.wat: emit it as punctuation.special,
  ;; consume the blanks and the LF or CRLF as a gap here so the caller's gap
  ;; scan does not see a new line, and return 1. Returns 0, consuming
  ;; nothing, before any other byte.
  (func $dockerLineJoin (result i32)
    (local $p i32)
    (local $c i32)
    (local.set $p (call $lexSkipSpaceAt (i32.add (global.get $ptr) (i32.const 1))))
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.and (i32.ne (local.get $c) (i32.const 10)) (i32.ne (local.get $c) (i32.const 13)))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 13))
            (i32.eq (call $dockerByte (local.get $p)) (i32.const 10)))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok
      (enum.get $Token.punctuation.special)
      (i32.sub (global.get $ptr) (i32.const 1))
      (global.get $ptr))
    (call $emitGap (global.get $ptr) (local.get $p))
    (global.set $ptr (local.get $p))
    (i32.const 1))

  ;; Advance $ptr over the `${...}` or `$name` reference whose `$` sits at
  ;; $ptr, given the byte after it; 0, consuming nothing, when neither opens.
  ;; A `${` reference ends at the first `}` or line break.
  (func $dockerVar (param $c2 i32) (result i32)
    (if (i32.eq (local.get $c2) (i32.const "{"))
      (then
        (global.set $ptr
          (call $scanFindSpecial
            (i32.add (global.get $ptr) (i32.const 2))
            (global.get $end)
            (i32.const "}")
            (i32.const 0)
            (i32.const 1)))
        (if (i32.eq (call $dockerByte (global.get $ptr)) (i32.const "}"))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (return (i32.const 1))))
    (if (i32.eqz (call $lexIsIdentStart (local.get $c2)))
      (then (return (i32.const 0))))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $scanIdentRun (i32.const "_"))
    (i32.const 1))

  (func $dockerIsShellOp (param $c i32) (result i32)
    (byteset.get "&;<=>|" (local.get $c)))

  ;; A Dockerfile is line-oriented: $lineHead is 1 until the first token of
  ;; a logical line, where the instruction word sits and a `#` opens a
  ;; comment. $inst is 1 after `FROM` - its `AS` is a keyword - 2 after a
  ;; shell-form instruction, whose command words $cmdHead marks after the
  ;; instruction and each `&&`, `||`, `|`, or `;`, 3 after any other
  ;; instruction, and 4 after `HEALTHCHECK` or `ONBUILD`, where the next
  ;; word is the wrapped instruction; heredocs open after any of them. A `\`
  ;; before the line break joins the next line, so the line-head state
  ;; survives it, and $lineHead is 2 at the start of the joined line: a `#`
  ;; there is a comment line that BuildKit drops, and the instruction
  ;; continues after it. A heredoc opener leaves $hdLen, $hdDelim, and
  ;; $hdStrip pending until the line break, after which its body runs to the
  ;; delimiter line. All are checkpointed.
  (func $hlDockerfile
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $g i32)
    (local $lineHead i32)
    (local $inst i32)
    (local $cmdHead i32)
    (local $hdLen i32)
    (local $hdDelim i32)
    (local $hdStrip i32)
    (local.set $lineHead (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        ;; the pending heredoc body starts after this line's break; an
        ;; opener on the final line of the input has no body
        (if (local.get $hdLen)
          (then
            (if
              (call $dockerHeredoc
                (local.get $gap)
                (local.get $hdDelim)
                (local.get $hdLen)
                (local.get $hdStrip))
              (then
                (local.set $hdLen (i32.const 0))
                (local.set $lineHead (i32.const 1))
                (local.set $inst (i32.const 0))
                (local.set $cmdHead (i32.const 0))
                (br $next)))
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then (local.set $hdLen (i32.const 0))))))

        (call $scanWhitespace)
        ;; the gap crossed a line break when a CR/LF sits before the new $ptr
        (if
          (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            ;; a comment or empty line inside a continuation keeps it
            (if (i32.ne (local.get $lineHead) (i32.const 2))
              (then
                (local.set $lineHead (i32.const 1))
                (local.set $inst (i32.const 0))
                (local.set $cmdHead (i32.const 0))))
            ;; a line break without a body - the opener was the final line
            ;; of a bounded range - drops the pending heredoc
            (local.set $hdLen (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $dockerByte (i32.add (global.get $ptr) (i32.const 1))))

        ;; comments and parser directives only start a line, or a line
        ;; joined by `\`
        (if
          (i32.and
            (i32.ne (local.get $lineHead) (i32.const 0))
            (i32.eq (local.get $c) (i32.const "#")))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        ;; the instruction word, or the one `HEALTHCHECK`/`ONBUILD` wraps
        (if
          (i32.and
            (i32.or
              (i32.eq (local.get $lineHead) (i32.const 1))
              (i32.eq (local.get $inst) (i32.const 4)))
            (call $lexIsIdentStart (local.get $c)))
          (then
            (local.set $lineHead (i32.const 0))
            (call $lexScanIdent)
            (local.set $g (call $dockerWordGroup (local.get $lhs) (global.get $ptr)))
            (if
              (i32.and
                (i32.ne (local.get $g) (i32.const 0))
                (i32.ne (local.get $g) (i32.const 3)))
              (then
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (local.set $inst
                  (select (i32.const 2) (i32.const 3) (i32.eq (local.get $g) (i32.const 1))))
                (if (i32.eq (local.get $g) (i32.const 4))
                  (then (local.set $inst (i32.const 4))))
                (if
                  (i32.and
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 4))
                    (i32.eq
                      (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020))
                      (i32.const "from")))
                  (then (local.set $inst (i32.const 1))))
                (local.set $cmdHead (i32.eq (local.get $inst) (i32.const 2))))
              (else
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
                ;; `HEALTHCHECK NONE` wraps nothing
                (if (i32.eq (local.get $inst) (i32.const 4))
                  (then (local.set $inst (i32.const 3))))))
            (br $next)))
        (local.set $lineHead (i32.const 0))

        ;; `\` before the line break continues the logical line; elsewhere
        ;; it escapes the next byte
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (if (call $dockerLineJoin)
              (then
                (local.set $lineHead (i32.const 2))
                (br $next)))
            (global.set $ptr (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (local.set $cmdHead (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexRawString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (local.set $cmdHead (i32.const 0))
            (br $next)))

        ;; `$name` and `${name:-default}` build arguments
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (if (call $dockerVar (local.get $c2))
              (then
                (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                (local.set $cmdHead (i32.const 0))
                (br $next)))))

        ;; `--flag=value` instruction options
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "-"))
            (i32.and
              (i32.eq (local.get $c2) (i32.const "-"))
              (call $lexIsIdentStart (call $dockerByte (i32.add (global.get $ptr) (i32.const 2))))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $scanIdentRun (i32.const "-"))
            (call $emitTok (enum.get $Token.variable.parameter) (local.get $lhs) (global.get $ptr))
            ;; the `=value` belongs to the option, so a shell-form command
            ;; still starts at the word after it: `RUN --mount=type=cache pip`.
            ;; `$name` and `${name}` inside it stay variables.
            (if
              (i32.and
                (i32.or (local.get $cmdHead) (i32.ne (local.get $inst) (i32.const 2)))
                (i32.eq (call $dockerByte (global.get $ptr)) (i32.const "=")))
              (then
                (local.set $lhs (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (block $valueDone
                  (loop $value
                    (br_if $valueDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (local.set $c (i32.load8_u (global.get $ptr)))
                    (br_if $valueDone (call $lexIsSpace (local.get $c)))
                    (if (i32.eq (local.get $c) (i32.const "$"))
                      (then
                        (local.set $p (global.get $ptr))
                        (if
                          (call $dockerVar
                            (call $dockerByte (i32.add (global.get $ptr) (i32.const 1))))
                          (then
                            (call $emitTok (enum.get $Token.none) (local.get $lhs) (local.get $p))
                            (call $emitTok (enum.get $Token.variable) (local.get $p) (global.get $ptr))
                            (local.set $lhs (global.get $ptr))
                            (br $value)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $value)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))

        ;; `<<EOF`, `<<-EOF`, `<<"EOF"`: a heredoc whose body follows the line
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "<"))
            (i32.and
              (i32.eq (local.get $c2) (i32.const "<"))
              (i32.ne (local.get $inst) (i32.const 0))))
          (then
            ;; $p: the delimiter word, $rhs: its opening quote byte or 0
            (local.set $hdStrip
              (i32.eq (call $dockerByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "-")))
            (local.set $rhs
              (i32.add (i32.add (global.get $ptr) (i32.const 2)) (local.get $hdStrip)))
            (local.set $p (local.get $rhs))
            (local.set $g (call $dockerByte (local.get $p)))
            (if
              (i32.or (i32.eq (local.get $g) (i32.const 34)) (i32.eq (local.get $g) (i32.const 39)))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
              (else (local.set $g (i32.const 0))))
            (if (call $lexIsIdentStart (call $dockerByte (local.get $p)))
              (then
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (local.get $rhs))
                (global.set $ptr (local.get $p))
                (local.set $hdDelim (local.get $p))
                (call $lexScanIdent)
                (local.set $hdLen (i32.sub (global.get $ptr) (local.get $hdDelim)))
                (if
                  (i32.and
                    (i32.ne (local.get $g) (i32.const 0))
                    (i32.eq (call $dockerByte (global.get $ptr)) (local.get $g)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.string.special) (local.get $rhs) (global.get $ptr))
                (local.set $cmdHead (i32.const 0))
                (br $next)))))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            (call $scanIdentRun (i32.const "-"))
            (if
              (i32.and
                (i32.eq (local.get $inst) (i32.const 1))
                (i32.eq (call $dockerWordGroup (local.get $lhs) (global.get $ptr)) (i32.const 3)))
              (then (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr)))
              (else
                (call $emitTok
                  (select (enum.get $Token.function) (enum.get $Token.none) (local.get $cmdHead))
                  (local.get $lhs)
                  (global.get $ptr))))
            (local.set $cmdHead (i32.const 0))
            (br $next)))

        ;; a number stands alone after blanks; digits inside `ubuntu:22.04`
        ;; stay plain
        (if (i32.and (call $lexIsDigit (local.get $c)) (i32.gt_u (local.get $lhs) (local.get $gap)))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $cmdHead (i32.const 0))
            (br $next)))

        (if (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (if (call $dockerIsShellOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone
                  (i32.eqz (call $dockerIsShellOp (call $dockerByte (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            ;; a shell command follows a pipeline or list operator
            (if
              (i32.and
                (i32.eq (local.get $inst) (i32.const 2))
                (i32.or
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "&"))
                    (i32.eq (local.get $c) (i32.const "|")))
                  (i32.eq (local.get $c) (i32.const ";"))))
              (then (local.set $cmdHead (i32.const 1))))
            (br $next)))

        (global.set $ptr
          (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
