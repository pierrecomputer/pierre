(module
  (import "./dotenv.wat")

  ;; +256: `rewrite` takes a regex first.
  (keyword-table $nginxWords $mem.nginxWords $mem.logWords
    (group $Token.keyword.declaration
      "http" "server" "location" "upstream" "events" "stream" "mail" "types" "map" "geo"
      "split_clients" "limit_except")
    (group $Token.keyword.control "if" "return" "break")
    (group $Token.keyword.control+256 "rewrite")
    (group $Token.keyword.import "include"))

  ;; Digit runs with one dot and up to two unit letters (`512k`, `1h30m`).
  ;; `127.0.0.1` stays text.
  (func $nginxIsSize (param $lhs i32) (param $rhs i32) (result i32)
    (local $c i32)
    (local $dot i32)
    (local $units i32)
    (block $no
      (loop $scan
        (if (i32.ge_u (local.get $lhs) (local.get $rhs))
          (then (return (i32.const 1))))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $lhs (i32.add (local.get $lhs) (i32.const 1)))
        (if (call $lexIsDigit (local.get $c))
          (then
            (local.set $units (i32.const 0))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (br_if $no (i32.or (local.get $dot) (local.get $units)))
            (local.set $dot (i32.const 1))
            (br_if $scan
              (i32.and
                (i32.lt_u (local.get $lhs) (local.get $rhs))
                (call $lexIsDigit (i32.load8_u (local.get $lhs)))))
            (br $no)))
        (br_if $no (i32.gt_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25)))
        (local.set $units (i32.add (local.get $units) (i32.const 1)))
        (br_if $scan (i32.le_u (local.get $units) (i32.const 2)))))
    (i32.const 0))

  ;; $expect: 0 before a directive, 1 in arguments, 2 before a regex. $open: the
  ;; quote of a string still open at the chunk end.
  (func $hlNginx
    (local $c i32)
    (local $depth i32)
    (local $gap i32)
    (local $hl i32)
    (local $lhs i32)
    (local $p i32)
    (local $expect i32)
    (local $open i32)
    (call $lexEmitLeadingContinuation)
    (if (local.get $open)
      (then
        (if (call $envQuoted (local.get $open) (i32.const 1) (global.get $ptr))
          (then (local.set $open (i32.const 0))))))
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (global.set $ptr (local.get $lhs))
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ";"))
          (then
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (local.set $open
              (select
                (i32.const 0)
                (local.get $c)
                (call $envQuoted (local.get $c) (i32.const 1) (local.get $lhs))))
            (local.set $expect (i32.const 1))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (local.get $lhs))
            (call $envDollar (global.get $end) (enum.get $Token.none))
            (local.set $expect (i32.const 1))
            (br $next)))
        (if (i32.and (i32.eq (local.get $expect) (i32.const 2)) (i32.ne (local.get $c) (i32.const ")")))
          (then
            (local.set $depth (i32.const 0))
            (global.set $ptr (local.get $lhs))
            (block $regexDone
              (loop $regex
                (br_if $regexDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (local.set $c (i32.load8_u (global.get $ptr)))
                (br_if $regexDone
                  (i32.or
                    (i32.le_u (local.get $c) (i32.const 32))
                    (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c) (i32.const "{")))))
                (if (i32.eq (local.get $c) (i32.const ")"))
                  (then
                    (br_if $regexDone (i32.eqz (local.get $depth)))
                    (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "("))
                  (then (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
                (if
                  (i32.and
                    (i32.eq (local.get $c) (i32.const 92))
                    (i32.gt_u (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const 32)))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $regex)))
            (call $emitTok (enum.get $Token.string.regex) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.const 1))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
          (then
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (br $next)))
        ;; a `~` other than `^~` makes the next argument a regex
        (if
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const "!")))
            (i32.or
              (i32.eq (local.get $c) (i32.const "~"))
              (i32.and
                (i32.eq (local.get $c) (i32.const "^"))
                (i32.eq (call $templateByte (global.get $ptr)) (i32.const "~")))))
          (then
            (local.set $hl (i32.eq (local.get $c) (i32.const "~")))
            (block $opDone
              (loop $op
                (local.set $p (call $templateByte (global.get $ptr)))
                (br_if $opDone
                  (i32.eqz
                    (i32.or
                      (i32.or (i32.eq (local.get $p) (i32.const "=")) (i32.eq (local.get $p) (i32.const "!")))
                      (i32.or (i32.eq (local.get $p) (i32.const "~")) (i32.eq (local.get $p) (i32.const "*"))))))
                (if (i32.eq (local.get $p) (i32.const "~"))
                  (then (local.set $hl (i32.ne (local.get $c) (i32.const "^")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $expect (i32.add (local.get $hl) (i32.const 1)))
            (br $next)))
        (block $wordDone
          (loop $word
            (br_if $wordDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $p (i32.load8_u (global.get $ptr)))
            (br_if $wordDone (i32.le_u (local.get $p) (i32.const 32)))
            (br_if $wordDone (byteset.get "\22$'();{}" (local.get $p)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $word)))
        (if
          (i32.and
            (i32.eqz (local.get $expect))
            (i32.or
              (i32.eq (local.get $c) (i32.const "_"))
              (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))))
          (then
            (local.set $hl (keyword-table.value $nginxWords (local.get $lhs) (global.get $ptr)))
            (if (i32.lt_s (local.get $hl) (i32.const 0))
              (then (local.set $hl (enum.get $Token.keyword))))
            (call $emitTok (i32.and (local.get $hl) (i32.const 0xff)) (local.get $lhs) (global.get $ptr))
            (local.set $expect (select (i32.const 2) (i32.const 1) (i32.shr_u (local.get $hl) (i32.const 8))))
            (br $next)))
        (local.set $expect (i32.const 1))
        (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
        (local.set $hl (enum.get $Token.none))
        (if
          (i32.and (call $lexIsDigit (local.get $c)) (call $nginxIsSize (local.get $lhs) (global.get $ptr)))
          (then (local.set $hl (enum.get $Token.number))))
        (if
          (i32.or
            (i32.and
              (i32.eq (local.get $p) (i32.const 2))
              (i32.eq (i32.load16_u (local.get $lhs)) (i32.const "on")))
            (i32.and
              (i32.eq (local.get $p) (i32.const 3))
              (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "off"))))
          (then (local.set $hl (enum.get $Token.boolean))))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
