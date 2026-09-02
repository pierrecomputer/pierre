(module
  (import "../common.wat")

  (func $exByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $exWordHl below. The `__MODULE__`
  ;; family is a prefix check there. `receive` is matched directly: it shares
  ;; its hash features with `require`, as `defguardp` does with `defmacrop`
  ;; and `reraise` with both, and those two rare words stay out.
  (keyword-table $exWords $mem.elixirWords $mem.elixirWords+896 16 256
    (group ;; 1: control
      "do" "if" "fn" "end" "for" "case" "cond" "else" "then" "with"
      "after" "catch" "raise" "throw" "unless" "rescue" "quote" "unquote"
      "try")
    (group ;; 2: definitions, next name is a function
      "def" "defp" "defmacro" "defmacrop" "defguard" "defdelegate")
    (group ;; 3: definitions, next name is a module
      "defmodule" "defprotocol" "defimpl")
    (group ;; 4: other definitions
      "defstruct" "defexception" "defoverridable" "defcallback")
    (group "use" "alias" "import" "require") ;; 5: import
    (group "in" "or" "and" "not" "when")      ;; 6: word operators
    (group "true" "false")                    ;; 7: booleans
    (group "nil")                             ;; 8: built-in constant
    (group "self" "super"))                   ;; 9: special variables

  ;; The token for a bare word, or -1 for an ordinary identifier. Bit 8 marks
  ;; a definition whose next name is a function, bit 9 one whose next name
  ;; is a module.
  (func $exWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $n i32)
    (local.set $g (keyword-table.get $exWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
        (if (i32.and
              (i32.ge_u (local.get $n) (i32.const 5))
              (i32.and
                (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "__"))
                (i32.eq (i32.load16_u (i32.sub (local.get $rhs) (i32.const 2))) (i32.const "__"))))
          (then (return (enum.get $Token.variable.special))))
        ;; the wide load stays inside the input slack
        (if (i32.and
              (i32.eq (local.get $n) (i32.const 7))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
                (i64.const "receive")))
          (then (return (enum.get $Token.keyword.control))))
        (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.eq (local.get $g) (i32.const 2))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
    (if (i32.eq (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (enum.get $Token.keyword.import))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.operator))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.boolean))))
    (if (i32.eq (local.get $g) (i32.const 8))
      (then (return (enum.get $Token.constant.builtin))))
    (enum.get $Token.variable.special))

  (func $exCloser (param $open i32) (result i32)
    (if (i32.eq (local.get $open) (i32.const "(")) (then (return (i32.const ")"))))
    (if (i32.eq (local.get $open) (i32.const "[")) (then (return (i32.const "]"))))
    (if (i32.eq (local.get $open) (i32.const "{")) (then (return (i32.const "}"))))
    (if (i32.eq (local.get $open) (i32.const "<")) (then (return (i32.const ">"))))
    (local.get $open))

  ;; Scan a literal body from $ptr with the bytes since $seg still
  ;; unemitted: up to the $close byte - tripled when $flags bit 3 is set -
  ;; at nesting depth zero, where $open is the byte that nests, zero when
  ;; none, and $depth the nesting already open. $flags bit 0 enables
  ;; escapes and `#{}` interpolation, bit 1 marks a sigil that carries
  ;; modifier letters, bit 2 colors the body as a documentation comment,
  ;; bit 4 keeps the body on one line, and bit 5 colors it as a regex.
  ;; $nested is nonzero inside an interpolation, where a nested literal
  ;; keeps `#{` plain. Returns the status in the low two bits - 1 past the
  ;; closer, 2 past a `#{` that opens an interpolation, emitted as
  ;; punctuation.special, 0 at $end or at the line break of a one-line body
  ;; - and the nesting depth still open in the bits above.
  (func $exLiteralBody
    (param $close i32) (param $open i32) (param $depth i32) (param $flags i32)
    (param $nested i32) (param $seg i32) (result i32)
    (local $c i32) (local $e i32) (local $hl i32) (local $status i32)
    (local $stop i32) (local $hash i32)
    (local.set $hl (select (enum.get $Token.string.regex)
      (select (enum.get $Token.comment.doc) (enum.get $Token.string)
        (i32.and (local.get $flags) (i32.const 4)))
      (i32.and (local.get $flags) (i32.const 32))))
    (local.set $stop (global.get $ptr))
    (local.set $hash (global.get $ptr))
    (block $done
      (loop $scan
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop (call $scanFindSpecial
              (global.get $ptr) (global.get $end) (local.get $close)
              (i32.and (local.get $flags) (i32.const 1)) (i32.shr_u (local.get $flags) (i32.const 4))))
            (local.set $hash (call $lexFindEither (global.get $ptr)
              (select (i32.const "#") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
              (select (local.get $open) (local.get $close) (local.get $open)))))
          (else
            (if (i32.gt_u (global.get $ptr) (local.get $hash))
              (then (local.set $hash (call $lexFindEither (global.get $ptr)
                (select (i32.const "#") (local.get $close) (i32.and (local.get $flags) (i32.const 1)))
                (select (local.get $open) (local.get $close) (local.get $open))))))))
        (global.set $ptr (select (local.get $hash) (local.get $stop)
          (i32.lt_u (local.get $hash) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $close))
          (then
            (if (local.get $depth)
              (then
                (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $scan)))
            (if (i32.and
                  (i32.and (local.get $flags) (i32.const 8))
                  (i32.eqz (i32.and
                    (i32.eq (call $exByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $close))
                    (i32.eq (call $exByte (i32.add (global.get $ptr) (i32.const 2))) (local.get $close)))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $scan)))
            ;; the trailing quotes of a heredoc read below $end, so this
            ;; cannot overshoot; a sigil carries its modifier letters
            (global.set $ptr (i32.add (global.get $ptr)
              (select (i32.const 3) (i32.const 1) (i32.and (local.get $flags) (i32.const 8)))))
            (if (i32.and (local.get $flags) (i32.const 2))
              (then (call $lexScanIdent)))
            (local.set $status (i32.const 1))
            (br $done)))
        (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $c) (local.get $open)))
          (then
            (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (br_if $done (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        (if (i32.and
              (i32.eq (call $exByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{"))
              (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special)
              (i32.sub (global.get $ptr) (i32.const 2)) (global.get $ptr))
            (return (i32.or (i32.const 2) (i32.shl (local.get $depth) (i32.const 2))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (local.get $hl) (local.get $seg) (global.get $ptr))
    (i32.or (local.get $status) (i32.shl (local.get $depth) (i32.const 2))))

  (func $exIsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "!")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "^")) (i32.eq (local.get $c) (i32.const "~")))
              (i32.or (i32.eq (local.get $c) (i32.const "\\")) (i32.eq (local.get $c) (i32.const "?")))))))))

  ;; An open literal body is described by $sClose, $sOpen, $sDepth, and
  ;; $sFlags - see $exLiteralBody - with $sActive 1 while it is being
  ;; scanned and $seg the start of its bytes not yet emitted; the $i*
  ;; copies hold the literal suspended by a `#{` interpolation whose braces
  ;; $interp counts. $decl is 1 after `def` and 2 after `defmodule`;
  ;; $member is 1 after `.`; $docAttr is 1 after `@doc`, `@moduledoc`, or
  ;; `@typedoc`, whose string is documentation. All are checkpointed.
  (func $hlElixir
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $status i32)
    (local $decl i32) (local $member i32) (local $docAttr i32)
    (local $seg i32) (local $interp i32)
    (local $sActive i32) (local $sClose i32) (local $sOpen i32) (local $sDepth i32) (local $sFlags i32)
    (local $iClose i32) (local $iOpen i32) (local $iDepth i32) (local $iFlags i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open literal body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $sActive)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $exLiteralBody
              (local.get $sClose) (local.get $sOpen) (local.get $sDepth) (local.get $sFlags)
              (local.get $interp) (local.get $seg)))
            (local.set $sDepth (i32.shr_u (local.get $status) (i32.const 2)))
            (local.set $status (i32.and (local.get $status) (i32.const 3)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $iClose (local.get $sClose))
                (local.set $iOpen (local.get $sOpen))
                (local.set $iDepth (local.get $sDepth))
                (local.set $iFlags (local.get $sFlags))
                (local.set $interp (i32.const 1))
                (local.set $sActive (i32.const 0))
                (local.set $seg (i32.const 0)))
              (else
                (if (i32.or
                      (i32.eq (local.get $status) (i32.const 1))
                      (i32.and (local.get $sFlags) (i32.const 16)))
                  (then
                    (local.set $sActive (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $exByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $exByte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))

        ;; strings, charlists, and their `"""` heredocs; a heredoc after
        ;; `@doc` is documentation. The body is scanned at the top of the
        ;; loop.
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $sFlags (i32.const 1))
            (if (i32.and (i32.eq (local.get $c2) (local.get $c)) (i32.eq (local.get $c3) (local.get $c)))
              (then
                (local.set $sFlags (i32.or (i32.const 9) (i32.shl (local.get $docAttr) (i32.const 2))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3))))
              (else
                (local.set $sFlags (i32.or (i32.const 17) (i32.shl (local.get $docAttr) (i32.const 2))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok
              (select (enum.get $Token.comment.doc) (enum.get $Token.string) (local.get $docAttr))
              (local.get $lhs) (global.get $ptr))
            (local.set $sActive (i32.const 1))
            (local.set $sClose (local.get $c))
            (local.set $sOpen (i32.const 0))
            (local.set $sDepth (i32.const 0))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $docAttr (i32.const 0))
            (br $next)))
        ;; sigils: `~r/.../`, `~s(...)`, `~w[...]`, `~H"""..."""`; a
        ;; lowercase letter interpolates, an uppercase one does not
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "~"))
              (i32.and
                (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (i32.and
                  (i32.gt_u (local.get $c3) (i32.const 32))
                  (i32.and (i32.lt_u (local.get $c3) (i32.const 128)) (i32.eqz (call $lexIsIdentContinue (local.get $c3)))))))
          (then
            (local.set $sOpen (local.get $c3))
            (local.set $sClose (call $exCloser (local.get $sOpen)))
            (if (i32.eq (local.get $sClose) (local.get $sOpen))
              (then (local.set $sOpen (i32.const 0))))
            (local.set $sDepth (i32.const 0))
            (local.set $sFlags (i32.or (i32.const 2)
              (i32.le_u (i32.sub (local.get $c2) (i32.const "a")) (i32.const 25))))
            (if (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "r"))
              (then (local.set $sFlags (i32.or (local.get $sFlags) (i32.const 32)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
            (if (i32.and
                  (i32.eqz (local.get $sOpen))
                  (i32.and
                    (i32.or (i32.eq (local.get $sClose) (i32.const 34)) (i32.eq (local.get $sClose) (i32.const 39)))
                    (i32.and
                      (i32.eq (call $exByte (global.get $ptr)) (local.get $sClose))
                      (i32.eq (call $exByte (i32.add (global.get $ptr) (i32.const 1))) (local.get $sClose)))))
              (then
                (local.set $sFlags (i32.or (local.get $sFlags) (i32.const 8)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
            (call $emitTok
              (select (enum.get $Token.string.regex) (enum.get $Token.string)
                (i32.and (local.get $sFlags) (i32.const 32)))
              (local.get $lhs) (global.get $ptr))
            (local.set $sActive (i32.const 1))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; atoms: `:name`, `:"quoted"`, `:+`; `::` is a typespec operator
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.ne (local.get $c2) (i32.const ":")))
          (then
            (if (i32.eq (local.get $c2) (i32.const 34))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string.special.symbol))
                (local.set $member (i32.const 0))
                (br $next)))
            (if (call $lexIsIdentStart (local.get $c2))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lexScanIdent)
                (if (i32.or
                      (i32.eq (call $exByte (global.get $ptr)) (i32.const "?"))
                      (i32.eq (call $exByte (global.get $ptr)) (i32.const "!")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0))
                (br $next)))
            (if (call $exIsOp (local.get $c2))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (block $opDone
                  (loop $op
                    (br_if $opDone (i32.eqz (call $exIsOp (call $exByte (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $op)))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 0))
                (br $next)))))

        ;; `@attr` module attributes; `@doc` and friends document the next string
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (local.set $docAttr (i32.and
              (i32.ge_u (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 4))
              (i32.eq (i32.and (i32.load (i32.sub (global.get $ptr) (i32.const 3))) (i32.const 0xffffff)) (i32.const "doc"))))
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `?c` character codes
        (if (i32.and
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.and (i32.gt_u (local.get $c2) (i32.const 32)) (i32.eqz (call $lexIsIdentContinue (local.get $c3)))))
          (then
            (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then (global.set $ptr (call $lexEscapeEnd (i32.add (local.get $lhs) (i32.const 1))))))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (if (i32.or
                  (i32.eq (call $exByte (global.get $ptr)) (i32.const "?"))
                  (i32.eq (call $exByte (global.get $ptr)) (i32.const "!")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; `key:` in a keyword list is an atom
            (if (i32.and
                  (i32.eq (call $exByte (local.get $rhs)) (i32.const ":"))
                  (i32.and
                    (i32.ne (call $exByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":"))
                    (i32.eqz (local.get $member))))
              (then
                (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (local.set $decl (i32.const 0))
                (br $next)))
            (local.set $kind (select (i32.const -1)
              (call $exWordHl (local.get $lhs) (local.get $rhs))
              (local.get $member)))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                (local.set $decl (i32.shr_u (local.get $kind) (i32.const 8))))
              (else
                (if (local.get $decl)
                  (then
                    (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                      (i32.eq (local.get $decl) (i32.const 1))))
                    ;; `defmodule Foo.Bar` keeps the head open through the dots
                    (if (i32.eqz (i32.and
                          (i32.eq (local.get $decl) (i32.const 2))
                          (i32.eq (call $exByte (local.get $rhs)) (i32.const "."))))
                      (then (local.set $decl (i32.const 0)))))
                  (else
                    (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                      (then (local.set $hl (enum.get $Token.type)))
                      (else
                        (if (local.get $member)
                          (then (local.set $hl (select
                            (enum.get $Token.function.method) (enum.get $Token.property)
                            (i32.eq (call $exByte (local.get $p)) (i32.const "(")))))
                          (else
                            ;; `foo(` and `foo arg` are calls; `_x` and the
                            ;; rest are variables
                            (local.set $c2 (call $exByte (local.get $p)))
                            (if (i32.or
                                  (i32.eq (call $exByte (local.get $rhs)) (i32.const "("))
                                  (i32.and
                                    (i32.gt_u (local.get $p) (local.get $rhs))
                                    (i32.or
                                      (i32.or
                                        (i32.eq (local.get $c2) (i32.const 34))
                                        (i32.eq (local.get $c2) (i32.const 39)))
                                      (i32.or
                                        (i32.and
                                          (i32.eq (local.get $c2) (i32.const ":"))
                                          (call $lexIsIdentStart (call $exByte (i32.add (local.get $p) (i32.const 1)))))
                                        (i32.or
                                          (i32.eq (local.get $c2) (i32.const "@"))
                                          (i32.and
                                            (call $lexIsIdentStart (local.get $c2))
                                            (call $exArgWord (local.get $p))))))))
                              (then (local.set $hl (enum.get $Token.function)))
                              (else (local.set $hl (enum.get $Token.variable))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the brace matching `#{` returns to the literal body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $sClose (local.get $iClose))
                        (local.set $sOpen (local.get $iOpen))
                        (local.set $sDepth (local.get $iDepth))
                        (local.set $sFlags (local.get $iFlags))
                        (local.set $sActive (i32.const 1))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (local.set $decl (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $decl (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $decl (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.ne (local.get $c2) (i32.const ".")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))
        ;; `%Struct{}` and `%{}`
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `&1` captures
        (if (i32.and (i32.eq (local.get $c) (i32.const "&")) (call $lexIsDigit (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or
              (call $exIsOp (local.get $c))
              (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (i32.or
                  (call $exIsOp (call $exByte (global.get $ptr)))
                  (i32.or
                    (i32.eq (call $exByte (global.get $ptr)) (i32.const "."))
                    (i32.eq (call $exByte (global.get $ptr)) (i32.const ":"))))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))

  ;; Whether the word at $p can be a bare argument: 1 for a name that is not
  ;; a keyword, 0 for a keyword such as the `do` of a block.
  (func $exArgWord (param $p i32) (result i32)
    (local $e i32)
    (local.set $e (local.get $p))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $e) (global.get $end)))
        (br_if $done (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $e)))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l)))
    (i32.eqz (keyword-table.get $exWords (local.get $p) (local.get $e))))
)
