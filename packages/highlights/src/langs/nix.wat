(module
  (import "../common.wat")

  (func $nixByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $hlNix. Every group carries its
  ;; token, so the lookup returns it directly, or -1 for an ordinary name.
  (keyword-table $nixWords $mem.nixWords $mem.nixWords+384
    (group $Token.keyword "let" "in" "with" "rec" "inherit" "assert")  ;; 1
    (group $Token.keyword.control "if" "then" "else")                  ;; 2
    (group $Token.boolean "true" "false")                              ;; 3
    (group $Token.constant.builtin "null")                             ;; 4
    (group $Token.keyword.operator "or")                               ;; 5
    (group $Token.namespace "builtins")                                ;; 6
    (group $Token.function ;; 7: the built-in functions in scope
      "import" "throw" "abort" "derivation" "map" "toString" "baseNameOf"
      "dirOf" "removeAttrs" "fetchTarball" "fetchGit" "isNull"))

  ;; The token of a keyword or built-in, or -1 for an ordinary name.
  (func $nixWordHl (param $lhs i32) (param $rhs i32) (result i32)
    (keyword-table.value $nixWords (local.get $lhs) (local.get $rhs)))

  ;; bytes of a path literal: `./src/default.nix`, `/etc/nixos`, `~/x`
  (func $nixIsPathByte (param $c i32) (result i32)
    (i32.or
      (call $lexIsIdentContinue (local.get $c))
      (byteset.get "+-./" (local.get $c))))

  ;; bytes of an unquoted URI: `https://example.org/a?b=c`
  (func $nixIsUriByte (param $c i32) (result i32)
    (i32.or
      (call $lexIsIdentContinue (local.get $c))
      (byteset.get "!%&'*+,-./:=?@~" (local.get $c))))

  ;; Whether the bytes at $p can begin the argument of a function
  ;; application: a name, a literal, an opening bracket, a path, or a search
  ;; path. A lone `.` selects an attribute and a lone `/` divides, so both
  ;; count only when a path follows.
  (func $nixIsArgAt (param $p i32) (result i32)
    (local $c i32) (local $c2 i32)
    (local.set $c (call $nixByte (local.get $p)))
    (local.set $c2 (call $nixByte (i32.add (local.get $p) (i32.const 1))))
    (if (i32.or
          (i32.or (call $lexIsIdentStart (local.get $c)) (call $lexIsDigit (local.get $c)))
          (byteset.get "\22([{" (local.get $c)))
      (then (return (i32.const 1))))
    (if (i32.eq (local.get $c) (i32.const 39))
      (then (return (i32.eq (local.get $c2) (i32.const 39)))))
    (if (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const "~")))
      (then (return (i32.or
        (call $lexIsIdentStart (local.get $c2))
        (i32.eq (local.get $c2) (i32.const "/"))))))
    (if (i32.eq (local.get $c) (i32.const "."))
      (then (return (i32.or
        (i32.eq (local.get $c2) (i32.const "/"))
        (i32.and
          (i32.eq (local.get $c2) (i32.const "."))
          (i32.eq (call $nixByte (i32.add (local.get $p) (i32.const 2))) (i32.const "/")))))))
    (if (i32.eq (local.get $c) (i32.const "/"))
      (then (return (i32.and
        (call $nixIsPathByte (local.get $c2))
        (i32.ne (local.get $c2) (i32.const "/"))))))
    (i32.const 0))

  ;; Scan a string body from $ptr with the bytes since $seg still unemitted.
  ;; $kind is 1 for a `"` string, whose backslash escapes are emitted
  ;; separately, and 2 for an `''` indented string, whose escapes are
  ;; `'''`, `''$`, and `''\`. Both span lines and carry `${` splices.
  ;; Returns 1 past the closer, 2 past a `${` that opens a splice - emitted
  ;; as punctuation.special, the caller lexes the expression - and 0 at
  ;; $end. $nested is nonzero inside a splice, where a nested string keeps
  ;; `${` plain.
  (func $nixStringBody (param $kind i32) (param $nested i32) (param $seg i32) (result i32)
    (local $c i32) (local $c2 i32) (local $e i32) (local $p i32)
    (block $done
      (loop $scan
        (if (i32.eq (local.get $kind) (i32.const 1))
          (then (local.set $p (call $scanFind3
            (global.get $ptr) (i32.const 34) (i32.const 92) (i32.const "$"))))
          (else (local.set $p (call $lexFindEither
            (global.get $ptr) (i32.const 39) (i32.const "$")))))
        (if (i32.ge_u (local.get $p) (global.get $end))
          (then
            (global.set $ptr (global.get $end))
            (br $done)))
        (global.set $ptr (local.get $p))
        (local.set $c (i32.load8_u (local.get $p)))
        (local.set $c2 (call $nixByte (i32.add (local.get $p) (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
            (return (i32.const 1))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (local.set $e (call $lexEscapeEnd (local.get $p)))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (if (i32.ne (local.get $c2) (i32.const 39))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (br $scan)))
            (local.set $c2 (call $nixByte (i32.add (local.get $p) (i32.const 2))))
            ;; `'''`, `''$`, and `''\x` escape; any other `''` closes
            (if (i32.or (i32.eq (local.get $c2) (i32.const 39)) (i32.eq (local.get $c2) (i32.const "$")))
              (then (local.set $e (i32.add (local.get $p) (i32.const 3))))
              (else
                (if (i32.eq (local.get $c2) (i32.const 92))
                  (then (local.set $e (call $lexEscapeEnd (i32.add (local.get $p) (i32.const 2)))))
                  (else
                    (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
                    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                    (return (i32.const 1))))))
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (call $emitTok (enum.get $Token.string.escape) (local.get $p) (local.get $e))
            (global.set $ptr (local.get $e))
            (local.set $seg (local.get $e))
            (br $scan)))
        ;; `$`
        (if (i32.and (i32.eq (local.get $c2) (i32.const "{")) (i32.eqz (local.get $nested)))
          (then
            (call $emitTok (enum.get $Token.string) (local.get $seg) (local.get $p))
            (global.set $ptr (i32.add (local.get $p) (i32.const 2)))
            (call $emitTok (enum.get $Token.punctuation.special) (local.get $p) (global.get $ptr))
            (return (i32.const 2))))
        (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (i32.const 0))

  (func $nixIsOp (param $c i32) (result i32)
    (byteset.get "!&*+-/<=>?@|:" (local.get $c)))

  ;; $strKind is 1 inside a `"` body and 2 inside an `''` body, with $seg the
  ;; start of the bytes not yet emitted; $interp counts braces inside a `${`
  ;; splice and $interpKind remembers which body to return to. $afterValue
  ;; is 1 after a value - a name, a literal, or a closer - so the head of an
  ;; application can be told from its arguments; $member is 1 after `.`;
  ;; $inherit is 1 from `inherit` to its `;`. $brackets is a stack of open
  ;; bracket kinds, two bits each - 1 paren, 2 list, 3 braces - and $depth
  ;; its height: names inside a list are elements, not applications, and a
  ;; name inside braces followed by `,` or `?` is a parameter. All are
  ;; checkpointed.
  (func $hlNix
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $status i32)
    (local $strKind i32) (local $seg i32) (local $interp i32) (local $interpKind i32)
    (local $afterValue i32) (local $member i32) (local $inherit i32)
    (local $brackets i32) (local $depth i32) (local $top i32) (local $pc i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $strKind)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status (call $nixStringBody
              (local.get $strKind) (local.get $interp) (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $interpKind (local.get $strKind))
                (local.set $interp (i32.const 1))
                (local.set $strKind (i32.const 0))
                (local.set $seg (i32.const 0))
                (local.set $afterValue (i32.const 0)))
              (else
                (if (i32.eq (local.get $status) (i32.const 1))
                  (then
                    (local.set $strKind (i32.const 0))
                    (local.set $seg (i32.const 0))
                    (local.set $afterValue (i32.const 1))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $nixByte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $nixByte (i32.add (global.get $ptr) (i32.const 2))))
        (local.set $top (i32.and (local.get $brackets) (i32.const 3)))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            (call $lexLineComment (i32.const 1) (enum.get $Token.comment))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2) (enum.get $Token.comment))
            (br $next)))

        ;; string openers are emitted at once; the body is scanned at the top
        ;; of the loop, where it can also resume after a chunk boundary
        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (local.set $strKind (i32.const 1))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c2) (i32.const 39)))
          (then
            (local.set $strKind (i32.const 2))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
            (local.set $seg (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `//` updates, `/x` opens a path
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 0))
            (br $next)))
        ;; paths: `./x`, `../x`, `/x`, `~/x`
        (if (i32.or
              (i32.and (i32.eq (local.get $c) (i32.const "/")) (call $nixIsPathByte (local.get $c2)))
              (i32.or
                (i32.and
                  (i32.eq (local.get $c) (i32.const "."))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "/"))
                    (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eq (local.get $c3) (i32.const "/")))))
                (i32.and (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c2) (i32.const "/")))))
          (then
            ;; the `~` of a home path is not a path byte itself
            (if (i32.eq (local.get $c) (i32.const "~"))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (block $pathDone
              (loop $path
                (br_if $pathDone (i32.ge_u (global.get $ptr) (global.get $end)))
                (br_if $pathDone (i32.eqz (call $nixIsPathByte (i32.load8_u (global.get $ptr)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $path)))
            (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; `<nixpkgs>` search paths
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (local.set $p (i32.add (global.get $ptr) (i32.const 1)))
            (block $spDone
              (loop $sp
                (br_if $spDone (i32.eqz (call $nixIsPathByte (call $nixByte (local.get $p)))))
                (local.set $p (i32.add (local.get $p) (i32.const 1)))
                (br $sp)))
            (if (i32.eq (call $nixByte (local.get $p)) (i32.const ">"))
              (then
                (global.set $ptr (i32.add (local.get $p) (i32.const 1)))
                (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.const 1))
                (br $next)))))

        (if (i32.and (call $lexIsIdentStart (local.get $c)) (i32.ne (local.get $c) (i32.const "$")))
          (then
            ;; names take `-` and `'`: `hello-world`, `x'`
            (block $identDone
              (loop $ident
                (call $scanIdentRun (i32.const "-"))
                (br_if $identDone (i32.ne (call $nixByte (global.get $ptr)) (i32.const 39)))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $ident)))
            (local.set $rhs (global.get $ptr))
            ;; `https://...` unquoted URIs
            (if (i32.and
                  (i32.eq (call $nixByte (local.get $rhs)) (i32.const ":"))
                  (i32.and
                    (i32.eq (call $nixByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const "/"))
                    (i32.eq (call $nixByte (i32.add (local.get $rhs) (i32.const 2))) (i32.const "/"))))
              (then
                (block $uriDone
                  (loop $uri
                    (br_if $uriDone (i32.ge_u (global.get $ptr) (global.get $end)))
                    (br_if $uriDone (i32.eqz (call $nixIsUriByte (i32.load8_u (global.get $ptr)))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $uri)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.const 1))
                (local.set $member (i32.const 0))
                (br $next)))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $pc (call $nixByte (local.get $p)))
            (local.set $kind (select (i32.const -1)
              (call $nixWordHl (local.get $lhs) (local.get $rhs))
              (i32.or (local.get $member) (local.get $inherit))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (local.get $kind))
                ;; `inherit` names attributes until its `;`
                (if (i32.and
                      (i32.eq (local.get $hl) (enum.get $Token.keyword))
                      (i32.and
                        (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 7))
                        (i32.eq (i32.load (local.get $lhs)) (i32.const "inhe"))))
                  (then (local.set $inherit (i32.const 1))))
                (local.set $afterValue (i32.or
                  (i32.eq (local.get $hl) (enum.get $Token.boolean))
                  (i32.eq (local.get $hl) (enum.get $Token.constant.builtin)))))
              (else
                (if (local.get $inherit)
                  (then (local.set $hl (enum.get $Token.property)))
                  (else
                    ;; `name =` defines an attribute, `name:` binds a
                    ;; parameter, and so does a name in a `{ a, b ? x }`
                    ;; pattern
                    (if (i32.and
                          (i32.eq (call $nixByte (local.get $p)) (i32.const "="))
                          (i32.ne (call $nixByte (i32.add (local.get $p) (i32.const 1))) (i32.const "=")))
                      (then (local.set $hl (enum.get $Token.property)))
                      (else
                        (if (i32.or
                              (i32.eq (call $nixByte (local.get $p)) (i32.const ":"))
                              (i32.and
                                (i32.eq (local.get $top) (i32.const 3))
                                (i32.and
                                  (i32.eqz (local.get $member))
                                  (byteset.get ",?}" (local.get $pc)))))
                          (then (local.set $hl (enum.get $Token.variable.parameter)))
                          (else
                            ;; the head of an application - a name before an
                            ;; argument that no value precedes, outside a
                            ;; list - is the function applied
                            (if (i32.and
                                  (i32.eqz (local.get $afterValue))
                                  (i32.and
                                    (i32.ne (local.get $top) (i32.const 2))
                                    (call $nixIsArgAt (local.get $p))))
                              (then (local.set $hl (enum.get $Token.function)))
                              (else
                                (local.set $hl (select (enum.get $Token.property) (enum.get $Token.variable)
                                  (local.get $member)))))))))))
                (local.set $afterValue (i32.const 1))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsDigit (local.get $c))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 1))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (local.get $interp)
              (then
                (if (i32.eq (local.get $c) (i32.const "{"))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (i32.const "}"))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the brace matching `${` returns to the string body
                        (call $emitTok (enum.get $Token.punctuation.special) (local.get $lhs) (global.get $ptr))
                        (local.set $strKind (local.get $interpKind))
                        (local.set $interpKind (i32.const 0))
                        (local.set $seg (global.get $ptr))
                        (local.set $member (i32.const 0))
                        (br $next)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (if (byteset.get "([{" (local.get $c))
              (then
                (local.set $brackets (i32.or
                  (i32.shl (local.get $brackets) (i32.const 2))
                  (select (i32.const 1)
                    (select (i32.const 2) (i32.const 3) (i32.eq (local.get $c) (i32.const "[")))
                    (i32.eq (local.get $c) (i32.const "(")))))
                (local.set $depth (i32.add (local.get $depth) (i32.const 1)))
                (local.set $afterValue (i32.const 0)))
              (else
                (if (local.get $depth)
                  (then
                    (local.set $brackets (i32.shr_u (local.get $brackets) (i32.const 2)))
                    (local.set $depth (i32.sub (local.get $depth) (i32.const 1)))))
                (local.set $afterValue (i32.const 1))))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ";")) (i32.eq (local.get $c) (i32.const ",")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 0))
            (local.set $member (i32.const 0))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $inherit (i32.const 0))))
            (br $next)))
        ;; `...` in a pattern; `.` selects an attribute
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.and (i32.eq (local.get $c2) (i32.const ".")) (i32.eq (local.get $c3) (i32.const ".")))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 3)))
                (call $emitTok (enum.get $Token.variable.special) (local.get $lhs) (global.get $ptr))
                (local.set $afterValue (i32.const 1)))
              (else
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
                (local.set $member (i32.const 1))
                (local.set $afterValue (i32.const 0))))
            (br $next)))

        (if (call $nixIsOp (local.get $c))
          (then
            (block $opDone
              (loop $op
                (br_if $opDone (i32.eqz (call $nixIsOp (call $nixByte (global.get $ptr)))))
                ;; a comment opener ends the run
                (br_if $opDone (i32.and
                  (i32.eq (call $nixByte (global.get $ptr)) (i32.const "/"))
                  (i32.eq (call $nixByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "*"))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $afterValue (i32.const 0))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (call $utf8SpanEnd (i32.add (global.get $ptr) (i32.const 1)) (global.get $end)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
