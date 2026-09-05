(module
  (import "../common.wat")

  (func $cljByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $cljWordHl. The high byte of a
  ;; declaration value names what the next symbol is: 1 a function, 2 a
  ;; variable, 3 a type, 4 a namespace. `defonce`, `declare`, `defrecord`,
  ;; `if-let`, and `when-let` share hash features with table words and are
  ;; matched directly; `refer` is left out for the same reason.
  (keyword-table $clojureWords $mem.clojureWords $mem.clojureWords+512
    (group $Token.keyword.declaration+256 ;; 1: the next symbol is a function
      "defn" "defn-" "defmacro" "defmulti" "defmethod" "definline")
    (group $Token.keyword.declaration+512 "def")      ;; 2: a variable
    (group $Token.keyword.declaration+768 ;; 3: a type
      "deftype" "defprotocol" "definterface" "defstruct")
    (group $Token.keyword.declaration+1024 "ns" "in-ns") ;; 4: a namespace
    (group $Token.keyword.control ;; 5: control flow
      "if" "if-not" "if-some" "when" "when-not" "when-some" "when-first"
      "cond" "condp" "case" "loop" "recur" "for" "doseq" "dotimes" "while"
      "try" "catch" "finally" "throw" "do")
    (group $Token.keyword ;; 6: special forms and core macros
      "fn" "let" "letfn" "binding" "import" "require" "use" "set!" "var"
      "quote" "new" "doto" "comment")
    (group $Token.keyword.operator "and" "or" "not") ;; 7: word operators
    (group $Token.boolean "true" "false")            ;; 8: booleans
    (group $Token.constant.builtin "nil"))           ;; 9: nil

  ;; Token in the low byte and the next-symbol capture in the high byte,
  ;; or -1 for an ordinary symbol. The direct matches read eight bytes,
  ;; which stay inside the input slack.
  (func $cljWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $v i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (local.set $v (keyword-table.value $clojureWords (local.get $lhs) (local.get $rhs)))
    (if (i32.ge_s (local.get $v) (i32.const 0)) (then (return (local.get $v))))
    (if (i32.eq (local.get $n) (i32.const 6))
      (then
        (if (i32.and
              (i32.eq (i32.load (local.get $lhs)) (i32.const "if-l"))
              (i32.eq (i32.load16_u offset=4 (local.get $lhs)) (i32.const "et")))
          (then (return (enum.get $Token.keyword.control))))))
    (if (i32.eq (local.get $n) (i32.const 7))
      (then
        (local.set $v (i32.const -1))
        (if (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
              (i64.const "defonce"))
          (then (local.set $v (i32.or (enum.get $Token.keyword.declaration) (i32.const 512)))))
        (if (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
              (i64.const "declare"))
          (then (local.set $v (i32.or (enum.get $Token.keyword.declaration) (i32.const 256)))))
        (return (local.get $v))))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then
        (if (i64.eq (i64.load (local.get $lhs)) (i64.const "when-let"))
          (then (return (enum.get $Token.keyword.control))))))
    (if (i32.eq (local.get $n) (i32.const 9))
      (then
        (if (i32.and
              (i64.eq (i64.load (local.get $lhs)) (i64.const "defrecor"))
              (i32.eq (i32.load8_u offset=8 (local.get $lhs)) (i32.const "d")))
          (then (return (i32.or (enum.get $Token.keyword.declaration) (i32.const 768)))))))
    (i32.const -1))

  ;; whether $c ends a symbol: whitespace, brackets, quotes, and the reader
  ;; characters that never join a name
  (func $cljIsDelim (param $c i32) (result i32)
    (i32.or
      (call $lexIsSpace (local.get $c))
      (byteset.get "\00\22()@[]^`{}~,;\5c" (local.get $c))))

  ;; advance $ptr over the symbol that starts at it
  (func $cljScanSymbol
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (call $cljIsDelim (i32.load8_u (global.get $ptr))))
        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (br $l))))

  ;; The offset of the `/` that splits a namespace-qualified symbol
  ;; [lhs,rhs), or 0 when the symbol is not qualified: a `/` alone or at
  ;; either end is part of an ordinary symbol.
  (func $cljNsSplit (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $rhs)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "/"))
          (then (return (i32.sub (local.get $p) (local.get $lhs)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; whether the symbol [lhs,rhs) has a `.` strictly inside it, the shape
  ;; of a namespace name
  (func $cljIsDotted (param $lhs i32) (param $rhs i32) (result i32)
    (local $p i32)
    (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (local.get $rhs)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "."))
          (then (return (i32.const 1))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (i32.const 0))

  ;; $expect is the pending next-symbol capture from a definition form and
  ;; $head is 1 right after `(`, where the symbol is the operator of the
  ;; form. Both are checkpointed.
  (func $hlClojure
    (local $c i32) (local $c2 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $q i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $head i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $cljByte (i32.add (global.get $ptr) (i32.const 1))))

        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $head (i32.const 0))
            (br $next)))
        ;; `\a`, `\newline`, `é`: a character literal
        (if (i32.and (i32.eq (local.get $c) (i32.const 92)) (i32.gt_u (local.get $c2) (i32.const 32)))
          (then
            (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
            (call $cljScanSymbol)
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.const 0))
            (br $next)))
        ;; `:kw`, `::kw`, `:ns/kw`
        (if (i32.and (i32.eq (local.get $c) (i32.const ":")) (i32.eqz (call $cljIsDelim (local.get $c2))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $cljScanSymbol)
            (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.eq (local.get $c) (i32.const "(")))
            ;; a definition names the symbol after its head; any bracket
            ;; other than that `(` ends the capture
            (if (i32.ne (local.get $c) (i32.const "("))
              (then (local.set $expect (i32.const 0))))
            (br $next)))

        ;; reader macros: quote, syntax-quote, unquote, deref, metadata
        (if (byteset.get "'@^`~" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c2) (i32.const "@"))))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            ;; `#"regex"`
            (if (i32.eq (local.get $c2) (i32.const 34))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
                (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string.regex))
                (local.set $head (i32.const 0))
                (br $next)))
            ;; `#!` shebang line
            (if (i32.eq (local.get $c2) (i32.const "!"))
              (then
                (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            ;; `##Inf`, `##NaN`
            (if (i32.eq (local.get $c2) (i32.const "#"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $cljScanSymbol)
                (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
                (local.set $head (i32.const 0))
                (br $next)))
            ;; `#:ns{...}` and `#::{...}` namespaced maps
            (if (i32.eq (local.get $c2) (i32.const ":"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $cljScanSymbol)
                (call $emitTok (enum.get $Token.string.special.symbol) (local.get $lhs) (global.get $ptr))
                (br $next)))
            ;; `#(`, `#{`, `#'`, `#_`, `#?`, `#?@`
            (if (i32.or (i32.eq (local.get $c2) (i32.const 39)) (i32.or (i32.eq (local.get $c2) (i32.const "_")) (i32.eq (local.get $c2) (i32.const "?"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (if (i32.and (i32.eq (local.get $c2) (i32.const "?")) (i32.eq (call $cljByte (global.get $ptr)) (i32.const "@")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                (br $next)))
            ;; `#inst "..."`, `#uuid "..."` tagged literals
            (if (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $cljScanSymbol)
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                (local.set $head (i32.const 0))
                (br $next)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `,` is whitespace to the reader
        (if (i32.eq (local.get $c) (i32.const ","))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; a symbol: number, keyword, definition name, operator, or plain
        (call $cljScanSymbol)
        (if (i32.eq (global.get $ptr) (local.get $lhs))
          (then (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))))
        (local.set $rhs (global.get $ptr))
        ;; a symbol starting with a digit, or a sign and a digit, is a number
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                (call $lexIsDigit (local.get $c2))))
          (then
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (local.get $rhs))
            (local.set $head (i32.const 0))
            (br $next)))
        ;; `%`, `%1`, `%&` inside `#(...)`
        (if (i32.eq (local.get $c) (i32.const "%"))
          (then
            (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (local.get $rhs))
            (local.set $head (i32.const 0))
            (br $next)))
        ;; `&` rest parameters
        (if (i32.and (i32.eq (local.get $c) (i32.const "&")) (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1)))
          (then
            (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $rhs))
            (local.set $head (i32.const 0))
            (br $next)))
        ;; `.method` and `.-field` interop
        (if (i32.and (i32.eq (local.get $c) (i32.const ".")) (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1)))
          (then
            (call $emitTok
              (select (enum.get $Token.property) (enum.get $Token.function.method)
                (i32.eq (local.get $c2) (i32.const "-")))
              (local.get $lhs) (local.get $rhs))
            (local.set $head (i32.const 0))
            (br $next)))
        (local.set $kind (call $cljWordHl (local.get $lhs) (local.get $rhs)))
        (if (i32.ge_s (local.get $kind) (i32.const 0))
          (then
            (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
            (if (local.get $head)
              (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $head (i32.const 0))
            (br $next)))
        (if (local.get $expect)
          (then
            (local.set $hl (enum.get $Token.function.definition))
            (if (i32.eq (local.get $expect) (i32.const 2)) (then (local.set $hl (enum.get $Token.variable))))
            (if (i32.eq (local.get $expect) (i32.const 3)) (then (local.set $hl (enum.get $Token.type))))
            (if (i32.eq (local.get $expect) (i32.const 4)) (then (local.set $hl (enum.get $Token.namespace))))
            (local.set $expect (i32.const 0))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $head (i32.const 0))
            (br $next)))
        ;; `ns/name`: the namespace or class, the slash, then the name
        (local.set $q (call $cljNsSplit (local.get $lhs) (local.get $rhs)))
        (if (local.get $q)
          (then
            (local.set $q (i32.add (local.get $lhs) (local.get $q)))
            (call $emitTok
              (select (enum.get $Token.type) (enum.get $Token.namespace)
                (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (local.get $lhs) (local.get $q))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $q) (i32.add (local.get $q) (i32.const 1)))
            (local.set $lhs (i32.add (local.get $q) (i32.const 1)))
            (local.set $c (i32.load8_u (local.get $lhs)))))
        ;; `Foo` and `Foo.` name classes wherever they stand; a dotted
        ;; lowercase symbol such as `clojure.string` names a namespace
        (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
          (then (local.set $hl (enum.get $Token.type)))
          (else
            (if (i32.and (call $lexIsIdentStart (local.get $c)) (call $cljIsDotted (local.get $lhs) (local.get $rhs)))
              (then (local.set $hl (enum.get $Token.namespace)))
              (else
                (if (local.get $head)
                  (then (local.set $hl (enum.get $Token.function)))
                  (else
                    ;; `*dynamic*` by convention
                    (if (i32.and
                          (i32.eq (local.get $c) (i32.const "*"))
                          (i32.and
                            (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                            (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "*"))))
                      (then (local.set $hl (enum.get $Token.variable.special)))
                      (else
                        (local.set $hl (select (enum.get $Token.variable) (enum.get $Token.operator)
                          (call $lexIsIdentStart (local.get $c))))))))))))
        (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
        (local.set $head (i32.const 0))
        (br $next))))
)
