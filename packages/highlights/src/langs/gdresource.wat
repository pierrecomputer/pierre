(module
  (import "./gdscript.wat")

  (keyword-table $gdResourceWords $mem.gdresourceWords $mem.gleamWords
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null" "nil" "inf" "nan")
    (group $Token.function "ExtResource" "SubResource" "Resource")
    (group $Token.tag "gd_scene" "gd_resource" "ext_resource" "sub_resource" "node" "connection" "editable" "resource"))

  (func $hlGdresource
    (local $c i32)
    (local $n i32)
    (local $lhs i32)
    (local $p i32)
    (local $hl i32)
    (local $header i32)
    (local $quote i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $token
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (block $string
          (br_if $string (local.get $quote))
          (call $scanWhitespace)
          (call $emitGap (local.get $lhs) (global.get $ptr))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (local.set $lhs (global.get $ptr))
          (local.set $c (i32.load8_u (global.get $ptr)))
          (local.set $n
            (select (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
              (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
          (if (i32.eq (local.get $c) (i32.const ";"))
            (then
              (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
              (br $token)))
          (if (i32.and (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $n) (i32.const 34)))
            (then
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (local.set $c (local.get $n))))
          (if (i32.eq (local.get $c) (i32.const 34))
            (then
              (local.set $quote (local.get $c))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
              (br $string)))
          ;; TileSet keys such as `0:0/0/terrain = 1` must be checked before numbers.
          (if (call $lexIsDigit (local.get $c))
            (then
              (if (i32.eqz (call $lexLineByteBefore (local.get $lhs)))
                (then
                  (block $keyDone
                    (loop $key
                      (call $lexScanIdent)
                      (br_if $keyDone (i32.ge_u (global.get $ptr) (global.get $end)))
                      (local.set $p (i32.load8_u (global.get $ptr)))
                      (br_if $keyDone
                        (i32.and (i32.ne (local.get $p) (i32.const "/")) (i32.ne (local.get $p) (i32.const ":"))))
                      (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                      (br $key)))
                  (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                  (if
                    (i32.and (i32.lt_u (local.get $p) (global.get $end))
                      (i32.eq (i32.load8_u (local.get $p)) (i32.const "=")))
                    (then
                      (call $emitTok (enum.get $Token.property) (local.get $lhs) (global.get $ptr))
                      (local.set $header (i32.const 0))
                      (br $token)))
                  (global.set $ptr (local.get $lhs))))))
          (if
            (i32.or (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $n))))
            (then
              (call $lexScanNumber)
              (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
              (local.set $header (i32.const 0))
              (br $token)))
          (if (call $lexIsIdentStart (local.get $c))
            (then
              (call $lexScanIdent)
              (block $keyDone
                (loop $key
                  (br_if $keyDone (i32.ge_u (global.get $ptr) (global.get $end)))
                  (br_if $keyDone (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "/")))
                  (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                  (call $lexScanIdent)
                  (br $key)))
              (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
              (local.set $hl (keyword-table.value $gdResourceWords (local.get $lhs) (global.get $ptr)))
              (if (i32.and (i32.eq (local.get $hl) (enum.get $Token.tag)) (i32.eqz (local.get $header)))
                (then (local.set $hl (i32.const -1))))
              (if (i32.lt_s (local.get $hl) (i32.const 0))
                (then (local.set $hl (call $gdTypeHl (local.get $lhs) (global.get $ptr)))))
              (if (i32.lt_s (local.get $hl) (i32.const 0))
                (then
                  (local.set $hl
                    (select (enum.get $Token.type) (enum.get $Token.variable)
                      (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))))))
              (if
                (i32.and (i32.lt_u (local.get $p) (global.get $end))
                  (i32.eq (i32.load8_u (local.get $p)) (i32.const "=")))
                (then (local.set $hl (enum.get $Token.property))))
              (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
              (local.set $header (i32.const 0))
              (br $token)))
          ;; Brackets inside values must not open section headers.
          (local.set $header (i32.const 0))
          (if (i32.eq (local.get $c) (i32.const "["))
            (then (local.set $header (i32.eqz (call $lexLineByteBefore (local.get $lhs))))))
          (local.set $hl (enum.get $Token.operator))
          (if (byteset.get "()[]{}" (local.get $c))
            (then (local.set $hl (enum.get $Token.punctuation.bracket))))
          (if (byteset.get ",:." (local.get $c))
            (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
          (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
          (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
          (br $token))
        (if
          (i32.eq
            (call $pyStringBody (local.get $quote) (i32.const 0) (i32.const 0)
              (i32.const 0) (i32.const 1) (i32.const 6) (local.get $lhs) (i32.const 0))
            (i32.const 1))
          (then (local.set $quote (i32.const 0))))
        (local.set $header (i32.const 0))
        (br $token))))
)
