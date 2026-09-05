(module
  (import "../common.wat")

  ;; A bounded byte read for prefix and operator lookahead.
  (func $cppByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $cppIsOp (param $c i32) (result i32)
    (byteset.get "!#%&*+-/<=>?^|~" (local.get $c)))

  ;; C++ numeric preprocessing token: radix digits, digit separators,
  ;; exponents and user-defined/type suffixes stay in one allocation-free run.
  (func $cppScanNumber
    (local $c i32)
    (local $prev i32)
    (local $dot i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (call $lexIsIdentContinue (local.get $c))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.eqz (local.get $dot)))
          (then
            (local.set $dot (i32.const 1))
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (if (i32.and
              (i32.or (i32.eq (local.get $c) (i32.const "+"))
                      (i32.eq (local.get $c) (i32.const "-")))
              (i32.or
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e"))
                (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "p"))))
          (then
            (local.set $prev (local.get $c))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $l)))
        (br $done))))

  ;; Return quote-offset+1 in the low byte and bit 8 for a raw literal.
  ;; Zero means the bytes begin an ordinary identifier instead.
  (func $cppStringKind (param $p i32) (result i32)
    (local $c i32)
    (local $n i32)
    (local.set $c (call $cppByte (local.get $p)))
    (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                (i32.eq (local.get $c) (i32.const 39)))
      (then (return (i32.const 1))))
    (local.set $n (call $cppByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.and (i32.eq (local.get $c) (i32.const "R"))
                 (i32.eq (local.get $n) (i32.const 34)))
      (then (return (i32.const 258))))
    (if (i32.and (i32.eq (local.get $c) (i32.const "u"))
                 (i32.eq (local.get $n) (i32.const "8")))
      (then
        (local.set $n (call $cppByte (i32.add (local.get $p) (i32.const 2))))
        (if (i32.or (i32.eq (local.get $n) (i32.const 34))
                    (i32.eq (local.get $n) (i32.const 39)))
          (then (return (i32.const 3))))
        (if (i32.and (i32.eq (local.get $n) (i32.const "R"))
                     (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 3))) (i32.const 34)))
          (then (return (i32.const 260))))))
    (if (i32.and
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "L"))
                    (i32.eq (local.get $c) (i32.const "u")))
            (i32.eq (local.get $c) (i32.const "U")))
          (i32.or
            (i32.or (i32.eq (local.get $n) (i32.const 34))
                    (i32.eq (local.get $n) (i32.const 39)))
            (i32.and (i32.eq (local.get $n) (i32.const "R"))
                     (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 2))) (i32.const 34)))))
      (then
        (return (select (i32.const 259) (i32.const 2)
          (i32.eq (local.get $n) (i32.const "R"))))))
    (i32.const 0))

  ;; Scan an ordinary or prefixed literal body from $ptr, whose bytes from
  ;; $seg on are still unemitted: the body as $hl and each C++ escape form -
  ;; fixed-width Unicode, arbitrary hex, octal, named Unicode, or one whole
  ;; UTF-8 character - as string.escape. A backslash before a line break
  ;; continues the literal. Returns 1 after the closing quote and any
  ;; user-defined-literal suffix, 2 when the scan reached $end right after an
  ;; escaped line break - the next chunk resumes the literal - or 0 when a
  ;; raw line break or $end left it unterminated.
  (func $cppStringBody (param $q i32) (param $hl i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $c2 i32)
    (local $e i32)
    (local $k i32)
    (local $status i32)
    (block $done
      (loop $scan
        ;; hop to the next quote, backslash, or line break, 16 bytes per step
        (global.set $ptr (call $scanFindSpecial
          (global.get $ptr) (global.get $end) (local.get $q) (i32.const 1) (i32.const 1)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (call $lexIsIdentStart (call $cppByte (global.get $ptr)))
              (then (call $lexScanIdent)))
            (local.set $status (i32.const 1))
            (br $done)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10))
                             (i32.eq (local.get $c) (i32.const 13))))

        ;; Escape endpoint: fixed-width Unicode, arbitrary hex (bounded here
        ;; to a generous run), octal, named Unicode, or one whole UTF-8 char.
        (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
        (local.set $c2 (call $cppByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.eq (local.get $c2) (i32.const "u"))
          (then (local.set $e (call $scanHexRun
            (i32.add (global.get $ptr) (i32.const 2)) (i32.const 4))))
          (else
            (if (i32.eq (local.get $c2) (i32.const "U"))
              (then (local.set $e (call $scanHexRun
                (i32.add (global.get $ptr) (i32.const 2)) (i32.const 8))))
              (else
                (if (i32.eq (local.get $c2) (i32.const "x"))
                  (then (local.set $e (call $scanHexRun
                    (i32.add (global.get $ptr) (i32.const 2)) (i32.const 64))))
                  (else
                    (if (i32.and
                          (i32.eq (local.get $c2) (i32.const "N"))
                          (i32.eq (call $cppByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const "{")))
                      (then
                        (local.set $e (i32.add (global.get $ptr) (i32.const 3)))
                        (block $namedDone
                          (loop $named
                            (br_if $namedDone (i32.ge_u (local.get $e) (global.get $end)))
                            (if (i32.eq (i32.load8_u (local.get $e)) (i32.const "}"))
                              (then
                                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                                (br $namedDone)))
                            (local.set $e (i32.add (local.get $e) (i32.const 1)))
                            (br $named))))
                      (else
                        (if (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 7))
                          (then
                            (local.set $e (i32.add (global.get $ptr) (i32.const 1)))
                            (local.set $k (i32.const 0))
                            (block $octDone
                              (loop $oct
                                (br_if $octDone (i32.or
                                  (i32.ge_u (local.get $e) (global.get $end))
                                  (i32.ge_u (local.get $k) (i32.const 3))))
                                (br_if $octDone (i32.gt_u
                                  (i32.sub (i32.load8_u (local.get $e)) (i32.const "0")) (i32.const 7)))
                                (local.set $e (i32.add (local.get $e) (i32.const 1)))
                                (local.set $k (i32.add (local.get $k) (i32.const 1)))
                                (br $oct))))
                          ;; one escaped byte, or a line continuation
                          ;; before LF or CRLF
                          (else
                            (local.set $e (call $lexEscapeEnd (global.get $ptr)))))))))))))
        ;; an escaped multibyte UTF-8 character stays whole inside the span
        (local.set $e (call $utf8SpanEnd (local.get $e) (global.get $end)))
        (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
        (global.set $ptr (local.get $e))
        (local.set $seg (local.get $e))
        ;; an escaped line break that ends the chunk leaves the literal open
        (if (i32.and
              (i32.eq (global.get $ptr) (global.get $end))
              (i32.or (i32.eq (local.get $c2) (i32.const 10))
                      (i32.eq (local.get $c2) (i32.const 13))))
          (then
            (local.set $status (i32.const 2))
            (br $done)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; Emit a prefixed ordinary or raw literal. Ordinary strings use a 16-byte
  ;; scan and split C++ escape forms; raw strings search `)` candidates 16 at
  ;; a time and verify their exact, at-most-16-byte delimiter. Returns the
  ;; quote byte when the chunk ended inside an ordinary literal right after an
  ;; escaped line break, so the caller can resume it in the next chunk, and
  ;; 0 otherwise.
  (func $cppString (param $lhs i32) (param $kind i32) (result i32)
    (local $quote i32)
    (local $q i32)
    (local $d i32)
    (local $dlen i32)
    (local $p i32)
    (local $c i32)
    (local $k i32)
    (local $match i32)
    (local $mask i32)
    (local $rem i32)
    (local $w v128)
    (local.set $quote (i32.add (local.get $lhs)
      (i32.sub (i32.and (local.get $kind) (i32.const 255)) (i32.const 1))))

    (block $ordinary
      (if (i32.and (local.get $kind) (i32.const 256))
        (then
          ;; Read the raw delimiter up to its opening `(`.
          (local.set $d (i32.add (local.get $quote) (i32.const 1)))
          (local.set $p (local.get $d))
          (block $delimiter
            (loop $dl
              (br_if $ordinary (i32.ge_u (local.get $p) (global.get $end)))
              (local.set $c (i32.load8_u (local.get $p)))
              (br_if $delimiter (i32.eq (local.get $c) (i32.const "(")))
              (br_if $ordinary (i32.or
                (i32.or (i32.le_u (local.get $c) (i32.const 32))
                        (i32.eq (local.get $c) (i32.const ")")))
                (i32.or (i32.eq (local.get $c) (i32.const 92))
                        (i32.ge_u (i32.sub (local.get $p) (local.get $d)) (i32.const 16)))))
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br $dl)))
          (local.set $dlen (i32.sub (local.get $p) (local.get $d)))
          (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
          (block $rawDone
            (loop $raw
              (br_if $rawDone (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $w (v128.load (global.get $ptr)))
              (local.set $mask (i8x16.bitmask
                (i8x16.eq (local.get $w) (i8x16.splat (i32.const ")")))))
              (local.set $rem (i32.sub (global.get $end) (global.get $ptr)))
              (if (i32.lt_u (local.get $rem) (i32.const 16))
                (then (local.set $mask (i32.and (local.get $mask)
                  (i32.sub (i32.shl (i32.const 1) (local.get $rem)) (i32.const 1))))))
              (block $advance
                (loop $candidate
                  (br_if $advance (i32.eqz (local.get $mask)))
                  (local.set $q (i32.add (global.get $ptr) (i32.ctz (local.get $mask))))
                  (if (i32.le_u
                        (i32.add (local.get $q) (i32.add (local.get $dlen) (i32.const 2)))
                        (global.get $end))
                    (then
                      (local.set $match (i32.const 1))
                      (local.set $k (i32.const 0))
                      (block $cmpDone
                        (loop $cmp
                          (br_if $cmpDone (i32.ge_u (local.get $k) (local.get $dlen)))
                          (if (i32.ne
                                (i32.load8_u (i32.add (i32.add (local.get $q) (i32.const 1)) (local.get $k)))
                                (i32.load8_u (i32.add (local.get $d) (local.get $k))))
                            (then
                              (local.set $match (i32.const 0))
                              (br $cmpDone)))
                          (local.set $k (i32.add (local.get $k) (i32.const 1)))
                          (br $cmp)))
                      (if (i32.and (local.get $match)
                            (i32.eq
                              (i32.load8_u (i32.add (i32.add (local.get $q) (local.get $dlen)) (i32.const 1)))
                              (i32.const 34)))
                        (then
                          (global.set $ptr
                            (i32.add (local.get $q) (i32.add (local.get $dlen) (i32.const 2))))
                          (if (call $lexIsIdentStart (call $cppByte (global.get $ptr)))
                            (then (call $lexScanIdent)))
                          (call $emitTok (enum.get $Token.string)
                            (local.get $lhs) (global.get $ptr))
                          (return (i32.const 0))))))
                  (local.set $mask (i32.and (local.get $mask)
                    (i32.sub (local.get $mask) (i32.const 1))))
                  (br $candidate)))
              (if (i32.le_u (local.get $rem) (i32.const 16))
                (then
                  (global.set $ptr (global.get $end))
                  (br $rawDone)))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 16)))
              (br $raw)))
          (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
          (if (i32.eq (global.get $ptr) (global.get $end))
            (then
              (i32.store8 (i32.const $mem.streamDelimiter) (i32.const ")"))
              (memory.copy
                (i32.const $mem.streamDelimiter+1) (local.get $d) (local.get $dlen))
              (i32.store8
                (i32.add (i32.const $mem.streamDelimiter+1) (local.get $dlen))
                (i32.const 34))
              (call $streamSetFixed
                (i32.const $mem.streamDelimiter)
                (i32.add (local.get $dlen) (i32.const 2))
                (enum.get $Token.string))))
          (return (i32.const 0)))))

    ;; An invalid raw prefix falls back to an ordinary quoted literal. This is
    ;; lenient, bounded, and still colors its leading R/u8R prefix as string.
    (local.set $q (i32.load8_u (local.get $quote)))
    (global.set $ptr (i32.add (local.get $quote) (i32.const 1)))
    (select (local.get $q) (i32.const 0)
      (i32.eq
        (call $cppStringBody (local.get $q)
          (select (enum.get $Token.number) (enum.get $Token.string)
            (i32.eq (local.get $q) (i32.const 39)))
          (local.get $lhs))
        (i32.const 2))))

  ;; Advance $ptr over the rest of a directive's logical line: physical lines
  ;; joined by a backslash before the line break. $lhs bounds the byte-before
  ;; read. Returns 1 when the scan stopped at $end right after such a join,
  ;; so the next streaming chunk still belongs to the directive.
  (func $cppDirectiveScan (param $lhs i32) (result i32)
    (local $joined i32)
    (block $done
      (loop $l
        (call $scanToLineEnd)
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then (return (i32.eq (global.get $ptr) (local.get $joined)))))
        (br_if $done (i32.or
          (i32.eq (global.get $ptr) (local.get $lhs))
          (i32.ne (i32.load8_u (i32.sub (global.get $ptr) (i32.const 1))) (i32.const 92))))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 13))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (if (i32.eq (call $cppByte (global.get $ptr)) (i32.const 10))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $joined (global.get $ptr))
        (br $l)))
    (i32.const 0))

  ;; group order is the dispatch order in $cppWordHl below
  (keyword-table $cppWords $mem.cppWords $mem.cppWords+1280
    (group $Token.keyword.control ;; 1: control - `continue` lives in $cppWordHl instead
      "if" "do" "for" "try" "else" "case" "goto" "while" "break" "catch"
      "throw" "switch" "return" "default" "co_await" "co_yield"
      "co_return")
    (group $Token.keyword.declaration+256 "class" "union" "struct")           ;; 2: declaration, next name is a class type
    (group $Token.keyword.declaration+512 "enum" "using" "typedef" "concept") ;; 3: declaration, next name is a type
    (group $Token.keyword.declaration+768 "namespace")                        ;; 4: declaration, next name is a namespace
    (group $Token.keyword.declaration ;; 5: declaration
      "extern" "inline" "static" "register" "template")
    (group $Token.keyword.import "import" "module" "export") ;; 6: modules
    (group $Token.type.builtin ;; 7: primitive types - `char32_t` lives in $cppWordHl instead
      "int" "auto" "bool" "char" "long" "void" "float" "short" "double"
      "signed" "char8_t" "wchar_t" "char16_t" "unsigned")
    (group $Token.boolean "true" "false") ;; 8: booleans
    (group $Token.constant.builtin "nullptr")      ;; 9: built-in constant
    (group $Token.variable.special "this")         ;; 10: special variable
    (group $Token.operator ;; 11: alternative operator spellings
      "or" "and" "not" "xor" "bitor" "compl" "or_eq" "and_eq" "bitand"
      "not_eq" "xor_eq")
    (group $Token.keyword ;; 12: remaining keywords, including casts and specifiers
      "asm" "new" "const" "final" "delete" "friend" "public" "sizeof"
      "typeid" "alignas" "alignof" "mutable" "private" "virtual" "decltype"
      "explicit" "noexcept" "operator" "override" "requires" "typename"
      "volatile" "consteval" "constexpr" "constinit" "protected"
      "const_cast" "static_cast" "dynamic_cast" "thread_local"
      "static_assert" "reinterpret_cast"))

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=type.class, 2=type, 3=namespace. -1 means an ordinary identifier.
  ;; `continue` and `char32_t` hash identically to `alignof` and `char16_t` in
  ;; every bit the table can use - first two bytes, last byte, and length - so
  ;; each takes one exact eight-byte compare here instead. Input sentinel slack
  ;; keeps the unaligned i64 loads safe.
  (func $cppWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 8))
      (then
        (if (i64.eq (i64.load (local.get $lhs)) (i64.const "continue"))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (i64.load (local.get $lhs)) (i64.const "char32_t"))
          (then (return (enum.get $Token.type.builtin))))))
    (keyword-table.value $cppWords (local.get $lhs) (local.get $rhs)))

  (func $hlCpp
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    ;; 1 once a token sits on the current physical line: a `#` opens a
    ;; directive only while it is 0. Zero at a fresh start and checkpointed
    ;; between chunks, so a resumed line keeps its position.
    (local $midLine i32)
    (local $expectType i32)
    (local $member i32) ;; 1 after ./->, 2 after ::
    ;; the quote byte of an ordinary literal the previous chunk left open at
    ;; an escaped line break, or 0
    (local $strCont i32)
    ;; 1 when the previous chunk ended inside a backslash-continued directive
    (local $contDirective i32)
    (call $lexEmitLeadingContinuation)
    ;; Resume a construct left open at an escaped line break: the literal
    ;; continues with C++ escape rules, or the directive owns this line too.
    (if (local.get $strCont)
      (then
        (local.set $strCont (select (local.get $strCont) (i32.const 0)
          (i32.eq
            (call $cppStringBody (local.get $strCont)
              (select (enum.get $Token.number) (enum.get $Token.string)
                (i32.eq (local.get $strCont) (i32.const 39)))
              (global.get $ptr))
            (i32.const 2))))))
    (if (local.get $contDirective)
      (then
        (local.set $lhs (global.get $ptr))
        (local.set $contDirective (call $cppDirectiveScan (local.get $lhs)))
        (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))))
    (block $done
      (loop $next
        ;; Whitespace remains a gap; a physical newline inside it puts the
        ;; next token at a line start. The search stops at $ptr so a long
        ;; line is scanned once, not once per token.
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (i32.lt_u
              (call $scanFindSpecial
                (local.get $gap) (global.get $ptr) (i32.const 10) (i32.const 0) (i32.const 1))
              (global.get $ptr))
          (then (local.set $midLine (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $cppByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $cppByte (i32.add (global.get $ptr) (i32.const 2))))

        ;; comments, including Doxygen-style documentation comments
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or (i32.eq (local.get $c3) (i32.const "/"))
                        (i32.eq (local.get $c3) (i32.const "!")))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.or
                  (i32.eq (local.get $c3) (i32.const "!"))
                  (i32.and (i32.eq (local.get $c3) (i32.const "*"))
                    (i32.ne (call $cppByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "/"))))))
            (br $next)))

        ;; A directive owns its logical line, including escaped newlines.
        (if (i32.and (i32.eqz (local.get $midLine)) (i32.eq (local.get $c) (i32.const "#")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $contDirective (call $cppDirectiveScan (local.get $lhs)))
            (if (i32.eqz (call $lexEmitIncludeDirective (local.get $lhs) (global.get $ptr)))
              (then (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))))
            (local.set $midLine (i32.const 1))
            (local.set $member (i32.const 0))
            (local.set $expectType (i32.const 0))
            (br $next)))

        ;; ordinary/prefixed/raw strings and character literals
        (local.set $kind (call $cppStringKind (global.get $ptr)))
        (if (local.get $kind)
          (then
            (local.set $strCont (call $cppString (local.get $lhs) (local.get $kind)))
            (local.set $midLine (i32.const 1))
            (local.set $member (i32.const 0))
            (local.set $expectType (i32.const 0))
            (br $next)))

        ;; identifiers and contextual function/type/member heuristics
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $kind (call $cppWordHl (local.get $lhs) (local.get $rhs)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (if (i32.shr_u (local.get $kind) (i32.const 8))
                  (then (local.set $expectType (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
                (if (local.get $expectType)
                  (then
                    (local.set $hl
                      (select (enum.get $Token.type.class)
                        (select (enum.get $Token.namespace) (enum.get $Token.type)
                          (i32.eq (local.get $expectType) (i32.const 3)))
                        (i32.eq (local.get $expectType) (i32.const 1))))
                    (local.set $expectType (i32.const 0)))
                  (else
                    (if (i32.eq (call $cppByte (local.get $p)) (i32.const "("))
                      (then (local.set $hl (select
                        (enum.get $Token.function.method) (enum.get $Token.function)
                        (local.get $member))))
                      (else
                        (if (i32.eq (local.get $member) (i32.const 1))
                          (then (local.set $hl (enum.get $Token.property)))
                          (else
                            (if (i32.or
                                  (i32.eq (local.get $member) (i32.const 2))
                                  (i32.and
                                    (i32.eq (call $cppByte (local.get $p)) (i32.const ":"))
                                    (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":"))))
                              (then (local.set $hl
                                (select (enum.get $Token.namespace) (enum.get $Token.type)
                                  (i32.and
                                    (i32.eq (call $cppByte (local.get $p)) (i32.const ":"))
                                    (i32.eq (call $cppByte (i32.add (local.get $p) (i32.const 1)))
                                            (i32.const ":"))))))
                              (else
                                (if (i32.and
                                      (i32.eq (call $cppByte (local.get $p)) (i32.const ":"))
                                      (i32.ne (call $cppByte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))
                                  (then (local.set $hl (enum.get $Token.label)))
                                  (else
                                    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                      (then (local.set $hl (enum.get $Token.constant)))
                                      (else
                                        (if (i32.le_u
                                              (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A"))
                                              (i32.const 25))
                                          (then (local.set $hl (enum.get $Token.type)))
                                          (else (local.set $hl (enum.get $Token.variable))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $midLine (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; numeric literals, including .5, binary/hex floats and separators
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const "."))
                       (call $lexIsDigit (local.get $c2))))
          (then
            (call $cppScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $midLine (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; brackets
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $midLine (i32.const 1))
            (local.set $member (i32.const 0))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{"))
                        (i32.eq (local.get $c) (i32.const "}")))
              (then (local.set $expectType (i32.const 0))))
            (br $next)))

        ;; scope/member delimiters and ellipsis/pointer-to-member operators
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr)
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (select (i32.const 2) (i32.const 0)
              (i32.eq (local.get $c2) (i32.const ":"))))
            (local.set $midLine (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.or (i32.eq (local.get $c2) (i32.const "*"))
                        (i32.and (i32.eq (local.get $c2) (i32.const "."))
                                 (i32.eq (local.get $c3) (i32.const "."))))
              (then
                (global.set $ptr (i32.add (global.get $ptr)
                  (select (i32.const 3) (i32.const 2) (i32.eq (local.get $c2) (i32.const ".")))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))))
            (local.set $midLine (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ","))
                    (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $midLine (i32.const 1))
            (local.set $member (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $expectType (i32.const 0))))
            (br $next)))

        ;; Operators consume one valid compound form, leaving a following `/`
        ;; visible to the next iteration so it can still open a comment.
        (if (call $cppIsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $member (i32.const 0))
            (if (i32.and (i32.eq (local.get $c) (i32.const "-"))
                         (i32.eq (local.get $c2) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (call $cppByte (global.get $ptr)) (i32.const "*"))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (local.set $member (i32.const 1)))
              (else
                (if (i32.and
                      (i32.eq (local.get $c) (i32.const "<"))
                      (i32.and (i32.eq (local.get $c2) (i32.const "="))
                               (i32.eq (local.get $c3) (i32.const ">"))))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 2))))
                  (else
                    (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                                (i32.eq (local.get $c) (local.get $c2)))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (if (i32.and
                              (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                      (i32.eq (local.get $c) (i32.const ">")))
                              (i32.eq (call $cppByte (global.get $ptr)) (i32.const "=")))
                          (then
                            (global.set $ptr
                              (i32.add (global.get $ptr) (i32.const 1)))))))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $midLine (i32.const 1))
            (br $next)))

        ;; Unknown bytes are plain; batch until the next recognized byte class.
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (block $plainDone
          (loop $plain
            (br_if $plainDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $plainDone (i32.or
              (i32.or
                (i32.or (call $lexIsSpace (local.get $c)) (call $lexIsIdentStart (local.get $c)))
                (i32.or (call $lexIsDigit (local.get $c)) (call $cppIsOp (local.get $c))))
              (byteset.get "\22'(),.:;[]{}" (local.get $c))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $plain)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $midLine (i32.const 1))
        (local.set $member (i32.const 0))
        (br $next))))
)
