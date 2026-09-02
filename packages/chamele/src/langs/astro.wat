(module
  (import "../common.wat")
  (import "./html.wat")

  ;; first CR or LF at or after $p, or $end - one SIMD compare per 16 bytes
  (func $astroLineEnd (param $p i32) (result i32)
    (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))

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

  ;; lex [$from,$to) as html; a start tag cut by the chunk end is
  ;; checkpointed as region 13 so $astroStreamResumeTag continues it
  (func $astroHtmlRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $htmlLex (i32.const 13))
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

  ;; The next position at or after $p where the html range must stop: a `{`
  ;; expression, a `<!--` comment, or a `<script`/`<style` element (whose
  ;; body must stay opaque to `{`); $end when there is none. The main loop
  ;; and the tag resume share it so both cut html identically.
  (func $astroNextCut (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither
          (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))
        (br_if $done (call $astroRawKind (local.get $p)))
        (br_if $done (i32.and
          (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
          (i32.eq (i32.load (local.get $p)) (i32.const "<!--"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select (local.get $p) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $hlAstro
    (local $after i32)
    (local $body i32)
    (local $close i32)
    (local $from i32)
    (local $lineEnd i32)
    (local $p i32)
    (local $to i32)
    (call $lexEmitLeadingContinuation)
    ;; Astro's TypeScript front matter between standalone `---` lines. Only
    ;; the document start opens it: in a stream every chunk starts at
    ;; $srcBase, so the first chunk is told apart by the reset flag.
    (if (i32.and
          (i32.and
            (i32.eq (global.get $ptr) (global.get $srcBase))
            (i32.or (i32.eqz (global.get $streaming)) (global.get $streamReset)))
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
    (block $done
      (loop $scan
        (local.set $p (call $astroNextCut (local.get $from)))
        (call $astroHtmlRange (local.get $from) (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
          (then
            (local.set $to (call $tsxExpressionEnd (local.get $p) (local.get $p)))
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
            (br $scan)))
        ;; a script/style element is scanned once, opaque to `{`; comments
        ;; stay opaque even when their text contains braces
        (global.set $ptr (local.get $p))
        (if (call $astroRawKind (local.get $p))
          (then (call $htmlTag (i32.const 13)))
          (else (call $htmlComment (local.get $p))))
        (local.set $from (global.get $ptr))
        (br $scan)))
    (global.set $ptr (global.get $end)))

  ;; Resume stream region 13: a start tag whose attributes continue past
  ;; the previous chunk end. Returns 1 when the region consumed the whole
  ;; chunk, 0 when the language lexer should continue from $ptr. An
  ;; ordinary tag stops where the html range would have been cut; a
  ;; script/style tag ($streamA set) never is.
  (func $astroStreamResumeTag (result i32)
    (local $r i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (if (i32.eqz (global.get $streamA))
      (then (global.set $end (call $astroNextCut (global.get $ptr)))))
    (local.set $r (call $htmlTagResume (i32.const 13)))
    (global.set $end (local.get $save))
    (local.get $r))
)
