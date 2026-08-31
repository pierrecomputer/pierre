(module
  (import "../common.wat")
  (import "./html.wat")

  (func $astroLineEnd (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.or
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 10))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  (func $astroAfterLine (param $p i32) (result i32)
    (if (i32.lt_u (local.get $p) (global.get $end))
      (then
        (if (i32.and
              (i32.eq (i32.load8_u (local.get $p)) (i32.const 13))
              (i32.and
                (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load8_u offset=1 (local.get $p)) (i32.const 10))))
          (then (return (i32.add (local.get $p) (i32.const 2)))))
        (return (i32.add (local.get $p) (i32.const 1)))))
    (local.get $p))

  (func $astroHtmlRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlHtml)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

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

  ;; 1 for `<script`, 2 for `<style`, 0 otherwise. $p sits on a proven `<`.
  (func $astroRawKind (param $p i32) (result i32)
    (local $kind i32)
    (local $q i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.le_u (i32.add (local.get $q) (i32.const 6)) (global.get $end))
      (then (local.set $kind (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 6))))))
    (if (i32.eqz (local.get $kind))
      (then
        (if (i32.le_u (i32.add (local.get $q) (i32.const 5)) (global.get $end))
          (then (local.set $kind (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 5))))))))
    (if (local.get $kind)
      (then
        (local.set $q (i32.add (local.get $q)
          (select (i32.const 6) (i32.const 5) (i32.eq (local.get $kind) (i32.const 1)))))
        (if (i32.and
              (i32.lt_u (local.get $q) (global.get $end))
              (i32.eqz (i32.or
                (call $lexIsSpace (i32.load8_u (local.get $q)))
                (i32.or
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const ">"))
                  (i32.eq (i32.load8_u (local.get $q)) (i32.const "/"))))))
          (then (return (i32.const 0))))))
    (local.get $kind))

  ;; End after the matching raw-text close tag, or $end if unterminated.
  (func $astroRawEnd (param $p i32) (param $kind i32) (result i32)
    (local $c i32)
    (local $quote i32)
    ;; First leave the opening tag, respecting quoted `>` bytes.
    (block $openDone
      (loop $open
        (br_if $openDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (local.get $quote)
          (then
            (if (i32.eq (local.get $c) (local.get $quote))
              (then (local.set $quote (i32.const 0)))))
          (else
            (if (i32.or (i32.eq (local.get $c) (i32.const 34))
                        (i32.eq (local.get $c) (i32.const 39)))
              (then (local.set $quote (local.get $c)))
              (else
                (if (i32.eq (local.get $c) (i32.const ">"))
                  (then
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $openDone)))))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $open)))
    (block $done
      (loop $body
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $isRawTextClose (local.get $p) (local.get $kind))
          (then
            (block $tagDone
              (loop $tag
                (br_if $tagDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $c (i32.load8_u (local.get $p)))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br_if $tagDone (i32.eq (local.get $c) (i32.const ">")))
                (br $tag)))
            (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $body)))
    (global.get $end))

  (func $hlAstro
    (local $after i32)
    (local $body i32)
    (local $c i32)
    (local $close i32)
    (local $from i32)
    (local $kind i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $to i32)
    (call $lexEmitLeadingContinuation)
    ;; Astro's TypeScript front matter between standalone `---` lines.
    (if (i32.and
          (i32.eq (global.get $ptr) (i32.const 65536))
          (i32.and
            (i32.le_u (i32.add (global.get $ptr) (i32.const 3)) (global.get $end))
            (i32.eq (i32.and (i32.load (global.get $ptr)) (i32.const 0xffffff))
                    (i32.const "---"))))
      (then
        (local.set $lineEnd (call $astroLineEnd (global.get $ptr)))
        (if (i32.eq (local.get $lineEnd) (i32.add (global.get $ptr) (i32.const 3)))
          (then
            (local.set $after (call $astroAfterLine (local.get $lineEnd)))
            (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $after))
            (local.set $body (local.get $after))
            (local.set $p (local.get $body))
            (local.set $close (global.get $end))
            (block $frontDone
              (loop $front
                (br_if $frontDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $lineEnd (call $astroLineEnd (local.get $p)))
                (if (i32.and
                      (i32.eq (i32.sub (local.get $lineEnd) (local.get $p)) (i32.const 3))
                      (i32.eq (i32.and (i32.load (local.get $p)) (i32.const 0xffffff))
                              (i32.const "---")))
                  (then (local.set $close (local.get $p)) (br $frontDone)))
                (local.set $p (call $astroAfterLine (local.get $lineEnd)))
                (br $front)))
            (if (i32.and
                  (global.get $streaming)
                  (i32.eq (local.get $close) (global.get $end)))
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
            (if (i32.lt_u (local.get $close) (global.get $end))
              (then
                (global.set $ptr (local.get $close))
                (local.set $after (call $astroAfterLine (call $astroLineEnd (global.get $ptr))))
                (call $emitTok (enum.get $Token.punctuation.special) (global.get $ptr) (local.get $after))
                (global.set $ptr (local.get $after))))))))

    (local.set $from (global.get $ptr))
    (local.set $p (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither
          (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.eq (local.get $c) (i32.const "<"))
          (then
            (local.set $kind (call $astroRawKind (local.get $p)))
            (if (local.get $kind)
              (then
                (local.set $to (call $astroRawEnd (local.get $p) (local.get $kind)))
                (call $astroHtmlRange (local.get $from) (local.get $p))
                (call $astroHtmlRange (local.get $p) (local.get $to))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))
            ;; Keep HTML comments opaque even when their text contains braces.
            (if (i32.and
                  (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
                  (i32.eq (i32.load (local.get $p)) (i32.const "<!--")))
              (then
                (call $astroHtmlRange (local.get $from) (local.get $p))
                (global.set $ptr (local.get $p))
                (call $htmlComment (local.get $p))
                (local.set $to (global.get $ptr))
                (local.set $from (local.get $to))
                (local.set $p (local.get $to))
                (br $scan)))))
        (if (i32.eq (local.get $c) (i32.const "{"))
          (then
            (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
            (call $astroHtmlRange (local.get $from) (local.get $p))
            (if (i32.and
                  (global.get $streaming)
                  (i32.and
                    (i32.eq (local.get $to) (global.get $end))
                    (i32.or
                      (i32.eq (local.get $to) (local.get $p))
                      (i32.ne
                        (i32.load8_u (i32.sub (local.get $to) (i32.const 1)))
                        (i32.const "}")))))
              (then
                (call $emitTok
                  (enum.get $Token.punctuation.bracket)
                  (local.get $p) (i32.add (local.get $p) (i32.const 1)))
                (global.set $ptr (global.get $end))
                (call $streamSetRegion (i32.const 8))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (drop (call $hlTsxExpressionStream
                  (i32.const 1) (i32.const 1)))
                (global.set $ptr (global.get $end))
                (global.set $streamRegionStarted (i32.const 1)))
              (else (call $astroTsxRange (local.get $p) (local.get $to))))
            (local.set $from (local.get $to))
            (local.set $p (local.get $to))
            (br $scan)))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $astroHtmlRange (local.get $from) (global.get $end))
    (global.set $ptr (global.get $end)))
)
