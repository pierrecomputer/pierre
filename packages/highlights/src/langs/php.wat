(module
  (import "../common.wat")
  (import "./html.wat")

  (global $phpStreamingCode (mut i32) (i32.const 0))
  (global $phpStreamDecl (mut i32) (i32.const 0))
  (global $phpStreamMember (mut i32) (i32.const 0))

  (func $phpIsOpen (param $p i32) (result i32)
    (local $c i32)
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 3)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load16_u (local.get $p)) (i32.const "<?"))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=2 (local.get $p)))
    (if (i32.eq (local.get $c) (i32.const "=")) (then (return (i32.const 1))))
    (if (i32.gt_u (i32.add (local.get $p) (i32.const 5)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne
          (i32.and
            (i32.or (i32.load offset=2 (local.get $p)) (i32.const 0x202020))
            (i32.const 0xffffff))
          (i32.const "php"))
      (then (return (i32.const 0))))
    (i32.or
      (i32.eq (i32.add (local.get $p) (i32.const 5)) (global.get $end))
      (call $lexIsSpace (i32.load8_u offset=5 (local.get $p)))))

  (func $phpFindOpen (param $p i32) (result i32)
    (block $done
      (loop $scan
        (local.set $p (call $lexFindByte (local.get $p) (i32.const "<")))
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (if (call $phpIsOpen (local.get $p)) (then (return (local.get $p))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (global.get $end))

  ;; A PHP line comment ends at `?>` as well as at a newline.
  (func $phpLineComment (param $skip i32)
    (local $close i32)
    (local $lhs i32)
    (local $lineEnd i32)
    (local $saveEnd i32)
    (local $stop i32)
    (local.set $lhs (global.get $ptr))
    (global.set $ptr (i32.add (global.get $ptr) (local.get $skip)))
    (if (i32.gt_u (global.get $ptr) (global.get $end))
      (then (global.set $ptr (global.get $end))))
    (local.set $lineEnd
      (call $lexFindEither (global.get $ptr) (i32.const 10) (i32.const 13)))
    (local.set $stop (local.get $lineEnd))
    (local.set $saveEnd (global.get $end))
    (global.set $end (local.get $lineEnd))
    (block $done
      (loop $find
        (local.set $close
          (call $lexFindByte (global.get $ptr) (i32.const "?")))
        (br_if $done (i32.ge_u (local.get $close) (local.get $lineEnd)))
        (if (i32.and
              (i32.lt_u (i32.add (local.get $close) (i32.const 1)) (local.get $lineEnd))
              (i32.eq (i32.load8_u offset=1 (local.get $close)) (i32.const ">")))
          (then
            (local.set $stop (local.get $close))
            (br $done)))
        (global.set $ptr (i32.add (local.get $close) (i32.const 1)))
        (br $find)))
    (global.set $end (local.get $saveEnd))
    (global.set $ptr (local.get $stop))
    (call $emitTok (enum.get $Token.comment) (local.get $lhs) (global.get $ptr)))

  ;; PHP keywords are case-insensitive: fold the first eight bytes once with
  ;; OR 0x20, then dispatch on length so only one length group's compares run.
  ;; Words longer than eight bytes compare their folded tail separately. The
  ;; buckets follow the lexer's split: control flow and language constructs
  ;; such as `echo`/`isset` are keyword.control, words that name what follows
  ;; (`class`, `extends`, `namespace`) are keyword.declaration so $phpCode
  ;; can prime the next identifier, and modifiers are plain keyword.
  (func $phpWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (local $n i32)
    (local $tail i32)
    (local $w i64)
    (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
    ;; every keyword is 2..12 bytes long
    (if (i32.gt_u (i32.sub (local.get $n) (i32.const 2)) (i32.const 10))
      (then (return (enum.get $Token.variable))))
    (local.set $w (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020)))
    (if (i32.eq (local.get $n) (i32.const 2))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffff)))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "if"))
              (i64.eq (local.get $w) (i64.const "do")))
          (then (return (enum.get $Token.keyword.control))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "as"))
              (i64.eq (local.get $w) (i64.const "fn")))
          (then (return (enum.get $Token.keyword))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 3))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffff)))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "new"))
              (i32.or
                (i64.eq (local.get $w) (i64.const "use"))
                (i64.eq (local.get $w) (i64.const "var"))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "for"))
              (i64.eq (local.get $w) (i64.const "try")))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "int"))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 4))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffff)))
        (if (i64.eq (local.get $w) (i64.const "true"))
          (then (return (enum.get $Token.boolean))))
        (if (i64.eq (local.get $w) (i64.const "null"))
          (then (return (enum.get $Token.constant.builtin))))
        (if (i32.or
              (i32.or
                (i64.eq (local.get $w) (i64.const "else"))
                (i64.eq (local.get $w) (i64.const "case")))
              (i32.or
                (i64.eq (local.get $w) (i64.const "echo"))
                (i64.eq (local.get $w) (i64.const "goto"))))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "enum"))
          (then (return (enum.get $Token.keyword.declaration))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "bool"))
              (i64.eq (local.get $w) (i64.const "void")))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 5))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffff)))
        (if (i64.eq (local.get $w) (i64.const "false"))
          (then (return (enum.get $Token.boolean))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "yield"))
              (i32.or
                (i64.eq (local.get $w) (i64.const "final"))
                (i64.eq (local.get $w) (i64.const "clone"))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i32.or
                (i32.or
                  (i64.eq (local.get $w) (i64.const "break"))
                  (i64.eq (local.get $w) (i64.const "catch")))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "while"))
                  (i64.eq (local.get $w) (i64.const "throw"))))
              (i32.or
                (i32.or
                  (i64.eq (local.get $w) (i64.const "match"))
                  (i64.eq (local.get $w) (i64.const "print")))
                (i32.or
                  (i64.eq (local.get $w) (i64.const "isset"))
                  (i32.or
                    (i64.eq (local.get $w) (i64.const "empty"))
                    (i64.eq (local.get $w) (i64.const "unset"))))))
          (then (return (enum.get $Token.keyword.control))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "class"))
              (i32.or
                (i64.eq (local.get $w) (i64.const "const"))
                (i64.eq (local.get $w) (i64.const "trait"))))
          (then (return (enum.get $Token.keyword.declaration))))
        (if (i32.or
              (i32.or
                (i64.eq (local.get $w) (i64.const "array"))
                (i64.eq (local.get $w) (i64.const "float")))
              (i32.or
                (i64.eq (local.get $w) (i64.const "mixed"))
                (i64.eq (local.get $w) (i64.const "never"))))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 6))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffff)))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "return"))
              (i32.or
                (i64.eq (local.get $w) (i64.const "switch"))
                (i64.eq (local.get $w) (i64.const "elseif"))))
          (then (return (enum.get $Token.keyword.control))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "public"))
              (i32.or
                (i64.eq (local.get $w) (i64.const "static"))
                (i64.eq (local.get $w) (i64.const "global"))))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "string"))
              (i64.eq (local.get $w) (i64.const "object")))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 7))
      (then
        (local.set $w (i64.and (local.get $w) (i64.const 0xffffffffffffff)))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "foreach"))
              (i32.or
                (i64.eq (local.get $w) (i64.const "default"))
                (i64.eq (local.get $w) (i64.const "finally"))))
          (then (return (enum.get $Token.keyword.control))))
        (if (i64.eq (local.get $w) (i64.const "extends"))
          (then (return (enum.get $Token.keyword.declaration))))
        (if (i32.or
              (i32.or
                (i64.eq (local.get $w) (i64.const "private"))
                (i64.eq (local.get $w) (i64.const "declare")))
              (i32.or
                (i64.eq (local.get $w) (i64.const "require"))
                (i64.eq (local.get $w) (i64.const "include"))))
          (then (return (enum.get $Token.keyword))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 8))
      (then
        (if (i64.eq (local.get $w) (i64.const "function"))
          (then (return (enum.get $Token.keyword.declaration))))
        (if (i64.eq (local.get $w) (i64.const "continue"))
          (then (return (enum.get $Token.keyword.control))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "abstract"))
              (i64.eq (local.get $w) (i64.const "readonly")))
          (then (return (enum.get $Token.keyword))))
        (if (i32.or
              (i64.eq (local.get $w) (i64.const "callable"))
              (i64.eq (local.get $w) (i64.const "iterable")))
          (then (return (enum.get $Token.type.builtin))))
        (return (enum.get $Token.variable))))
    ;; longer words: up to four folded tail bytes after the first eight. The
    ;; load may pass $end into the input slack; the mask discards those bytes.
    (local.set $tail (i32.or (i32.load offset=8 (local.get $lhs)) (i32.const 0x20202020)))
    (if (i32.eq (local.get $n) (i32.const 9))
      (then
        (local.set $tail (i32.and (local.get $tail) (i32.const 0xff)))
        (if (i32.or
              (i32.and
                (i64.eq (local.get $w) (i64.const "interfac"))
                (i32.eq (local.get $tail) (i32.const "e")))
              (i32.and
                (i64.eq (local.get $w) (i64.const "namespac"))
                (i32.eq (local.get $tail) (i32.const "e"))))
          (then (return (enum.get $Token.keyword.declaration))))
        (if (i32.or
              (i32.and
                (i64.eq (local.get $w) (i64.const "protecte"))
                (i32.eq (local.get $tail) (i32.const "d")))
              (i32.and
                (i64.eq (local.get $w) (i64.const "insteado"))
                (i32.eq (local.get $tail) (i32.const "f"))))
          (then (return (enum.get $Token.keyword))))
        (return (enum.get $Token.variable))))
    (if (i32.eq (local.get $n) (i32.const 10))
      (then
        (local.set $tail (i32.and (local.get $tail) (i32.const 0xffff)))
        (if (i32.and
              (i64.eq (local.get $w) (i64.const "implemen"))
              (i32.eq (local.get $tail) (i32.const "ts")))
          (then (return (enum.get $Token.keyword.declaration))))
        (if (i32.and
              (i64.eq (local.get $w) (i64.const "instance"))
              (i32.eq (local.get $tail) (i32.const "of")))
          (then (return (enum.get $Token.keyword))))
        (return (enum.get $Token.variable))))
    ;; `require_once` / `include_once`: the fold would turn `_` into 0x7f, so
    ;; the eighth byte is compared unfolded
    (if (i32.eq (local.get $n) (i32.const 12))
      (then
        (if (i32.and
              (i32.and
                (i32.or
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "require"))
                  (i64.eq (i64.and (local.get $w) (i64.const 0xffffffffffffff)) (i64.const "include")))
                (i32.eq (i32.load8_u offset=7 (local.get $lhs)) (i32.const "_")))
              (i32.eq (local.get $tail) (i32.const "once")))
          (then (return (enum.get $Token.keyword))))))
    (enum.get $Token.variable))

  ;; $p always sits on a CR, an LF, or $end here (callers land on the result
  ;; of $phpLineEndAt), so consuming one byte plus a CRLF pair is exact.
  (func $phpAfterLine (param $p i32) (result i32)
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

  (func $phpLineEndAt (param $p i32) (result i32)
    (call $lexFindEither (local.get $p) (i32.const 10) (i32.const 13)))

  (func $phpBlanksAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (i32.or
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 32))
          (i32.eq (i32.load8_u (local.get $p)) (i32.const 9)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; do the $n bytes at $a equal those at $b? The whole run must fit before
  ;; $end; the masked wide loads may pass it into the input slack.
  (func $phpBytesEq (param $a i32) (param $b i32) (param $n i32) (result i32)
    (local $mask i64)
    (if (i32.gt_u (i32.add (local.get $a) (local.get $n)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.eqz (local.get $n)) (then (return (i32.const 1))))
    (block $done
      (loop $cmp
        (if (i32.lt_u (local.get $n) (i32.const 8))
          (then
            (local.set $mask (i64.shr_u (i64.const -1)
              (i64.extend_i32_u
                (i32.shl (i32.sub (i32.const 8) (local.get $n)) (i32.const 3)))))
            (if (i64.ne
                  (i64.and (i64.load (local.get $a)) (local.get $mask))
                  (i64.and (i64.load (local.get $b)) (local.get $mask)))
              (then (return (i32.const 0))))
            (br $done)))
        (if (i64.ne (i64.load (local.get $a)) (i64.load (local.get $b)))
          (then (return (i32.const 0))))
        (local.set $a (i32.add (local.get $a) (i32.const 8)))
        (local.set $b (i32.add (local.get $b) (i32.const 8)))
        (local.set $n (i32.sub (local.get $n) (i32.const 8)))
        (br_if $cmp (local.get $n))))
    (i32.const 1))

  ;; Emit a heredoc/nowdoc body that starts at $body and ends at the first
  ;; line whose first non-blank run is the $n-byte label at $delim followed
  ;; by a non-identifier byte (`EOT;` closes, `EOTX` does not). Returns 1
  ;; with $ptr after the label. An unterminated body runs to $end and returns
  ;; 0; in streaming it becomes php-owned stream mode 14 so the next chunk
  ;; keeps looking for the closer: the label is copied into the 32-byte
  ;; stream delimiter and its length into $streamA. Longer labels cannot be
  ;; checkpointed and simply end at the chunk.
  (func $phpHeredocBody (param $body i32) (param $delim i32) (param $n i32) (result i32)
    (local $c i32)
    (local $line i32)
    (local $start i32)
    (local.set $line (local.get $body))
    (block $found
      (block $eof
        (loop $scan
          (br_if $eof (i32.ge_u (local.get $line) (global.get $end)))
          (local.set $start (call $phpBlanksAt (local.get $line)))
          (if (call $phpBytesEq (local.get $start) (local.get $delim) (local.get $n))
            (then
              (local.set $c (i32.add (local.get $start) (local.get $n)))
              ;; the label must not be a prefix of a longer word
              (if (i32.or
                    (i32.ge_u (local.get $c) (global.get $end))
                    (i32.eqz (call $lexIsIdentContinue (i32.load8_u (local.get $c)))))
                (then (br $found)))))
          (local.set $line (call $phpAfterLine
            (call $phpLineEndAt (local.get $line))))
          (br $scan)))
      ;; unterminated: the body is the rest of the range
      (call $emitTok (enum.get $Token.string) (local.get $body) (global.get $end))
      (global.set $ptr (global.get $end))
      (if (i32.and (global.get $streaming) (i32.le_u (local.get $n) (i32.const 32)))
        (then
          (memory.copy
            (i32.const $mem.streamDelimiter) (local.get $delim) (local.get $n))
          (global.set $streamMode (i32.const 14))
          (global.set $streamA (local.get $n))))
      (return (i32.const 0)))
    (call $emitTok (enum.get $Token.string) (local.get $body) (local.get $line))
    (call $emitGap (local.get $line) (local.get $start))
    (call $emitTok (enum.get $Token.string)
      (local.get $start) (i32.add (local.get $start) (local.get $n)))
    (global.set $ptr (i32.add (local.get $start) (local.get $n)))
    (i32.const 1))

  ;; Resume php-owned stream mode 14: a heredoc/nowdoc body the previous
  ;; chunk left open. Returns 1 when the body still runs past this chunk, 0
  ;; with the mode cleared and $ptr after the closing label.
  (func $phpHeredocResume (result i32)
    (if (call $phpHeredocBody
          (global.get $ptr) (i32.const $mem.streamDelimiter) (global.get $streamA))
      (then
        (global.set $streamMode (i32.const 0))
        (return (i32.const 0))))
    (i32.const 1))

  ;; `<<<ID`, `<<<"ID"` and nowdoc `<<<'ID'`. The body runs to the first line
  ;; whose first non-blank run is the identifier, so everything in between -
  ;; `?>` included - stays literal text instead of closing PHP mode.
  ;; Returns 1 when a heredoc was consumed, 0 to leave `<<<` to the caller.
  (func $phpHeredoc (result i32)
    (local $body i32)
    (local $c i32)
    (local $delim i32)
    (local $lhs i32)
    (local $n i32)
    (local $p i32)
    (local $quote i32)
    (local $start i32)
    (local.set $lhs (global.get $ptr))
    (local.set $p (call $phpBlanksAt (i32.add (global.get $ptr) (i32.const 3))))
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (local.set $quote (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eq (local.get $quote) (i32.const 34))
                (i32.eq (local.get $quote) (i32.const 39)))
      (then (local.set $p (i32.add (local.get $p) (i32.const 1))))
      (else (local.set $quote (i32.const 0))))
    ;; a label starts with a letter or `_`, never a digit and never `$`
    (if (i32.ge_u (local.get $p) (global.get $end)) (then (return (i32.const 0))))
    (local.set $c (i32.load8_u (local.get $p)))
    (if (i32.or (i32.eqz (call $lexIsIdentStart (local.get $c)))
                (i32.eq (local.get $c) (i32.const "$")))
      (then (return (i32.const 0))))
    (local.set $delim (local.get $p))
    (block $idDone
      (loop $id
        (br_if $idDone (i32.ge_u (local.get $p) (global.get $end)))
        (local.set $c (i32.load8_u (local.get $p)))
        (br_if $idDone (i32.or
          (i32.eqz (call $lexIsIdentContinue (local.get $c)))
          (i32.eq (local.get $c) (i32.const "$"))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $id)))
    (local.set $n (i32.sub (local.get $p) (local.get $delim)))
    (if (local.get $quote)
      (then
        (if (i32.or (i32.ge_u (local.get $p) (global.get $end))
                    (i32.ne (i32.load8_u (local.get $p)) (local.get $quote)))
          (then (return (i32.const 0))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))))
    ;; the opener has to end its line
    (local.set $start (call $phpBlanksAt (local.get $p)))
    (if (i32.and
          (i32.lt_u (local.get $start) (global.get $end))
          (i32.and
            (i32.ne (i32.load8_u (local.get $start)) (i32.const 10))
            (i32.ne (i32.load8_u (local.get $start)) (i32.const 13))))
      (then (return (i32.const 0))))
    (call $emitTok (enum.get $Token.operator)
      (local.get $lhs) (i32.add (local.get $lhs) (i32.const 3)))
    (call $emitTok (enum.get $Token.string)
      (i32.add (local.get $lhs) (i32.const 3)) (local.get $p))
    (call $emitGap (local.get $p) (local.get $start))
    (local.set $body (call $phpAfterLine (local.get $start)))
    (call $emitGap (local.get $start) (local.get $body))
    (drop (call $phpHeredocBody (local.get $body) (local.get $delim) (local.get $n)))
    (i32.const 1))

  ;; PHP code, stopping before a live `?>` delimiter. $resume is 1 when the
  ;; previous chunk ended inside code: the declaration and member lookahead
  ;; it checkpointed continues into this chunk.
  (func $phpCode (param $resume i32)
    (local $c i32)
    (local $decl i32) ;; 1 function, 2 class-like
    (local $hl i32)
    (local $lhs i32)
    (local $member i32)
    (local $next i32)
    (local $p i32)
    (if (local.get $resume)
      (then
        (local.set $decl (global.get $phpStreamDecl))
        (local.set $member (global.get $phpStreamMember))))
    (block $done
      (loop $token
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $next (select
          (i32.load8_u offset=1 (global.get $ptr)) (i32.const 0)
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))))
        (br_if $done (i32.and (i32.eq (local.get $c) (i32.const "?"))
                              (i32.eq (local.get $next) (i32.const ">"))))
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "/"))
                       (i32.eq (local.get $next) (i32.const "/")))
              (i32.and (i32.eq (local.get $c) (i32.const "#"))
                       (i32.ne (local.get $next) (i32.const "["))))
          (then
            (call $phpLineComment
              (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c) (i32.const "/")))
            )
            (br $token)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/"))
                     (i32.eq (local.get $next) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $token)))
        (if (i32.and
              (i32.and (i32.eq (local.get $c) (i32.const "<"))
                       (i32.eq (local.get $next) (i32.const "<")))
              (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 2)) (global.get $end))
                (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "<"))))
          (then
            (if (call $phpHeredoc)
              (then
                (local.set $decl (i32.const 0))
                (local.set $member (i32.const 0))
                (br $token)))))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const 34))
              (i32.or (i32.eq (local.get $c) (i32.const 39))
                      (i32.eq (local.get $c) (i32.const "`"))))
          (then
            (call $lexString (local.get $c) (i32.const 1) (enum.get $Token.string))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (i32.eq (local.get $c) (i32.const "$"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.variable) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (global.set $sigPattern (i32.const 0))
            (br $token)))
        (if (i32.or
              (call $lexIsDigit (local.get $c))
              (i32.and
                (i32.eq (local.get $c) (i32.const "."))
                (call $lexIsDigit (local.get $next))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (br $token)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $hl (call $phpWordHl (local.get $lhs) (global.get $ptr)))
            (if (local.get $decl)
              (then
                (local.set $hl (select
                  (enum.get $Token.function.definition) (enum.get $Token.type.class)
                  (i32.eq (local.get $decl) (i32.const 1))))
                (local.set $decl (i32.const 0)))
              (else
                (if (local.get $member)
                  (then
                    (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                    (local.set $hl (select
                      (enum.get $Token.function.method) (enum.get $Token.property)
                      (i32.and (i32.lt_u (local.get $p) (global.get $end))
                               (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))))
                    (local.set $member (i32.const 0)))
                  (else
                    (if (i32.eq (local.get $hl) (enum.get $Token.variable))
                      (then
                        (local.set $p (call $lexSkipSpaceAt (global.get $ptr)))
                        (if (i32.and (i32.lt_u (local.get $p) (global.get $end))
                                     (i32.eq (i32.load8_u (local.get $p)) (i32.const "(")))
                          (then (local.set $hl (enum.get $Token.function))))
                        ;; a PHP 8 named call argument - `name:` after `(` or
                        ;; `,`, never `::` - is Zed's argument name capture
                        (if (i32.and
                              (global.get $sigPattern)
                              (i32.and
                                (i32.and
                                  (i32.lt_u (local.get $p) (global.get $end))
                                  (i32.eq (i32.load8_u (local.get $p)) (i32.const ":")))
                                (i32.ne
                                  (select
                                    (i32.load8_u offset=1 (local.get $p)) (i32.const 0)
                                    (i32.lt_u (i32.add (local.get $p) (i32.const 1)) (global.get $end)))
                                  (i32.const ":"))))
                          (then (local.set $hl (enum.get $Token.variable.parameter))))))))))
            (if (i32.eq (local.get $hl) (enum.get $Token.keyword.declaration))
              (then
                (local.set $decl (select
                  (i32.const 1) (i32.const 2)
                  (i32.and
                    (i32.eq (i32.sub (global.get $ptr) (local.get $lhs)) (i32.const 8))
                    (i64.eq (i64.or (i64.load (local.get $lhs)) (i64.const 0x2020202020202020))
                            (i64.const "function")))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
            (global.set $sigPattern (i32.const 0))
            (br $token)))
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "-"))
                       (i32.eq (local.get $next) (i32.const ">")))
              (i32.and (i32.eq (local.get $c) (i32.const ":"))
                       (i32.eq (local.get $next) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 1))
            (global.set $sigPattern (i32.const 0))
            (br $token)))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            ;; an open paren puts the next bare word in named-argument position
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const "(")))
            (br $token)))
        (if (i32.or
              (i32.eq (local.get $c) (i32.const ","))
              (i32.or (i32.eq (local.get $c) (i32.const ";"))
                      (i32.eq (local.get $c) (i32.const ":"))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $decl (i32.const 0))
            (local.set $member (i32.const 0))
            (global.set $sigPattern (i32.eq (local.get $c) (i32.const ",")))
            (br $token)))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (select
          (enum.get $Token.attribute) (enum.get $Token.operator)
          (i32.and (i32.eq (local.get $c) (i32.const "#"))
                   (i32.eq (local.get $next) (i32.const "["))))
          (local.get $lhs) (global.get $ptr))
        (if (i32.ne (local.get $c) (i32.const "&"))
          (then (local.set $decl (i32.const 0))))
        (local.set $member (i32.const 0))
        (br $token)))
    (if (global.get $streaming)
      (then
        (global.set $phpStreamDecl (local.get $decl))
        (global.set $phpStreamMember (local.get $member)))))

  ;; Resume the php stream state the previous chunk left: first a heredoc
  ;; body (mode 14), then - when the chunk ended inside PHP code - the code
  ;; itself up to `?>`. Returns 1 when the whole chunk was consumed; on 0
  ;; $hlPhp continues from $ptr, in markup mode after a `?>`.
  (func $phpStreamResume (result i32)
    (local $code i32)
    (local $lhs i32)
    (local.set $code (i32.eq (global.get $phpStreamingCode) (i32.const 1)))
    (if (i32.eq (global.get $streamMode) (i32.const 14))
      (then
        (if (call $phpHeredocResume) (then (return (i32.const 1))))
        ;; a heredoc only opens inside code, so its closer continues code
        (local.set $code (i32.const 1))))
    (if (i32.eqz (local.get $code)) (then (return (i32.const 0))))
    (call $phpCode (i32.const 1))
    (if (i32.and
          (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
          (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "?>")))
      (then
        (local.set $lhs (global.get $ptr))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
        (call $emitTok (enum.get $Token.preproc) (local.get $lhs) (global.get $ptr))
        (global.set $phpStreamingCode (i32.const 2))
        (return (i32.const 0))))
    (i32.const 1))

  ;; Does the visible text at $p start markup - a tag, a comment or doctype,
  ;; or a close tag - rather than a bare PHP snippet?
  (func $phpLooksLikeMarkup (param $p i32) (result i32)
    (local $c i32)
    (if (i32.ge_u (i32.add (local.get $p) (i32.const 1)) (global.get $end))
      (then (return (i32.const 0))))
    (if (i32.ne (i32.load8_u (local.get $p)) (i32.const "<"))
      (then (return (i32.const 0))))
    (local.set $c (i32.load8_u offset=1 (local.get $p)))
    (i32.or
      (call $lexIsIdentStart (local.get $c))
      (i32.or
        (i32.eq (local.get $c) (i32.const "!"))
        (i32.eq (local.get $c) (i32.const "/")))))

  ;; Skip every ASCII whitespace byte from $p, line breaks included, so the
  ;; snippet-versus-markup decision reads the first visible byte wherever
  ;; its line is.
  (func $phpSkipWhitespaceAt (param $p i32) (result i32)
    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $p) (global.get $end)))
        (br_if $done (i32.eqz (call $lexIsSpace (i32.load8_u (local.get $p)))))
        (local.set $p (i32.add (local.get $p) (i32.const 1)))
        (br $l)))
    (local.get $p))

  ;; A PHP file is markup with `<?php ... ?>` islands; input without an
  ;; opener is a bare code snippet unless its first visible byte starts
  ;; markup. Streaming decides that on the first non-blank chunk and keeps
  ;; the answer in $phpStreamingCode - 1 code, 2 markup, 0 undecided - so
  ;; later chunks without an opener stay markup after a `?>`, and blank
  ;; chunks decide nothing, keeping leading empty lines equal to a
  ;; whole-buffer run.
  (func $hlPhp
    (local $open i32)
    (local $p i32)
    (local $saveEnd i32)
    (local $snippet i32)
    (call $lexEmitLeadingContinuation)
    (local.set $snippet (i32.const 0))
    (block $out
      (local.set $open (call $phpFindOpen (global.get $ptr)))
      (if (i32.eq (local.get $open) (global.get $end))
        (then
          (if (i32.and
                (global.get $streaming)
                (i32.eq (global.get $phpStreamingCode) (i32.const 2)))
            (then
              (call $hlHtml)
              (br $out)))
          (local.set $p (call $phpSkipWhitespaceAt (global.get $ptr)))
          (if (i32.ge_u (local.get $p) (global.get $end))
            (then
              (call $emitGap (global.get $ptr) (global.get $end))
              (global.set $ptr (global.get $end))
              (br $out)))
          (if (call $phpLooksLikeMarkup (local.get $p))
            (then
              (global.set $phpStreamingCode (i32.const 2))
              (call $hlHtml)
              (br $out)))
          (local.set $snippet (i32.const 1))))
      ;; the html prefix runs once here; each loop iteration ends by lexing
      ;; the html between `?>` and the next opener itself
      (if (i32.and
            (i32.eqz (local.get $snippet))
            (i32.lt_u (global.get $ptr) (local.get $open)))
        (then
          (local.set $saveEnd (global.get $end))
          (global.set $end (local.get $open))
          (call $hlHtml)
          (global.set $end (local.get $saveEnd))))
      (block $done
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (loop $part
          ;; a snippet has no opener before its code
          (if (i32.eqz (local.get $snippet))
            (then
              (local.set $open (global.get $ptr))
              (global.set $ptr (i32.add (global.get $ptr)
                (select (i32.const 3) (i32.const 5)
                  (i32.eq (i32.load8_u offset=2 (global.get $ptr)) (i32.const "=")))))
              (call $emitTok (enum.get $Token.preproc) (local.get $open) (global.get $ptr))))
          (local.set $snippet (i32.const 0))
          (call $phpCode (i32.const 0))
          (if (i32.and
                (i32.lt_u (i32.add (global.get $ptr) (i32.const 1)) (global.get $end))
                (i32.eq (i32.load16_u (global.get $ptr)) (i32.const "?>")))
            (then
              (local.set $open (global.get $ptr))
              (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
              (call $emitTok (enum.get $Token.preproc) (local.get $open) (global.get $ptr))
              (global.set $phpStreamingCode (i32.const 2)))
            (else
              ;; code only stops at `?>` or $end: the next chunk resumes code
              (global.set $phpStreamingCode (i32.const 1))
              (br $done)))
          (local.set $open (call $phpFindOpen (global.get $ptr)))
          (if (i32.lt_u (global.get $ptr) (local.get $open))
            (then
              (local.set $saveEnd (global.get $end))
              (global.set $end (local.get $open))
              (call $hlHtml)
              (global.set $end (local.get $saveEnd))))
          (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
          (br $part)))))
)
