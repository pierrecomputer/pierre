(module
  (import "../common.wat")
  (import "./html.wat")

  ;; lex [$from,$to) as html; a start tag cut by the chunk end is
  ;; checkpointed as region 12 so $svelteStreamResumeTag continues it
  (func $svelteHtmlRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $htmlLex (i32.const 12))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $svelteTsxRange (param $from i32) (param $to i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to)) (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $hlTsx)
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  (func $svelteRawKind (param $p i32) (result i32)
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
  (func $svelteNextCut (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither
          (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))
        (br_if $done (call $svelteRawKind (local.get $p)))
        (br_if $done (i32.and
          (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
          (i32.eq (i32.load (local.get $p)) (i32.const "<!--"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select (local.get $p) (global.get $end)
      (i32.lt_u (local.get $p) (global.get $end))))

  (func $svelteExpressionEnd (param $from i32) (result i32)
    (local $c i32)
    (local $p i32)
    (local.set $p (i32.add (local.get $from) (i32.const 1)))
    (if (i32.ge_u (local.get $p) (global.get $end))
      (then (return (global.get $end))))
    (local.set $c (i32.load8_u (local.get $p)))
    ;; A closing block is Svelte syntax, not a JavaScript expression.
    (if (i32.eq (local.get $c) (i32.const "/"))
      (then
        (local.set $p (call $lexFindByte
          (i32.add (local.get $p) (i32.const 1)) (i32.const "}")))
        (return (select
          (i32.add (local.get $p) (i32.const 1)) (local.get $p)
          (i32.lt_u (local.get $p) (global.get $end))))))
    ;; Block/directive marker words are fixed ASCII keywords. The following
    ;; bytes are JavaScript and start in regexp-allowed position.
    (if (i32.or
          (i32.eq (local.get $c) (i32.const "#"))
          (i32.or (i32.eq (local.get $c) (i32.const ":"))
                  (i32.eq (local.get $c) (i32.const "@"))))
      (then
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (block $markerDone
          (loop $marker
            (br_if $markerDone (i32.ge_u (local.get $p) (global.get $end)))
            (br_if $markerDone (i32.gt_u
              (i32.sub
                (i32.or (i32.load8_u (local.get $p)) (i32.const 32))
                (i32.const "a"))
              (i32.const 25)))
            (local.set $p (i32.add (local.get $p) (i32.const 1)))
            (br $marker)))
        (return (call $tsxExpressionEnd (local.get $from) (local.get $p)))))
    (call $tsxExpressionEnd (local.get $from) (local.get $from)))

  (func $svelteExpression (param $from i32) (param $to i32)
    (local $c i32)
    (local $complete i32)
    (local $markerEnd i32)
    (local $p i32)
    (local.set $complete (i32.and
      (i32.gt_u (local.get $to) (local.get $from))
      (i32.eq (i32.load8_u (i32.sub (local.get $to) (i32.const 1))) (i32.const "}"))))
    (call $emitTok (enum.get $Token.punctuation.special)
      (local.get $from) (i32.add (local.get $from) (i32.const 1)))
    (local.set $p (i32.add (local.get $from) (i32.const 1)))
    (if (i32.lt_u (local.get $p) (local.get $to))
      (then
        (local.set $c (i32.load8_u (local.get $p)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const "#"))
              (i32.or
                (i32.eq (local.get $c) (i32.const ":"))
                (i32.or (i32.eq (local.get $c) (i32.const "/"))
                        (i32.eq (local.get $c) (i32.const "@")))))
          (then
            (local.set $markerEnd (i32.add (local.get $p) (i32.const 1)))
            (block $markerDone
              (loop $marker
                (br_if $markerDone (i32.ge_u (local.get $markerEnd) (local.get $to)))
                (br_if $markerDone (i32.gt_u
                  (i32.sub
                    (i32.or (i32.load8_u (local.get $markerEnd)) (i32.const 32))
                    (i32.const "a"))
                  (i32.const 25)))
                (local.set $markerEnd (i32.add (local.get $markerEnd) (i32.const 1)))
                (br $marker)))
            (call $emitTok (enum.get $Token.keyword.control)
              (local.get $p) (local.get $markerEnd))
            (local.set $p (local.get $markerEnd))))))
    (if (i32.and (global.get $streaming) (i32.eqz (local.get $complete)))
      (then
        (global.set $ptr (global.get $end))
        (call $streamSetRegion (i32.const 7))
        (global.set $ptr (local.get $p))
        (drop (call $hlTsxExpressionStream (i32.const 1) (i32.const 1)))
        (global.set $ptr (global.get $end))
        (global.set $streamRegionStarted (i32.const 1)))
      (else
        (call $svelteTsxRange
          (local.get $p)
          (select
            (i32.sub (local.get $to) (i32.const 1))
            (local.get $to)
            (local.get $complete)))))
    (if (local.get $complete)
      (then
        (call $emitTok (enum.get $Token.punctuation.special)
          (i32.sub (local.get $to) (i32.const 1)) (local.get $to))))
    (global.set $ptr (local.get $to)))

  (func $hlSvelte
    (local $from i32)
    (local $p i32)
    (local $to i32)
    (call $lexEmitLeadingContinuation)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $svelteNextCut (local.get $from)))
        (call $svelteHtmlRange (local.get $from) (local.get $p))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
          (then
            (local.set $to (call $svelteExpressionEnd (local.get $p)))
            (call $svelteExpression (local.get $p) (local.get $to))
            (local.set $from (local.get $to))
            (br $scan)))
        ;; a script/style element is scanned once, opaque to `{`; comments
        ;; stay opaque even when their text contains braces
        (global.set $ptr (local.get $p))
        (if (call $svelteRawKind (local.get $p))
          (then (call $htmlTag (i32.const 12)))
          (else (call $htmlComment (local.get $p))))
        (local.set $from (global.get $ptr))
        (br $scan)))
    (global.set $ptr (global.get $end)))

  ;; Resume stream region 12: a start tag whose attributes continue past
  ;; the previous chunk end. Returns 1 when the region consumed the whole
  ;; chunk, 0 when the language lexer should continue from $ptr. An
  ;; ordinary tag stops where the html range would have been cut; a
  ;; script/style tag ($streamA set) never is.
  (func $svelteStreamResumeTag (result i32)
    (local $r i32)
    (local $save i32)
    (local.set $save (global.get $end))
    (if (i32.eqz (global.get $streamA))
      (then (global.set $end (call $svelteNextCut (global.get $ptr)))))
    (local.set $r (call $htmlTagResume (i32.const 12)))
    (global.set $end (local.get $save))
    (local.get $r))
)
