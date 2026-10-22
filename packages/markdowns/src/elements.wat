(module
  (import "./out.wat")
  (import "./scan.wat")
  (import "./htmlscan.wat")

  ;; React consumes a flat tape of 20-byte records, never raw HTML. Only the
  ;; renderer's generated markup reaches this scanner: renderToElements sets
  ;; the skip-HTML flag before rendering. Source ranges point into that HTML,
  ;; below the tape, and remain stable when ensureOut grows scratch memory.
  ;; Kinds: 1=open, 2=close, 3=attribute, 4=text, 5=end of opening tag.
  (func $elementEvent (param $kind i32) (param $p i32) (param $e i32)
      (param $v i32) (param $ve i32)
    (call $ensureOut (i32.const 20))
    (i32.store (global.get $out) (local.get $kind))
    (i32.store offset=4 (global.get $out) (local.get $p))
    (i32.store offset=8 (global.get $out) (local.get $e))
    (i32.store offset=12 (global.get $out) (local.get $v))
    (i32.store offset=16 (global.get $out) (local.get $ve))
    (global.set $out (i32.add (global.get $out) (i32.const 20))))

  (func (export "elements")
    (local $p i32) (local $e i32) (local $start i32) (local $q i32)
    (local $name i32) (local $nameEnd i32) (local $value i32)
    (local $valueEnd i32) (local $close i32) (local $c i32)
    (local.set $p (global.get $outBase))
    (local.set $e (global.get $out))
    (local.set $start (global.get $out))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $e)))
        (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "<"))
          (then
            (local.set $q (call $findByte (local.get $p) (local.get $e) (i32.const "<")))
            (call $elementEvent (i32.const 4) (local.get $p) (local.get $q) (i32.const 0) (i32.const 0))
            (local.set $p (local.get $q))
            (br $scan)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (local.set $close (i32.eq (i32.load8_u (local.get $p)) (i32.const "/")))
        (if (local.get $close) (then (local.set $p (i32.add (local.get $p) (i32.const 1)))))
        (local.set $q (i32.add (local.get $p) (call $scanTagName (local.get $p) (local.get $e))))
        (call $elementEvent (if (result i32) (local.get $close) (then (i32.const 2)) (else (i32.const 1)))
          (local.get $p) (local.get $q) (i32.const 0) (i32.const 0))
        (local.set $p (local.get $q))
        (block $tagDone
          (loop $attributes
            (br_if $tagDone (i32.ge_u (local.get $p) (local.get $e)))
            (local.set $c (i32.load8_u (local.get $p)))
            (if (i32.eq (local.get $c) (i32.const ">"))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $tagDone)))
            (if (i32.or (call $isWhiteByte (local.get $c)) (i32.eq (local.get $c) (i32.const "/")))
              (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $attributes)))
            (local.set $name (local.get $p))
            (block $nameDone
              (loop $attrName
                (br_if $nameDone (i32.ge_u (local.get $p) (local.get $e)))
                (local.set $c (i32.load8_u (local.get $p)))
                (br_if $nameDone (i32.or (call $isWhiteByte (local.get $c))
                  (i32.or (i32.eq (local.get $c) (i32.const "=")) (i32.eq (local.get $c) (i32.const ">")))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $attrName)))
            (local.set $nameEnd (local.get $p))
            (local.set $value (local.get $p))
            (local.set $valueEnd (local.get $p))
            (if (i32.eq (local.get $c) (i32.const "="))
              (then
                ;; Generated attributes always use double quotes, and quotes
                ;; in their values are entity-escaped by the HTML backend.
                (local.set $value (i32.add (local.get $p) (i32.const 2)))
                (local.set $valueEnd (call $findByte (local.get $value) (local.get $e) (i32.const "\22")))
                (local.set $p (i32.add (local.get $valueEnd) (i32.const 1)))))
            (call $elementEvent (i32.const 3) (local.get $name) (local.get $nameEnd)
              (local.get $value) (local.get $valueEnd))
            (br $attributes)))
        (if (i32.eqz (local.get $close))
          (then (call $elementEvent (i32.const 5) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
        (br $scan)))
    (i32.store (i32.const 6) (local.get $start))
    (i32.store (i32.const 10) (i32.sub (global.get $out) (local.get $start))))
)
