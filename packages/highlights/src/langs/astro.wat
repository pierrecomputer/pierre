(module
  (import "../common.wat")
  (import "./brace-markup.wat")

  ;; first CR or LF at or after $p, or $end - one SIMD compare per 16 bytes
  (func $astroLineEnd (param $p i32) (result i32)
    (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))

  (func $astroAfterLine (param $p i32) (result i32)
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

  ;; Front matter between standalone `---` lines, shared by astro, markdown,
  ;; and mdx. Only the document start opens it: in a stream every chunk
  ;; starts at $srcBase, so the first chunk is told apart by the reset flag.
  ;; Returns the offset after the opener's line break, or 0 when $ptr does
  ;; not open front matter.
  (func $frontMatterOpen (result i32)
    (if
      (i32.and
        (i32.and
          (i32.eq (global.get $ptr) (global.get $srcBase))
          (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset)))
        (i32.and
          (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
          (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffffff)) (i32.const "---"))))
      (then
        (if
          (i32.eq
            (call $astroLineEnd (global.get $ptr))
            (i32.add (global.get $ptr) (i32.const 3)))
          (then
            (return
              (call $astroAfterLine (i32.add (global.get $ptr) (i32.const 3))))))))
    (i32.const 0))

  ;; Start of the first line at or after $p that is exactly `---` (the front
  ;; matter closer), or $end when there is none.
  (func $frontMatterClose (param $p i32) (result i32)
    (local $lineEnd i32)
    (block $done
      (loop $front
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $lineEnd (call $astroLineEnd (local.get $p)))
        (if
          (i32.and
            (i32.eq (i32.sub (local.get $lineEnd) (local.get $p)) (i32.const 3))
            (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff)) (i32.const "---")))
          (then (return (local.get $p))))
        (local.set $p (call $astroAfterLine (local.get $lineEnd)))
        (br $front)))
    (global.get $end))

  ;; Emit the front-matter closer line at $close - when the scan found one
  ;; before $end - through its line break, and move $ptr past it.
  (func $frontMatterCloser (param $close i32)
    (local $after i32)
    (if (i32.lt_u (local.get $close) (global.get $end))
      (then
        (global.set $ptr (local.get $close))
        (local.set $after (call $astroAfterLine (call $astroLineEnd (local.get $close))))
        (call $emitTok
          (enum.get $Token.punctuation.special)
          (local.get $close)
          (local.get $after))
        (global.set $ptr (local.get $after)))))

  (func $astroTsxRange (param $from i32) (param $to i32)
    (local $save i32)
    ;; skip empty ranges, but still land $ptr at $to: the front-matter caller
    ;; relies on it when an unterminated `---` opener leaves body == close
    (if (i32.ge_u (local.get $from) (local.get $to))
      (then
        (global.set $ptr (local.get $to))
        (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlTsx)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $hlAstro
    (local $body i32)
    (local $close i32)
    (local $lineEnd i32)
    (call $lexEmitLeadingContinuation)
    ;; Astro's TypeScript front matter between standalone `---` lines.
    (local.set $body (call $frontMatterOpen))
    (if (local.get $body)
      (then
        (call $emitTok
          (enum.get $Token.punctuation.special)
          (global.get $ptr)
          (local.get $body))
        (local.set $close (call $frontMatterClose (local.get $body)))
        (if (i32.and (global.get $streaming) (i32.eq (local.get $close) (global.get $end)))
          (then
            (global.set $ptr (global.get $end))
            (call $streamSetRegion (i32.const 3))
            (global.set $ptr (local.get $body))
            (local.set $lineEnd (global.get $end))
            (global.set $end (local.get $close))
            (call $hlTsxStream (i32.const 1))
            (global.set $end (local.get $lineEnd))
            (global.set $ptr (local.get $close))
            (global.set $streamRegionStarted (i32.const 1)))
          (else (call $astroTsxRange (local.get $body) (local.get $close))))
        (call $frontMatterCloser (local.get $close))))

    (call $braceMarkup (i32.const 1)))
)
