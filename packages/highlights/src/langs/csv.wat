(module
  (import "../common.wat")

  (func $hlCsv
    (call $hlCsvImpl (i32.const ",") (i32.const 1)))

  ;; TSV (IANA text/tab-separated-values) has no quoting: a quote is data.
  (func $hlTsv
    (call $hlCsvImpl (i32.const 9) (i32.const 0)))

  ;; Rainbow columns: field $col takes entry $col mod 8 of a cycle of token
  ;; kinds that most bundled themes color differently, so adjacent columns
  ;; stay apart without a parser for the cell contents.
  (func $csvColumnTok (param $col i32) (result i32)
    ;; one token byte per column, lowest byte first; i64.shr_u takes its
    ;; count mod 64, so the shift selects byte $col mod 8
    (i32.and
      (i32.wrap_i64
        (i64.shr_u
          (i64.or
            (i64.or
              (i64.or
                (i64.extend_i32_u (enum.get $Token.string))
                (i64.shl (i64.extend_i32_u (enum.get $Token.type)) (i64.const 8)))
              (i64.or
                (i64.shl (i64.extend_i32_u (enum.get $Token.keyword)) (i64.const 16))
                (i64.shl (i64.extend_i32_u (enum.get $Token.number)) (i64.const 24))))
            (i64.or
              (i64.or
                (i64.shl (i64.extend_i32_u (enum.get $Token.function)) (i64.const 32))
                (i64.shl (i64.extend_i32_u (enum.get $Token.operator)) (i64.const 40)))
              (i64.or
                (i64.shl (i64.extend_i32_u (enum.get $Token.property)) (i64.const 48))
                (i64.shl (i64.extend_i32_u (enum.get $Token.variable.special)) (i64.const 56)))))
          (i64.extend_i32_u (i32.shl (local.get $col) (i32.const 3)))))
      (i32.const 255)))

  ;; Delimiter-separated values. Each field takes its column's color and each
  ;; delimiter is punctuation. With $quoting (RFC 4180), a field that starts
  ;; with `"` runs to the next lone `"`, across delimiters and line breaks; a
  ;; doubled `""` inside it is an escape. $col and $quoted carry over between
  ;; stream chunks, so a quoted line break keeps the next line's columns.
  (func $hlCsvImpl (param $delim i32) (param $quoting i32)
    (local $c i32)
    (local $col i32)
    (local $lhs i32)
    (local $p i32)
    (local $quoted i32)
    (local $tok i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $field
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $tok (call $csvColumnTok (local.get $col)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (block $next
          (if (local.get $quoted)
            (then
              (local.set $p
                (call $scanFindSpecial
                  (global.get $ptr) (global.get $end) (i32.const 34) (i32.const 0) (i32.const 1)))
              (call $emitTok (local.get $tok) (local.get $lhs) (local.get $p))
              (global.set $ptr (local.get $p))
              (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
              ;; a line break inside quotes continues the field on the next line
              (if (i32.ne (i32.load8_u (local.get $p)) (i32.const 34))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitGap (local.get $p) (global.get $ptr))
                  (br $next)))
              (if
                (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                  (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 34)))
                (then
                  (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                  (call $emitTok (enum.get $Token.string.escape) (local.get $p) (global.get $ptr))
                  (br $next)))
              (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
              (call $emitTok (local.get $tok) (local.get $p) (global.get $ptr))
              (local.set $quoted (i32.const 0))
              (br $next)))

          (if (i32.eq (local.get $c) (local.get $delim))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
              (local.set $col (i32.add (local.get $col) (i32.const 1)))
              (br $next)))

          ;; LF, CRLF, or a lone CR ends the record. Live documents split
          ;; lines at a lone CR too, so every mode resets the column there.
          (if (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13)))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (if
                (i32.and
                  (i32.eq (local.get $c) (i32.const 13))
                  (i32.and
                    (i32.lt_u (global.get $ptr) (global.get $end))
                    (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 10))))
                (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
              (call $emitGap (local.get $lhs) (global.get $ptr))
              (local.set $col (i32.const 0))
              (br $next)))

          (if (i32.and (local.get $quoting) (i32.eq (local.get $c) (i32.const 34)))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $emitTok (local.get $tok) (local.get $lhs) (global.get $ptr))
              (local.set $quoted (i32.const 1))
              (br $next)))

          ;; unquoted text, or stray text after a closing quote, runs to the
          ;; delimiter or the line break
          (local.set $p
            (call $scanFind3 (global.get $ptr) (local.get $delim) (i32.const 10) (i32.const 13)))
          (call $emitTok (local.get $tok) (local.get $lhs) (local.get $p))
          (global.set $ptr (local.get $p)))
        (br $field))))
)
