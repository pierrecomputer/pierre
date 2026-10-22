(module
  (import "./memory.wat")
  (import "./scan.wat")

  ;; The original EOF locates a pending label even in rebuilt inline content.
  (global $completeClosedLabelEnd (mut i32) (i32.const 0))

  ;; Complete the display copy of a streaming input. Fences and inline code
  ;; protect their contents; a bounded delimiter stack supplies only missing
  ;; closing markers. This does not alter the caller's original Markdown.
  (func (export "complete") (result i32)
    (local $p i32) (local $end i32) (local $stack i32) (local $depth i32)
    (local $c i32) (local $n i32) (local $q i32) (local $prev i32) (local $next i32)
    (local $fence i32) (local $fenceLen i32) (local $tick i32)
    (local $line i32) (local $indent i32) (local $open i32) (local $url i32)
    (local $image i32) (local $html i32) (local $canOpen i32) (local $canClose i32)
    (local $top i32) (local $remaining i32)
    (local.set $p (i32.const $mem.input))
    (local.set $line (local.get $p))
    (local.set $end (i32.add (local.get $p) (i32.load (i32.const 2))))
    (local.set $stack (i32.add (local.get $end) (i32.const 4096)))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $p) (local.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const 10))
          (then
            (if (i32.and (i32.eqz (local.get $fence))
                  (i32.ge_u (call $skipSpace (local.get $line) (local.get $p)) (local.get $p)))
              (then
                (local.set $depth (i32.const 0)) (local.set $open (i32.const 0))
                (local.set $url (i32.const 0)) (local.set $tick (i32.const 0))))
            (local.set $line (i32.add (local.get $p) (i32.const 1)))
            (local.set $html (i32.const 0))))
        (if (i32.and (i32.and (i32.eqz (local.get $fence)) (i32.eqz (local.get $tick))) (i32.eq (local.get $c) (i32.const "\5c")))
          (then (local.set $p (i32.add (local.get $p) (i32.const 2))) (br $scan)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $c) (i32.const "~")))
          (then
            (local.set $q (local.get $p))
            (block $runDone
              (loop $run
                (br_if $runDone (i32.ge_u (local.get $q) (local.get $end)))
                (br_if $runDone (i32.ne (i32.load8_u (local.get $q)) (local.get $c)))
                (local.set $q (i32.add (local.get $q) (i32.const 1))) (br $run)))
            (local.set $n (i32.sub (local.get $q) (local.get $p)))
            (local.set $indent (local.get $line))
            (block $indentDone
              (loop $spaces
                (br_if $indentDone (i32.ge_u (local.get $indent) (local.get $p)))
                ;; Quotes and list markers can precede a nested fence. This
                ;; conservative prefix scan protects their code from repair.
                (local.set $prev (i32.load8_u (local.get $indent)))
                (br_if $indentDone (i32.eqz (i32.or (call $isSpaceByte (local.get $prev))
                  (i32.or (call $isDigit (local.get $prev))
                    (i32.or (i32.eq (local.get $prev) (i32.const ">"))
                      (i32.or (i32.eq (local.get $prev) (i32.const "-"))
                        (i32.or (i32.eq (local.get $prev) (i32.const "+"))
                          (i32.or (i32.eq (local.get $prev) (i32.const "*"))
                            (i32.or (i32.eq (local.get $prev) (i32.const "."))
                              (i32.eq (local.get $prev) (i32.const ")")))))))))))
                (local.set $indent (i32.add (local.get $indent) (i32.const 1))) (br $spaces)))
            (if (i32.and (i32.eq (local.get $indent) (local.get $p))
                  (i32.ge_u (local.get $n) (i32.const 3)))
              (then
                (if (i32.eqz (local.get $fence))
                  (then
                    (local.set $fence (local.get $c)) (local.set $fenceLen (local.get $n))
                    (local.set $depth (i32.const 0)) (local.set $open (i32.const 0))
                    (local.set $url (i32.const 0)) (local.set $tick (i32.const 0)))
                  (else
                    (if (i32.and (i32.eq (local.get $fence) (local.get $c))
                          (i32.ge_u (local.get $n) (local.get $fenceLen)))
                      (then
                        (local.set $indent (call $skipSpace (local.get $q) (local.get $end)))
                        (if (i32.or (i32.eq (local.get $indent) (local.get $end))
                              (i32.eq (i32.load8_u (local.get $indent)) (i32.const 10)))
                          (then (local.set $fence (i32.const 0))))))))
                (local.set $p (local.get $q)) (br $scan)))
            (if (i32.eq (local.get $c) (i32.const "`"))
              (then
                (if (i32.eqz (local.get $fence))
                  (then
                    (if (i32.eqz (local.get $tick))
                      (then (local.set $tick (local.get $n)))
                      (else (if (i32.eq (local.get $tick) (local.get $n))
                        (then (local.set $tick (i32.const 0))))))))
                (local.set $p (local.get $q)) (br $scan)))))
        (if (i32.or (local.get $fence) (local.get $tick))
          (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $scan)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "<"))
              (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
          (then
            (local.set $next (i32.load8_u offset=1 (local.get $p)))
            (if (i32.or (call $isAlpha (local.get $next)) (i32.eq (local.get $next) (i32.const "/")))
              (then (local.set $html (local.get $p))))))
        (if (i32.eq (local.get $c) (i32.const ">")) (then (local.set $html (i32.const 0))))
        (if (i32.eq (local.get $c) (i32.const "["))
          (then
            (local.set $open (local.get $p))
            (local.set $url (i32.const 0))
            (local.set $image (i32.and (i32.gt_u (local.get $p) (i32.const $mem.input))
              (i32.eq (i32.load8_u (i32.sub (local.get $p) (i32.const 1))) (i32.const "!"))))))
        (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (i32.eq (local.get $c) (i32.const "]")))
          (then
            (if (i32.and (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (local.get $end))
                  (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const "(")))
              (then (local.set $url (i32.add (local.get $p) (i32.const 2))))
              (else
                ;; A delivery can stop between a label's `]` and its `(`.
                ;; Defer repair until inline analysis has ruled out references;
                ;; changing the input here could corrupt code or definition URLs.
                (if (i32.and (i32.eqz (local.get $image))
                      (i32.eq (i32.add (local.get $p) (i32.const 1)) (local.get $end)))
                  (then
                    (global.set $completeClosedLabelEnd (local.get $end))
                    ;; The host resets option flags before every render.
                    (i32.store8 (i32.const 1)
                      (i32.or (i32.load8_u (i32.const 1)) (i32.const 4)))))
                (local.set $open (i32.const 0))))))
        (if (i32.and (i32.ne (local.get $url) (i32.const 0)) (i32.eq (local.get $c) (i32.const ")")))
          (then (local.set $open (i32.const 0)) (local.set $url (i32.const 0))))
        (if (local.get $url)
          (then (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $scan)))
        (if (i32.or (i32.eq (local.get $c) (i32.const "*"))
              (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "~"))))
          (then
            (local.set $q (local.get $p))
            (block $marksDone
              (loop $marks
                (br_if $marksDone (i32.ge_u (local.get $q) (local.get $end)))
                (br_if $marksDone (i32.ne (i32.load8_u (local.get $q)) (local.get $c)))
                (local.set $q (i32.add (local.get $q) (i32.const 1))) (br $marks)))
            (local.set $n (i32.sub (local.get $q) (local.get $p)))
            (local.set $prev (if (result i32) (i32.gt_u (local.get $p) (i32.const $mem.input))
              (then (i32.load8_u (i32.sub (local.get $p) (i32.const 1)))) (else (i32.const 32))))
            (local.set $next (if (result i32) (i32.lt_u (local.get $q) (local.get $end))
              (then (i32.load8_u (local.get $q))) (else (i32.const 32))))
            (local.set $canOpen (i32.eqz (call $isWhiteByte (local.get $next))))
            (local.set $canClose (i32.and (i32.gt_u (local.get $p) (i32.const $mem.input))
              (i32.eqz (call $isWhiteByte (local.get $prev)))))
            ;; Intraword underscores and arithmetic asterisks stay literal.
            (if (i32.and (call $isAlnum (local.get $prev)) (call $isAlnum (local.get $next)))
              (then (local.set $canOpen (i32.const 0)) (local.set $canClose (i32.const 0))))
            (if (i32.and (local.get $canClose) (i32.gt_u (local.get $depth) (i32.const 0)))
              (then
                (local.set $top (i32.add (local.get $stack) (i32.mul (i32.sub (local.get $depth) (i32.const 1)) (i32.const 8))))
                (if (i32.eq (i32.load (local.get $top)) (local.get $c))
                  (then
                    (local.set $remaining (i32.load offset=4 (local.get $top)))
                    (if (i32.ge_u (local.get $n) (local.get $remaining))
                      (then (local.set $depth (i32.sub (local.get $depth) (i32.const 1))))
                      (else (i32.store offset=4 (local.get $top) (i32.sub (local.get $remaining) (local.get $n)))))
                    (local.set $p (local.get $q)) (br $scan)))))
            (if (i32.and (local.get $canOpen) (i32.and (i32.lt_u (local.get $depth) (i32.const 64)) (i32.le_u (local.get $n) (i32.const 3))))
              (then
                (local.set $top (i32.add (local.get $stack) (i32.mul (local.get $depth) (i32.const 8))))
                (i32.store (local.get $top) (local.get $c))
                (i32.store offset=4 (local.get $top) (local.get $n))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))))
            (local.set $p (local.get $q)) (br $scan)))
        (local.set $p (i32.add (local.get $p) (i32.const 1))) (br $scan)))
    (if (local.get $fence) (then (return (i32.sub (local.get $end) (i32.const $mem.input)))))
    (if (local.get $html) (then (local.set $end (local.get $html))))
    (if (i32.and (i32.ne (local.get $open) (i32.const 0)) (local.get $image))
      (then (return (i32.sub (i32.sub (local.get $open) (i32.const 1)) (i32.const $mem.input)))))
    (if (local.get $url) (then (local.set $end (local.get $url))))
    (if (i32.eqz (local.get $url))
      (then
        (if (i32.and (i32.ne (local.get $tick) (i32.const 0)) (i32.le_u (local.get $tick) (i32.const 255)))
          (then
            (memory.fill (local.get $end) (i32.const "`") (local.get $tick))
            (local.set $end (i32.add (local.get $end) (local.get $tick)))))
        (block $closed
          (loop $closeMarks
            (br_if $closed (i32.eqz (local.get $depth)))
            (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))
            (local.set $top (i32.add (local.get $stack) (i32.mul (local.get $depth) (i32.const 8))))
            (local.set $n (i32.load offset=4 (local.get $top)))
            (memory.fill (local.get $end) (i32.load (local.get $top)) (local.get $n))
            (local.set $end (i32.add (local.get $end) (local.get $n))) (br $closeMarks)))))
    (if (local.get $open)
      (then
        (if (i32.eqz (local.get $url))
          (then
            (i32.store16 (local.get $end) (i32.const "]("))
            (local.set $end (i32.add (local.get $end) (i32.const 2)))))
        ;; The React layer renders this sentinel as text, never as a URL.
        (i64.store (local.get $end) (i64.const "streamdo"))
        (i64.store offset=8 (local.get $end) (i64.const "wn:incom"))
        (i64.store offset=16 (local.get $end) (i64.const "plete-li"))
        (i32.store offset=24 (local.get $end) (i32.const "nk)"))
        (local.set $end (i32.add (local.get $end) (i32.const 27)))))
    (i32.sub (local.get $end) (i32.const $mem.input)))
)
