(module
  (import "../common.wat")

  ;; The OR with 0x20 maps only letters onto letters; the mask drops bytes past $rhs.
  (func $iniIsBoolean (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 3))
      (then (return (i32.const 0))))
    (local.set $w
      (i64.and
        (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
        (i64.sub
          (i64.shl (i64.const 1) (i64.extend_i32_u (i32.shl (local.get $n) (i32.const 3))))
          (i64.const 1))))
    (i32.or
      (i32.or
        (i64.eq (local.get $w) (i64.const "true"))
        (i64.eq (local.get $w) (i64.const "false")))
      (i32.or
        (i32.or
          (i64.eq (local.get $w) (i64.const "yes"))
          (i64.eq (local.get $w) (i64.const "no")))
        (i32.or
          (i64.eq (local.get $w) (i64.const "on"))
          (i64.eq (local.get $w) (i64.const "off"))))))

  ;; At most one dot, so versions and addresses stay text.
  (func $iniIsNumber (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $dot i32)
    (local $digit i32)
    (local.set $c (i32.load8_u (local.get $lhs)))
    (local.set $lhs (i32.add (local.get $lhs) (byteset.get "+-" (local.get $c))))
    (block $no
      (loop $scan
        (br_if $no (i32.ge_u (local.get $lhs) (local.get $rhs)))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (local.set $digit (i32.const 1))
            (br_if $scan (i32.lt_u (local.get $lhs) (local.get $rhs)))
            (return (i32.const 1))))
        (br_if $no (i32.or (i32.ne (local.get $c) (i32.const ".")) (local.get $dot)))
        (br_if $no (i32.eqz (local.get $digit)))
        (local.set $dot (i32.const 1))
        (local.set $digit (i32.const 0))
        (br $scan)))
    (i32.const 0))

  ;; The first line break, a stop byte of set $stops (1 `=:`, 2 blanks, 3 `]"`), or $end.
  (func $iniFind (param $p i32) (param $stops i32) (result i32)
    (local $c i32)
    (block $found
      (loop $scan
        (br_if $found (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $found (byteset.get "\n\r" (local.get $c)))
        (if (i32.eq (local.get $stops) (i32.const 1))
          (then (br_if $found (byteset.get "=:" (local.get $c)))))
        (if (i32.eq (local.get $stops) (i32.const 2))
          (then (br_if $found (byteset.get " \t" (local.get $c)))))
        (if (i32.eq (local.get $stops) (i32.const 3))
          (then (br_if $found (byteset.get "]\"" (local.get $c)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (local.get $p))

  (func $iniTrim (param $lhs i32) (param $p i32) (result i32)
    (local $c i32)
    (block $trimmed
      (loop $trim
        (br_if $trimmed (i32.le_u (local.get $p) (local.get $lhs)))
        (local.set $c (i32.load8_u (i32.sub (local.get $p) (i32.const 1))))
        (br_if $trimmed (i32.eqz (byteset.get " \t" (local.get $c))))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $trim)))
    (local.get $p))

  ;; Returns 1 when an odd run of backslashes continues the value on the next line.
  (func $iniValue (result i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $c i32)
    (local $slashes i32)
    (local.set $lhs (global.get $ptr))
    (call $scanToLineEnd)
    (local.set $rhs (call $iniTrim (local.get $lhs) (global.get $ptr)))
    (local.set $p (local.get $rhs))
    (block $counted
      (loop $count
        (br_if $counted (i32.le_u (local.get $p) (local.get $lhs)))
        (br_if $counted (i32.ne (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const 92)))
        (local.set $p (i32.sub (local.get $p) (i32.const 1)))
        (br $count)))
    (local.set $slashes (i32.sub (local.get $rhs) (local.get $p)))
    (global.set $ptr (local.get $lhs))
    (local.set $c (i32.load8_u (local.get $lhs)))
    (if (call $iniIsBoolean (local.get $lhs) (local.get $rhs))
      (then
        (global.set $ptr (local.get $rhs))
        (call $emitTok (enum.get $Token.boolean) (local.get $lhs) (local.get $rhs))))
    (if (call $iniIsNumber (local.get $lhs) (local.get $rhs))
      (then
        (global.set $ptr (local.get $rhs))
        (call $emitTok (enum.get $Token.number) (local.get $lhs) (local.get $rhs))))
    (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (i32.eq (global.get $ptr) (local.get $lhs)))
      (then (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))))
    (block $plainDone
      (loop $plain
        (br_if $plainDone (i32.ge_u (global.get $ptr) (local.get $rhs)))
        (local.set $p (global.get $ptr))
        (block $found
          (loop $quote
            (br_if $found (i32.ge_u (local.get $p) (local.get $rhs)))
            (br_if $found (i32.eq (i32.load8_u (local.get $p)) (i32.const 34)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $quote)))
        (call $emitTok (enum.get $Token.none) (global.get $ptr) (local.get $p))
        (global.set $ptr (local.get $p))
        (br_if $plainDone (i32.ge_u (local.get $p) (local.get $rhs)))
        (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
        (br $plain)))
    (i32.and (local.get $slashes) (i32.const 1)))

  ;; $line: 0 at a line start, 1 in a value, 2 after a section header.
  (func $hlIni
    (local $c i32)
    (local $lhs i32)
    (local $gap i32)
    (local $p i32)
    (local $line i32)
    (local $cont i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (if (call $lexGapHasBreak (local.get $gap) (global.get $ptr))
          (then
            (local.set $line (local.get $cont))
            ;; a blank line ends a `\` continuation, as a line-fed stream sees it
            (if (local.get $cont)
              (then
                (local.set $p (local.get $gap))
                (loop $first
                  (local.set $c (i32.load8_u (local.get $p)))
                  (local.set $p (i32.add (local.get $p) (i32.const 1)))
                  (br_if $first (i32.eqz (byteset.get "\n\r" (local.get $c)))))
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 13))
                    (i32.eq (call $templateByte (local.get $p)) (i32.const 10)))
                  (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
                (if (call $lexGapHasBreak (local.get $p) (global.get $ptr))
                  (then (local.set $line (i32.const 0))))))
            (local.set $cont (i32.const 0))))
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (if (i32.eq (local.get $line) (i32.const 1))
          (then
            (local.set $cont (call $iniValue))
            (br $next)))
        (if (local.get $line)
          (then
            (if (byteset.get ";#" (local.get $c))
              (then (call $lexLineComment (i32.const 1) (enum.get $Token.comment)))
              (else
                (call $scanToLineEnd)
                (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))))
            (br $next)))
        (if (byteset.get ";#!" (local.get $c))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (block $headerDone
              (loop $header
                (br_if $headerDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $lhs (global.get $ptr))
                (local.set $c (i32.load8_u (local.get $lhs)))
                (br_if $headerDone (byteset.get "\n\r" (local.get $c)))
                (if (i32.eq (local.get $c) (i32.const "]"))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                    (br $headerDone)))
                (if (i32.eq (local.get $c) (i32.const 34))
                  (then
                    (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
                    (br $header)))
                (global.set $ptr (call $iniFind (i32.add (local.get $lhs) (i32.const 1)) (i32.const 3)))
                (call $emitTok (enum.get $Token.type) (local.get $lhs) (global.get $ptr))
                (br $header)))
            (local.set $line (i32.const 2))
            (br $next)))
        ;; Without `=` or `:`, a key ends at a blank, as in properties `key value`.
        (local.set $p (call $iniFind (local.get $lhs) (i32.const 1)))
        (local.set $c (call $templateByte (local.get $p)))
        (if (i32.and (i32.lt_u (local.get $p) (global.get $end)) (byteset.get "=:" (local.get $c)))
          (then
            (global.set $ptr (local.get $p))
            (local.set $p (call $iniTrim (local.get $lhs) (local.get $p)))
            (call $emitTok (enum.get $Token.property) (local.get $lhs) (local.get $p))
            (call $emitGap (local.get $p) (global.get $ptr))
            (local.set $lhs (global.get $ptr))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr)))
          (else
            (global.set $ptr (call $iniFind (i32.add (local.get $lhs) (i32.const 1)) (i32.const 2)))
            (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))))
        (local.set $line (i32.const 1))
        (br $next))))
)
