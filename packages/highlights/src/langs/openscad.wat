(module
  (import "../common.wat")

  ;; The high byte of a declaration marks that the next name is defined; of
  ;; an import, that a `<path>` follows. Built-in modules and functions are
  ;; calls, so the `name(` rule colors them with no table entry.
  (keyword-table $openscadWords $mem.openscadWords $mem.shaderlabWords
    (group $Token.keyword.declaration+256 "module" "function")
    (group $Token.keyword.import+512 "use" "include")
    (group $Token.keyword.control
      "if" "for" "let" "each" "echo" "else" "assert" "intersection_for")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "PI" "undef"))

  ;; $depth counts open `(` and `[`; $expr is 1 after an `=` outside them,
  ;; until `;`. Where both are 0 a statement can start, so `!`, `#`, `%`,
  ;; and `*` there are modifiers rather than operators. $define is 1 after
  ;; `module` or `function`. All three carry across chunks.
  (func $hlOpenscad
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $gap i32)
    (local $hl i32)
    (local $p i32)
    (local $depth i32)
    (local $expr i32)
    (local $define i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))

        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (if (i32.eq (local.get $c2) (i32.const "/"))
              (then
                (call $lexLineComment (i32.const 2) (enum.get $Token.comment))
                (br $next)))
            (if (i32.eq (local.get $c2) (i32.const "*"))
              (then
                (call $lexBlockComment
                  (i32.const 2)
                  (select
                    (enum.get $Token.comment.doc)
                    (enum.get $Token.comment)
                    (i32.and
                      (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "*"))
                      (i32.ne (call $templateByte (i32.add (local.get $lhs) (i32.const 3))) (i32.const "/")))))
                (br $next)))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 1) (enum.get $Token.string))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))

        ;; names, and `$fn`, `$fa`, `$fs`, `$t`, and other special variables
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $scanIdentRun (i32.const "$"))
            (local.set $rhs (global.get $ptr))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $c2 (call $templateByte (local.get $p)))
            (local.set $hl (keyword-table.value $openscadWords (local.get $lhs) (local.get $rhs)))
            (block $classified
              (if (i32.ge_s (local.get $hl) (i32.const 0))
                (then
                  (local.set $define (i32.eq (i32.shr_u (local.get $hl) (i32.const 8)) (i32.const 1)))
                  ;; `include <path>` and `use <path>`
                  (if
                    (i32.and
                      (i32.eq (i32.shr_u (local.get $hl) (i32.const 8)) (i32.const 2))
                      (i32.eq (local.get $c2) (i32.const "<")))
                    (then
                      (call $emitTok (enum.get $Token.keyword.import) (local.get $lhs) (local.get $rhs))
                      (call $emitGap (local.get $rhs) (local.get $p))
                      (global.set $ptr
                        (call $scanFindSpecial
                          (local.get $p)
                          (global.get $end)
                          (i32.const ">")
                          (i32.const 0)
                          (i32.const 1)))
                      (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">"))
                        (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                      (call $emitTok (enum.get $Token.string) (local.get $p) (global.get $ptr))
                      (br $next)))
                  (local.set $hl (i32.and (local.get $hl) (i32.const 255)))
                  (br $classified)))
              (if (i32.eq (local.get $c) (i32.const "$"))
                (then
                  (local.set $hl (enum.get $Token.variable.special))
                  (br $classified)))
              (if (local.get $define)
                (then
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $define (i32.const 0))
                  (br $classified)))
              (if (i32.eq (local.get $c2) (i32.const "("))
                (then
                  (local.set $hl (enum.get $Token.function))
                  (br $classified)))
              ;; a named argument or parameter default: `cube(size = 10)`
              (if
                (i32.and
                  (i32.ne (local.get $depth) (i32.const 0))
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "="))
                    (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "="))))
                (then
                  (local.set $hl (enum.get $Token.variable.parameter))
                  (br $classified)))
              (local.set $hl
                (select
                  (enum.get $Token.constant)
                  (enum.get $Token.variable)
                  (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (local.set $define (i32.const 0))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (byteset.get "([" (local.get $c))
              (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (if (byteset.get ")]" (local.get $c))
              (then
                (local.set $depth
                  (select
                    (i32.sub (local.get $depth) (i32.const 1))
                    (i32.const 0)
                    (local.get $depth)))))
            ;; braces bound statements, so they also end an expression
            (if (i32.ge_u (local.get $c) (i32.const "{"))
              (then (local.set $expr (i32.const 0))))))
        (if (byteset.get ",.:;" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $expr (i32.const 0))))))
        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.operator))
            ;; a two-byte comparison or logical operator
            (if
              (i32.or
                (i32.eq (local.get $c2) (i32.const "="))
                (i32.and
                  (i32.eq (local.get $c) (local.get $c2))
                  (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2))))
              (else
                (if (i32.and (i32.eq (local.get $c) (i32.const "=")) (i32.eqz (local.get $depth)))
                  (then (local.set $expr (i32.const 1))))))))
        ;; debug modifiers before a statement: `#` highlight, `%` background,
        ;; `!` root, `*` disable
        (if
          (i32.and
            (i32.eqz (i32.or (local.get $depth) (local.get $expr)))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "#")) (i32.eq (local.get $c) (i32.const "%")))
              (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "*")))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (local.set $hl (enum.get $Token.punctuation.special))))
        (if (i32.eqz (local.get $hl))
          (then (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
