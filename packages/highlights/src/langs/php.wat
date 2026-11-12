(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.phpWords 256)
  (memory-region $mem.hackWords 128)

  (import "@pierre/wat-tools/common.wat")
  (import "./html.wat")

  (global $phpStreamingCode (mut i32) (i32.const 0))
  (global $phpStreamDecl (mut i32) (i32.const 0))
  (global $phpStreamMember (mut i32) (i32.const 0))
  ;; 1 only while $hlHack or its stream resume runs, so PHP, Blade, and the
  ;; templates that share this code never see it
  (global $phpHack (mut i32) (i32.const 0))
  (global $phpXhp (mut i32) (i32.const 0))

  (func $phpIsOpen (param $p i32) (result i32)
    (local $c i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load16_u (local.get $p)) (i32.const "<?"))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=2 (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "="))
      (then (return (i32.const 1))))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 5)) (global.get $end))
      (then (return (i32.const 0))))
    (if
      (i32.ne
        (i32.and
          (i32.or (i32.load offset=2 (local.get $p)) (i32.const 0x202020))
          (i32.const 0xffffff))
        (i32.const "php"))
      (then (return (i32.const 0))))
    (i32.or
      (i32.eq (i32.add (local.get $p) (i32.const 5)) (global.get $end))
      (call $lexIsSpace (i32.load8_u offset=5 (local.get $p)))))

  (func $phpFindOpen (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $phpIsOpen (local.get $p))
          (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (global.get $end))

  ;; A PHP line comment ends at `?>` as well as at a newline; Hack has no `?>`.
  (func $phpLineComment (param $skip i32)
    (local $close i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $saveEnd i32)
    (local $stop i32)
    (if (global.get $phpHack)
      (then
        (call $lexLineComment (local.get $skip) (enum.get $Token.comment))
        (return)))
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (local.set $lineEnd (call $lexFindEither (global.get $ptr) (i32.const 10) (i32.const 13)))
    (local.set $stop (local.get $lineEnd))
    (local.set $saveEnd (global.get $end))
    (global.set $end (local.get $lineEnd))
    (block $done
      (loop $find
        (local.set $close (call $lexFindByte (global.get $ptr) (i32.const "?")))
        (br_if $done (i32.ge_u (local.get $close) (local.get $lineEnd)))
        (if
          (i32.and
            (i32.lt_u (i32.add (local.get $close) (i32.const 1)) (local.get $lineEnd))
            (i32.eq (i32.load8_u offset=1 (local.get $close)) (i32.const ">")))
          (then
            (local.set $stop (local.get $close))
            (br $done)))
        (global.set $ptr (i32.add (local.get $close) (i32.const 1)))
        (br $find)))
    (global.set $end (local.get $saveEnd))
    (global.set $ptr (local.get $stop))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr)))

  ;; The token for a bare uppercase-first name that is not a call: the class
  ;; before `::` (`User::class`, `Foo::bar()`), a SCREAMING_CASE constant
  ;; (`PHP_EOL`), or a plain name - in Hack, where variables carry `$`, a
  ;; type. Kept out of line so lowercase names - functions, and the
  ;; `self`/`parent`/`static` scopes - pay one compare.
  (func $phpUpperName (param $lhs i32) (param $rhs i32) (result i32)
    (local $plain i32)
    (local.set $plain (select (enum.get $Token.type) (enum.get $Token.variable) (global.get $phpHack)))
    (if
      (i32.and
        (i32.lt_u (i32.add (local.get $rhs) (i32.const 1)) (global.get $end))
        (i32.eq (i32.load16_u (local.get $rhs)) (i32.const "::")))
      (then (return (enum.get $Token.type))))
    ;; a lowercase second letter rules SCREAMING_CASE out without a scan
    (if (i32.le_u (i32.sub (i32.load8_u offset=1 (local.get $lhs)) (i32.const "a")) (i32.const 25))
      (then (return (local.get $plain))))
    (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
      (then (return (enum.get $Token.constant))))
    (local.get $plain))

  (keyword-table $phpWords $mem.phpWords $mem.phpWords+256
    (group $Token.keyword.control
      "break" "catch" "while" "throw" "match" "print" "isset" "empty" "unset" "return" "switch" "elseif" "foreach" "default" "finally" "continue"
      "endif" "endfor" "endwhile" "endswitch" "endforeach" "enddeclare")
    (group $Token.keyword
      "yield" "final" "clone" "public" "static" "global" "private" "declare" "require" "include" "abstract" "readonly" "protected" "insteadof" "instanceof" "require_once" "include_once")
    (group $Token.type.builtin
      "array" "float" "mixed" "never" "string" "object" "callable" "iterable")
    (group $Token.boolean
      "false")
    (group $Token.keyword.declaration
      "class" "const" "trait" "extends" "function" "interface" "namespace" "implements"))

  ;; Hack words that PHP lacks, matched case-sensitively after $phpWordHl misses.
  (keyword-table $hackWords $mem.hackWords $mem.hackWords+128
    (group $Token.keyword.control "await" "concurrent")
    (group $Token.keyword "async" "inout" "where" "super" "using" "upcast" "reify" "internal")
    (group $Token.keyword.declaration "type" "newtype")
    (group $Token.keyword.operator "is")
    (group $Token.type.builtin
      "vec" "dict" "keyset" "tuple" "shape" "arraykey" "num" "nothing" "noreturn" "nonnull"
      "dynamic" "this" "varray" "darray"))

  (func $phpWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $hl i32)
    (local $w i64)
    (local $v v128)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 10))
      (then (return (enum.get $Token.variable))))
    (byte-switch (local.get $n)
      (case 2
        (local.set $w (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
        (local.set $w (i64.and (local.get $w) (i64.const 0xffff)))
        (if
          (i32.or (i64.eq (local.get $w) (i64.const "if")) (i64.eq (local.get $w) (i64.const "do")))
          (then (return (enum.get $Token.keyword.control))))
        (if
          (i32.or (i64.eq (local.get $w) (i64.const "as")) (i64.eq (local.get $w) (i64.const "fn")))
          (then (return (enum.get $Token.keyword))))
        (if (i64.eq (local.get $w) (i64.const "or"))
          (then (return (enum.get $Token.keyword.operator))))
        (return (enum.get $Token.variable)))
      (case 3
        (local.set $w (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffff)))
        (if
          (i32.or
            (i64.eq (local.get $w) (i64.const "new"))
            (i32.or
              (i64.eq (local.get $w) (i64.const "use"))
              (i64.eq (local.get $w) (i64.const "var"))))
          (then (return (enum.get $Token.keyword))))
        (if
          (i32.or
            (i64.eq (local.get $w) (i64.const "for"))
            (i64.eq (local.get $w) (i64.const "try")))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "int"))
          (then (return (enum.get $Token.type.builtin))))
        (if (i32.or (i64.eq (local.get $w) (i64.const "and")) (i64.eq (local.get $w) (i64.const "xor")))
          (then (return (enum.get $Token.keyword.operator))))
        (return (enum.get $Token.variable)))
      (case 4
        (local.set $w (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffff)))
        (if (i64.eq (local.get $w) (i64.const "true"))
          (then (return (enum.get $Token.boolean))))
        (if (i64.eq (local.get $w) (i64.const "null"))
          (then (return (enum.get $Token.constant.builtin))))
        (if
          (i32.or
            (i32.or
              (i64.eq (local.get $w) (i64.const "else"))
              (i64.eq (local.get $w) (i64.const "case")))
            (i32.or
              (i64.eq (local.get $w) (i64.const "echo"))
              (i64.eq (local.get $w) (i64.const "goto"))))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "enum"))
          (then (return (enum.get $Token.keyword.declaration))))
        (if
          (i32.or
            (i64.eq (local.get $w) (i64.const "bool"))
            (i64.eq (local.get $w) (i64.const "void")))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (local.set $v (v128.load (local.get $lhs)))
    (v128.store
      (i32.const $mem.lexLowerScratch)
      (v128.or
        (local.get $v)
        (v128.and
          (i8x16.le_u
            (i8x16.sub (local.get $v) (i8x16.splat (i32.const "A")))
            (i8x16.splat (i32.const 25)))
          (i8x16.splat (i32.const 32)))))
    (local.set $hl
      (keyword-table.value $phpWords
        (i32.const $mem.lexLowerScratch)
        (i32.add (i32.const $mem.lexLowerScratch) (local.get $n))))
    (select (local.get $hl) (enum.get $Token.variable) (i32.ge_s (local.get $hl) (i32.const 0))))

  ;; $p always sits on a CR, an LF, or $end here (callers land on the result
  ;; of $phpLineEndAt), so consuming one byte plus a CRLF pair is exact.
  (func $phpAfterLine (param $p i32) (result i32)
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (if
          (i32.and
            (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
            (i32.and
              (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
              (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 10))))
          (then (return (i32.add (local.get $p) (i32.const 2)))))
        (return (i32.add (local.get $p) (i32.const 1)))))
    (local.get $p))

  (func $phpLineEndAt (param $p i32) (result i32)
    (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))

  (func $phpBlanksAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done
          (i32.eqz
            (i32.or
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 32))
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 9)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; do the $n bytes at $a equal those at $b? The whole run must fit before
  ;; $end; the masked wide loads may pass it into the input slack.
  (func $phpBytesEq (param $a i32) (param $b i32) (param $n i32) (result i32)
    (local $mask i64)
    (if (i32.gt_u (i32.add (local.get $a) (local.get $n)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.eqz (local.get $n))
      (then (return (i32.const 1))))
    (block $done
      (loop $cmp
        (if (i32.lt_u (local.get $n) (i32.const 8))
          (then
            (local.set $mask
              (i64.shr_u
                (i64.const -1)
                (i64.extend_i32_u (i32.shl (i32.sub (i32.const 8) (local.get $n)) (i32.const 3)))))
            (if
              (i64.ne
                (i64.and (i64.load (local.get $a)) (local.get $mask))
                (i64.and (i64.load (local.get $b)) (local.get $mask)))
              (then (return (i32.const 0))))
            (br $done)))
        (if (i64.ne (i64.load (local.get $a)) (i64.load (local.get $b)))
          (then (return (i32.const 0))))
        (local.set $a (i32.add (local.get $a) (i32.const 8)))
        (local.set $b (i32.add (local.get $b) (i32.const 8)))
        (local.set $n (i32.sub (local.get $n) (i32.const 8)))
        (br_if $cmp (local.get $n))))
    (i32.const 1))

  ;; The `}` that closes the brace before $p on the same line and within
  ;; 512 bytes, or 0. The bound keeps a line of unclosed braces linear.
  (func $phpBraceEnd (param $p i32) (result i32)
    (local $c i32)
    (local $depth i32)
    (local $close i32)
    (local.set $close (i32.add (local.get $p) (i32.const 512)))
    (if (i32.gt_u (local.get $close) (global.get $end))
      (then (local.set $close (global.get $end))))
    (block $none
      (loop $brace
        (br_if $none (i32.ge_u (local.get $p) (local.get $close)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $none (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const "}"))
          (then
            (if (i32.eqz (local.get $depth))
              (then (return (local.get $p))))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $brace)))
    (i32.const 0))

  ;; The nested code run must not leave stream state for the code around it.
  (func $phpBraceCode (param $open i32) (param $p i32) (param $e i32)
    (local $saveEnd i32)
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $open) (local.get $p))
    (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
    (call $scanIdentRun (i32.const "_"))
    (if (i32.and (i32.eq (global.get $ptr) (local.get $e)) (i32.eq (i32.load8_u (local.get $p)) (i32.const "$")))
      (then (call $emitTok (enum.get $Token.variable) (local.get $p) (local.get $e)))
      (else
        (global.set $ptr (local.get $p))
        (local.set $saveEnd (global.get $end))
        (global.set $end (local.get $e))
        (call $phpCode (i32.const 0))
        (call $emitTok (enum.get $Token.string) (global.get $ptr) (local.get $e))
        (global.set $end (local.get $saveEnd))
        (global.set $phpStreamDecl (i32.const 0))
        (global.set $phpStreamMember (i32.const 0))
        (global.set $phpXhp (i32.const 0))))
    (global.set $ptr (i32.add (local.get $e) (i32.const 1)))
    (call $emitTok (enum.get $Token.punctuation.special) (local.get $e) (global.get $ptr)))

  (func $hackXhpName
    (block $done
      (loop $part
        (call $scanIdentRun (i32.const "-"))
        (br_if $done (i32.ne (call $templateByte (global.get $ptr)) (i32.const ":")))
        (br_if $done (i32.eqz (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $part))))

  ;; $state: open elements * 4, +1 inside a start tag. Returns the state at $end, 0 once
  ;; the outermost element closes. $state -1: returns -1 if `<name` starts no operand.
  (func $hackXhp (param $state i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $lhs i32)
    (if (i32.lt_s (local.get $state) (i32.const 0))
      (then
        (local.set $c (call $lexLineByteBefore (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const "n"))
          (then
            (local.set $e (global.get $ptr))
            (block $blank
              (loop $back
                (br_if $blank (i32.le_u (local.get $e) (global.get $srcBase)))
                (local.set $c (i32.load8_u (i32.sub (local.get $e) (i32.const 1))))
                (br_if $blank (i32.and (i32.ne (local.get $c) (i32.const 32)) (i32.ne (local.get $c) (i32.const 9))))
                (local.set $e (i32.sub (local.get $e) (i32.const 1)))
                (br $back)))
            (local.set $e (i32.sub (local.get $e) (i32.const 6)))
            (local.set $c
              (i32.and
                (i32.ge_s (local.get $e) (global.get $srcBase))
                (i64.eq
                  (i64.and (i64.load (local.get $e)) (i64.const 0xffffffffffff))
                  (i64.const "return"))))
            (if (i32.and (local.get $c) (i32.gt_u (local.get $e) (global.get $srcBase)))
              (then
                (local.set $c
                  (i32.eqz (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $e) (i32.const 1)))))))))
          (else
            (local.set $c
              (i32.or
                (i32.eqz (local.get $c))
                (byteset.get "!&(,:;=>?[{|}" (local.get $c))))))
        (if (i32.eqz (local.get $c))
          (then (return (i32.const -1))))
        (local.set $state (i32.const 0))))
    (block $done
      (loop $next
        (if (i32.and (local.get $state) (i32.const 1))
          (then
            (local.set $lhs (global.get $ptr))
            (call $scanWhitespace)
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $lhs (global.get $ptr))
            (local.set $c (i32.load8_u (local.get $lhs)))
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                (local.set $state (i32.sub (local.get $state) (i32.const 1)))
                (br $next)))
            (if
              (i32.and
                (i32.eq (local.get $c) (i32.const "/"))
                (i32.eq (call $templateByte (i32.add (local.get $lhs) (i32.const 1))) (i32.const ">")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
                (local.set $state (i32.sub (local.get $state) (i32.const 5)))
                (br_if $done (i32.eqz (local.get $state)))
                (br $next)))
            (if (i32.eq (local.get $c) (i32.const "{"))
              (then
                (local.set $e (call $phpBraceEnd (i32.add (local.get $lhs) (i32.const 1))))
                (if (local.get $e)
                  (then
                    (call $phpBraceCode (local.get $lhs) (i32.add (local.get $lhs) (i32.const 1)) (local.get $e))
                    (br $next)))))
            (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
              (then
                (global.set $ptr (call $scanFind3 (i32.add (local.get $lhs) (i32.const 1)) (local.get $c) (i32.const 10) (i32.const 13)))
                (if (i32.eq (call $templateByte (global.get $ptr)) (local.get $c))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (if (call $lexIsNameStart (local.get $c))
              (then
                (call $hackXhpName)
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                (br $next)))
            (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
            (call $emitTok
              (select
                (enum.get $Token.punctuation.delimiter.html)
                (enum.get $Token.none)
                (i32.eq (local.get $c) (i32.const "=")))
              (local.get $lhs)
              (global.get $ptr))
            (br $next)))
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (call $lexFindEither (local.get $lhs) (i32.const "<") (i32.const "{")))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.eq (i32.load8_u (local.get $lhs)) (i32.const "{"))
          (then
            (local.set $e (call $phpBraceEnd (i32.add (local.get $lhs) (i32.const 1))))
            (if (local.get $e)
              (then (call $phpBraceCode (local.get $lhs) (i32.add (local.get $lhs) (i32.const 1)) (local.get $e)))
              (else
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "/"))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $hackXhpName)
            (call $emitTok (enum.get $Token.tag) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (call $lexSkipSpaceAt (local.get $lhs)))
            (call $emitGap (local.get $lhs) (global.get $ptr))
            (if (i32.eq (call $templateByte (global.get $ptr)) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok
                  (enum.get $Token.punctuation.bracket.html)
                  (i32.sub (global.get $ptr) (i32.const 1))
                  (global.get $ptr))))
            (local.set $state (i32.sub (local.get $state) (i32.const 4)))
            (br_if $done (i32.le_s (local.get $state) (i32.const 0)))
            (br $next)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (call $lexIsNameStart (local.get $c))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket.html) (local.get $lhs) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (call $hackXhpName)
            (call $emitTok (enum.get $Token.tag) (local.get $lhs) (global.get $ptr))
            (local.set $state (i32.add (local.get $state) (i32.const 5)))
            (br $next)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (br $next)))
    (select (local.get $state) (i32.const 0) (i32.gt_s (local.get $state) (i32.const 0))))

  ;; $q: the closing quote, or 0 for a heredoc body. Returns 1 after the quote, 0 at $end;
  ;; a quoted string open at a chunk end becomes mode 14, $streamA 0, the quote in $streamB.
  (func $phpInterp (param $q i32) (param $seg i32) (result i32)
    (local $c i32)
    (local $e i32)
    (local $lhs i32)
    (local $open i32)
    (local $p i32)
    (local $status i32)
    (block $done
      (loop $l
        (global.set $ptr
          (call $scanFind3
            (global.get $ptr)
            (select (local.get $q) (i32.const "$") (local.get $q))
            (i32.const 92)
            (i32.const "$")))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $e (call $lexEscapeEnd (global.get $ptr)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $l)))
        (if (i32.ne (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (block $plain
          (if
            (i32.or
              (i32.eq (local.get $c) (i32.const "{"))
              (i32.and
                (i32.gt_u (local.get $lhs) (local.get $seg))
                (i32.eq (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1))) (i32.const "{"))))
            (then
              (local.set $open (local.get $lhs))
              (local.set $p (i32.add (local.get $lhs) (i32.const 2)))
              (if (i32.ne (local.get $c) (i32.const "{"))
                (then
                  (local.set $p (local.get $lhs))
                  (local.set $open (i32.sub (local.get $lhs) (i32.const 1)))))
              (local.set $e (call $phpBraceEnd (local.get $p)))
              (br_if $plain (i32.eqz (local.get $e)))
              (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $open))
              (call $phpBraceCode (local.get $open) (local.get $p) (local.get $e))
              (local.set $seg (global.get $ptr))
              (br $l)))
          (br_if $plain (i32.eqz (call $lexIsNameStart (local.get $c))))
          (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $lhs))
          (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
          (call $scanIdentRun (i32.const "_"))
          (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
          (local.set $c (call $templateByte (global.get $ptr)))
          (if
            (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.and
                (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">"))
                (call $lexIsNameStart (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))))
            (then
              (local.set $p (i32.add (global.get $ptr) (i32.const 2)))
              (call $emitTok (enum.get $Token.operator) (global.get $ptr) (local.get $p))
              (global.set $ptr (local.get $p))
              (call $scanIdentRun (i32.const "_"))
              (call $emitTok (enum.get $Token.property) (local.get $p) (global.get $ptr))))
          (if (i32.eq (local.get $c) (i32.const "["))
            (then
              (local.set $lhs (global.get $ptr))
              (local.set $p (i32.add (local.get $lhs) (i32.const 1)))
              (local.set $c (call $templateByte (local.get $p)))
              (global.set $ptr
                (i32.add
                  (local.get $p)
                  (i32.or (i32.eq (local.get $c) (i32.const "$")) (i32.eq (local.get $c) (i32.const "-")))))
              (call $scanIdentRun (i32.const "_"))
              (if
                (i32.and
                  (i32.gt_u (global.get $ptr) (local.get $p))
                  (i32.eq (call $templateByte (global.get $ptr)) (i32.const "]")))
                (then
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (local.get $p))
                  (call $emitTok
                    (select
                      (enum.get $Token.variable)
                      (select
                        (enum.get $Token.number)
                        (enum.get $Token.string)
                        (i32.or (i32.eq (local.get $c) (i32.const "-")) (call $lexIsDigit (local.get $c))))
                      (i32.eq (local.get $c) (i32.const "$")))
                    (local.get $p)
                    (global.get $ptr))
                  (local.set $p (global.get $ptr))
                  (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                  (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $p) (global.get $ptr)))
                (else (global.set $ptr (local.get $lhs))))))
          (local.set $seg (global.get $ptr))
          (br $l))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (if
      (i32.and
        (i32.eqz (local.get $status))
        (i32.and
          (i32.ne (local.get $q) (i32.const 0))
          (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof)))))
      (then
        (global.set $streamMode (i32.const 14))
        (global.set $streamA (i32.const 0))
        (global.set $streamB (local.get $q))))
    (local.get $status))

    ;; Emit a heredoc/nowdoc body that starts at $body and ends at the first
  ;; line whose first non-blank run is the $n-byte label at $delim followed
  ;; by a non-identifier byte (`EOT;` closes, `EOTX` does not). $interp is 1
  ;; for a heredoc, whose body interpolates. Returns 1 with $ptr after the
  ;; label. An unterminated body runs to $end and returns 0; in streaming it
  ;; becomes php-owned stream mode 14 so the next chunk keeps looking for the
  ;; closer: the label is copied into the 32-byte stream delimiter, its
  ;; length into $streamA, and $interp into $streamB. Longer labels cannot be
  ;; checkpointed and simply end at the chunk.
  (func $phpHeredocBody (param $body i32) (param $delim i32) (param $n i32) (param $interp i32) (result i32)
    (local $c i32)
    (local $closed i32)
    (local $line i32)
    (local $saveEnd i32)
    (local $start i32)
    (local.set $line (local.get $body))
    (block $scanned
      (loop $scan
        (br_if $scanned (i32.ge_u (local.get $line) (global.get $end)))
        (local.set $start (call $phpBlanksAt (local.get $line)))
        (if (call $phpBytesEq (local.get $start) (local.get $delim) (local.get $n))
          (then
            (local.set $c (i32.add (local.get $start) (local.get $n)))
            ;; the label must not be a prefix of a longer word
            (if
              (i32.or
                (i32.ge_u (local.get $c) (global.get $end))
                (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $c)))))
              (then
                (local.set $closed (i32.const 1))
                (br $scanned)))))
        (local.set $line (call $phpAfterLine (call $phpLineEndAt (local.get $line))))
        (br $scan)))
    ;; an unterminated body is the rest of the range
    (if (i32.eqz (local.get $closed))
      (then (local.set $line (global.get $end))))
    (if (local.get $interp)
      (then
        (local.set $saveEnd (global.get $end))
        (global.set $end (local.get $line))
        (global.set $ptr (local.get $body))
        (drop (call $phpInterp (i32.const 0) (local.get $body)))
        (global.set $end (local.get $saveEnd)))
      (else (call $emitTok (enum.get $Token.string) (local.get $body) (local.get $line))))
    (if (i32.eqz (local.get $closed))
      (then
        (global.set $ptr (global.get $end))
        (if (i32.and (global.get $streaming) (i32.le_u (local.get $n) (i32.const 32)))
          (then
            (memory.copy (i32.const $mem.streamDelimiter) (local.get $delim) (local.get $n))
            (global.set $streamMode (i32.const 14))
            (global.set $streamA (local.get $n))
            (global.set $streamB (local.get $interp))))
        (return (i32.const 0))))
    (call $emitGap (local.get $line) (local.get $start))
    (call $emitTok
      (enum.get $Token.string)
      (local.get $start)
      (i32.add (local.get $start) (local.get $n)))
    (global.set $ptr (i32.add (local.get $start) (local.get $n)))
    (i32.const 1))

  ;; Resume php-owned stream mode 14: a heredoc/nowdoc body ($streamA its
  ;; label length) or a quoted string ($streamA 0) the previous chunk left
  ;; open. Returns 1 when the body still runs past this chunk, 0 with the
  ;; mode cleared and $ptr after the closing label or quote.
  (func $phpHeredocResume (result i32)
    (if
      (if (result i32) (global.get $streamA)
        (then
          (call $phpHeredocBody
            (global.get $ptr)
            (i32.const $mem.streamDelimiter)
            (global.get $streamA)
            (global.get $streamB)))
        (else (call $phpInterp (global.get $streamB) (global.get $ptr))))
      (then
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (i32.const 1))

  ;; `<<<ID`, `<<<"ID"` and nowdoc `<<<'ID'`. The body runs to the first line
  ;; whose first non-blank run is the identifier, so everything in between -
  ;; `?>` included - stays literal text instead of closing PHP mode.
  ;; Returns 1 when a heredoc was consumed, 0 to leave `<<<` to the caller.
  (func $phpHeredoc (result i32)
    (local $body i32)
    (local $c i32)
    (local $delim i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $quote i32)
    (local $start i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (call $phpBlanksAt (i32.add (global.get $ptr) (i32.const 3))))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.const 0))))
    (local.set $quote (i32.load8_u (local.get $p)))
    (if
      (i32.or (i32.eq (local.get $quote) (i32.const 34)) (i32.eq (local.get $quote) (i32.const 39)))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
      (else (local.set $quote (i32.const 0))))
    ;; a label starts with a letter or `_`, never a digit and never `$`
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if
      (i32.eqz
        (i32.or
          (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
          (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.ge_u (local.get $c) (i32.const 128)))))
      (then (return (i32.const 0))))
    (local.set $delim (local.get $p))
    (block $idDone
      (loop $id
        (br_if $idDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $idDone
          (i32.or
            (i32.eqz (call $lexIsIdentContinue (local.get $c)))
            (i32.eq (local.get $c) (i32.const "$"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $id)))
    (local.set $n (i32.sub (local.get $p) (local.get $delim)))
    (if (local.get $quote)
      (then
        (if
          (i32.or
            (i32.ge_u (local.get $p) (global.get $end))
            (i32.ne (i32.load8_u (local.get $p)) (local.get $quote)))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    ;; the opener has to end its line
    (local.set $start (call $phpBlanksAt (local.get $p)))
    (if
      (i32.and
        (i32.lt_u (local.get $start) (global.get $end))
        (i32.and
          (i32.ne (i32.load8_u (local.get $start)) (i32.const 10))
          (i32.ne (i32.load8_u (local.get $start)) (i32.const 13))))
      (then (return (i32.const 0))))
    (call $emitTok
      (enum.get $Token.operator)
      (local.get $lhs)
      (i32.add (local.get $lhs) (i32.const 3)))
    (call $emitTok (enum.get $Token.string) (i32.add (local.get $lhs) (i32.const 3)) (local.get $p))
    (call $emitGap (local.get $p) (local.get $start))
    (local.set $body (call $phpAfterLine (local.get $start)))
    (call $emitGap (local.get $start) (local.get $body))
    (drop
      (call $phpHeredocBody
        (local.get $body)
        (local.get $delim)
        (local.get $n)
        (i32.ne (local.get $quote) (i32.const 39))))
    (i32.const 1))

  ;; A single-quoted string body from $ptr, $seg holding its first unemitted
  ;; byte. PHP escapes only `\'` and `\\` here, so regex patterns (`'/\d+/'`)
  ;; and Windows paths stay plain string text. Returns 1 after the closing
  ;; quote, 0 when the body runs to $end; a body that reaches the end of a
  ;; streamed chunk becomes php-owned stream mode 15, resumed by
  ;; $phpStreamResume, so later lines keep these escape rules.
  (func $phpSingleBody (param $seg i32) (result i32)
    (local $c i32)
    (local $status i32)
    (block $done
      (loop $l
        (global.set $ptr
          (call $scanFindSpecial
            (global.get $ptr)
            (global.get $end)
            (i32.const 39)
            (i32.const 1)
            (i32.const 0)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (if (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 39))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $status (i32.const 1))
            (br $done)))
        ;; a backslash escapes only a quote or another backslash
        (local.set $c (i32.load8_u offset=1 (global.get $ptr)))
        (if
          (i32.and
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
            (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const 92))))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (local.set $seg (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.string.escape) (global.get $ptr) (local.get $seg))
            (global.set $ptr (local.get $seg)))
          (else (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (br $l)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (if
      (i32.and
        (i32.eqz (local.get $status))
        (i32.and (global.get $streaming) (i32.eq (global.get $ptr) (global.get $eof))))
      (then (global.set $streamMode (i32.const 15))))
    (local.get $status))

  ;; PHP code, stopping before a live `?>` delimiter. $resume is 1 when the
  ;; previous chunk ended inside code: the declaration and member lookahead
  ;; it checkpointed continues into this chunk.
  ;; Hack's $attr: 1 where a `<<` attribute list expects a name, 2 after one.
  ;; Attribute lists rarely span lines, so any line break since $attrAt - in
  ;; a gap, comment, or string - ends one, as a line-fed stream sees it.
  (func $phpCode (param $resume i32)
    (local $attr i32)
    (local $attrAt i32)
    (local $c i32)
    (local $decl i32) ;; the name a keyword primes, see below
    (local $hl i32)
    (local $lhs i32)
    (local $member i32)
    (local $next i32)
    (local $p i32)
    (if (local.get $resume)
      (then
        (local.set $decl (global.get $phpStreamDecl))
        (local.set $member (global.get $phpStreamMember))
        (if (global.get $phpXhp)
          (then (global.set $phpXhp (call $hackXhp (global.get $phpXhp)))))))
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (if (local.get $attr)
          (then
            (if (call $lexGapHasBreak (local.get $attrAt) (global.get $ptr))
              (then (local.set $attr (i32.const 0))))
            (local.set $attrAt (global.get $ptr))))
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next
          (select
            (i32.load8_u offset=1 (global.get $ptr))
            (i32.const 0)
            (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (br_if $done
          (i32.and
            (i32.eqz (global.get $phpHack))
            (i32.and
              (i32.eq (local.get $c) (i32.const "?"))
              (i32.eq (local.get $next) (i32.const ">")))))
        ;; a branch to $reset clears the pending name and member lookahead
        (block $reset
        ;; Hack: a legacy `<?hh` header, and `<<Name, ...>>` attributes
        (if (i32.and (global.get $phpHack) (i32.eq (local.get $c) (i32.const "<")))
          (then
            (local.set $p (call $templateByte (i32.add (global.get $ptr) (i32.const 2))))
            (if
              (i32.and
                (i32.eq (local.get $next) (i32.const "?"))
                (i32.and
                  (i32.eq (local.get $p) (i32.const "h"))
                  (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 3))) (i32.const "h"))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 4)))
                (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
                (br $token)))
            (if
              (i32.and
                (i32.eq (local.get $next) (i32.const "<"))
                (i32.or
                  (i32.le_u (i32.sub (i32.or (local.get $p) (i32.const 32)) (i32.const "a")) (i32.const 25))
                  (i32.or (i32.eq (local.get $p) (i32.const "_")) (i32.ge_u (local.get $p) (i32.const 128)))))
              (then
                ;; after a value, `<<` shifts: `1<<BIT`, `$x<<SHIFT >> 2`
                (local.set $p (call $lexLineByteBefore (local.get $lhs)))
                (if
                  (i32.eqz
                    (i32.or
                      (call $lexIsIdentContinue (local.get $p))
                      (i32.or (i32.eq (local.get $p) (i32.const ")")) (i32.eq (local.get $p) (i32.const "]")))))
                  (then
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                    (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                    (local.set $attr (i32.const 1))
                    (local.set $attrAt (global.get $ptr))
                    (br $reset)))))
            ;; never XHP right after a name (`vec<int>`)
            (if
              (i32.and
                (i32.le_u (i32.sub (i32.or (local.get $next) (i32.const 32)) (i32.const "a")) (i32.const 25))
                (i32.or
                  (i32.le_u (local.get $lhs) (global.get $srcBase))
                  (i32.eqz (call $lexIsIdentContinue (i32.load8_u (i32.sub (local.get $lhs) (i32.const 1)))))))
              (then
                (local.set $p (call $hackXhp (i32.const -1)))
                (if (i32.ge_s (local.get $p) (i32.const 0))
                  (then
                    (global.set $phpXhp (local.get $p))
                    (br $reset)))))))
        (if
          (i32.or
            (i32.and
              (i32.eq (local.get $c) (i32.const "/"))
              (i32.eq (local.get $next) (i32.const "/")))
            (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.ne (local.get $next) (i32.const "["))))
          (then
            (call $phpLineComment
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "/"))))
            (br $token)))
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "/"))
            (i32.eq (local.get $next) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if
          (i32.and
            (i32.and
              (i32.eq (local.get $c) (i32.const "<"))
              (i32.eq (local.get $next) (i32.const "<")))
            (i32.and
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
              (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "<"))))
          (then
            (br_if $reset (call $phpHeredoc))))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 34))
            (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const "`"))))
          (then
            (if (i32.eq (local.get $c) (i32.const 39))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (drop (call $phpSingleBody (local.get $lhs))))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (drop (call $phpInterp (local.get $c) (local.get $lhs)))))
            (br $reset)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (global.set $sigPattern (i32.const 0))
            (br $reset)))
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $next))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $reset)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $hl (call $phpWordHl (local.get $lhs) (global.get $ptr)))
            (if (global.get $phpHack)
              (then
                (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                  (then
                    (local.set $p (keyword-table.value $hackWords (local.get $lhs) (global.get $ptr)))
                    (if (i32.ge_s (local.get $p) (i32.const 0))
                      (then (local.set $hl (local.get $p))))))
                ;; `enum class Name` re-arms the name capture, and the builtin
                ;; type of `const int MAX` cancels it
                (if
                  (i32.and
                    (i32.or
                      (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                      (i32.eq (local.get $hl) (enum.get $Token.type.builtin)))
                    (i32.ne (local.get $decl) (i32.const 6)))
                  (then (local.set $decl (i32.const 0))))))
            (if (local.get $decl)
              (then
                (if (i32.ge_u (local.get $decl) (i32.const 4))
                  (then
                    (if (i32.eq (local.get $decl) (i32.const 4))
                      (then
                        (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                          (then
                            (local.set $hl (enum.get $Token.constant))
                            (local.set $decl (i32.const 0))
                            (if
                              (call $lexIsNameStart
                                (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
                              (then
                                (local.set $hl (enum.get $Token.type))
                                (local.set $decl (i32.const 4)))))
                          (else
                            (if (i32.ne (local.get $hl) (enum.get $Token.type.builtin))
                              (then (local.set $decl (i32.const 0)))))))
                      (else
                        (if (i32.ne (local.get $hl) (enum.get $Token.keyword.declaration))
                          (then
                            (if
                              (i32.and
                                (i32.lt_u (global.get $ptr) (global.get $end))
                                (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 92)))
                              (then (local.set $hl (enum.get $Token.namespace)))
                              (else
                                (if (i32.eq (local.get $decl) (i32.const 7))
                                  (then (local.set $hl (enum.get $Token.namespace)))
                                  (else
                                    (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                                      (then
                                        (local.set $hl
                                          (call $phpUpperName (local.get $lhs) (global.get $ptr)))))))
                                (local.set $decl (i32.const 0)))))))))
                  (else
                    ;; `new` (decl 3) names a class unless a keyword follows
                    ;; (`new class`, `new static`)
                    (if
                      (i32.or
                        (i32.lt_u (local.get $decl) (i32.const 3))
                        (i32.eq (local.get $hl) (enum.get $Token.variable)))
                      (then
                        (local.set $hl
                          (select
                            (enum.get $Token.function.definition)
                            (enum.get $Token.type.class)
                            (i32.eq (local.get $decl) (i32.const 1))))))
                    ;; in a qualified `new A\B` the segments before `\` are
                    ;; namespaces and the class name is still pending
                    (if
                      (i32.and
                        (i32.eq (local.get $decl) (i32.const 3))
                        (i32.and
                          (i32.lt_u (global.get $ptr) (global.get $end))
                          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const 92))))
                      (then (local.set $hl (enum.get $Token.namespace)))
                      (else (local.set $decl (i32.const 0)))))))
              (else
                (if (local.get $member)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $hl
                      (select
                        (enum.get $Token.function.method)
                        (enum.get $Token.property)
                        (i32.and
                          (i32.lt_u (local.get $p) (global.get $end))
                          (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))
                    ;; a class constant after `::` (`Attribute::TARGET_CLASS`)
                    (if (i32.eq (local.get $member) (i32.const 2))
                      (then
                        (if
                          (i32.and
                            (i32.eq (local.get $hl) (enum.get $Token.property))
                            (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
                          (then
                            (if (call $lexIsConstCase (local.get $lhs) (global.get $ptr))
                              (then (local.set $hl (enum.get $Token.constant))))))))
                    (local.set $member (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if
                          (i32.and
                            (i32.lt_u (local.get $p) (global.get $end))
                            (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (enum.get $Token.function)))
                          (else
                            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                              (then
                                (local.set $hl
                                  (call $phpUpperName (local.get $lhs) (global.get $ptr)))))))
                        ;; a PHP 8 named call argument - `name:` after `(` or
                        ;; `,`, never `::` - is Zed's argument name capture
                        (if
                          (i32.and
                            (global.get $sigPattern)
                            (i32.and
                              (i32.and
                                (i32.lt_u (local.get $p) (global.get $end))
                                (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))
                              (i32.ne
                                (select
                                  (i32.load8_u offset=1 (local.get $p))
                                  (i32.const 0)
                                  (i32.lt_u
                                    (i32.add (local.get $p) (i32.const 1))
                                    (global.get $end)))
                                (i32.const ":"))))
                          (then (local.set $hl (enum.get $Token.variable.parameter)))))
                      (else
                        ;; a declaration keyword primes the name that follows:
                        ;; 1 a function, 2 a class-like, 4 a constant, 7 a
                        ;; namespace; `new` (3) a class, `use` (6) a path
                        (if (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
                          (then
                            (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
                            (local.set $decl
                              (select
                                (i32.const 1)
                                (i32.const 2)
                                (i32.and
                                  (i32.eq (local.get $p) (i32.const 8))
                                  (i64.eq
                                    (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
                                    (i64.const "function")))))
                            (if (i32.eq (i32.or (i32.load (local.get $lhs)) (i32.const 0x20202020)) (i32.const "cons"))
                              (then (local.set $decl (i32.const 4))))
                            (if
                              (i32.and
                                (i32.eq (local.get $p) (i32.const 9))
                                (i32.eq (i32.or (i32.load8_u (local.get $lhs)) (i32.const 32)) (i32.const "n")))
                              (then (local.set $decl (i32.const 7)))))
                          (else
                            (if (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 3))
                              (then
                                (local.set $p
                                  (i32.and
                                    (i32.or (i32.load (local.get $lhs)) (i32.const 0x202020))
                                    (i32.const 0xffffff)))
                                (if (i32.eq (local.get $p) (i32.const "new"))
                                  (then (local.set $decl (i32.const 3))))
                                (if (i32.eq (local.get $p) (i32.const "use"))
                                  (then (local.set $decl (i32.const 6))))))))))))))
            (if (i32.eq (local.get $attr) (i32.const 1))
              (then
                (local.set $hl (enum.get $Token.attribute))
                (local.set $attr (i32.const 2))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (global.set $sigPattern (i32.const 0))
            (br $token)))
        (if
          (i32.or
            (i32.and
              (i32.eq (local.get $c) (i32.const "-"))
              (i32.eq (local.get $next) (i32.const ">")))
            (i32.and
              (i32.eq (local.get $c) (i32.const ":"))
              (i32.eq (local.get $next) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            ;; 2 after `::`, where SCREAMING_CASE names class constants
            (local.set $member (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const ":"))))
            (global.set $sigPattern (i32.const 0))
            (br $token)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; an open paren puts the next bare word in named-argument position
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const "(")))
            (br $reset)))
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const ","))
            (i32.or
              (i32.eq (local.get $c) (i32.const ";"))
              (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok
              (enum.get $Token.punctuation.delimiter)
              (local.get $lhs)
              (global.get $ptr))
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const ",")))
            (if (local.get $attr)
              (then (local.set $attr (i32.const 1))))
            (br $reset)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (local.set $hl
          (select
            (enum.get $Token.attribute)
            (enum.get $Token.operator)
            (i32.and
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.eq (local.get $next) (i32.const "[")))))
        ;; the `>>` that closes a Hack attribute list
        (if
          (i32.and
            (i32.ne (local.get $attr) (i32.const 0))
            (i32.and (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $next) (i32.const ">"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (local.set $hl (enum.get $Token.attribute))
            (local.set $attr (i32.const 0))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        ;; `function &name`, the `\` of `new \A\B`, and `const ?int` keep the
        ;; pending name
        (if (local.get $decl)
          (then
            (if
              (i32.and
                (i32.and (i32.ne (local.get $c) (i32.const "&")) (i32.ne (local.get $c) (i32.const 92)))
                (i32.ne (local.get $c) (i32.const "?")))
              (then (local.set $decl (i32.const 0))))))
        (local.set $member (i32.const 0))
        (br $token))
        (local.set $decl (i32.const 0))
        (local.set $member (i32.const 0))
        (br $token)))
    (if (global.get $streaming)
      (then
        (global.set $phpStreamDecl (local.get $decl))
        (global.set $phpStreamMember (local.get $member)))))

  ;; Resume the php stream state the previous chunk left: first a heredoc
  ;; body (mode 14) or single-quoted string (mode 15), then - when the chunk
  ;; ended inside PHP code - the code itself up to `?>`. Returns 1 when the
  ;; whole chunk was consumed; on 0 $hlPhp continues from $ptr, in markup
  ;; mode after a `?>`.
  (func $phpStreamResume (result i32)
    (local $code i32)
    (local $lhs i32)
    (local.set $code (i32.eq (global.get $phpStreamingCode) (i32.const 1)))
    (if (i32.eq (global.get $streamMode) (i32.const 14))
      (then
        (if (call $phpHeredocResume)
          (then (return (i32.const 1))))
        ;; a heredoc only opens inside code, so its closer continues code
        (local.set $code (i32.const 1))))
    (if (i32.eq (global.get $streamMode) (i32.const 15))
      (then
        (if (i32.eqz (call $phpSingleBody (global.get $ptr)))
          (then (return (i32.const 1))))
        (global.set $streamMode (i32.const 0))
        (local.set $code (i32.const 1))))
    (if (i32.eqz (local.get $code))
      (then (return (i32.const 0))))
    (call $phpCode (i32.const 1))
    (if
      (i32.and
        (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
        (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "?>")))
      (then
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
        (global.set $phpStreamingCode (i32.const 2))
        (return (i32.const 0))))
    (i32.const 1))

  ;; Does the visible text at $p start markup - a tag, a comment or doctype,
  ;; or a close tag - rather than a bare PHP snippet?
  (func $phpLooksLikeMarkup (param $p i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "<"))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=1 (local.get $p)))
    (i32.or
      (call $lexIsIdentStart (local.get $c))
      (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "/")))))

  ;; Skip every ASCII whitespace byte from $p, line breaks included, so the
  ;; snippet-versus-markup decision reads the first visible byte wherever
  ;; its line is.
  (func $phpSkipWhitespaceAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  (global $phpHtmlOpen (mut i32) (i32.const 0))

  ;; WARNING: $hlHtml starts again after each PHP island: tag, script, and
  ;; style state do not cross it. A modular build must lex each HTML segment
  ;; as a whole body (-1) to match. Only the HTML that ends a stream chunk
  ;; is a stream ($phpHtmlOpen), which the next chunk continues.
  (func $phpHtml
    (local $reset i32)
    (if (global.get $externalEmbedding)
      (then
        (local.set $reset (i32.const -1))
        (if (global.get $streaming)
          (then
            (if (global.get $phpHtmlOpen)
              (then (local.set $reset (i32.const 0)))
              (else
                (if (i32.eq (global.get $end) (global.get $eof))
                  (then (local.set $reset (i32.const 1))))))
            (global.set $phpHtmlOpen (i32.eq (global.get $end) (global.get $eof)))))
        (drop
          (call $embedLanguage
            (enum.get $Language.html) (global.get $ptr) (global.get $end)
            (local.get $reset) (i32.const -7)))
        (global.set $ptr (global.get $end))
        (return)))
    (call $hlHtml))

  ;; A PHP file is markup with `<?php ... ?>` islands; input whose first
  ;; visible line has no opener is a bare code snippet when that line looks
  ;; like PHP (no `<tag` first; any first byte but an uppercase letter, `<`,
  ;; `>`, `&`, or non-ASCII, or one of `$;{}()` in it), else markup. Streaming decides that on the first
  ;; non-blank chunk and keeps the answer in $phpStreamingCode - 1 code, 2 markup, 0 undecided - so
  ;; later chunks without an opener stay markup after a `?>`, and blank
  ;; chunks decide nothing, keeping leading empty lines equal to a
  ;; whole-buffer run.
  (func $hlPhp
    (local $open i32)
    (local $p i32)
    (local $saveEnd i32)
    (local $snippet i32)
    (if (global.get $externalEmbedding)
      (then
        (if (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset))
          (then (global.set $phpHtmlOpen (i32.const 0))))))
    (call $lexEmitLeadingContinuation)
    (local.set $snippet (i32.const 0))
    ;; a `#!` first line is a comment, so a stream decides on the next line
    (if
      (i32.and
        (i32.eq (global.get $ptr) (global.get $docStart))
        (i32.and
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "#!"))))
      (then
        (local.set $p (global.get $ptr))
        (global.set $ptr (call $phpLineEndAt (local.get $p)))
        (call $emitTok (enum.get $Token.comment) (local.get $p) (global.get $ptr))))
    (block $out
      (local.set $open (call $phpFindOpen (global.get $ptr)))
      (if
        (i32.and (global.get $streaming) (i32.eq (global.get $phpStreamingCode) (i32.const 2)))
        (then
          (if (i32.eq (local.get $open) (global.get $end))
            (then
              (call $phpHtml)
              (br $out))))
        (else
          (local.set $p (call $phpSkipWhitespaceAt (global.get $ptr)))
          (if (i32.ge_u (local.get $p) (global.get $end))
            (then
              (call $emitGap (global.get $ptr) (global.get $end))
              (global.set $ptr (global.get $end))
              (br $out)))
          ;; a stream sees only the first visible line, so it alone decides snippet or markup
          (local.set $saveEnd (call $phpLineEndAt (local.get $p)))
          (if (i32.ge_u (local.get $open) (local.get $saveEnd))
            (then
              (if (i32.eqz (call $phpLooksLikeMarkup (local.get $p)))
                (then
                  (local.set $snippet (i32.load8_u (local.get $p)))
                  (local.set $snippet
                    (i32.eqz
                      (i32.or
                        (i32.or
                          (i32.le_u (i32.sub (local.get $snippet) (i32.const "A")) (i32.const 25))
                          (i32.ge_u (local.get $snippet) (i32.const 0x80)))
                        (i32.or
                          (i32.eq (local.get $snippet) (i32.const "&"))
                          (i32.eq (i32.or (local.get $snippet) (i32.const 2)) (i32.const ">"))))))
                  (block $seen
                    (loop $scan
                      (br_if $seen (i32.or (local.get $snippet) (i32.ge_u (local.get $p) (local.get $saveEnd))))
                      (local.set $snippet (i32.load8_u (local.get $p)))
                      (local.set $snippet (byteset.get "$;{}()" (local.get $snippet)))
                      (local.set $p (i32.add (local.get $p) (i32.const 1)))
                      (br $scan)))))
              (if (i32.eqz (local.get $snippet))
                (then
                  (global.set $phpStreamingCode (i32.const 2))
                  (if (i32.eq (local.get $open) (global.get $end))
                    (then
                      (call $phpHtml)
                      (br $out)))))))))
      (block $done
        (loop $part
          ;; a snippet has no html or opener before its code
          (if (i32.eqz (local.get $snippet))
            (then
              (if (i32.lt_u (global.get $ptr) (local.get $open))
                (then
                  (local.set $saveEnd (global.get $end))
                  (global.set $end (local.get $open))
                  (call $phpHtml)
                  (global.set $end (local.get $saveEnd))))
              (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
              (local.set $open (global.get $ptr))
              (global.set $ptr
                (i32.add
                  (global.get $ptr)
                  (select
                    (i32.const 3)
                    (i32.const 5)
                    (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "=")))))
              (global.set $phpHtmlOpen (i32.const 0))
              (call $emitTok (enum.get $Token.preproc) (local.get $open) (global.get $ptr))))
          (local.set $snippet (i32.const 0))
          (call $phpCode (i32.const 0))
          (if
            (i32.and
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
              (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "?>")))
            (then
              (local.set $open (global.get $ptr))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
              (call $emitTok (enum.get $Token.preproc) (local.get $open) (global.get $ptr))
              (global.set $phpStreamingCode (i32.const 2)))
            (else
              ;; code only stops at `?>` or $end: the next chunk resumes code
              (global.set $phpStreamingCode (i32.const 1))
              (br $done)))
          (local.set $open (call $phpFindOpen (global.get $ptr)))
          (br $part)))))
)
