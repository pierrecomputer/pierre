(module
  (import "../common.wat")

  ;; identifier-start: a-z A-Z `_` and any byte >= 128 - leading `-` is resolved by
  ;; the callers, which must split `-2px` from `-webkit-x` and `--custom`
  (func $cssIdentStart (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
        (i32.eq (local.get $c) (i32.const "_")))
      (i32.ge_u (local.get $c) (i32.const 128))))

  ;; advance $ptr over identifier-continuation bytes, bounded by $end
  (func $cssScanIdent
    (call $scanIdentRun (i32.const "-")))

  ;; loose numeric tail + unit; the first byte, and any sign, is already
  ;; consumed. Digits, dots, exponents, then `%` or one trailing identifier run so
  ;; `1.5rem` / `80%` / `10px` / `1e-2s` are each a single number token.
  (func $cssScanNumber
    (local $c i32)
    (local $prev i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (block $consume
          (br_if $consume (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
          (br_if $consume (i32.eq (local.get $c) (i32.const ".")))
          (br_if $consume (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "e")))
          (if (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e")))
            (then (br $consume)))
          (br $done))
        (local.set $prev (local.get $c))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    ;; unit: `%` or an identifier run - `2n+1` stays `2n`
    ;; then `+` then `1`, and `1-2` never glues into one token
    (if (i32.lt_u (global.get $ptr) (global.get $end))
      (then
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
          (else
            (if (call $cssIdentStart (local.get $c))
              (then (call $cssScanIdent))))))))

  ;; quoted string starting at the opening quote: emitted as $Token.string with
  ;; 2-byte string.escape sub-spans for `\x` escapes. A raw CR/LF terminates the
  ;; (invalid) string leniently without being consumed; `\` + newline is an
  ;; escape, so continuation lines keep the string open. 16 bytes per step.
  (func $cssString
    (local $q i32)
    (local $seg i32)
    (local $c i32)
    (local $e i32)
    (local.set $q (i32.load8_u (global.get $ptr)))
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (block $done
      (loop $wide
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $q) (i32.const 1) (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $done)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10))
                             (i32.eq (local.get $c) (i32.const 13))))
        ;; backslash escape: `\` + up to 6 hex digits (css hex escape) or two
        ;; bytes, clamped to $end. An escaped multibyte UTF-8 character stays
        ;; whole inside the escape span - a span boundary must never split a
        ;; code point, or the output decodes to garbage
        (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
        (local.set $e (call $scanHexRun
          (i32.add (global.get $ptr) (i32.const 1)) (i32.const 6)))
        (if (i32.eq (local.get $e) (i32.add (global.get $ptr) (i32.const 1)))
          (then (local.set $e (i32.add (global.get $ptr) (i32.const 2)))))
        (local.set $e (call $utf8SpanEnd (local.get $e) (global.get $end)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (global.get $ptr))
        (br $wide)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr)))

  ;; whether [$lhs,$rhs) is a media/supports query operator:
  ;; `and` / `or` / `not` / `only`. wide loads may read past $rhs, always
  ;; inside the input buffer or its slack; masks drop the extra bytes
  (func $cssIsQueryOp (param $lhs i32) (param $rhs i32) (result i32)
    (local $len i32)
    (local $w i32)
    (local.set $len (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $w (i32.load (local.get $lhs)))
    (if (i32.eq (local.get $len) (i32.const 2))
      (then (return
        (i32.eq (i32.and (local.get $w) (i32.const 0xffff)) (i32.const "or")))))
    (if (i32.eq (local.get $len) (i32.const 3))
      (then
        (local.set $w (i32.and (local.get $w) (i32.const 0xffffff)))
        (return (i32.or
          (i32.eq (local.get $w) (i32.const "and"))
          (i32.eq (local.get $w) (i32.const "not"))))))
    (if (i32.eq (local.get $len) (i32.const 4))
      (then (return (i32.eq (local.get $w) (i32.const "only")))))
    (i32.const 0))

  ;; advance $ptr over an unquoted url body: everything up to whitespace, a
  ;; quote, or the closing paren - data: uris make these long, 16 bytes/step
  (func $cssScanUrlBody
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    (block $done
      (loop $wide
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $w (v128.load (global.get $ptr)))
        (local.set $mask (i8x16.bitmask (v128.or
          (v128.or
            (i8x16.le_u (i8x16.sub (local.get $w) (i8x16.splat (i32.const 9))) (i8x16.splat (i32.const 4)))
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 32))))
          (v128.or
            (v128.or
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const 34)))
              (i8x16.eq (local.get $w) (i8x16.splat (i32.const 39))))
            (i8x16.eq (local.get $w) (i8x16.splat (i32.const 41)))))))
        (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
        (if (i32.lt_u (local.get $rem) (i32.const 16))
          (then (local.set $mask (i32.and (local.get $mask)
            (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
        (if (local.get $mask)
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
            (br $done)))
        (if (i32.le_u (local.get $rem) (i32.const 16))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
        (br $wide))))

  ;; the statement-start decider: scan ahead from $ptr without emitting until
  ;; a `{` (returns 1: selector) or a `;` / `}` / $end (returns 0: leniently a
  ;; declaration), skipping strings and comments. The string skip mirrors
  ;; $cssString - a raw newline ends a string - so both passes agree.
  (func $cssDecide (result i32)
    (local $p i32)
    (local $c i32)
    (local $q i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    (local.set $p (global.get $ptr))
    (block $decl
      (loop $scan
        (br_if $decl (i32.ge_u (local.get $p) (global.get $end)))
        ;; hop to the next of `{` `}` `;` `/` or a quote, 16 bytes per step
        (block $found
          (loop $wide
            (local.set $w (v128.load (local.get $p)))
            (local.set $mask (i8x16.bitmask (v128.or
              (v128.or
                (v128.or
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "{")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "}"))))
                (v128.or
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const ";")))
                  (i8x16.eq (local.get $w) (i8x16.splat (i32.const "/")))))
              (v128.or
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const 34)))
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const 39)))))))
            (local.set $rem (i32.sub (global.get $end) (local.get $p)))
            (if (i32.lt_u (local.get $rem) (i32.const 16))
              (then (local.set $mask (i32.and (local.get $mask)
                (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
            (if (local.get $mask)
              (then
                (local.set $p (i32.add (local.get $p) (i32.ctz (local.get $mask))))
                (br $found)))
            (br_if $decl (i32.le_u (local.get $rem) (i32.const 16)))
            (local.set $p (i32.add (local.get $p) (i32.const 16)))
            (br $wide)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then (return (i32.const 1))))
        (if (i32.or (i32.eq (local.get $c) (i32.const "}"))
                    (i32.eq (local.get $c) (i32.const ";")))
          (then (return (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (if (i32.and
                  (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                  (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "*")))
              (then
                ;; skip the comment body, hopping star to star instead of
                ;; testing every byte; an unterminated comment stops at $end
                (local.set $p (i32.add (local.get $p) (i32.const 2)))
                (block $cDone
                  (loop $cl
                    (local.set $p (call $lexFindByte (local.get $p) (i32.const "*")))
                    (br_if $cDone (i32.ge_u (local.get $p) (global.get $end)))
                    (if (i32.and
                          (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                          (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "/")))
                      (then
                        (local.set $p (i32.add (local.get $p) (i32.const 2)))
                        (br $cDone)))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $cl))))
              (else (local.set $p (i32.add (local.get $p) (i32.const 1)))))
            (br $scan)))
        ;; skip a quoted string, hopping 16 bytes per step to the next quote,
        ;; backslash, or newline - the same three stop classes the scalar loop
        ;; tested, so a `\` still swallows one byte and a raw CR/LF still ends
        ;; the string unconsumed
        (local.set $q (local.get $c))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (block $sDone
          (loop $sl
            (local.set $p (call $scanFindSpecial (local.get $p) (global.get $end)
              (local.get $q) (i32.const 1) (i32.const 1)))
            (br_if $sDone (i32.ge_u (local.get $p) (global.get $end)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if (i32.eq (local.get $c) (local.get $q))
              (then
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $sDone)))
            (br_if $sDone (i32.or (i32.eq (local.get $c) (i32.const 10))
                                  (i32.eq (local.get $c) (i32.const 13))))
            (local.set $p (i32.add (local.get $p) (i32.const 2)))
            (br $sl)))
        (br $scan)))
    (i32.const 0))

  (func $hlCss
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $mid i32)
    (local $p i32)
    (local $mode i32)   ;; 0 selector, 1 at-prelude, 2 property, 3 value
    (local $decide i32) ;; 1 at a statement start: classify before dispatching
    (local $attr i32)   ;; selector-mode attr selector: 1 before `=`, 2 after
    (local $namespace i32) ;; @namespace prelude still expects its optional name
    (local.set $decide (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        ;; block comments, in any mode - also while a decision is pending
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))

        ;; statement start: at-rule, or the selector/declaration look-ahead
        (if (local.get $decide)
          (then
            (local.set $decide (i32.const 0))
            (local.set $attr (i32.const 0))
            (local.set $namespace (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const "@"))
              (then
                (local.set $mode (i32.const 1))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $cssScanIdent)
                (local.set $namespace (i32.and
                  (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 10))
                  (i32.and
                    (i64.eq
                      (i64.or (i64.load offset=1 (local.get $lhs)) (i64.const 0x2020202020202020))
                      (i64.const "namespac"))
                    (i32.eq (i32.or (i32.load8_u offset=9 (local.get $lhs)) (i32.const 32))
                            (i32.const "e")))))
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (global.get $ptr))
                (br $next))
              ;; the look-ahead runs at every statement start, nested or not, so
              ;; a bare-declaration fragment (style attribute, docs snippet)
              ;; colors as property/value, not as selectors
              (else (local.set $mode
                (select (i32.const 0) (i32.const 2) (call $cssDecide)))))))

        ;; structural bytes end statements in any mode
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $decide (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            (local.set $decide (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (local.set $decide (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; quoted strings, in any mode
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $cssString)
            (br $next)))

        (block $misc
          ;; ---- selector mode ----
          (if (i32.eqz (local.get $mode))
            (then
              ;; element name / attr-selector name / unquoted attr value
              (if (call $cssIdentStart (local.get $c))
                (then
                  (call $cssScanIdent)
                  (call $emitTok
                    (select
                      (select (enum.get $Token.namespace) (enum.get $Token.tag)
                        (i32.and
                          (i32.lt_u (global.get $ptr) (global.get $end))
                          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "|"))))
                      (select (enum.get $Token.attribute) (enum.get $Token.string)
                        (i32.eq (local.get $attr) (i32.const 1)))
                      (i32.eqz (local.get $attr)))
                    (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; `.class` - the dot rides along in the span
              (if (i32.eq (local.get $c) (i32.const "."))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $cssScanIdent)
                  (call $emitTok
                    (select (enum.get $Token.selector.class) (enum.get $Token.punctuation.delimiter)
                      (i32.gt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1)))
                    (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; `#id`
              (if (i32.eq (local.get $c) (i32.const "#"))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $cssScanIdent)
                  (call $emitTok
                    (select (enum.get $Token.selector.id) (enum.get $Token.none)
                      (i32.gt_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 1)))
                    (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; `:pseudo` / `::pseudo` - colons ride along; a bare colon is a
              ;; plain delimiter
              (if (i32.eq (local.get $c) (i32.const ":"))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                               (i32.eq (i32.load8_u (global.get $ptr)) (i32.const ":")))
                    (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                  (local.set $mid (global.get $ptr))
                  (call $cssScanIdent)
                  (call $emitTok
                    (select (enum.get $Token.selector.pseudo) (enum.get $Token.punctuation.delimiter)
                      (i32.gt_u (global.get $ptr) (local.get $mid)))
                    (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; numbers: keyframes steps `50%`, nth arguments `2n+1`
              (if (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $cssScanNumber)
                  (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; brackets; `[` / `]` also drive the attr-selector state
              (if (i32.eq (local.get $c) (i32.const "["))
                (then
                  (local.set $attr (i32.const 1))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.eq (local.get $c) (i32.const "]"))
                (then
                  (local.set $attr (i32.const 0))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; `=` flips the attr selector to its value side
              (if (i32.eq (local.get $c) (i32.const "="))
                (then
                  (if (local.get $attr) (then (local.set $attr (i32.const 2))))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.eq (local.get $c) (i32.const ","))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; combinators and attr-match operators
              (if (i32.or
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "+")))
                      (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "*"))))
                    (i32.or
                      (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "-")))
                      (i32.or (i32.eq (local.get $c) (i32.const "^"))
                        (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "$"))))))
                (then
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (br $misc)))

          ;; ---- declaration property side ----
          (if (i32.eq (local.get $mode) (i32.const 2))
            (then
              (if (i32.or (call $cssIdentStart (local.get $c)) (i32.eq (local.get $c) (i32.const "-")))
                (then
                  (call $cssScanIdent)
                  (call $emitTok
                    (select (enum.get $Token.variable) (enum.get $Token.property)
                      (i32.and (i32.eq (local.get $c) (i32.const "-"))
                               (i32.eq (local.get $c2) (i32.const "-"))))
                    (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.eq (local.get $c) (i32.const ":"))
                (then
                  (local.set $mode (i32.const 3))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                  (br $next)))))
          ;; anything else on the property side falls through to the shared
          ;; value dispatch below, which covers brackets, numbers, and stray
          ;; operators without a second copy

          ;; ---- value / at-rule prelude (and property-side leftovers) ----

          ;; identifiers, including `-webkit-x` and `--custom`
          (if (i32.or (call $cssIdentStart (local.get $c))
                (i32.and (i32.eq (local.get $c) (i32.const "-"))
                  (i32.or (call $cssIdentStart (local.get $c2))
                          (i32.eq (local.get $c2) (i32.const "-")))))
            (then
              (call $cssScanIdent)
              ;; `--custom` inside var() and anywhere in a value
              (if (i32.and (i32.eq (local.get $c) (i32.const "-"))
                           (i32.eq (local.get $c2) (i32.const "-")))
                (then
                  (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; in an at-rule prelude the query operators and/or/not/only can
              ;; be glued to a `(` in minified css - they are operators, so
              ;; this must run before the identifier-glued-to-`(` function rule
              (if (i32.and (i32.eq (local.get $mode) (i32.const 1))
                           (call $cssIsQueryOp (local.get $lhs) (global.get $ptr)))
                (then
                  (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; an identifier glued to `(` is a function name; url? gets special
              ;; treatment: its unquoted body is one constant.builtin token,
              ;; the kind Zed gives css plain values
              (if (i32.and (i32.lt_u (global.get $ptr) (global.get $end))
                           (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "(")))
                (then
                  (if (i32.and
                        (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 3))
                        (i32.eq (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020))
                                (i32.const "url(")))
                    (then
                      (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
                      (local.set $lhs (global.get $ptr))
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                      ;; peek past whitespace: quoted bodies go back to the
                      ;; main loop; anything else up to the `)` is the raw url
                      (local.set $p (global.get $ptr))
                      (block $uDone
                        (loop $uWs
                          (br_if $uDone (i32.ge_u (local.get $p) (global.get $end)))
                          (local.set $c2 (i32.load8_u (local.get $p)))
                          (br_if $uDone (i32.eqz (i32.or
                            (i32.eq (local.get $c2) (i32.const 32))
                            (i32.le_u (i32.sub (local.get $c2) (i32.const 9)) (i32.const 4)))))
                          (local.set $p (i32.add (local.get $p) (i32.const 1)))
                          (br $uWs)))
                      (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                            (i32.eqz (i32.or
                              (i32.eq (local.get $c2) (i32.const ")"))
                              (i32.or (i32.eq (local.get $c2) (i32.const 34))
                                      (i32.eq (local.get $c2) (i32.const 39))))))
                        (then
                          (call $emitGap (global.get $ptr) (local.get $p))
                          (global.set $ptr (local.get $p))
                          (local.set $lhs (local.get $p))
                          (call $cssScanUrlBody)
                          (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))))
                      (br $next)))
                  (call $emitTok (enum.get $Token.function) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              (if (i32.and (i32.eq (local.get $mode) (i32.const 1)) (local.get $namespace))
                (then
                  (local.set $namespace (i32.const 0))
                  (call $emitTok (enum.get $Token.namespace) (local.get $lhs) (global.get $ptr))
                  (br $next)))
              ;; at-rule prelude: a feature name directly before `:` is a
              ;; property, the query operators and/or/not/only are Zed's
              ;; keyword.operator, everything else is a value keyword
              (if (i32.eq (local.get $mode) (i32.const 1))
                (then
                  (local.set $p (global.get $ptr))
                  (block $aDone
                    (loop $aWs
                      (br_if $aDone (i32.ge_u (local.get $p) (global.get $end)))
                      (local.set $c2 (i32.load8_u (local.get $p)))
                      (br_if $aDone (i32.eqz (i32.or
                        (i32.eq (local.get $c2) (i32.const 32))
                        (i32.le_u (i32.sub (local.get $c2) (i32.const 9)) (i32.const 4)))))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $aWs)))
                  (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                               (i32.eq (local.get $c2) (i32.const ":")))
                    (then
                      (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
                      (br $next)))
                  (if (call $cssIsQueryOp (local.get $lhs) (global.get $ptr))
                    (then
                      (call $emitTok (enum.get $Token.keyword.operator) (local.get $lhs) (global.get $ptr))
                      (br $next)))))
              (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
              (br $next)))

          ;; numbers with their unit: `1.5rem` `80%` `.5s` `-2px` `+1e2`
          (if (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $cssScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 9)))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $cssScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (if (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                (i32.or
                  (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 9))
                  (i32.and (i32.eq (local.get $c2) (i32.const "."))
                    (i32.and
                      (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                      (i32.le_u (i32.sub (i32.load8_u offset=2 (global.get $ptr)) (i32.const "0"))
                                (i32.const 9))))))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $cssScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (br $next)))

          ;; `#hex` colors, 3/4/6/8 digits - the identifier scan eats hex digits
          (if (i32.eq (local.get $c) (i32.const "#"))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $cssScanIdent)
              (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
              (br $next)))

          ;; `!important` - the bang rides along; a bare `!` is an operator
          (if (i32.eq (local.get $c) (i32.const "!"))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (local.set $mid (global.get $ptr))
              (call $cssScanIdent)
              (call $emitTok
                (select (enum.get $Token.keyword) (enum.get $Token.operator)
                  (i32.gt_u (global.get $ptr) (local.get $mid)))
                (local.get $lhs) (global.get $ptr))
              (br $next)))

          ;; delimiters and brackets
          (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ":")))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (if (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]"))))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
              (br $next)))

          ;; value operators: calc arithmetic, font shorthand `/`, media ranges
          (if (i32.or
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/")))
                  (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-"))))
                (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                  (i32.or (i32.eq (local.get $c) (i32.const "="))
                    (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "^"))))))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
              (br $next)))
          (br $misc))

        ;; anything unclassified: one plain byte
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
