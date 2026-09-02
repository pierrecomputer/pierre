(module
  (import "../common.wat")

  ;; Scan a Python string body. $seg includes the prefix and opening quote for
  ;; a new literal and starts at $ptr when resuming a stream chunk. $depth is
  ;; the number of f-string replacement fields open at $ptr - zero outside
  ;; f-strings. Returns the status in the low two bits - one after the closing
  ;; quote, two after a continued line, zero otherwise - and the field depth
  ;; still open at $ptr in the bits above, so a stream chunk can checkpoint it.
  (func $pyStringBody (param $quote i32) (param $raw i32)
        (param $format i32) (param $triple i32) (param $seg i32)
        (param $depth i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $status i32)
    (local $stop i32)
    (block $done
      (loop $scan
        ;; Every byte before the next quote, backslash, or (single-quoted
        ;; only) line break is plain body: hop 16 bytes per step. Inside an
        ;; f-string the hop stops at the next brace as well, found once per
        ;; brace with the same SIMD scan.
        (if (local.get $format)
          (then
            (if (i32.ge_u (global.get $ptr) (local.get $stop))
              (then (local.set $stop (call $lexFindEither
                (global.get $ptr) (i32.const "{") (i32.const "}"))))))
          (else (local.set $stop (global.get $end))))
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (local.get $stop) (local.get $quote)
          (i32.const 1) (i32.eqz (local.get $triple))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $quote))
          (then
            (if (local.get $triple)
              (then
                (if (i32.and
                      (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                      (i32.and
                        (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
                        (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                    (local.set $status (i32.const 1))
                    (br $done))))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (local.set $status (i32.const 1))
                (br $done)))))
        (br_if $done (i32.and
          (i32.eqz (local.get $triple))
          (i32.or (i32.eq (local.get $c) (i32.const 10))
                  (i32.eq (local.get $c) (i32.const 13)))))
        ;; A backslash escapes the next character, or continues the line when
        ;; it precedes LF or CRLF. Raw literals keep the bytes as plain body
        ;; but still continue the line, so both kinds share the span end.
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (if (i32.eqz (local.get $raw))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
                (local.set $seg (local.get $e))))
            (global.set $ptr (local.get $e))
            (if (i32.and
                  (i32.eq (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq
                      (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))
                      (i32.const 10))
                    (i32.eq
                      (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1)))
                      (i32.const 13))))
              (then (local.set $status (i32.const 2))))
            (br $scan)))
        (if (i32.and
              (local.get $format)
              (i32.or (i32.eq (local.get $c) (i32.const "{"))
                      (i32.eq (local.get $c) (i32.const "}"))))
          (then
            ;; outside a replacement field a doubled brace is a literal
            ;; brace; inside one `{` nests a display or a nested format field
            ;; and `}` closes, so `{w}}` ends two fields, not one plus `}}`
            (if (i32.and
                  (i32.eqz (local.get $depth))
                  (i32.and
                    (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                    (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $c))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (br $scan)))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1))))
              (else
                (if (local.get $depth)
                  (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $e) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.or (local.get $status) (i32.shl (local.get $depth) (i32.const 2))))

  ;; Python string literal at $ptr, including a 0-2 byte prefix. Triple quotes
  ;; are multiline; raw literals retain backslashes and f-string braces are
  ;; surfaced without attempting to recursively parse their expressions.
  (func $pyString (param $prefix i32) (param $quote i32)
        (param $raw i32) (param $format i32)
    (local $seg i32)
    (local $status i32)
    (local $triple i32)
    (local.set $seg (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $prefix)))
    (if (i32.and
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
          (i32.and
            (i32.eq (i32.load8_u offset=1 (global.get $ptr)) (local.get $quote))
            (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (local.get $quote))))
      (then
        (local.set $triple (i32.const 1))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 3))))
      (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
    (local.set $status (call $pyStringBody
      (local.get $quote) (local.get $raw) (local.get $format)
      (local.get $triple) (local.get $seg) (i32.const 0)))
    ;; a triple-quoted string spans chunks until its closing quotes; a
    ;; single-quoted one only when the chunk ended in an escaped line break
    (if (i32.and
          (global.get $streaming)
          (i32.and
            (i32.eq (global.get $ptr) (global.get $end))
            (i32.and
              (i32.ne (i32.and (local.get $status) (i32.const 3)) (i32.const 1))
              (i32.or
                (local.get $triple)
                (i32.eq (i32.and (local.get $status) (i32.const 3)) (i32.const 2))))))
      (then
        (global.set $streamMode (i32.const 10))
        (global.set $streamA (local.get $quote))
        (global.set $streamB (i32.or
          (local.get $raw)
          (i32.or
            (i32.shl (local.get $format) (i32.const 1))
            (i32.shl (local.get $triple) (i32.const 2)))))
        (global.set $streamC (i32.shr_u (local.get $status) (i32.const 2))))))

  ;; Resume a string the previous chunk left open (mode 10: $streamA quote,
  ;; $streamB raw/format/triple flags, $streamC open f-string field depth).
  ;; Returns 1 when the string still runs past this chunk.
  (func $pyStreamResume (result i32)
    (local $flags i32)
    (local $status i32)
    (if (i32.ne (global.get $streamMode) (i32.const 10))
      (then (return (i32.const 0))))
    (local.set $flags (global.get $streamB))
    (local.set $status (call $pyStringBody
      (global.get $streamA)
      (i32.and (local.get $flags) (i32.const 1))
      (i32.and (i32.shr_u (local.get $flags) (i32.const 1)) (i32.const 1))
      (i32.and (i32.shr_u (local.get $flags) (i32.const 2)) (i32.const 1))
      (global.get $ptr)
      (global.get $streamC)))
    (global.set $streamC (i32.shr_u (local.get $status) (i32.const 2)))
    (local.set $status (i32.and (local.get $status) (i32.const 3)))
    (if (i32.eq (local.get $status) (i32.const 1))
      (then
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (if (i32.and
          (i32.eq (global.get $ptr) (global.get $end))
          (i32.or
            (i32.and (i32.shr_u (local.get $flags) (i32.const 2)) (i32.const 1))
            (i32.eq (local.get $status) (i32.const 2))))
      (then (return (i32.const 1))))
    (global.set $streamMode (i32.const 0))
    (i32.const 0))

  ;; group order is the dispatch order in $pyWordHl below; def and class keep
  ;; dedicated groups so the caller can prime the next name as a definition.
  ;; raise is missing on purpose: it shares its hash features (first two
  ;; bytes, last byte, length) with range, so no table geometry holds both;
  ;; $pyWordHl matches it with a direct compare instead. match and case are
  ;; soft keywords and live in $pySoftKeyword, which needs the line position.
  (keyword-table $pyWords $mem.pythonWords $mem.pythonWords+1152 32 256
    (group "True" "False")                       ;; 1: booleans
    (group "None" "Ellipsis" "NotImplemented")   ;; 2: built-in constants
    (group "self" "cls")                         ;; 3: special variables
    (group "def")                                ;; 4: decl, next name a function
    (group "class")                              ;; 5: decl, next name a class
    (group "from" "import")                      ;; 6: import
    (group "and" "in" "is" "not" "or")           ;; 7: operator keywords
    (group ;; 8: control keywords
      "assert" "async" "await" "break" "continue" "del" "elif"
      "else" "except" "finally" "for" "global" "if" "lambda"
      "nonlocal" "pass" "return" "try" "while" "with" "yield")
    (group ;; 9: built-in types
      "bool" "bytearray" "bytes" "complex" "dict" "float" "frozenset" "int"
      "list" "memoryview" "object" "range" "set" "slice" "str" "tuple" "type")
    (group ;; 10: built-in functions
      "abs" "all" "any" "callable" "enumerate" "filter" "getattr" "input"
      "isinstance" "iter" "len" "map" "max" "min" "next" "open" "pow"
      "print" "repr" "round" "sorted" "sum" "super" "zip"))

  ;; Token in the low byte; the high byte primes the next name: 1=def, 2=class.
  (func $pyWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local.set $g (keyword-table.get $pyWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        ;; raise, kept out of the table (see above); wide loads stay inside
        ;; the input buffer slack
        (if (i32.and
              (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0x000000ffffffffff))
                (i64.const "raise")))
          (then (return (enum.get $Token.keyword.control))))
        (return (enum.get $Token.none))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (enum.get $Token.constant.builtin))))
    (if (i32.eq (local.get $g) (i32.const 3))
      (then (return (enum.get $Token.variable.special))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (i32.or
        (enum.get $Token.keyword.declaration) (i32.const 0x100)))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (i32.or
        (enum.get $Token.keyword.declaration) (i32.const 0x200)))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $g) (i32.const 9))
      (then (return (enum.get $Token.type.builtin))))
    (enum.get $Token.function))

  ;; The soft keywords `match` and `case` open a statement only at the head
  ;; of a line with a subject or pattern after them; `re.match(p, s)` and
  ;; `match = 3` keep them as ordinary names. The caller checks the line
  ;; position; this checks the word [lhs,rhs) and the byte after any blanks.
  (func $pySoftKeyword (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eqz (i32.or
          (i32.and
            (i32.eq (local.get $n) (i32.const 5))
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x000000ffffffffff))
              (i64.const "match")))
          (i32.and
            (i32.eq (local.get $n) (i32.const 4))
            (i32.eq (i32.load (local.get $lhs)) (i32.const "case")))))
      (then (return (i32.const 0))))
    (local.set $rhs (call $lexSkipSpaceAt (local.get $rhs)))
    (if (i32.ge_u (local.get $rhs) (global.get $end))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $rhs)))
    ;; a subject or pattern starts with a name, number, string, bracket,
    ;; unary minus, or splat star
    (i32.or
      (i32.or
        (i32.and
          (call $lexIsIdentStart (local.get $c))
          (i32.ne (local.get $c) (i32.const "$")))
        (call $lexIsDigit (local.get $c)))
      (i32.or
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const 34))
                  (i32.eq (local.get $c) (i32.const 39)))
          (i32.or (i32.eq (local.get $c) (i32.const "("))
                  (i32.eq (local.get $c) (i32.const "["))))
        (i32.or
          (i32.eq (local.get $c) (i32.const "{"))
          (i32.or (i32.eq (local.get $c) (i32.const "-"))
                  (i32.eq (local.get $c) (i32.const "*")))))))

  (func $pyIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+"))
                (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*"))
                (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%"))
                (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "<"))
                  (i32.eq (local.get $c) (i32.const ">")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "!"))
                    (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|"))
                      (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~"))
                      (i32.eq (local.get $c) (i32.const "@")))))))))

  (func $hlPython
    (local $afterDecl i32) ;; 1 = def, 2 = class
    (local $afterDot i32)
    (local $annotName i32) ;; the previous token can take a `: type` annotation
    (local $brackDepth i32) ;; open `[`/`{` nesting - no annotations inside
    (local $c i32)
    (local $c2 i32)
    (local $format i32)
    (local $g i32)
    (local $gap i32)
    (local $hl i32)
    (local $lambdaPend i32) ;; between `lambda` and the `:` that ends its head
    (local $lhs i32)
    (local $lineHead i32)
    (local $p i32)
    (local $prefix i32)
    (local $q i32)
    (local $raw i32)
    (local $typeNext i32)
    (call $lexEmitLeadingContinuation)
    (local.set $lineHead (i32.const 1))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        ;; The gap crossed a line break when a CR/LF sits before the new $ptr.
        ;; A backslash right before the break continues the statement, so
        ;; neither the line head nor a pending annotation changes; otherwise
        ;; the next token starts a line and an armed annotation lapses.
        (local.set $q (call $scanFindSpecial (local.get $gap) (global.get $ptr)
          (i32.const 10) (i32.const 0) (i32.const 1)))
        (if (i32.lt_u (local.get $q) (global.get $ptr))
          (then
            (if (i32.eqz (i32.and
                  (i32.eq (local.get $q) (local.get $gap))
                  (i32.and
                    (i32.gt_u (local.get $gap) (global.get $srcBase))
                    (i32.eq
                      (i32.load8_u (i32.sub (local.get $gap) (i32.const 1)))
                      (i32.const 92)))))
              (then
                (local.set $lineHead (i32.const 1))
                (local.set $typeNext (i32.const 0))))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))

        ;; a pending `def` head survives only its `[...]` type-parameter list
        ;; and comments on the way to the `(` of its parameter list
        (if (i32.and (global.get $sigFnPend) (i32.eqz (global.get $sigFnAngle)))
          (then
            (if (i32.eqz (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "("))
                          (i32.eq (local.get $c) (i32.const "[")))
                  (i32.eq (local.get $c) (i32.const "#"))))
              (then (global.set $sigFnPend (i32.const 0))))))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and
              (local.get $lineHead)
              (i32.eq (local.get $c) (i32.const "@")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (block $decoratorDone
              (loop $decorator
                (br_if $decoratorDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $decoratorDone (i32.eqz
                  (i32.or (call $lexIsIdentContinue (local.get $c))
                          (i32.eq (local.get $c) (i32.const ".")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $decorator)))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $annotName (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.lt_u (i32.add (local.get $lhs) (i32.const 2)) (global.get $end))
          (then
            (local.set $p (i32.or (i32.load16_u (local.get $lhs)) (i32.const 0x2020)))
            (if (i32.and
                  (i32.or
                    (i32.or (i32.eq (local.get $p) (i32.const "br"))
                            (i32.eq (local.get $p) (i32.const "rb")))
                    (i32.or (i32.eq (local.get $p) (i32.const "fr"))
                            (i32.eq (local.get $p) (i32.const "rf"))))
                  (i32.or
                    (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const 34))
                    (i32.eq (i32.load8_u offset=2 (local.get $lhs)) (i32.const 39))))
              (then
                (call $pyString
                  (i32.const 2) (i32.load8_u offset=2 (local.get $lhs))
                  (i32.const 1)
                  (i32.or
                    (i32.eq (local.get $p) (i32.const "fr"))
                    (i32.eq (local.get $p) (i32.const "rf"))))
                (local.set $annotName (i32.const 0))
                (local.set $lineHead (i32.const 0))
                (local.set $afterDot (i32.const 0))
                (br $next)))))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                    (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $pyString (i32.const 0) (local.get $c) (i32.const 0) (i32.const 0))
            (local.set $annotName (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (br $next)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $annotName (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $typeNext (i32.const 0))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            ;; Recognize case-insensitive r/u/b/f and br/rb/fr/rf prefixes.
            (local.set $prefix (i32.const 0))
            (local.set $raw (i32.const 0))
            (local.set $format (i32.const 0))
            (local.set $c (i32.or (local.get $c) (i32.const 32)))
            (if (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const "r"))
                          (i32.eq (local.get $c) (i32.const "u")))
                  (i32.or (i32.eq (local.get $c) (i32.const "b"))
                          (i32.eq (local.get $c) (i32.const "f"))))
              (then
                (local.set $prefix (i32.const 1))
                (local.set $raw (i32.eq (local.get $c) (i32.const "r")))
                (local.set $format (i32.eq (local.get $c) (i32.const "f")))))
            (local.set $q (i32.add (local.get $lhs) (local.get $prefix)))
            (if (i32.and
                  (local.get $prefix)
                  (i32.and
                    (i32.lt_u (local.get $q) (global.get $end))
                    (i32.or
                      (i32.eq (i32.load8_u (local.get $q)) (i32.const 34))
                      (i32.eq (i32.load8_u (local.get $q)) (i32.const 39)))))
              (then
                (call $pyString
                  (local.get $prefix) (i32.load8_u (local.get $q))
                  (local.get $raw) (local.get $format))
                (local.set $annotName (i32.const 0))
                (local.set $lineHead (i32.const 0))
                (local.set $afterDot (i32.const 0))
                (br $next)))

            (call $lexScanIdent)
            ;; a member name is never a keyword or builtin: `re.match` and
            ;; `obj.print` are attribute accesses
            (if (local.get $afterDot)
              (then (local.set $g (i32.const 0)))
              (else (local.set $g (call $pyWordHl (local.get $lhs) (global.get $ptr)))))
            (local.set $hl (i32.and (local.get $g) (i32.const 255)))
            (if (i32.eq (local.get $hl) (enum.get $Token.none))
              (then
                (if (i32.and
                      (local.get $lineHead)
                      (call $pySoftKeyword (local.get $lhs) (global.get $ptr)))
                  (then (local.set $hl (enum.get $Token.keyword.control)))
                  (else
                    (if (local.get $afterDecl)
                      (then
                        (local.set $hl (select
                          (enum.get $Token.type.class)
                          (enum.get $Token.function.definition)
                          (i32.eq (local.get $afterDecl) (i32.const 2))))
                        ;; a `def` name arms the parameter machine for its `(`
                        (if (i32.eq (local.get $afterDecl) (i32.const 1))
                          (then
                            (global.set $sigFnPend (i32.const 1))
                            (global.set $sigFnAngle (i32.const 0)))))
                      (else
                        (if (local.get $afterDot)
                          (then
                            (local.set $q (call $lexSkipSpaceAt (global.get $ptr)))
                            (local.set $hl (select
                              (enum.get $Token.function.method) (enum.get $Token.property)
                              (i32.and
                                (i32.lt_u (local.get $q) (global.get $end))
                                (i32.eq (i32.load8_u (local.get $q)) (i32.const "("))))))
                          (else
                            ;; a name at the top level of a marked `def` list after
                            ;; `(`, `,`, or a splat star is a parameter (Zed's
                            ;; function_definition parameters captures); self/cls
                            ;; return variable.special above, matching Zed
                            (if (i32.and
                                  (i32.and (call $sigActive) (global.get $sigPattern))
                                  (i32.eqz (global.get $sigObscure)))
                              (then (local.set $hl (enum.get $Token.variable.parameter)))
                              (else
                                (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                                  (then (local.set $hl (enum.get $Token.constant)))
                                  (else
                                    (if (i32.or
                                          (local.get $typeNext)
                                          (i32.le_u
                                            (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                                            (i32.const 25)))
                                      (then (local.set $hl (enum.get $Token.type)))
                                      (else
                                        (local.set $q (call $lexSkipSpaceAt (global.get $ptr)))
                                        (local.set $hl (select
                                          (enum.get $Token.function) (enum.get $Token.variable)
                                          (i32.and
                                            (i32.lt_u (local.get $q) (global.get $end))
                                            (i32.eq (i32.load8_u (local.get $q)) (i32.const "(")))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            ;; Annotation position: a bare name (no table hit, not a soft
            ;; keyword) or self/cls that starts its line or is a parameter,
            ;; or a member that continues such a name (`self.x: int`).
            (local.set $annotName (i32.and
              (i32.or
                (i32.and
                  (i32.eqz (local.get $g))
                  (i32.ne (local.get $hl) (enum.get $Token.keyword.control)))
                (i32.eq (local.get $hl) (enum.get $Token.variable.special)))
              (i32.or
                (i32.eq (local.get $hl) (enum.get $Token.variable.parameter))
                (i32.or
                  (local.get $lineHead)
                  (i32.and (local.get $afterDot) (local.get $annotName))))))
            (if (i32.and
                  (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 6))
                  (i64.eq
                    (i64.and (i64.load (local.get $lhs)) (i64.const 0x0000ffffffffffff))
                    (i64.const "lambda")))
              (then (local.set $lambdaPend (i32.const 1))))
            (local.set $afterDecl (i32.shr_u (local.get $g) (i32.const 8)))
            (local.set $afterDot (i32.const 0))
            (local.set $typeNext (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (global.set $sigPattern (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "("))
                      (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "["))
                        (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.eq (local.get $c) (i32.const "}")))))
          (then
            ;; parameter machine: `(` may open the armed `def` list and puts
            ;; the next name in parameter position; `[` right after the name
            ;; is a PEP 695 type-parameter list; brackets inside a marked
            ;; list obscure its top level (defaults, annotations, subscripts)
            (if (i32.eq (local.get $c) (i32.const "("))
              (then
                (global.set $sigParens
                  (i32.add (global.get $sigParens) (i32.const 1)))
                (if (i32.eqz (global.get $sigFnAngle))
                  (then
                    (if (global.get $sigFnPend) (then (call $sigMark)))
                    (global.set $sigFnPend (i32.const 0))))
                (global.set $sigPattern (i32.const 1)))
              (else
                (global.set $sigPattern (i32.const 0))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (if (call $sigActive) (then (call $sigUnmark)))
                    (if (i32.gt_u (global.get $sigParens) (i32.const 0))
                      (then (global.set $sigParens
                        (i32.sub (global.get $sigParens) (i32.const 1))))))
                  (else
                    (if (global.get $sigFnPend)
                      (then
                        (if (i32.eq (local.get $c) (i32.const "["))
                          (then (global.set $sigFnAngle
                            (i32.add (global.get $sigFnAngle) (i32.const 1))))
                          (else
                            (if (i32.eq (local.get $c) (i32.const "]"))
                              (then (call $sigFnAngleDrop (i32.const 1)))
                              (else (global.set $sigFnPend (i32.const 0)))))))
                      (else
                        (if (call $sigActive)
                          (then
                            (if (i32.or
                                  (i32.eq (local.get $c) (i32.const "["))
                                  (i32.eq (local.get $c) (i32.const "{")))
                              (then (global.set $sigObscure
                                (i32.add (global.get $sigObscure) (i32.const 1))))
                              (else
                                (if (i32.gt_u (global.get $sigObscure) (i32.const 0))
                                  (then (global.set $sigObscure
                                    (i32.sub (global.get $sigObscure) (i32.const 1)))))))))))))))
            ;; dict displays, comprehensions, and subscripts use `:` for keys
            ;; and slices, never for annotations
            (if (i32.or (i32.eq (local.get $c) (i32.const "["))
                        (i32.eq (local.get $c) (i32.const "{")))
              (then (local.set $brackDepth (i32.add (local.get $brackDepth) (i32.const 1))))
              (else
                (if (i32.and
                      (local.get $brackDepth)
                      (i32.or (i32.eq (local.get $c) (i32.const "]"))
                              (i32.eq (local.get $c) (i32.const "}"))))
                  (then (local.set $brackDepth
                    (i32.sub (local.get $brackDepth) (i32.const 1)))))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $annotName (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $lineHead (i32.const 0))
            (br $next)))
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "."))
                      (i32.eq (local.get $c) (i32.const ",")))
              (i32.or (i32.and
                        (i32.eq (local.get $c) (i32.const ":"))
                        (i32.ne (local.get $c2) (i32.const "=")))
                      (i32.eq (local.get $c) (i32.const ";"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $afterDot (i32.eq (local.get $c) (i32.const ".")))
            ;; `:` arms a type annotation only after a name in annotation
            ;; position outside brackets and lambda heads: dict values,
            ;; slice bounds, and lambda bodies stay plain
            (local.set $typeNext (i32.and
              (i32.eq (local.get $c) (i32.const ":"))
              (i32.and
                (local.get $annotName)
                (i32.and
                  (i32.eqz (local.get $brackDepth))
                  (i32.eqz (local.get $lambdaPend))))))
            (if (i32.eq (local.get $c) (i32.const ":"))
              (then (local.set $lambdaPend (i32.const 0))))
            ;; a member access continues an annotated attribute chain
            (if (i32.ne (local.get $c) (i32.const "."))
              (then (local.set $annotName (i32.const 0))))
            (local.set $lineHead (i32.const 0))
            ;; a comma returns to parameter position; `.`/`:`/`;` leave it
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const ",")))
            (br $next)))
        (if (i32.or
              (call $pyIsOp (local.get $c))
              (i32.eq (local.get $c) (i32.const ":")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.and
                  (i32.lt_u (global.get $ptr) (global.get $end))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.or
                      (i32.eq (local.get $c) (local.get $c2))
                      (i32.and
                        (i32.eq (local.get $c) (i32.const "-"))
                        (i32.eq (local.get $c2) (i32.const ">"))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.lt_u (global.get $ptr) (global.get $end))
                      (i32.or
                        (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "="))
                        (i32.and
                          (i32.eq (local.get $c) (i32.const "/"))
                          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "/")))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $typeNext (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.eq (local.get $c2) (i32.const ">"))))
            (local.set $annotName (i32.const 0))
            (local.set $afterDot (i32.const 0))
            (local.set $lineHead (i32.const 0))
            ;; a splat star after `(` or `,` keeps parameter position, so
            ;; `*args` and `**kwargs` names still read as parameters
            (global.set $sigPattern (i32.and
              (global.get $sigPattern)
              (i32.eq (local.get $c) (i32.const "*"))))
            (br $next)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $annotName (i32.const 0))
        (local.set $afterDot (i32.const 0))
        (local.set $lineHead (i32.const 0))
        (br $next))))
)
