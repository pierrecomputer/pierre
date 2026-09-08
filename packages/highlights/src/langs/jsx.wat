(module
  ;; JSX mode stack and markup scanner shared by JSX and TSX.
  ;; jsx mode stack entries
  ;; mode 1 = TAG (inside an open tag, scanning attributes; a TSRX raw-text
  ;;          element keeps its kind in the target field until the `>`)
  ;; mode 2 = CONTENT (between > and </, scanning children)
  ;; mode 3 = CONTAINER ({expr}: the token pipeline runs until braceDepth
  ;;          returns to the recorded target)
  ;; TSRX only (langs/tsrx.wat):
  ;; mode 4 = DIRECTIVE (`@if (x) { ... }` from CONTENT: the token pipeline
  ;;          runs until the `}` that returns braceDepth to the target, or
  ;;          until a bare element body ends)
  ;; mode 5 = SCRIPT (a `<script>` body: the token pipeline runs until the
  ;;          scanner reports `</script`)
  ;; mode 6 = STYLE (a `<style>` body: CSS bytes; the target field holds the
  ;;          CSS lexer's resumable state)
  ;; mode 7 = CLOSE TAIL (`</{expr}>` after its container closed)
  ;; like $brkPush, pushes past the 512-entry capacity are dropped but still
  ;; COUNTED, so every pop matches its push and the stored entries are correct
  ;; again once the depth returns below capacity; top accesses clamp to the
  ;; deepest stored entry meanwhile
  (func $jsxPush (param $mode i32) (param $target i32)
    (if (i32.lt_u (global.get $jsxSp) (i32.const 512))
      (then
        (i32.store (i32.add (i32.const $mem.jsxStack) (i32.shl (global.get $jsxSp) (i32.const 3)))
          (local.get $mode))
        (i32.store offset=4 (i32.add (i32.const $mem.jsxStack) (i32.shl (global.get $jsxSp) (i32.const 3)))
          (local.get $target))))
    (global.set $jsxSp (i32.add (global.get $jsxSp) (i32.const 1))))
  ;; address of the top entry, clamped to the last stored one ($jsxSp > 0)
  (func $jsxTopSlot (result i32)
    (local $i i32)
    (local.set $i (i32.sub (global.get $jsxSp) (i32.const 1)))
    (if (i32.gt_u (local.get $i) (i32.const 511))
      (then (local.set $i (i32.const 511))))
    (i32.add (i32.const $mem.jsxStack) (i32.shl (local.get $i) (i32.const 3))))
  (func $jsxTopMode (result i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return (i32.const 0))))
    (i32.load (call $jsxTopSlot)))
  (func $jsxTopTarget (result i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return (i32.const 0))))
    (i32.load offset=4 (call $jsxTopSlot)))
  (func $jsxSetTopMode (param $mode i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return)))
    (i32.store (call $jsxTopSlot) (local.get $mode)))
  (func $jsxSetTopTarget (param $target i32)
    (if (i32.eqz (global.get $jsxSp)) (then (return)))
    (i32.store offset=4 (call $jsxTopSlot) (local.get $target)))
  ;; modes that scan bytes rather than tokens: TAG, CONTENT, STYLE, CLOSE TAIL
  (func $jsxByteMode (param $mode i32) (result i32)
    (i32.or
      (i32.le_u (i32.sub (local.get $mode) (i32.const 1)) (i32.const 1))
      (i32.ge_u (local.get $mode) (i32.const 6))))
  ;; pop one element. Whatever completed - an element or a container - is an
  ;; ended expression, so the following tokens must see it as one (identifier):
  ;; also INSIDE a container, or `{<b/> / 2}` would read the `/` as a regexp
  (func $jsxPop
    (if (global.get $jsxSp)
      (then (global.set $jsxSp (i32.sub (global.get $jsxSp) (i32.const 1)))))
    (global.set $prevTok (enum.get $Lex.identifier))
    (global.set $lto (enum.get $Lex.identifier))
    ;; TSRX: an element in statement position ends its statement, so the
    ;; pipeline sees a statement start after it and a `<tag` sibling opens
    ;; the next element; the scanner keeps the ended-expression view for
    ;; `/`. A directive whose body was that bare element ends with it
    (if (call $ecmaHasTsrx)
      (then
        (global.set $prevTok (enum.get $Lex.eof))
        (if (i32.and (i32.eq (call $jsxTopMode) (i32.const 4))
                     (i32.eq (global.get $braceDepth) (call $jsxTopTarget)))
          (then (global.set $jsxSp (i32.sub (global.get $jsxSp) (i32.const 1))))))))

  ;; ---- JSX ----

  ;; [A-Za-z_$]
  (func $jsxNameStart (param $c i32) (result i32)
    (i32.or
      (i32.le_u (i32.sub (i32.or (local.get $c) (i32.const 32)) (i32.const "a")) (i32.const 25))
      (i32.or (i32.eq (local.get $c) (i32.const "_")) (i32.eq (local.get $c) (i32.const "$")))))

  ;; tag-name continue: [A-Za-z0-9_$.:-]
  (func $jsxNameCont (param $c i32) (result i32)
    (i32.or
      (i32.or
        (call $jsxNameStart (local.get $c))
        (i32.le_u (i32.sub (local.get $c) (i32.const "0")) (i32.const 9)))
      (i32.or
        (i32.eq (local.get $c) (i32.const "."))
        (i32.or (i32.eq (local.get $c) (i32.const ":"))
                (i32.eq (local.get $c) (i32.const "-"))))))

  ;; does the byte shape after the `<` at $p look like a JSX tag? pure
  ;; lookahead, consumes nothing. `<>`, or a name followed by `>`/`/`/`{`/
  ;; quote/another name - anything else bails to a comparison operator.
  (func $jsxValidate (param $p i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const ">")) (then (return (i32.const 1))))
    ;; TSRX dynamic tag `<{expr}`
    (if (i32.and (call $ecmaHasTsrx) (i32.eq (local.get $c) (i32.const "{")))
      (then (return (i32.const 1))))
    (if (i32.eqz (call $jsxNameStart (local.get $c))) (then (return (i32.const 0))))
    ;; the tag name
    (block $nameDone
      (loop $name
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br_if $nameDone (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $name (call $jsxNameCont (i32.load8_u (local.get $p))))))
    ;; whitespace
    (block $wsDone
      (loop $ws
        (br_if $wsDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $wsDone (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $ws)))
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 1))))
    (local.set $c (i32.load8_u (local.get $p)))
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const ">"))
                (i32.eq (local.get $c) (i32.const "/")))
        (i32.or (i32.eq (local.get $c) (i32.const "{"))
                (call $jsxNameStart (local.get $c))))
      (i32.or (i32.eq (local.get $c) (i32.const 34))
              (i32.eq (local.get $c) (i32.const 39)))))

  ;; scan + emit the tag name at $ptr: lowercase simple names are `tag.jsx`,
  ;; Capitalized or dotted names are `tag.component.jsx` - Zed's tsx captures.
  ;; empty names - fragments - emit nothing. Returns the TSRX raw-text kind
  ;; of the name - 1 script, 2 style - else 0
  (func $jsxEmitName (result i32)
    (local $from i32)
    (local $c i32)
    (local $dotted i32)
    (local $kind i32)
    (local.set $from (global.get $ptr))
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $done (i32.eqz (call $jsxNameCont (local.get $c))))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then (local.set $dotted (i32.const 1))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l)))
    (if (i32.gt_u (global.get $ptr) (local.get $from))
      (then
        (call $emitTok
          (select (enum.get $Token.tag.component.jsx) (enum.get $Token.tag.jsx)
            (i32.or (local.get $dotted)
              (i32.le_u (i32.sub (i32.load8_u (local.get $from)) (i32.const "A")) (i32.const 25))))
          (local.get $from) (global.get $ptr))
        (if (call $ecmaHasTsrx)
          (then (local.set $kind (call $tsrxRawKind (local.get $from) (global.get $ptr)))))))
    (local.get $kind))

  ;; a `{` at $ptr opens an expression container: pull the l_brace through the
  ;; tokenizer so brace/template bookkeeping stays consistent, then let the
  ;; token pipeline run until braceDepth returns to the recorded target
  (func $jsxOpenContainer
    (drop (call $nextToken))
    ;; a TSRX `@{` statement container - the two-byte l_brace - splits into
    ;; its directive `@` and an ordinary `{`
    (if (i32.eq (i32.sub (global.get $rhs) (global.get $lhs)) (i32.const 2))
      (then (call $tsrxEmitContainerOpen (global.get $lhs) (global.get $rhs)))
      (else
        (call $emitTok (enum.get $Token.punctuation.bracket)
          (global.get $lhs) (global.get $rhs))))
    (call $jsxPush (i32.const 3) (i32.sub (global.get $braceDepth) (i32.const 1)))
    (global.set $prevTok (enum.get $Lex.l_brace)))

  ;; one step inside an open tag: whitespace, then one attribute piece or the
  ;; tag end. always advances $ptr or changes mode.
  (func $jsxTagStep
    (local $from i32)
    (local $c i32)
    (local $q i32)
    (local.set $from (global.get $ptr))
    (block $wsDone
      (loop $ws
        (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $wsDone (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $ws)))
    (call $emitGap (local.get $from) (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end)) (then (return)))
    (local.set $from (global.get $ptr))
    ;; `>` - the tag opens: children follow. A TSRX raw-text element - the
    ;; open tag recorded its kind in the entry's target field - takes the
    ;; style body mode with a fresh CSS state, or the script body mode with
    ;; the token pipeline at a statement start
    (if (i32.eq (local.get $c) (i32.const ">"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $from) (global.get $ptr))
        (local.set $q (call $jsxTopTarget))
        (call $jsxSetTopMode (i32.const 2))
        (if (i32.eq (local.get $q) (i32.const 2))
          (then
            (call $jsxSetTopMode (i32.const 6))
            (call $jsxSetTopTarget (i32.const 260))))
        (if (i32.eq (local.get $q) (i32.const 1))
          (then
            (call $jsxSetTopMode (i32.const 5))
            (call $jsxSetTopTarget (i32.const 0))
            (global.set $prevTok (enum.get $Lex.eof))
            (global.set $lto (enum.get $Lex.eof))))
        (return)))
    ;; `/>` - self-closing
    (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                 (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $from) (global.get $ptr))
        (call $jsxPop)
        (return)))
    ;; `{` - spread attribute or expression value
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (call $jsxOpenContainer)
        (return)))
    ;; quoted attribute value (may span lines; no escapes in JSX strings)
    (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
      (then
        (local.set $q (local.get $c))
        (global.set $ptr (call $scanFind3
          (i32.add (global.get $ptr) (i32.const 1))
          (local.get $q) (local.get $q) (local.get $q)))
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))
          (else
            (if (global.get $tsxStreaming)
              (then
                (global.set $tsxStreamMode
                  (select (i32.const 6) (i32.const 7) (i32.eq (local.get $q) (i32.const 34))))))))
        (call $emitTok (enum.get $Token.string) (local.get $from) (global.get $ptr))
        (return)))
    ;; `=` between an attribute name and its value
    (if (i32.eq (local.get $c) (i32.const "="))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.delimiter.jsx) (local.get $from) (global.get $ptr))
        (return)))
    ;; attribute name
    (if (call $jsxNameStart (local.get $c))
      (then
        (block $nDone
          (loop $n
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br_if $nDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (br_if $n (call $jsxNameCont (i32.load8_u (global.get $ptr))))))
        (call $emitTok (enum.get $Token.attribute.jsx) (local.get $from) (global.get $ptr))
        (return)))
    ;; anything else: one lenient plain byte
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.none) (local.get $from) (global.get $ptr)))

  ;; the lenient tail of a close tag after its name: whitespace, then `>`;
  ;; stray bytes stay plain and a `<` stops early. Returns 1 once the tag
  ;; ended, 0 at the input end; the caller pops the element
  (func $jsxCloseTagTail (result i32)
    (local $seg i32)
    (local $c i32)
    (block $tDone
      (loop $t
        (local.set $seg (global.get $ptr))
        (block $wsDone
          (loop $ws
            (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $wsDone (i32.eqz (i32.or
              (i32.eq (local.get $c) (i32.const 32))
              (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $ws)))
        (call $emitGap (local.get $seg) (global.get $ptr))
        (if (i32.ge_u (global.get $ptr) (global.get $end))
          (then (return (i32.const 0))))
        (local.set $seg (global.get $ptr))
        (if (i32.eq (local.get $c) (i32.const ">"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $seg) (global.get $ptr))
            (br $tDone)))
        ;; a `<` here starts something new: stop the close tag leniently
        (br_if $tDone (i32.eq (local.get $c) (i32.const "<")))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $seg) (global.get $ptr))
        (br $t)))
    (i32.const 1))

  ;; one step in a TSRX dynamic close tag `</{expr}>` after its container
  ;; closed (mode 7): the tail, then the element pops
  (func $jsxCloseTailStep
    (if (call $jsxCloseTagTail) (then (call $jsxPop))))

  ;; one step between `>` and the closing tag: a text run, then one structural
  ;; item - a child tag, a close tag, a `{...}` container, or a stray byte.
  ;; TSRX text also stops at `@{` containers, `@if`-style directive heads, a
  ;; bare `finally {` clause head, and JavaScript comments: `/* */` anywhere,
  ;; `//` where only blanks precede it since the run start or the line start
  (func $jsxContentStep
    (local $seg i32)
    (local $bound i32)
    (local $act i32)
    (local $c i32)
    (local $c2 i32)
    (local $p i32)
    (local $tsrx i32)
    (local.set $tsrx (call $ecmaHasTsrx))
    (local.set $seg (global.get $ptr))
    (local.set $bound (global.get $ptr))
    ;; TSRX: `finally {` as the first word of the run heads a try clause; the
    ;; blanks before it are text, as they are when the run holds no clause
    (if (local.get $tsrx)
      (then
        (local.set $p (call $tsrxFinallyAhead (global.get $ptr)))
        (if (local.get $p)
          (then
            (call $emitTok (enum.get $Token.text.jsx) (global.get $ptr) (local.get $p))
            (global.set $ptr (local.get $p))
            (call $jsxPush (i32.const 4) (global.get $braceDepth))
            (return)))))
    ;; text run up to `<` or `{`, hopping plain text 16 bytes per step;
    ;; `&entity;` gets a string.special span
    (block $textDone
      (loop $text
        (if (local.get $tsrx)
          (then (global.set $ptr (call $tsrxContentFind (global.get $ptr))))
          (else
            (global.set $ptr (call $scanFind3
              (global.get $ptr) (i32.const "<") (i32.const "{") (i32.const "&")))))
        (br_if $textDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $textDone (i32.or (i32.eq (local.get $c) (i32.const "<"))
                                 (i32.eq (local.get $c) (i32.const "{"))))
        (if (i32.eq (local.get $c) (i32.const "&"))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (block $eDone
              (loop $e
                (br_if $eDone (i32.ge_u (local.get $p) (global.get $end)))
                (local.set $c2 (i32.load8_u (local.get $p)))
                (br_if $eDone (i32.eqz (i32.or
                  (i32.or
                    (i32.le_u (i32.sub (i32.or (local.get $c2) (i32.const 32)) (i32.const "a")) (i32.const 25))
                    (i32.le_u (i32.sub (local.get $c2) (i32.const "0")) (i32.const 9)))
                  (i32.eq (local.get $c2) (i32.const "#")))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $e)))
            (if (i32.and
                  (i32.gt_u (local.get $p) (i32.add (global.get $ptr) (i32.const 1)))
                  (i32.and (i32.lt_u (local.get $p) (global.get $end))
                           (i32.eq (call $tsxByte (local.get $p)) (i32.const ";"))))
              (then
                (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr))
                (call $emitTok (enum.get $Token.string.special)
                  (global.get $ptr) (i32.add (local.get $p) (i32.const 1)))
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (local.set $seg (global.get $ptr)))
              (else
                ;; a bare `&`: plain text
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (br $text)))
        ;; TSRX text specials: LF, `@`, `/`
        (if (i32.eq (local.get $c) (i32.const 10))
          (then
            ;; `finally {` after a line's indentation heads a try clause
            (local.set $p (call $tsrxFinallyAhead (i32.add (global.get $ptr) (i32.const 1))))
            (if (local.get $p)
              (then
                (global.set $ptr (local.get $p))
                (local.set $act (i32.const 2))
                (br $textDone)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $text)))
        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            (if (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{"))
              (then
                (local.set $act (i32.const 1))
                (br $textDone)))
            (if (call $tsrxDirectiveAt (i32.add (global.get $ptr) (i32.const 1)))
              (then
                (local.set $act (i32.const 2))
                (br $textDone)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $text)))
        ;; `/`: a block comment anywhere, a line comment at a boundary
        (local.set $c2 (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))))
        (if (i32.eq (local.get $c2) (i32.const "*"))
          (then
            (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $scanBlockCommentEnd)
            (call $emitTok (enum.get $Token.comment) (local.get $seg) (global.get $ptr))
            ;; open at the chunk end: the next chunk resumes the comment
            (if (i32.and (global.get $tsxStreaming)
                         (call $blockCommentOpen (local.get $seg) (global.get $ptr)))
              (then (global.set $tsxStreamMode (i32.const 2))))
            (local.set $seg (global.get $ptr))
            (local.set $bound (global.get $ptr))
            (br $text)))
        (if (i32.and (i32.eq (local.get $c2) (i32.const "/"))
                     (call $tsrxAtBoundary (local.get $bound) (global.get $ptr)))
          (then
            (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (call $scanToLineEnd)
            (call $emitTok (enum.get $Token.comment) (local.get $seg) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $bound (global.get $ptr))
            (br $text)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $text)))
    (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr))
    (if (i32.ge_u (global.get $ptr) (global.get $end)) (then (return)))
    ;; TSRX: an `@{` container, or a directive head the token pipeline scans
    (if (i32.eq (local.get $act) (i32.const 1))
      (then
        (call $jsxOpenContainer)
        (return)))
    (if (i32.eq (local.get $act) (i32.const 2))
      (then
        (call $jsxPush (i32.const 4) (global.get $braceDepth))
        (return)))
    ;; `{` container
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (call $jsxOpenContainer)
        (return)))
    ;; `<...`
    (local.set $seg (global.get $ptr))
    (local.set $c2 (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))))
    ;; `</name >` closes this element
    (if (i32.eq (local.get $c2) (i32.const "/"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $seg) (global.get $ptr))
        (drop (call $jsxEmitName))
        ;; TSRX dynamic close tag `</{expr}>`: the tail waits for its container
        (if (i32.and (local.get $tsrx)
                     (i32.eq (call $tsxByte (global.get $ptr)) (i32.const "{")))
          (then
            (call $jsxSetTopMode (i32.const 7))
            (call $jsxOpenContainer)
            (return)))
        (drop (call $jsxCloseTagTail))
        (call $jsxPop)
        (return)))
    ;; `<name` / `<>` opens a child; TSRX also `<{expr}`
    (if (i32.or (call $jsxNameStart (local.get $c2))
                (i32.or (i32.eq (local.get $c2) (i32.const ">"))
                        (i32.and (local.get $tsrx) (i32.eq (local.get $c2) (i32.const "{")))))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.punctuation.bracket.jsx) (local.get $seg) (global.get $ptr))
        (call $jsxPush (i32.const 1) (call $jsxEmitName))
        (return)))
    ;; a stray `<`: plain text
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
    (call $emitTok (enum.get $Token.text.jsx) (local.get $seg) (global.get $ptr)))

  ;; ---- non-emitting steps for $tsxExpressionEnd ----
  ;; The expression-end scanner walks tokens with $nextToken, which knows
  ;; nothing about markup: inside `{items.map((i) => <li>{i}</li>)}` the `/`
  ;; of `</li>` would start a regexp that swallows the closing brace. These
  ;; steps mirror $jsxTagStep and $jsxContentStep without emitting, so the
  ;; scanner keeps the same TAG/CONTENT/CONTAINER mode stack as the lexer and
  ;; stops at the `}` the lexer will stop at.

  ;; advance $ptr over tag-name bytes
  (func $jsxSkipName
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (br_if $done (i32.eqz (call $jsxNameCont (i32.load8_u (global.get $ptr)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $l))))

  ;; a `{` at $ptr opens an expression container; see $jsxOpenContainer
  (func $jsxSkipOpenContainer
    (drop (call $nextToken))
    (call $jsxPush (i32.const 3) (i32.sub (global.get $braceDepth) (i32.const 1)))
    (global.set $prevTok (enum.get $Lex.l_brace)))

  ;; one step inside an open tag; see $jsxTagStep
  (func $jsxSkipTagStep
    (local $c i32)
    (block $wsDone
      (loop $ws
        (br_if $wsDone (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (br_if $wsDone (i32.eqz (i32.or
          (i32.eq (local.get $c) (i32.const 32))
          (i32.le_u (i32.sub (local.get $c) (i32.const 9)) (i32.const 4)))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $ws)))
    (if (i32.ge_u (global.get $ptr) (global.get $end)) (then (return)))
    ;; `>` - the tag opens: children follow
    (if (i32.eq (local.get $c) (i32.const ">"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $jsxSetTopMode (i32.const 2))
        (return)))
    ;; `/>` - self-closing
    (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                 (i32.eq (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const ">")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $jsxPop)
        (return)))
    ;; `{` - spread attribute or expression value
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (call $jsxSkipOpenContainer)
        (return)))
    ;; quoted attribute value (may span lines; no escapes in JSX strings)
    (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
      (then
        (global.set $ptr (call $scanFind3
          (i32.add (global.get $ptr) (i32.const 1))
          (local.get $c) (local.get $c) (local.get $c)))
        (if (i32.lt_u (global.get $ptr) (global.get $end))
          (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
        (return)))
    ;; attribute name
    (if (call $jsxNameStart (local.get $c))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $jsxSkipName)
        (return)))
    ;; `=` and anything else: one byte
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))

  ;; one step between `>` and the closing tag; see $jsxContentStep
  (func $jsxSkipContentStep
    (local $c i32)
    (local $c2 i32)
    (global.set $ptr (call $scanFind3
      (global.get $ptr) (i32.const "<") (i32.const "{") (i32.const "{")))
    (if (i32.ge_u (global.get $ptr) (global.get $end)) (then (return)))
    (local.set $c (i32.load8_u (global.get $ptr)))
    ;; `{` container
    (if (i32.eq (local.get $c) (i32.const "{"))
      (then
        (call $jsxSkipOpenContainer)
        (return)))
    (local.set $c2 (call $tsxByte (i32.add (global.get $ptr) (i32.const 1))))
    ;; `</name >` closes this element; the lenient tail runs to `>`, or
    ;; stops before a `<` that starts something new
    (if (i32.eq (local.get $c2) (i32.const "/"))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $jsxSkipName)
        (block $tDone
          (loop $t
            (br_if $tDone (i32.ge_u (global.get $ptr) (global.get $end)))
            (local.set $c (i32.load8_u (global.get $ptr)))
            (br_if $tDone (i32.eq (local.get $c) (i32.const "<")))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br_if $tDone (i32.eq (local.get $c) (i32.const ">")))
            (br $t)))
        (call $jsxPop)
        (return)))
    ;; `<name` / `<>` opens a child
    (if (i32.or (call $jsxNameStart (local.get $c2)) (i32.eq (local.get $c2) (i32.const ">")))
      (then
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $jsxSkipName)
        (call $jsxPush (i32.const 1) (i32.const 0))
        (return)))
    ;; a stray `<`: text
    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1))))

  (func $hlJsx (call $hlEcma (i32.const 2)))
  (func $hlJsxStream (param $reset i32)
    (call $hlEcmaStream (i32.const 2) (local.get $reset)))
)
