(module
  (import "../common.wat")

  (func $lispByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $lispWordHl below. Words with a
  ;; `*` or `!` cannot sit in the table and are matched directly: `let*`,
  ;; `set!`. `declare` shares its hash features with `deftype` and stays out,
  ;; as do `defconst` and `defrecord`, which share slot bits with `defsubst`
  ;; and `defmethod` in every geometry that fits the range.
  (keyword-table $lispWords $mem.lispWords $mem.lispWords+1280
    (group ;; 1: definitions, next name is a function
      "defun" "defmacro" "defmethod" "defgeneric" "define" "define-syntax"
      "define-macro" "defsubst")
    (group ;; 2: definitions, next name is a variable
      "defvar" "defparameter" "defconstant" "defcustom")
    (group ;; 3: definitions, next name is a type
      "defstruct" "defclass" "deftype" "defpackage" "defgroup" "defprotocol")
    (group ;; 4: special forms and macros
      "if" "do" "go" "or" "and" "let" "the" "cond" "case" "flet" "loop"
      "prog1" "prog2" "progn" "setq" "setf" "when" "block" "catch" "throw"
      "unless" "lambda" "labels" "letrec" "return" "dolist" "dotimes"
      "declaim" "tagbody" "typecase" "function" "eval-when" "handler-case"
      "handler-bind" "return-from" "in-package" "use-package" "ignore-errors"
      "unwind-protect" "with-open-file" "with-slots" "syntax-rules"
      "multiple-value-bind" "destructuring-bind" "let-values" "begin"
      "ecase" "etypecase" "assert" "error" "check-type" "interactive"
      "condition-case" "save-excursion" "with-current-buffer" "require"
      "provide" "import" "export" "quote" "ns" "fn" "defn" "def")
    (group "nil" "true" "false")) ;; 5: constants

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function, 2=variable, 3=type. -1 means an ordinary symbol.
  (func $lispWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $g i32)
    (local $n i32)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.eq (local.get $n) (i32.const 1))
      (then
        ;; the table needs two bytes; `t` is the one-letter truth constant
        (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "t"))
          (then (return (enum.get $Token.constant.builtin))))
        (return (i32.const -1))))
    (local.set $g (keyword-table.get $lispWords (local.get $lhs) (local.get $rhs)))
    (if (i32.eqz (local.get $g))
      (then
        ;; the wide loads stay inside the input slack
        (if (i32.and
              (i32.eq (local.get $n) (i32.const 4))
              (i32.or
                (i32.eq (i32.load (local.get $lhs)) (i32.const "let*"))
                (i32.eq (i32.load (local.get $lhs)) (i32.const "set!"))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.and
              (i32.eq (local.get $n) (i32.const 7))
              (i64.eq
                (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
                (i64.const "declare")))
          (then (return (enum.get $Token.keyword))))
        (return (i32.const -1))))
    (if (i32.le_u (local.get $g) (i32.const 3))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (local.get $g) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 4))
      (then (return (enum.get $Token.keyword))))
    (enum.get $Token.constant.builtin))

  ;; whether $c ends a symbol: whitespace, parentheses, brackets, quotes,
  ;; and the reader characters
  (func $lispIsDelim (param $c i32) (result i32)
    (i32.or
      (i32.or
        (call $lexIsSpace (local.get $c))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
          (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))))
      (byteset.get "\00\22',;`{}" (local.get $c))))

  ;; advance $ptr over the symbol that starts at it
  (func $lispScanSymbol
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (call $lispIsDelim (i32.load8_u (global.get $ptr))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; whether [lhs,rhs) is a number: an optional sign, digits with at most
  ;; one point or slash, and an optional exponent
  (func $lispIsNumber (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $digits i32)
    (local $prev i32)
    (local.set $c (i32.load8_u (local.get $lhs)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
      (then (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (call $lexIsDigit (local.get $c))
          (then (local.set $digits (i32.const 1)))
          (else
            ;; a sign inside the number only follows an exponent marker
            (if (i32.eqz (i32.or
                  (i32.or (i32.eq (local.get $c) (i32.const ".")) (i32.eq (local.get $c) (i32.const "/")))
                  (i32.or
                    (i32.eq (i32.or (local.get $c) (i32.const 32)) (i32.const "e"))
                    (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                      (i32.eq (i32.or (local.get $prev) (i32.const 32)) (i32.const "e"))))))
              (then (return (i32.const 0))))))
        (local.set $prev (local.get $c))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (local.get $digits))

  ;; $expect is the pending next-name capture from a definition form and
  ;; $head is 1 right after `(`, where the symbol is the operator of the
  ;; form. Both are checkpointed.
  (func $hlLisp
    (local $c i32) (local $c2 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32)
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
        (local.set $c2 (call $lispByte (i32.add (global.get $ptr) (i32.const 1))))

        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        ;; `#| ... |#` nests
        (if (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "|")))
          (then
            (call $lexNestedBlockComment (i32.const "#|") (i32.const "|#") (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $head (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.eq (local.get $c) (i32.const "(")))
            ;; a definition names the symbol after its head; a paren there
            ;; is an argument list or a `(name options)` spec, whose first
            ;; symbol is still the name
            (if (i32.and (i32.ne (local.get $c) (i32.const "(")) (i32.ne (local.get $c) (i32.const ")")))
              (then (local.set $expect (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then (local.set $expect (i32.const 0))))
            (br $next)))

        ;; reader macros: quote, quasiquote, unquote, and `#'`, `#(`, `#:`,
        ;; `#+feature`, `#\char`, `#x1F`
        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const "`")))
              (i32.eq (local.get $c) (i32.const ",")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.and (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c2) (i32.const "@"))))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then
                ;; `#\a`, `#\Space`, `#\(`: one character or a name
                (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 2)) (global.get $end)))
                (call $lispScanSymbol)
                (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                (local.set $head (i32.const 0))
                (br $next)))
            (if (i32.or
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "x"))
                  (i32.or
                    (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "b"))
                    (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "o"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lispScanSymbol)
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (local.set $head (i32.const 0))
                (br $next)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "+")) (i32.eq (local.get $c2) (i32.const "-")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lispScanSymbol)
                (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
                (local.set $head (i32.const 0))
                (br $next)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const 39)) (i32.eq (local.get $c2) (i32.const ":")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $head (i32.const 0))
            (br $next)))

        ;; a symbol: keyword, number, definition name, operator, or plain
        (call $lispScanSymbol)
        (if (i32.eq (global.get $ptr) (local.get $lhs))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (local.set $rhs (global.get $ptr))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then (local.set $hl (enum.get $Token.string.special.symbol)))
          (else
            (if (call $lispIsNumber (local.get $lhs) (local.get $rhs))
              (then (local.set $hl (enum.get $Token.number)))
              (else
                (if (i32.eq (local.get $c) (i32.const "&"))
                  (then (local.set $hl (enum.get $Token.keyword)))
                  (else
                    (local.set $kind (call $lispWordHl (local.get $lhs) (local.get $rhs)))
                    (if (i32.ge_s (local.get $kind) (i32.const 0))
                      (then
                        (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                        (if (local.get $head)
                          (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
                      (else
                        (if (local.get $expect)
                          (then
                            (local.set $hl (select (enum.get $Token.function.definition)
                              (select (enum.get $Token.variable) (enum.get $Token.type)
                                (i32.eq (local.get $expect) (i32.const 2)))
                              (i32.eq (local.get $expect) (i32.const 1))))
                            (local.set $expect (i32.const 0)))
                          (else
                            (if (local.get $head)
                              (then (local.set $hl (enum.get $Token.function)))
                              (else
                                ;; `*special*` and `+constant+` by convention
                                (if (i32.and
                                      (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2))
                                      (i32.and
                                        (i32.eq (local.get $c) (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))))
                                        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "+")))))
                                  (then (local.set $hl (select (enum.get $Token.variable.special) (enum.get $Token.constant)
                                    (i32.eq (local.get $c) (i32.const "*")))))
                                  (else
                                    (if (call $lexIsIdentStart (local.get $c))
                                      (then (local.set $hl (select (enum.get $Token.type) (enum.get $Token.variable)
                                        (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))))
                                      (else (local.set $hl (enum.get $Token.operator))))))))))))))))))
        (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
        (local.set $head (i32.const 0))
        (br $next))))
)
