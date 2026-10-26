(module
  (import "../common.wat")

  ;; Lowercase words. Bits above the token: 256 a statement whose `name=`
  ;; pairs are options, 512 a word that is a function before a glued `(`,
  ;; 1024 a macro statement that needs its `%`, 2048 a keyword only where it
  ;; starts a statement (`weight` is also a common column), 4096 the next
  ;; name is a procedure or macro reference, 8192 the next name defines a
  ;; macro, 16384 a statement that starts data lines. `while` and `return` share their
  ;; hash features with `where` and `retain` and are matched directly.
  (keyword-table $sasWords $mem.sasWords $mem.stataWords
    (group $Token.keyword.control
      "if" "then" "else" "do" "end" "to" "until" "select" "when" "otherwise" "leave" "continue"
      "stop" "abort" "goto" "link")
    (group $Token.keyword+256
      "set" "merge" "update" "modify" "output" "ods" "options" "libname" "filename" "infile"
      "file")
    (group $Token.keyword
      "by" "where" "call" "title" "footnote" "create" "from" "as" "group" "order" "having"
      "distinct" "into" "join" "on" "inner" "outer" "full" "union" "insert" "values" "calculated"
      "desc" "descending")
    (group $Token.keyword+2048
      "keep" "drop" "retain" "rename" "format" "informat" "label" "attrib" "class" "var" "model"
      "tables" "table" "id" "freq" "weight" "array")
    (group $Token.keyword+512 "input" "put" "left" "right")
    (group $Token.keyword+2560 "length" "sum")
    (group $Token.keyword.operator
      "and" "or" "not" "in" "eq" "ne" "gt" "lt" "ge" "le" "like" "between" "is")
    (group $Token.keyword.operator+512 "missing")
    (group $Token.keyword.declaration+4352 "proc")
    (group $Token.keyword.declaration+256 "data")
    (group $Token.keyword.declaration "run" "quit")
    (group $Token.keyword.declaration+9216 "macro")
    (group $Token.keyword.declaration+5120 "mend")
    (group $Token.keyword.declaration+1024 "let" "global" "local")
    (group $Token.keyword.import "include")
    (group $Token.keyword+16384 "datalines" "cards" "datalines4" "cards4"))

  ;; The table value of the word [lhs,rhs) compared case-insensitively, or -1.
  (func $sasWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $m i32)
    (local $v i32)
    (local $w i64)
    (local.set $n
      (call $lexLowerCopy (local.get $lhs) (local.get $rhs) (i32.const $mem.lexLowerScratch)))
    (local.set $v
      (keyword-table.value $sasWords
        (i32.const $mem.lexLowerScratch)
        (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
    (if (i32.ge_s (local.get $v) (i32.const 0))
      (then (return (local.get $v))))
    (local.set $w (i64.load (i32.const $mem.lexLowerScratch)))
    (if
      (i32.or
        (i32.and
          (i32.eq (local.get $n) (i32.const 5))
          (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "while")))
        (i32.and
          (i32.eq (local.get $n) (i32.const 6))
          (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffff)) (i64.const "return"))))
      (then (return (enum.get $Token.keyword.control))))
    ;; `title2` and `footnote3` number their lines
    (local.set $m (local.get $n))
    (block $digits
      (loop $strip
        (br_if $digits (i32.eqz (local.get $m)))
        (br_if $digits
          (i32.eqz
            (call $lexIsDigit
              (i32.load8_u (i32.add (i32.const $mem.lexLowerScratch-1) (local.get $m))))))
        (local.set $m (i32.sub (local.get $m) (i32.const 1)))
        (br $strip)))
    (if
      (i32.and
        (i32.lt_u (local.get $m) (local.get $n))
        (i32.or
          (i32.and
            (i32.eq (local.get $m) (i32.const 5))
            (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffff)) (i64.const "title")))
          (i32.and (i32.eq (local.get $m) (i32.const 8)) (i64.eq (local.get $w) (i64.const "footnote")))))
      (then (return (enum.get $Token.keyword))))
    (i32.const -1))

  ;; The end of a format's `.` at $p and its decimal digits, as in `comma10.2`.
  (func $sasFormatEnd (param $p i32) (result i32)
    (local.set $p (i32.add (local.get $p) (i32.const 1)))
    (block $done
      (loop $digits
        (br_if $done (i32.eqz (call $lexIsDigit (call $templateByte (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $digits)))
    (local.get $p))

  ;; Data lines after DATALINES; or CARDS; run until a line that holds `;`
  ;; (`;;;;` for DATALINES4). Return $mode while the lines continue past
  ;; $end, or 0 at the closing line, which the caller lexes as code.
  (func $sasCards (param $mode i32) (result i32)
    (local $lhs i32)
    (local $p i32)
    (loop $line
      (local.set $lhs (global.get $ptr))
      (call $scanWhitespace)
      (call $emitGap (local.get $lhs) (global.get $ptr))
      (if (i32.ge_u (global.get $ptr) (global.get $end))
        (then (return (local.get $mode))))
      (local.set $lhs (global.get $ptr))
      (local.set $p
        (call $scanFindSpecial
          (local.get $lhs)
          (global.get $end)
          (i32.const ";")
          (i32.const 0)
          (i32.const 1)))
      (global.set $ptr (local.get $p))
      (if (i32.eq (call $templateByte (local.get $p)) (i32.const ";"))
        (then
          (if
            (i32.or
              (i32.ne (local.get $mode) (i32.const 4))
              (i32.and
                (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                (i32.eq (i32.load (local.get $p)) (i32.const ";;;;"))))
            (then
              (global.set $ptr (local.get $lhs))
              (return (i32.const 0))))
          (call $scanToLineEnd)))
      (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
      (br $line))
    (unreachable))

  ;; $stmt is 1 at a statement start, where `*` opens a comment and data
  ;; lines can begin. $opts is 1 in a statement whose `name=` pairs are
  ;; options when $paren, the open parentheses, is 0 or 1. $expect is 1 when
  ;; the next name is a procedure or macro reference and 2 when it defines a
  ;; macro. $cards is the data lines mode of $sasCards. All are checkpointed.
  (func $hlSas
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $v i32)
    (local $hl i32)
    (local $pct i32)
    (local $eq i32)
    (local $after i32)
    (local $atStmt i32)
    (local $stmt i32)
    (local $opts i32)
    (local $paren i32)
    (local $expect i32)
    (local $cards i32)
    (local.set $stmt (i32.const 1))
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (if (local.get $cards)
          (then (local.set $cards (call $sasCards (local.get $cards)))))
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $atStmt (local.get $stmt))
        (local.set $stmt (i32.const 0))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (local.set $stmt (local.get $atStmt))
            (br $next)))
        ;; `* text;` and `%* text;` are comment statements
        (if
          (i32.and
            (local.get $atStmt)
            (i32.or
              (i32.eq (local.get $c) (i32.const "*"))
              (i32.and (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c2) (i32.const "*")))))
          (then
            (global.set $ptr (call $lexFindByte (local.get $lhs) (i32.const ";")))
            (if (i32.lt_u (global.get $ptr) (global.get $end))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr)))
              (else
                (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr))
                (call $streamSetFixed32 (i32.const ";") (i32.const 1) (enum.get $Token.comment))))
            (local.set $stmt (i32.const 1))
            (br $next)))
        ;; a doubled quote closes and reopens, so `'It''s'` stays one span
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexRawString (local.get $c) (i32.const 1) (enum.get $Token.string))
            (br $next)))
        ;; `&name`, `&&name`, and `&name.` macro variables
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (local.set $p (local.get $lhs))
            (loop $amps
              (local.set $p (i32.add (local.get $p) (i32.const 1)))
              (br_if $amps (i32.eq (call $templateByte (local.get $p)) (i32.const "&"))))
            (local.set $c2 (call $templateByte (local.get $p)))
            (if (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))
              (then
                (global.set $ptr (local.get $p))
                (call $scanIdentRun (i32.const "_"))
                (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (br $next)))))
        ;; `$`, `$20`, and `$char10.` character formats
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
              (then (global.set $ptr (call $sasFormatEnd (global.get $ptr)))))
            (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (local.set $pct
          (i32.and
            (i32.eq (local.get $c) (i32.const "%"))
            (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.ne (local.get $c2) (i32.const "$")))))
        (if
          (i32.or
            (local.get $pct)
            (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$"))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (local.get $pct)))
            (call $scanIdentRun (i32.const "_"))
            (local.set $rhs (global.get $ptr))
            (local.set $c2 (call $templateByte (local.get $rhs)))
            (if (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eqz (local.get $pct)))
              (then
                (local.set $p (i32.add (local.get $rhs) (i32.const 1)))
                (local.set $c2 (call $templateByte (local.get $p)))
                ;; `date9.` and `best.` are formats
                (if (i32.or (i32.eqz (call $lexIsIdentStart (local.get $c2))) (i32.eq (local.get $c2) (i32.const "$")))
                  (then
                    (global.set $ptr (call $sasFormatEnd (local.get $rhs)))
                    (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
                    (br $next)))
                ;; `first.id` and `last.id` flag BY groups; `lib.member` names a data set
                (local.set $v (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)))
                (local.set $hl (enum.get $Token.namespace))
                (if
                  (i32.or
                    (i32.and
                      (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 4)))
                      (i32.eq (local.get $v) (i32.const "last")))
                    (i32.and
                      (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 5)))
                      (i32.and
                        (i32.eq (local.get $v) (i32.const "firs"))
                        (i32.eq (i32.or (i32.load8_u offset=4 (local.get $lhs)) (i32.const 32)) (i32.const "t")))))
                  (then (local.set $hl (enum.get $Token.variable.special))))
                (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $rhs) (local.get $p))
                (global.set $ptr (local.get $p))
                (call $scanIdentRun (i32.const "_"))
                (call $emitTok (enum.get $Token.variable) (local.get $p) (global.get $ptr))
                (local.set $expect (i32.const 0))
                (br $next)))
            ;; the `d`, `dt`, `t`, `x`, `b`, or `n` suffix of `'01jan2020'd`
            (if
              (i32.and
                (i32.gt_u (local.get $lhs) (global.get $srcBase))
                (i32.or
                  (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 34))
                  (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const 39))))
              (then
                (local.set $p (i32.sub (local.get $rhs) (local.get $lhs)))
                (if
                  (i32.or
                    (i32.and (i32.eq (local.get $p) (i32.const 1)) (byteset.get "BDNTXbdntx" (local.get $c)))
                    (i32.and
                      (i32.eq (local.get $p) (i32.const 2))
                      (i32.eq (i32.or (i32.load16_u (local.get $lhs)) (i32.const 0x2020)) (i32.const "dt"))))
                  (then
                    (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (local.get $rhs))
                    (br $next)))))
            (local.set $v (call $sasWordHl (i32.add (local.get $lhs) (local.get $pct)) (local.get $rhs)))
            (if
              (i32.or
                (i32.and (i32.ne (i32.and (local.get $v) (i32.const 1024)) (i32.const 0)) (i32.eqz (local.get $pct)))
                (i32.and (i32.ne (i32.and (local.get $v) (i32.const 2048)) (i32.const 0)) (i32.eqz (local.get $atStmt))))
              (then (local.set $v (i32.const -1))))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; the byte after the name and its blanks
            (local.set $after (call $templateByte (local.get $p)))
            (if
              (i32.and
                (i32.and (local.get $atStmt) (i32.ge_s (local.get $v) (i32.const 16384)))
                (i32.eq (local.get $after) (i32.const ";")))
              (then
                (call $emitTok (enum.get $Token.keyword) (local.get $lhs) (local.get $rhs))
                (call $emitGap (local.get $rhs) (local.get $p))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $p) (global.get $ptr))
                (local.set $p (global.get $ptr))
                (call $scanToLineEnd)
                (call $emitTok (enum.get $Token.none) (local.get $p) (global.get $ptr))
                (local.set $cards
                  (select
                    (i32.const 4)
                    (i32.const 1)
                    (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "4"))))
                (local.set $stmt (i32.const 1))
                (local.set $opts (i32.const 0))
                (local.set $paren (i32.const 0))
                (local.set $expect (i32.const 0))
                (br $next)))
            (local.set $hl (select (enum.get $Token.function) (enum.get $Token.variable) (local.get $pct)))
            (if (i32.ge_s (local.get $v) (i32.const 0))
              (then (local.set $hl (i32.and (local.get $v) (i32.const 255)))))
            (local.set $eq
              (i32.and
                (i32.eq (local.get $after) (i32.const "="))
                (i32.ne (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "="))))
            (if (local.get $expect)
              (then
                (local.set $hl
                  (select
                    (enum.get $Token.function.definition)
                    (enum.get $Token.function)
                    (i32.eq (local.get $expect) (i32.const 2))))
                (local.set $expect (i32.const 0)))
              (else
                ;; `file = 1;` assigns a variable that shares a statement's name
                (if (i32.and (local.get $atStmt) (i32.and (local.get $eq) (i32.eqz (local.get $pct))))
                  (then
                    (local.set $hl (enum.get $Token.variable))
                    (local.set $v (i32.const -1))))
                (if (i32.ge_s (local.get $v) (i32.const 0))
                  (then
                    (local.set $expect (i32.and (i32.shr_u (local.get $v) (i32.const 12)) (i32.const 3)))
                    (if (i32.and (local.get $atStmt) (i32.ne (i32.and (local.get $v) (i32.const 256)) (i32.const 0)))
                      (then (local.set $opts (i32.const 1))))))
                (if
                  (i32.and
                    (i32.and (local.get $opts) (i32.le_u (local.get $paren) (i32.const 1)))
                    (local.get $eq))
                  (then (local.set $hl (enum.get $Token.variable.parameter)))
                  (else
                    ;; in an option statement `a(keep=x)` is a data set with options
                    (if
                      (i32.and
                        (i32.and
                          (i32.eq (local.get $c2) (i32.const "("))
                          (i32.eqz (i32.and (local.get $opts) (i32.eqz (local.get $paren)))))
                        (i32.or (i32.lt_s (local.get $v) (i32.const 0)) (i32.ne (i32.and (local.get $v) (i32.const 512)) (i32.const 0))))
                      (then (local.set $hl (enum.get $Token.function)))
                      (else
                        ;; `_n_`, `_error_`, and `_null_` are automatic names
                        (if
                          (i32.and
                            (i32.and (i32.lt_s (local.get $v) (i32.const 0)) (i32.eqz (local.get $pct)))
                            (i32.and
                              (i32.and
                                (i32.eq (local.get $c) (i32.const "_"))
                                (i32.gt_u (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 2)))
                              (i32.eq (i32.load8_u (i32.sub (local.get $rhs) (i32.const 1))) (i32.const "_"))))
                          (then (local.set $hl (enum.get $Token.variable.special))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $next)))

        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            ;; `8.` is a numeric format of width 8
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const "."))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; `.` is a missing value; `.A` through `.Z` and `._` are special ones
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (if
              (i32.and
                (i32.and (call $lexIsIdentStart (local.get $c2)) (i32.lt_u (local.get $c2) (i32.const 0x80)))
                (i32.and
                  (i32.ne (local.get $c2) (i32.const "$"))
                  (i32.eqz (call $lexIsIdentContinue (call $templateByte (i32.add (local.get $lhs) (i32.const 2)))))))
              (then (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))))
            (call $emitTok (enum.get $Token.constant.builtin) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (if (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $opDone
              (loop $op
                (local.set $c (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!#%&*+-/:<=>?@^|~" (local.get $c))))
                ;; `=&name` and `=%name` start macro text; `/*` a comment
                (br_if $opDone
                  (i32.or
                    (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "%")))
                    (i32.and
                      (i32.eq (local.get $c) (i32.const "/"))
                      (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "*")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $next)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (local.set $hl (enum.get $Token.none))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (local.set $hl (enum.get $Token.punctuation.delimiter))
            (local.set $stmt (i32.const 1))
            (local.set $opts (i32.const 0))
            (local.set $paren (i32.const 0))
            (local.set $expect (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const ","))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (if (i32.eq (local.get $c) (i32.const "("))
              (then (local.set $paren (i32.add (local.get $paren) (i32.const 1)))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (i32.ne (local.get $paren) (i32.const 0)))
              (then (local.set $paren (i32.sub (local.get $paren) (i32.const 1)))))))
        (global.set $ptr (call $utf8SpanEnd (global.get $ptr) (global.get $end)))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
