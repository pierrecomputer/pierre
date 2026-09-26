(module
  (import "../common.wat")

  (func $lispByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Each group's value is the $lispWordHl result for its words. Words with a
  ;; `*` or `!` cannot sit in the table and are matched directly: `let*`,
  ;; `set!`. `declare` shares its hash features with `deftype` and stays out,
  ;; as do `defconst` and `defrecord`, which share slot bits with `defsubst`
  ;; and `defmethod` in every geometry that fits the range.
  (keyword-table $lispWords $mem.lispWords $mem.luaWords
    (group $Token.keyword.declaration+256 ;; definitions, next name is a function
      "defun" "defmacro" "defmethod" "defgeneric" "define" "define-syntax" "define-macro"
      "defsubst")
    (group $Token.keyword.declaration+512 ;; definitions, next name is a variable
      "defvar" "defparameter" "defconstant" "defcustom")
    (group $Token.keyword.declaration+768 ;; definitions, next name is a type
      "defstruct" "defclass" "deftype" "defpackage" "defgroup" "defprotocol")
    (group $Token.keyword ;; special forms and macros
      "if" "do" "go" "or" "and" "the" "cond" "case" "loop" "prog1" "prog2" "progn"
      "setq" "setf" "when" "block" "catch" "throw" "unless" "return"
      "dolist" "dotimes" "declaim" "tagbody" "typecase" "function" "eval-when" "handler-case"
      "handler-bind" "return-from" "in-package" "use-package" "ignore-errors" "unwind-protect"
      "with-open-file" "with-slots" "syntax-rules"
      "let-values" "begin" "ecase" "etypecase" "assert" "error" "check-type" "interactive"
      "condition-case" "save-excursion" "with-current-buffer" "require" "provide" "import" "export"
      "quote" "ns" "fn" "defn" "def")
    (group $Token.constant.builtin "nil" "true" "false") ;; constants
    ;; binding forms, keywords whose next list binds names (see $hlLisp)
    (group $Token.keyword+1024 "lambda" "multiple-value-bind" "destructuring-bind") ;; parameter list
    (group $Token.keyword+2048 "let" "letrec")                                      ;; let bindings
    (group $Token.keyword+3072 "flet" "labels"))                                    ;; local functions

  ;; Token in the low byte; bits 8-9 select the next-name capture:
  ;; 1=function, 2=variable, 3=type; bits 10-11 the binding-list kind a
  ;; binding form arms (see $hlLisp). -1 means an ordinary symbol.
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
    (local.set $g (keyword-table.value $lispWords (local.get $lhs) (local.get $rhs)))
    (if (i32.lt_s (local.get $g) (i32.const 0))
      (then
        ;; the wide loads stay inside the input slack; `let*` binds like `let`
        (if (i32.eq (local.get $n) (i32.const 4))
          (then
            (if (i32.eq (i32.load (local.get $lhs)) (i32.const "let*"))
              (then (return (i32.or (enum.get $Token.keyword) (i32.const 0x800)))))
            (if (i32.eq (i32.load (local.get $lhs)) (i32.const "set!"))
              (then (return (enum.get $Token.keyword))))))
        (if
          (i32.and
            (i32.eq (local.get $n) (i32.const 7))
            (i64.eq
              (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff))
              (i64.const "declare")))
          (then (return (enum.get $Token.keyword))))
        (return (i32.const -1))))
    (local.get $g))

  ;; whether $c ends a symbol: whitespace, parentheses, brackets, quotes,
  ;; and the reader characters
  (func $lispIsDelim (param $c i32) (result i32)
    (byteset.get "\00\09\0a\0b\0c\0d \22'(),;[]`{}" (local.get $c)))

  ;; advance $ptr over the symbol that starts at it
  (func $lispScanSymbol
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (call $lispIsDelim (i32.load8_u (global.get $ptr))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; whether $c is an exponent marker: `e`, or Common Lisp's `s`, `f`, `d`,
  ;; and `l` precision markers (`1.5d0`), in either case
  (func $lispIsExponent (param $c i32) (result i32)
    (byteset.get "DEFLSdefls" (local.get $c)))

  ;; whether [lhs,rhs) is a number: an optional sign, digits with at most
  ;; one point or slash, and an optional exponent
  (func $lispIsNumber (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $digits i32)
    (local $prev i32)
    (local.set $c (i32.load8_u (local.get $lhs)))
    (if (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
      (then
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $c (i32.load8_u (local.get $lhs)))))
    ;; a number starts with a digit or a point, which rejects most symbols
    ;; at once (a byte at $rhs is a delimiter)
    (if
      (i32.eqz
        (i32.or
          (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9))
          (i32.eq (local.get $c) (i32.const "."))))
      (then (return (i32.const 0))))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (call $lexIsDigit (local.get $c))
          (then (local.set $digits (i32.const 1)))
          (else
            ;; a sign inside the number only follows an exponent marker
            (if
              (i32.eqz
                (i32.or
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "."))
                    (i32.eq (local.get $c) (i32.const "/")))
                  (i32.or
                    (call $lispIsExponent (local.get $c))
                    (i32.and
                      (i32.or
                        (i32.eq (local.get $c) (i32.const "+"))
                        (i32.eq (local.get $c) (i32.const "-")))
                      (call $lispIsExponent (local.get $prev))))))
              (then (return (i32.const 0))))))
        (local.set $prev (local.get $c))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (local.get $digits))

  ;; Binding lists: the names a parameter or binding list introduces are
  ;; variables (or local functions), not calls, although each one may sit
  ;; right after a `(`. The state is packed into one checkpointed value,
  ;; $bl in $hlLisp:
  ;;   bits 0-1  kind of the open list: 0 none, 1 parameter list (after a
  ;;             `defun` name, `lambda`, `destructuring-bind`), 2 `let`
  ;;             bindings, 3 `flet`/`labels` bindings
  ;;   bit 2     inside a flet binding's parameter list
  ;;   bits 3-4  elements seen in the current binding, saturating at 3
  ;;   bits 5-6  the kind armed for the next `(` while no list is open
  ;;   bit 7     right after `(`, where a symbol is the operator of the form
  ;;             (the helpers below drop it; $hlLisp rewrites it after each)
  ;;   bits 8-   bracket depth inside the open list
  ;; One list is tracked at a time: a list opened inside it (a `lambda` in a
  ;; `let` value) lexes as ordinary code.

  ;; $bl after an opening `(` or `[`: an armed kind opens its list; inside
  ;; one, depth 2 starts a binding and a list at depth 3 is one of its
  ;; elements - a flet binding's second element is its parameter list.
  (func $lispBindOpen (param $bl i32) (result i32)
    (local $kind i32)
    (local $depth i32)
    (local $elem i32)
    (local.set $kind (i32.and (local.get $bl) (i32.const 3)))
    (if (i32.eqz (local.get $kind))
      (then
        (local.set $kind (i32.and (i32.shr_u (local.get $bl) (i32.const 5)) (i32.const 3)))
        (return
          (select (i32.or (local.get $kind) (i32.const 256)) (i32.const 0) (local.get $kind)))))
    (local.set $depth (i32.add (i32.shr_u (local.get $bl) (i32.const 8)) (i32.const 1)))
    (if (i32.eq (local.get $depth) (i32.const 2))
      (then (return (i32.or (local.get $kind) (i32.const 512)))))
    (if (i32.eq (local.get $depth) (i32.const 3))
      (then
        (local.set $elem (i32.and (i32.shr_u (local.get $bl) (i32.const 3)) (i32.const 3)))
        (return
          (i32.or
            (i32.or (local.get $kind) (i32.const 768))
            (i32.or
              (select
                (i32.const 4)
                (i32.const 0)
                (i32.and
                  (i32.eq (local.get $kind) (i32.const 3))
                  (i32.eq (local.get $elem) (i32.const 1))))
              (i32.shl
                (select (i32.add (local.get $elem) (i32.const 1)) (i32.const 3) (i32.lt_u (local.get $elem) (i32.const 3)))
                (i32.const 3)))))))
    (i32.or (i32.and (local.get $bl) (i32.const 31)) (i32.shl (local.get $depth) (i32.const 8))))

  ;; $bl after a closing `)` or `]`: one level out, leaving a flet
  ;; parameter list on the way back to its binding; a closer also drops an
  ;; armed kind that never opened.
  (func $lispBindClose (param $bl i32) (result i32)
    (local $depth i32)
    (if (i32.eqz (i32.and (local.get $bl) (i32.const 3)))
      (then (return (i32.const 0))))
    (local.set $depth (i32.sub (i32.shr_u (local.get $bl) (i32.const 8)) (i32.const 1)))
    (if (i32.eqz (local.get $depth))
      (then (return (i32.const 0))))
    (i32.or
      (i32.and
        (local.get $bl)
        (select (i32.const 27) (i32.const 31) (i32.eq (local.get $depth) (i32.const 2))))
      (i32.shl (local.get $depth) (i32.const 8))))

  ;; The token for a plain symbol at the current binding-list position, or
  ;; -1 to classify it as usual: a variable for every symbol of a parameter
  ;; list, each binding's name, and a flet binding's parameters; a function
  ;; definition for a flet binding's name and a named let's name.
  (func $lispBindName (param $bl i32) (result i32)
    (local $kind i32)
    (local $depth i32)
    (local.set $kind (i32.and (local.get $bl) (i32.const 3)))
    (if (i32.eqz (local.get $kind))
      (then
        (return
          (select
            (enum.get $Token.function.definition)
            (i32.const -1)
            (i32.eq (i32.and (local.get $bl) (i32.const -129)) (i32.const 64))))))
    (local.set $depth (i32.shr_u (local.get $bl) (i32.const 8)))
    (if (i32.eq (local.get $depth) (i32.const 1))
      (then (return (enum.get $Token.variable))))
    (if
      (i32.and
        (i32.eq (local.get $depth) (i32.const 2))
        (i32.eqz (i32.and (local.get $bl) (i32.const 24))))
      (then
        (return
          (select
            (enum.get $Token.function.definition)
            (enum.get $Token.variable)
            (i32.eq (local.get $kind) (i32.const 3))))))
    (if
      (i32.and
        (i32.eq (local.get $depth) (i32.const 3))
        (i32.ne (i32.and (local.get $bl) (i32.const 4)) (i32.const 0)))
      (then (return (enum.get $Token.variable))))
    (i32.const -1))

  ;; $bl after a symbol starting with $c: inside a list, one more element of
  ;; the current binding; outside, $arm (when nonzero) arms the next `(`. An
  ;; armed kind survives a `:qualifier` (`defmethod f :before (...)`) and a
  ;; named let's name, and anything else drops it.
  (func $lispBindStep (param $bl i32) (param $c i32) (param $arm i32) (result i32)
    (if (i32.and (local.get $bl) (i32.const 3))
      (then
        (if (i32.ne (i32.shr_u (local.get $bl) (i32.const 8)) (i32.const 2))
          (then (return (local.get $bl))))
        (return
          (select
            (i32.add (local.get $bl) (i32.const 8))
            (local.get $bl)
            (i32.lt_u (i32.and (local.get $bl) (i32.const 24)) (i32.const 24))))))
    (if (local.get $arm)
      (then (return (i32.shl (local.get $arm) (i32.const 5)))))
    (select
      (local.get $bl)
      (i32.const 0)
      (i32.or (i32.eq (local.get $c) (i32.const ":")) (i32.eq (i32.and (local.get $bl) (i32.const -129)) (i32.const 64)))))

  ;; $expect is the pending next-name capture from a definition form (bit 2
  ;; marks a `defun`-style definer, whose name is followed by a parameter
  ;; list), and $bl is the binding-list state described above, including
  ;; the form-head bit. Both are checkpointed.
  (func $hlLisp
    (local $c i32)
    (local $c2 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $bl i32)
    (local $arm i32)
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
        (if
          (i32.and (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c2) (i32.const "|")))
          (then
            (call $lexNestedBlockComment
              (i32.const "#|")
              (i32.const "|#")
              (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; a definition names the symbol after its head; a paren there
            ;; is an argument list or a `(name options)` spec, whose first
            ;; symbol is still the name
            (if
              (i32.and
                (i32.ne (local.get $c) (i32.const "("))
                (i32.ne (local.get $c) (i32.const ")")))
              (then (local.set $expect (i32.const 0))))
            (if (i32.eq (local.get $c) (i32.const ")"))
              (then (local.set $expect (i32.const 0))))
            ;; bits 0-1 and 5-6 (99): a list is open or armed; with neither,
            ;; both helpers leave the state empty
            (if (i32.and (local.get $bl) (i32.const 99))
              (then
                (if (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const "[")))
                  (then (local.set $bl (call $lispBindOpen (local.get $bl)))))
                (if (i32.or (i32.eq (local.get $c) (i32.const ")")) (i32.eq (local.get $c) (i32.const "]")))
                  (then (local.set $bl (call $lispBindClose (local.get $bl)))))))
            ;; the symbol right after `(` is the operator of the form
            (local.set $bl
              (i32.or
                (i32.and (local.get $bl) (i32.const -129))
                (i32.shl (i32.eq (local.get $c) (i32.const "(")) (i32.const 7))))
            (br $next)))

        ;; reader macros: quote, quasiquote, unquote, and `#'`, `#(`, `#:`,
        ;; `#+feature`, `#\char`, `#x1F`
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const "`")))
            (i32.eq (local.get $c) (i32.const ",")))
          (then
            (global.set $ptr
              (i32.add
                (global.get $ptr)
                (select
                  (i32.const 2)
                  (i32.const 1)
                  (i32.and
                    (i32.eq (local.get $c) (i32.const ","))
                    (i32.eq (local.get $c2) (i32.const "@"))))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const 92))
              (then
                ;; `#\a`, `#\Space`, `#\(`: one character or a name. A line
                ;; break right after `#\` stays out, so a streamed line
                ;; ends the same way.
                (local.set $rhs (i32.add (local.get $lhs) (i32.const 2)))
                (global.set $ptr (local.get $rhs))
                (if
                  (i32.eqz
                    (i32.or
                      (i32.ge_u (local.get $rhs) (global.get $end))
                      (i32.or
                        (i32.eq (i32.load8_u (local.get $rhs)) (i32.const 10))
                        (i32.eq (i32.load8_u (local.get $rhs)) (i32.const 13)))))
                  (then
                    (global.set $ptr
                      (call $utf8SpanEnd (i32.add (local.get $rhs) (i32.const 1)) (global.get $end)))
                    (call $lispScanSymbol)))
                (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
                (br $next)))
            (if
              (i32.or
                (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "x"))
                (i32.or
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "b"))
                  (i32.eq (i32.or (local.get $c2) (i32.const 32)) (i32.const "o"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lispScanSymbol)
                (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
                (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
                (br $next)))
            (if
              (i32.or
                (i32.eq (local.get $c2) (i32.const "+"))
                (i32.eq (local.get $c2) (i32.const "-")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $lispScanSymbol)
                (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
                (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
                (br $next)))
            (if
              (i32.or
                (i32.eq (local.get $c2) (i32.const 39))
                (i32.eq (local.get $c2) (i32.const ":")))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
            (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
            (br $next)))

        ;; Emacs Lisp escaped character literals `?\(`, `?\\`: the escaped
        ;; byte is data, never a bracket, and a line break is never taken.
        ;; A plain `?a` stays a symbol, as Common Lisp's `?x` variables are.
        (if (i32.and (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c2) (i32.const 92)))
          (then
            (if (i32.gt_u (call $lispByte (i32.add (global.get $ptr) (i32.const 2))) (i32.const 13))
              (then
                (global.set $ptr
                  (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 3)) (global.get $end)))
                (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
                (br $next)))))

        ;; a symbol: keyword, number, definition name, operator, or plain
        (local.set $arm (i32.const 0))
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
                        (if (i32.and (local.get $bl) (i32.const 128))
                          (then
                            (local.set $expect
                              (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 3)))
                            ;; `defun`-style definers, unlike Scheme's
                            ;; `define`, take a parameter list after the name
                            (if
                              (i32.and
                                (i32.eq (local.get $expect) (i32.const 1))
                                (i32.ne (i32.load8_u offset=3 (local.get $lhs)) (i32.const "i")))
                              (then (local.set $expect (i32.const 5))))
                            (local.set $arm (i32.shr_u (local.get $kind) (i32.const 10))))))
                      (else
                        ;; a name a binding list introduces comes first
                        (local.set $hl (i32.const -1))
                        (if (i32.and (local.get $bl) (i32.const 99))
                          (then (local.set $hl (call $lispBindName (local.get $bl)))))
                        (if (i32.lt_s (local.get $hl) (i32.const 0))
                          (then
                            (if (local.get $expect)
                              (then
                                (local.set $hl
                                  (select
                                    (enum.get $Token.function.definition)
                                    (select
                                      (enum.get $Token.variable)
                                      (enum.get $Token.type)
                                      (i32.eq (i32.and (local.get $expect) (i32.const 3)) (i32.const 2)))
                                    (i32.eq (i32.and (local.get $expect) (i32.const 3)) (i32.const 1))))
                                (if
                                  (i32.and
                                    (i32.ne (i32.and (local.get $expect) (i32.const 4)) (i32.const 0))
                                    (i32.eqz (i32.and (local.get $bl) (i32.const 128))))
                                  (then (local.set $arm (i32.const 1))))
                                (local.set $expect (i32.const 0)))
                              (else
                                (if (i32.and (local.get $bl) (i32.const 128))
                                  (then (local.set $hl (enum.get $Token.function)))
                                  (else
                                    ;; `*special*` and `+constant+` by convention
                                    (if
                                      (i32.and
                                        (i32.gt_u
                                          (i32.sub (local.get $rhs) (local.get $lhs))
                                          (i32.const 2))
                                        (i32.and
                                          (i32.eq
                                            (local.get $c)
                                            (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))))
                                          (i32.or
                                            (i32.eq (local.get $c) (i32.const "*"))
                                            (i32.eq (local.get $c) (i32.const "+")))))
                                      (then
                                        (local.set $hl
                                          (select
                                            (enum.get $Token.variable.special)
                                            (enum.get $Token.constant)
                                            (i32.eq (local.get $c) (i32.const "*")))))
                                      (else
                                        (if (call $lexIsIdentStart (local.get $c))
                                          (then
                                            (local.set $hl
                                              (select
                                                (enum.get $Token.type)
                                                (enum.get $Token.variable)
                                                (i32.le_u
                                                  (i32.sub (local.get $c) (i32.const "A"))
                                                  (i32.const 25)))))
                                          (else
                                            (local.set $hl (enum.get $Token.operator))))))))))))))))))))
        (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
        (local.set $bl (i32.and (local.get $bl) (i32.const -129)))
        (if (i32.or (i32.and (local.get $bl) (i32.const 99)) (local.get $arm))
          (then (local.set $bl (call $lispBindStep (local.get $bl) (local.get $c) (local.get $arm)))))
        (br $next))))
)
