(module
  (import "../common.wat")
  (import "./html.wat")

  ;; Svelte and Astro share this html lexing around `{...}` expressions.
  ;; $astro (0 or 1) selects the dialect: Svelte's html ranges checkpoint as
  ;; stream region 12 and its expressions as region 7; Astro's as 13 and 8.

  ;; lex [$from,$to) as html; a start tag cut by the chunk end is
  ;; checkpointed as region 12 + $astro so $braceStreamResumeTag continues it
  (func $braceHtmlRange (param $from i32) (param $to i32) (param $astro i32)
    (local $save i32)
    (if (i32.ge_u (local.get $from) (local.get $to))
      (then (return)))
    (local.set $save (global.get $end))
    (global.set $end (local.get $to))
    (global.set $ptr (local.get $from))
    (call $htmlLex (i32.add (i32.const 12) (local.get $astro)))
    (global.set $end (local.get $save))
    (global.set $ptr (local.get $to)))

  ;; 1 for `<script`, 2 for `<style`, 0 otherwise. $p sits on a proven `<`.
  (func $braceRawKind (param $p i32) (result i32)
    (local $kind i32)
    (local $q i32)
    (local.set $q (i32.add (local.get $p) (i32.const 1)))
    (if (i32.le_u (i32.add (local.get $q) (i32.const 6)) (global.get $end))
      (then
        (local.set $kind
          (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 6))))))
    (if (i32.eqz (local.get $kind))
      (then
        (if (i32.le_u (i32.add (local.get $q) (i32.const 5)) (global.get $end))
          (then
            (local.set $kind
              (call $rawTextKind (local.get $q) (i32.add (local.get $q) (i32.const 5))))))))
    (if (local.get $kind)
      (then
        (local.set $q
          (i32.add
            (local.get $q)
            (select (i32.const 6) (i32.const 5) (i32.eq (local.get $kind) (i32.const 1)))))
        (if
          (i32.and
            (i32.lt_u (local.get $q) (global.get $end))
            (i32.eqz
              (i32.or
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
  (func $braceNextCut (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindEither (local.get $p) (i32.const "{") (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eq (i32.load8_u (local.get $p)) (i32.const "{")))
        (br_if $done (call $braceRawKind (local.get $p)))
        (br_if $done
          (i32.and
            (i32.le_u (i32.add (local.get $p) (i32.const 4)) (global.get $end))
            (i32.eq (i32.load (local.get $p)) (i32.const "<!--"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (select (local.get $p) (global.get $end) (i32.lt_u (local.get $p) (global.get $end))))

  ;; Highlight the `{...}` at $from in one pass (see $hlTsxExpression).
  ;; Svelte emits the `{` itself and a block or directive marker word after
  ;; it (`#if`, `:else`, `/each`, `@html`) as a keyword, then lexes the body
  ;; as TSX in regexp-allowed position; its braces are punctuation.special.
  ;; Astro lexes the braces as TSX too, so they stay brackets. Returns 1 with
  ;; $ptr after the closing `}`, 0 when the body ran to $end; a body open at
  ;; a chunk end streams on as region 7 + $astro, keeping $tag.
  (func $braceExpression (param $from i32) (param $tag i32) (param $astro i32) (result i32)
    (local $c i32)
    (local $markerEnd i32)
    (local $p i32)
    (local.set $p (local.get $from))
    (if (i32.eqz (local.get $astro))
      (then
        (call $emitTok
          (enum.get $Token.punctuation.special)
          (local.get $from)
          (i32.add (local.get $from) (i32.const 1)))
        (local.set $p (i32.add (local.get $from) (i32.const 1)))
        (if (i32.lt_u (local.get $p) (global.get $end))
          (then
            (local.set $c (i32.load8_u (local.get $p)))
            (if
              (i32.or
                (i32.eq (local.get $c) (i32.const "#"))
                (i32.or
                  (i32.eq (local.get $c) (i32.const ":"))
                  (i32.or
                    (i32.eq (local.get $c) (i32.const "/"))
                    (i32.eq (local.get $c) (i32.const "@")))))
              (then
                (local.set $markerEnd (i32.add (local.get $p) (i32.const 1)))
                (block $markerDone
                  (loop $marker
                    (br_if $markerDone (i32.ge_u (local.get $markerEnd) (global.get $end)))
                    (br_if $markerDone
                      (i32.gt_u
                        (i32.sub
                          (i32.or (i32.load8_u (local.get $markerEnd)) (i32.const 32))
                          (i32.const "a"))
                        (i32.const 25)))
                    (local.set $markerEnd (i32.add (local.get $markerEnd) (i32.const 1)))
                    (br $marker)))
                (call $emitTok (enum.get $Token.keyword.control) (local.get $p) (local.get $markerEnd))
                (local.set $p (local.get $markerEnd))))))))
    (global.set $ptr (local.get $p))
    (if
      (call $hlTsxExpression
        (i32.const 1)
        (local.get $astro)
        (i32.add (i32.const 7) (local.get $astro))
        (local.get $tag))
      (then
        (call $emitTok
          (select
            (enum.get $Token.punctuation.bracket)
            (enum.get $Token.punctuation.special)
            (local.get $astro))
          (global.get $ptr)
          (i32.add (global.get $ptr) (i32.const 1)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (return (i32.const 1))))
    (i32.const 0))

  ;; Continue a start tag that a `{` cut interrupted, from $ptr: after an
  ;; expression (`class={x}`, `{...props}`, Svelte's `title="a {b} c"`), or,
  ;; in Astro, at a `{` inside a quoted value, which Astro keeps literal
  ;; (`href="/x/{id}"`). The attributes run to the next cut, and each `{`
  ;; there is another expression (Astro: unless quoted), until the tag
  ;; closes, a stray `<` or another cut abandons it, or the input ends. $tag
  ;; is the packed attribute state at the `{` (see $htmlOpenTag): the value
  ;; an expression gave is complete, and an open quote continues after it.
  (func $braceTagRest (param $tag i32) (param $astro i32)
    (local $quote i32)
    (local $r i32)
    (local $save i32)
    (block $done
      (loop $next
        (local.set $quote (i32.and (i32.shr_u (local.get $tag) (i32.const 8)) (i32.const 255)))
        (local.set $save (global.get $end))
        ;; an Astro quoted `{` is value text, so the next cut lies beyond it
        (global.set $end
          (call $braceNextCut
            (i32.add
              (global.get $ptr)
              (i32.and (local.get $astro) (i32.ne (local.get $quote) (i32.const 0))))))
        (global.set $htmlOpenTag (i32.const 0))
        (local.set $r
          (call $htmlAttrs
            (i32.const 0)
            (local.get $quote)
            (i32.shr_u (local.get $tag) (i32.const 16))
            (i32.add (i32.const 12) (local.get $astro))))
        (global.set $end (local.get $save))
        (call $htmlTagEnd (local.get $r))
        (local.set $tag (global.get $htmlOpenTag))
        (global.set $htmlOpenTag (i32.const 0))
        (br_if $done (i32.eqz (local.get $tag)))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.ne (i32.load8_u (global.get $ptr)) (i32.const "{")))
        (if
          (i32.eqz
            (i32.and (local.get $astro) (i32.ne (i32.and (local.get $tag) (i32.const 0xff00)) (i32.const 0))))
          (then
            (br_if $done
              (i32.eqz (call $braceExpression (global.get $ptr) (local.get $tag) (local.get $astro))))))
        (br $next))))

  ;; The `{` at $ptr: an expression - or, in Astro, value text inside a
  ;; quoted attribute value - and when it sits inside a start tag ($tag
  ;; nonzero) the rest of that tag.
  (func $braceBrace (param $tag i32) (param $astro i32)
    (if (i32.and (local.get $astro) (i32.ne (i32.and (local.get $tag) (i32.const 0xff00)) (i32.const 0)))
      (then
        (call $braceTagRest (local.get $tag) (local.get $astro))
        (return)))
    (if (call $braceExpression (global.get $ptr) (local.get $tag) (local.get $astro))
      (then
        (if (local.get $tag)
          (then (call $braceTagRest (local.get $tag) (local.get $astro)))))))

  ;; Lex from $ptr to $end: html ranges between cuts, each `{` an expression
  ;; (continuing the start tag it interrupted), and script/style elements
  ;; and comments scanned once, opaque to `{` even when their text contains
  ;; braces.
  (func $braceMarkup (param $astro i32)
    (local $from i32)
    (local $p i32)
    (local $tag i32)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $scan
        (local.set $p (call $braceNextCut (local.get $from)))
        (global.set $htmlOpenTag (i32.const 0))
        (call $braceHtmlRange (local.get $from) (local.get $p) (local.get $astro))
        (local.set $tag (global.get $htmlOpenTag))
        (global.set $htmlOpenTag (i32.const 0))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (i32.eq (i32.load8_u (local.get $p)) (i32.const "{"))
          (then
            (global.set $ptr (local.get $p))
            (call $braceBrace (local.get $tag) (local.get $astro))
            (local.set $from (global.get $ptr))
            (br $scan)))
        (global.set $ptr (local.get $p))
        (if (call $braceRawKind (local.get $p))
          (then (call $htmlTag (i32.add (i32.const 12) (local.get $astro))))
          (else (call $htmlComment (local.get $p))))
        (local.set $from (global.get $ptr))
        (br $scan)))
    (global.set $ptr (global.get $end)))

  ;; Resume stream region 12 + $astro: a start tag whose attributes continue
  ;; past the previous chunk end. Returns 1 when the region consumed the
  ;; whole chunk, 0 when the language lexer should continue from $ptr. An
  ;; ordinary tag stops where the html range would have been cut; a
  ;; script/style tag ($streamA set) never is. A `{` cut inside the tag
  ;; continues it as in the main loop.
  (func $braceStreamResumeTag (param $astro i32) (result i32)
    (local $r i32)
    (local $save i32)
    (local $tag i32)
    (local.set $save (global.get $end))
    (if (i32.eqz (global.get $streamA))
      (then (global.set $end (call $braceNextCut (global.get $ptr)))))
    (global.set $htmlOpenTag (i32.const 0))
    (local.set $r (call $htmlTagResume (i32.add (i32.const 12) (local.get $astro))))
    (global.set $end (local.get $save))
    (local.set $tag (global.get $htmlOpenTag))
    (global.set $htmlOpenTag (i32.const 0))
    (if
      (i32.and
        (i32.ne (local.get $tag) (i32.const 0))
        (i32.and
          (i32.lt_u (global.get $ptr) (global.get $end))
          (i32.eq (i32.load8_u (global.get $ptr)) (i32.const "{"))))
      (then
        (call $braceBrace (local.get $tag) (local.get $astro))
        (local.set $r (i32.ge_u (global.get $ptr) (global.get $end)))))
    (local.get $r))
)
