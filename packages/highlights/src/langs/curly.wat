(module
  (import "../emitter.wat")
  (import "@pierre/wat-tools/lexer-state.wat")
  (memory-region $mem.moveWords 232)
  (memory-region $mem.cadenceWords 224)
  (memory-region $mem.vWords 240)
  (memory-region $mem.chapelWords 328)
  (memory-region $mem.ballerinaWords 312)

  (import "@pierre/wat-tools/common.wat")

  ;; Move, Cadence, V, Chapel, and Ballerina share one lexer. Its dialect
  ;; parameter is 0 move, 1 cadence, 2 v, 3 chapel, 4 ballerina.
  (func $hlMove
    (call $hlCurlyImpl (i32.const 0)))
  (func $hlCadence
    (call $hlCurlyImpl (i32.const 1)))
  (func $hlV
    (call $hlCurlyImpl (i32.const 2)))
  (func $hlChapel
    (call $hlCurlyImpl (i32.const 3)))
  (func $hlBallerina
    (call $hlCurlyImpl (i32.const 4)))

  ;; Group values hold the token in the low byte and the capture for the next
  ;; name in bits 8-10: 1 function, 2 type, 3 namespace, 5 Move abilities,
  ;; 6 a Ballerina service path, 7 an import path. Bit 11 marks a soft
  ;; keyword, a name before `:`, `.`, `,`, or `)`: Cadence `borrow(from: p)`.
  (keyword-table $moveWords $mem.moveWords $mem.moveWords+232
    (group $Token.keyword.declaration+256 "fun")
    (group $Token.keyword.declaration+512 "struct" "enum" "schema")
    (group $Token.keyword.declaration+768 "module")
    (group $Token.keyword.import+1792 "use" "friend")
    (group $Token.keyword.control
      "if" "else" "while" "loop" "for" "return" "abort" "break" "continue" "match")
    (group $Token.keyword.declaration "let" "const" "spec")
    (group $Token.keyword+1280 "has")
    (group $Token.keyword
      "public" "entry" "native" "inline" "mut" "acquires" "copy" "move" "phantom" "macro"
      "requires" "ensures" "aborts_if" "invariant" "pragma")
    (group $Token.keyword.operator "as")
    (group $Token.type.builtin
      "u8" "u16" "u32" "u64" "u128" "u256" "bool" "address" "signer" "vector")
    (group $Token.boolean "true" "false")
    (group $Token.variable.special "Self")
    (group $Token.function
      "borrow_global" "borrow_global_mut" "move_to" "move_from" "exists" "freeze"))

  (keyword-table $cadenceWords $mem.cadenceWords $mem.cadenceWords+224
    (group $Token.keyword.declaration+256 "fun")
    (group $Token.keyword.declaration+512
      "contract" "resource" "struct" "event" "interface" "enum" "attachment" "entitlement")
    (group $Token.keyword.import+1792 "import")
    (group $Token.keyword.import+2048 "from")
    (group $Token.keyword+2048 "to")
    (group $Token.keyword.control
      "if" "else" "while" "for" "return" "break" "continue" "switch" "case" "default" "emit")
    (group $Token.keyword.declaration "let" "var" "init")
    (group $Token.keyword
      "access" "all" "account" "pub" "priv" "create" "destroy" "auth" "view" "transaction"
      "prepare" "execute" "pre" "post" "remove" "attach" "native")
    (group $Token.keyword.operator "as" "in")
    (group $Token.type.builtin
      "String" "Int" "Bool" "Address" "UInt8" "UInt64" "UFix64" "Fix64" "Void" "AnyStruct"
      "AnyResource")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "nil")
    (group $Token.variable.special "self"))

  (keyword-table $vWords $mem.vWords $mem.vWords+240
    (group $Token.keyword.declaration+256 "fn")
    (group $Token.keyword.declaration+512 "struct" "interface" "enum" "union" "type")
    (group $Token.keyword.declaration+768 "module")
    (group $Token.keyword.import+1792 "import")
    (group $Token.keyword.control
      "if" "else" "for" "match" "or" "return" "break" "continue" "goto" "defer" "go" "spawn"
      "select" "lock" "rlock" "unsafe" "assert")
    (group $Token.keyword.declaration "const" "__global")
    (group $Token.keyword "mut" "pub" "static" "shared" "atomic" "volatile")
    (group $Token.keyword.operator "in" "is" "as")
    (group $Token.type.builtin
      "int" "i8" "i16" "i32" "i64" "u8" "u16" "u32" "u64" "f32" "f64" "string" "bool" "rune"
      "byte" "voidptr" "isize" "usize" "any" "chan" "map")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "none" "nil"))

  (keyword-table $chapelWords $mem.chapelWords $mem.chapelWords+328
    (group $Token.keyword.declaration+256 "proc" "iter" "operator")
    (group $Token.keyword.declaration+512 "record" "class" "union" "enum" "type")
    (group $Token.keyword.declaration+768 "module")
    (group $Token.keyword.import+768 "use" "import" "require")
    (group $Token.keyword.control
      "if" "then" "else" "for" "forall" "coforall" "foreach" "do" "while" "select" "when"
      "otherwise" "return" "yield" "break" "continue" "begin" "cobegin" "sync" "serial" "on"
      "local" "try" "catch" "throw" "defer")
    (group $Token.keyword.declaration "var" "const" "param" "config" "ref" "let")
    (group $Token.keyword
      "public" "private" "export" "extern" "inline" "override" "throws" "with" "zip"
      "by" "reduce" "scan" "dmapped" "new" "delete" "owned" "shared" "borrowed" "unmanaged"
      "noinit" "only" "out" "inout")
    (group $Token.keyword.operator "in" "as")
    (group $Token.type.builtin
      "int" "uint" "real" "imag" "complex" "bool" "string" "bytes" "void" "nothing" "domain"
      "range" "locale")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "nil" "none")
    (group $Token.variable.special "this" "super" "here"))

  (keyword-table $ballerinaWords $mem.ballerinaWords $mem.ballerinaWords+312
    (group $Token.keyword.declaration+256 "function")
    (group $Token.keyword.declaration+512 "type" "class" "enum")
    (group $Token.keyword.declaration+1536 "service")
    (group $Token.keyword.import+1792 "import")
    (group $Token.keyword.control
      "if" "else" "while" "foreach" "match" "return" "break" "continue" "panic" "check"
      "checkpanic" "fail" "do" "on" "trap" "lock" "transaction" "retry" "rollback" "commit"
      "from" "select" "let" "join" "order" "by" "limit" "wait" "fork" "start")
    (group $Token.keyword.declaration
      "var" "final" "const" "resource" "remote" "isolated" "public" "private" "listener"
      "client" "configurable" "annotation" "worker")
    (group $Token.keyword "returns" "new" "record" "object" "readonly" "distinct" "table" "stream")
    (group $Token.keyword.operator "in" "is" "as" "typeof")
    (group $Token.type.builtin
      "int" "float" "decimal" "string" "boolean" "byte" "json" "xml" "map" "any" "anydata"
      "error" "never" "handle" "future" "typedesc")
    (group $Token.boolean "true" "false")
    (group $Token.constant.builtin "null")
    (group $Token.variable.special "self"))

  ;; The dialect's keyword value for [$lhs,$rhs), or -1.
  (func $curlyWordHl (param $dialect i32) (param $lhs i32) (param $rhs i32) (result i32)
    ;; `where` shares a table hash with `while` in Chapel and Ballerina; the
    ;; wide load stays in the input slack, as in the table's own compare
    (if
      (i32.and
        (i32.ge_u (local.get $dialect) (i32.const 3))
        (i32.and
          (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 5))
          (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "where"))))
      (then
        (return
          (select
            (enum.get $Token.keyword.control)
            (enum.get $Token.keyword)
            (i32.eq (local.get $dialect) (i32.const 4))))))
    (if (i32.eqz (local.get $dialect))
      (then (return (keyword-table.value $moveWords (local.get $lhs) (local.get $rhs)))))
    (if (i32.eq (local.get $dialect) (i32.const 1))
      (then (return (keyword-table.value $cadenceWords (local.get $lhs) (local.get $rhs)))))
    (if (i32.eq (local.get $dialect) (i32.const 2))
      (then (return (keyword-table.value $vWords (local.get $lhs) (local.get $rhs)))))
    (if (i32.eq (local.get $dialect) (i32.const 3))
      (then (return (keyword-table.value $chapelWords (local.get $lhs) (local.get $rhs)))))
    (keyword-table.value $ballerinaWords (local.get $lhs) (local.get $rhs)))

  ;; The string state that quote $c opens in $dialect, or 0: the quote byte,
  ;; plus 0x100 multiline, 0x200 backslash escapes, 0x400 `${` templates,
  ;; 0x800 `$name` templates, 0x1000 a triple quote (set by the caller), and
  ;; 0x2000 Cadence `\(` templates.
  (func $curlyQuote (param $dialect i32) (param $c i32) (result i32)
    ;; V: `'` and `"` are multiline templates, a backtick quotes a rune
    (if (i32.eq (local.get $dialect) (i32.const 2))
      (then
        (return
          (i32.or
            (local.get $c)
            (select (i32.const 0x200) (i32.const 0xf00) (i32.eq (local.get $c) (i32.const "`")))))))
    (if (i32.eq (local.get $c) (i32.const 34))
      (then
        (return
          (select (i32.const 0x2222) (i32.const 0x222) (i32.eq (local.get $dialect) (i32.const 1))))))
    (if (i32.and (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $dialect) (i32.const 3)))
      (then (return (i32.const 0x227))))
    ;; Ballerina backtick templates span lines and have no escapes
    (if (i32.and (i32.eq (local.get $c) (i32.const "`")) (i32.eq (local.get $dialect) (i32.const 4)))
      (then (return (i32.const 0x560))))
    (i32.const 0))

  ;; Scan a string body from $ptr with state $str (see $curlyQuote). The
  ;; bytes since $seg are not yet emitted. Returns 1 past the closing quote,
  ;; 2 past a template opener (`${` or `\(`, emitted as punctuation.special),
  ;; 3 when an escaped line break ends at $end, and 0 at $end or at the raw
  ;; line break of a single-line string. Inside an interpolation ($nested),
  ;; a nested string keeps its template openers as text, so one level of
  ;; state is enough. The next stop byte and the next `$` before it are each
  ;; found with one SIMD scan, so the scan stays linear.
  (func $curlyStringBody (param $str i32) (param $nested i32) (param $seg i32) (result i32)
    (local $q i32)
    (local $c i32)
    (local $stop i32)
    (local $dollar i32)
    (local $status i32)
    (local.set $q (i32.and (local.get $str) (i32.const 255)))
    (local.set $stop (global.get $ptr))
    (block $done
      (loop $scan
        (if (i32.ge_u (global.get $ptr) (local.get $stop))
          (then
            (local.set $stop
              (call $scanFindSpecial
                (global.get $ptr)
                (global.get $end)
                (local.get $q)
                (i32.ne (i32.and (local.get $str) (i32.const 0x2200)) (i32.const 0))
                (i32.eqz (i32.and (local.get $str) (i32.const 0x100)))))
            (local.set $dollar (i32.const 0))))
        (if (i32.gt_u (global.get $ptr) (local.get $dollar))
          (then
            (if (i32.and (local.get $str) (i32.const 0x400))
              (then
                (local.set $dollar
                  (call $scanFindSpecial
                    (global.get $ptr)
                    (local.get $stop)
                    (i32.const "$")
                    (i32.const 0)
                    (i32.const 0))))
              (else (local.set $dollar (local.get $stop))))))
        (global.set $ptr
          (select
            (local.get $dollar)
            (local.get $stop)
            (i32.lt_u (local.get $dollar) (local.get $stop))))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (if (i32.eq (local.get $c) (local.get $q))
          (then
            (if
              (i32.or
                (i32.eqz (i32.and (local.get $str) (i32.const 0x1000)))
                (i32.and
                  (i32.eq
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                    (local.get $q))
                  (i32.eq
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 2)))
                    (local.get $q))))
              (then
                ;; the trailing quotes read below $end, so this cannot overshoot
                (global.set $ptr
                  (i32.add
                    (global.get $ptr)
                    (select
                      (i32.const 3)
                      (i32.const 1)
                      (i32.and (local.get $str) (i32.const 0x1000)))))
                (local.set $status (i32.const 1))
                (br $done)))
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (br $scan)))
        (br_if $done
          (i32.or (i32.eq (local.get $c) (i32.const 10)) (i32.eq (local.get $c) (i32.const 13))))
        (if (i32.eq (local.get $c) (i32.const 92))
          (then
            (if
              (i32.and
                (i32.ne (i32.and (local.get $str) (i32.const 0x2000)) (i32.const 0))
                (i32.and
                  (i32.eqz (local.get $nested))
                  (i32.eq
                    (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))
                    (i32.const "("))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
                (local.set $c (global.get $ptr))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.special) (local.get $c) (global.get $ptr))
                (return (i32.const 2))))
            (if (call $stringEscapeAt (local.get $seg))
              (then (local.set $status (i32.const 3))))
            (local.set $seg (global.get $ptr))
            (br $scan)))
        ;; `$`: `${` opens a template, and V also reads `$name`
        (if
          (i32.or
            (i32.ne (i32.and (local.get $str) (i32.const 0x800)) (i32.const 0))
            (i32.eq (call $templateByte (i32.add (global.get $ptr) (i32.const 1))) (i32.const "{")))
          (then
            (local.set $seg (call $stringDollarAt (local.get $seg) (i32.const 16) (local.get $nested)))
            (br_if $scan (i32.ge_s (local.get $seg) (i32.const 0)))
            (return (i32.const 2))))
        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (br $scan)))
    (call $emitTok (enum.get $Token.string) (local.get $seg) (global.get $ptr))
    (local.get $status))

  ;; $str is the open string's state (see $curlyQuote), with $seg the start
  ;; of its bytes not yet emitted. $interp counts the brackets of an open
  ;; template expression, and $interpStr is the string to return to. $expect
  ;; is the pending capture of a keyword (see the tables), or 4 for a name
  ;; after a V receiver `fn (r T) name(`; $recv is 1 inside that receiver.
  ;; All of these are checkpointed between stream chunks.
  (func $hlCurlyImpl (param $dialect i32)
    (local $c i32)
    (local $c2 i32)
    (local $c3 i32)
    (local $gap i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (local $attr i32)
    (local $recv i32)
    (local $str i32)
    (local $seg i32)
    (local $interp i32)
    (local $interpStr i32)
    (local $status i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        ;; an open string body; $seg is zero across a chunk boundary, where
        ;; the body resumes at the chunk start
        (if (local.get $str)
          (then
            (if (i32.ge_u (global.get $ptr) (global.get $end))
              (then
                (local.set $seg (i32.const 0))
                (br $done)))
            (if (i32.eqz (local.get $seg))
              (then (local.set $seg (global.get $ptr))))
            (local.set $status
              (call $curlyStringBody (local.get $str) (local.get $interp) (local.get $seg)))
            (local.set $seg (global.get $ptr))
            (if (i32.eq (local.get $status) (i32.const 2))
              (then
                (local.set $interpStr (local.get $str))
                (local.set $interp (i32.const 1))
                (local.set $str (i32.const 0))
                (local.set $seg (i32.const 0)))
              (else
                ;; closed, or a single-line body cut by a raw line break
                (if
                  (i32.or
                    (i32.eq (local.get $status) (i32.const 1))
                    (i32.eqz
                      (i32.or (local.get $status) (i32.and (local.get $str) (i32.const 0x100)))))
                  (then
                    (local.set $str (i32.const 0))
                    (local.set $seg (i32.const 0))))))
            (br $next)))

        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $templateByte (i32.add (local.get $lhs) (i32.const 1))))
        (local.set $c3 (call $templateByte (i32.add (local.get $lhs) (i32.const 2))))
        ;; a branch that leaves $tailE ends any pending capture and clears
        ;; $member; one that leaves $tailM only clears $member
        (block $tailM
        (block $tailE

        ;; `//` and nesting `/*` comments (Ballerina has only `//`); `///`
        ;; and `/**` are doc comments
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const "/"))
            (i32.or
              (i32.eq (local.get $c2) (i32.const "/"))
              (i32.and
                (i32.eq (local.get $c2) (i32.const "*"))
                (i32.ne (local.get $dialect) (i32.const 4)))))
          (then
            (local.set $hl
              (select
                (enum.get $Token.comment.doc)
                (enum.get $Token.comment)
                (i32.and
                  (i32.eq (local.get $c3) (local.get $c2))
                  (i32.ne
                    (call $templateByte (i32.add (local.get $lhs) (i32.const 3)))
                    (local.get $c2)))))
            (if (i32.eq (local.get $c2) (i32.const "/"))
              (then (call $lexLineComment (i32.const 2) (local.get $hl)))
              (else (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (local.get $hl))))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const "#"))
          (then
            ;; Ballerina `# docs` lines
            (if (i32.eq (local.get $dialect) (i32.const 4))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.comment.doc))
                (br $next)))
            ;; Move `#[test]`: the next name is an attribute
            (if (i32.and (i32.eqz (local.get $dialect)) (i32.eq (local.get $c2) (i32.const "[")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                (local.set $attr (i32.const 1))
                (br $tailM)))
            ;; V `#include` and `#flag`, Cadence `#allowAccountLinking`
            (if
              (i32.and
                (call $lexIsIdentStart (local.get $c2))
                (i32.le_u (i32.sub (local.get $dialect) (i32.const 1)) (i32.const 1)))
              (then
                (call $lexLineComment (i32.const 1) (enum.get $Token.preproc))
                (br $next)))
            ;; Chapel `#` counts
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (br $tailE)))

        (if (i32.eq (local.get $c) (i32.const "@"))
          (then
            ;; Cadence `@R`: a resource type
            (if (i32.eq (local.get $dialect) (i32.const 1))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $tailM)))
            ;; V `@[attr]`
            (if (i32.and (i32.eq (local.get $dialect) (i32.const 2)) (i32.eq (local.get $c2) (i32.const "[")))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
                (local.set $attr (i32.const 1))
                (br $tailM)))
            ;; Move addresses `@0x1` and `@std`, V `@FILE`, and annotations
            ;; `@http:ServiceConfig` (Ballerina) or `@attr.name` (Chapel)
            (if (call $lexIsIdentContinue (local.get $c2))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                (block $nameDone
                  (loop $name
                    (call $scanIdentRun (i32.const "_"))
                    (br_if $nameDone (i32.lt_u (local.get $dialect) (i32.const 3)))
                    (local.set $p (call $templateByte (global.get $ptr)))
                    (br_if $nameDone
                      (i32.eqz
                        (i32.and
                          (i32.or (i32.eq (local.get $p) (i32.const ":")) (i32.eq (local.get $p) (i32.const ".")))
                          (call $lexIsIdentStart
                            (call $templateByte (i32.add (global.get $ptr) (i32.const 1)))))))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                    (br $name)))
                (call $emitTok
                  (select
                    (enum.get $Token.constant)
                    (select
                      (enum.get $Token.constant.builtin)
                      (enum.get $Token.attribute)
                      (i32.eq (local.get $dialect) (i32.const 2)))
                    (i32.eqz (local.get $dialect)))
                  (local.get $lhs)
                  (global.get $ptr))
                (br $tailM)))))

        ;; Move `'label` and Ballerina `'quoted` identifiers
        (if
          (i32.and
            (i32.eq (local.get $c) (i32.const 39))
            (i32.and
              (call $lexIsIdentStart (local.get $c2))
              (i32.or (i32.eqz (local.get $dialect)) (i32.eq (local.get $dialect) (i32.const 4)))))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $scanIdentRun (i32.const "_"))
            (call $emitTok
              (select (enum.get $Token.label) (enum.get $Token.variable) (i32.eqz (local.get $dialect)))
              (local.get $lhs)
              (global.get $ptr))
            (br $tailM)))

        ;; a string opener is emitted at once; its body is scanned at the top
        ;; of the loop, where it can also resume after a chunk boundary
        (if
          (i32.or
            (i32.eq (local.get $c) (i32.const 34))
            (i32.or (i32.eq (local.get $c) (i32.const 39)) (i32.eq (local.get $c) (i32.const "`"))))
          (then
            (local.set $str (call $curlyQuote (local.get $dialect) (local.get $c)))
            (if (local.get $str)
              (then
                ;; Chapel `"""` and `'''` strings span lines
                (if
                  (i32.and
                    (i32.eq (local.get $dialect) (i32.const 3))
                    (i32.and (i32.eq (local.get $c2) (local.get $c)) (i32.eq (local.get $c3) (local.get $c))))
                  (then
                    (local.set $str (i32.or (local.get $str) (i32.const 0x1100)))
                    (global.set $ptr (i32.add (global.get $ptr) (i32.const 2)))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                (local.set $seg (global.get $ptr))
                (br $tailM)))))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $c3 (call $templateByte (local.get $rhs)))
            ;; string prefixes: Move `b"bytes"` and `x"ff"`, V `r'raw'` and
            ;; `c'text'`, Chapel `b"bytes"`
            (if
              (i32.and
                (i32.eq (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1)))
                (i32.or (i32.eq (local.get $c3) (i32.const 34)) (i32.eq (local.get $c3) (i32.const 39))))
              (then
                (local.set $str
                  (select
                    (i32.or
                      (local.get $c3)
                      (select (i32.const 0x100) (i32.const 0x300) (i32.eq (local.get $c) (i32.const "r"))))
                    (select
                      (i32.or (local.get $c3) (i32.const 0x200))
                      (i32.const 0)
                      (i32.or
                        (i32.and
                          (i32.eqz (local.get $dialect))
                          (i32.and
                            (i32.eq (local.get $c3) (i32.const 34))
                            (i32.or (i32.eq (local.get $c) (i32.const "b")) (i32.eq (local.get $c) (i32.const "x")))))
                        (i32.and (i32.eq (local.get $dialect) (i32.const 3)) (i32.eq (local.get $c) (i32.const "b")))))
                    (i32.and
                      (i32.eq (local.get $dialect) (i32.const 2))
                      (i32.or (i32.eq (local.get $c) (i32.const "r")) (i32.eq (local.get $c) (i32.const "c"))))))
                (if (local.get $str)
                  (then
                    (global.set $ptr (i32.add (local.get $rhs) (i32.const 1)))
                    (call $emitTok (enum.get $Token.string) (local.get $lhs) (global.get $ptr))
                    (local.set $seg (global.get $ptr))
                    (br $tailM)))))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; the byte after the name's blanks
            (local.set $c2 (call $templateByte (local.get $p)))
            ;; V `$if` and `$for` compile-time words, Move `$x` macro parameters
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then
                (local.set $kind (i32.const -1))
                (if (i32.gt_u (local.get $rhs) (i32.add (local.get $lhs) (i32.const 1)))
                  (then
                    (local.set $kind
                      (call $curlyWordHl
                        (local.get $dialect)
                        (i32.add (local.get $lhs) (i32.const 1))
                        (local.get $rhs)))))
                (call $emitTok
                  (select
                    (i32.and (local.get $kind) (i32.const 255))
                    (select
                      (enum.get $Token.function)
                      (enum.get $Token.variable)
                      (i32.eq (local.get $c2) (i32.const "(")))
                    (i32.ge_s (local.get $kind) (i32.const 0)))
                  (local.get $lhs)
                  (local.get $rhs))
                (br $tailM)))
            ;; after `.`, keywords are field names
            (local.set $kind
              (select
                (i32.const -1)
                (call $curlyWordHl (local.get $dialect) (local.get $lhs) (local.get $rhs))
                (i32.eq (local.get $member) (i32.const 1))))
            (if
              (i32.and
                (i32.gt_s (local.get $kind) (i32.const 2047))
                (i32.or
                  (i32.eq (local.get $c2) (i32.const ":"))
                  (i32.or
                    (i32.eq (local.get $c2) (i32.const "."))
                    (i32.or (i32.eq (local.get $c2) (i32.const ",")) (i32.eq (local.get $c2) (i32.const ")"))))))
              (then (local.set $kind (i32.const -1))))
            (block $named
              (if (i32.ge_s (local.get $kind) (i32.const 0))
                (then
                  (local.set $hl
                    (select
                      (enum.get $Token.type.builtin)
                      (i32.and (local.get $kind) (i32.const 255))
                      (i32.eq (local.get $expect) (i32.const 5))))
                  ;; a keyword after a receiver's `)` is a result type
                  (if (i32.eq (local.get $expect) (i32.const 4))
                    (then (local.set $expect (i32.const 0))))
                  (if (i32.and (local.get $kind) (i32.const 0x700))
                    (then
                      (local.set $expect
                        (i32.and (i32.shr_u (local.get $kind) (i32.const 8)) (i32.const 7)))))
                  (br $named)))
              (if (local.get $attr)
                (then
                  (local.set $hl (enum.get $Token.attribute))
                  (local.set $attr (i32.const 0))
                  (br $named)))
              (if (i32.eq (local.get $expect) (i32.const 1))
                (then
                  ;; Ballerina `resource function get path()`: the accessor
                  (local.set $hl (enum.get $Token.keyword))
                  (br_if $named
                    (i32.and
                      (i32.eq (local.get $dialect) (i32.const 4))
                      (i32.and
                        (i32.gt_u (local.get $p) (local.get $rhs))
                        (i32.or
                          (call $lexIsIdentStart (local.get $c2))
                          (i32.or
                            (i32.eq (local.get $c2) (i32.const "/"))
                            (i32.or (i32.eq (local.get $c2) (i32.const "[")) (i32.eq (local.get $c2) (i32.const "."))))))))
                  ;; `proc Point.norm()`: the receiver type before the name
                  (local.set $hl (enum.get $Token.type))
                  (br_if $named (i32.eq (local.get $c3) (i32.const ".")))
                  (local.set $hl (enum.get $Token.function.definition))
                  (local.set $expect (i32.const 0))
                  (br $named)))
              (if (i32.eq (local.get $expect) (i32.const 2))
                (then
                  (local.set $hl (enum.get $Token.type))
                  (local.set $expect (i32.const 0))
                  (br $named)))
              ;; Move `has key, store`
              (if (i32.eq (local.get $expect) (i32.const 5))
                (then
                  (local.set $hl (enum.get $Token.type.builtin))
                  (br $named)))
              (if (i32.and (local.get $expect) (i32.eq (i32.and (local.get $expect) (i32.const 3)) (i32.const 3)))
                (then
                  (local.set $hl (enum.get $Token.namespace))
                  ;; the path goes on after `::`, `.`, or an import's `/`
                  (br_if $named
                    (i32.or
                      (i32.eq (local.get $c3) (i32.const "."))
                      (i32.or
                        (i32.and
                          (i32.eq (local.get $c3) (i32.const ":"))
                          (i32.eq (call $templateByte (i32.add (local.get $rhs) (i32.const 1))) (i32.const ":")))
                        (i32.and
                          (i32.eq (local.get $c3) (i32.const "/"))
                          (i32.eq (local.get $expect) (i32.const 7))))))
                  ;; the last segment of an import is a module or a type
                  (if
                    (i32.and
                      (i32.eq (local.get $expect) (i32.const 7))
                      (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
                    (then (local.set $hl (enum.get $Token.type))))
                  ;; a list goes on after `,`: `use IO, Math;`
                  (br_if $named (i32.eq (local.get $c2) (i32.const ",")))
                  (local.set $expect (i32.const 0))
                  (br $named)))
              (if (i32.eq (local.get $expect) (i32.const 4))
                (then
                  (local.set $expect (i32.const 0))
                  (local.set $hl (enum.get $Token.function.definition))
                  (br_if $named (i32.eq (local.get $c2) (i32.const "(")))))
              (local.set $expect (i32.const 0))
              ;; calls, and Move macros `assert!(`
              (local.set $hl
                (select (enum.get $Token.function.method) (enum.get $Token.function) (i32.eq (local.get $member) (i32.const 1))))
              (br_if $named (i32.eq (local.get $c2) (i32.const "(")))
              ;; a generic member call: Move `vector::empty<u64>()`,
              ;; Cadence `storage.borrow<&T>(`
              (br_if $named
                (i32.and
                  (i32.and (i32.ne (local.get $member) (i32.const 0)) (i32.eq (local.get $c3) (i32.const "<")))
                  (i32.gt_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))))
              (local.set $hl (enum.get $Token.function))
              (br_if $named
                (i32.and
                  (i32.eq (local.get $c2) (i32.const "!"))
                  (i32.eq (call $templateByte (i32.add (local.get $p) (i32.const 1))) (i32.const "("))))
              ;; module paths: Move `coin::value`, Ballerina `http:Listener`
              (local.set $hl (enum.get $Token.namespace))
              (if (i32.eq (local.get $c3) (i32.const ":"))
                (then
                  (local.set $p (call $templateByte (i32.add (local.get $rhs) (i32.const 1))))
                  (br_if $named
                    (i32.and
                      (i32.eqz (local.get $dialect))
                      (i32.and
                        (i32.eq (local.get $p) (i32.const ":"))
                        (i32.gt_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))))
                  (br_if $named
                    (i32.and
                      (i32.eq (local.get $dialect) (i32.const 4))
                      (call $lexIsIdentStart (local.get $p))))))
              (local.set $hl (enum.get $Token.constant))
              (br_if $named (call $lexIsConstCase (local.get $lhs) (local.get $rhs)))
              (local.set $hl (enum.get $Token.type))
              (br_if $named (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25)))
              (local.set $hl (select (enum.get $Token.property) (enum.get $Token.variable) (local.get $member))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (br $tailM)))

        ;; a number keeps a pending capture: `module 0x1::coin`
        (if
          (i32.or
            (call $lexIsDigit (local.get $c))
            (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $tailM)))

        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            ;; Ballerina `{|` closed records
            (if
              (i32.and
                (i32.eq (local.get $dialect) (i32.const 4))
                (i32.and (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c2) (i32.const "|"))))
              (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))
            (if (local.get $interp)
              (then
                (local.set $p (i32.and (local.get $interpStr) (i32.const 0x2000)))
                (if (i32.eq (local.get $c) (select (i32.const "(") (i32.const "{") (local.get $p)))
                  (then (local.set $interp (i32.add (local.get $interp) (i32.const 1)))))
                (if (i32.eq (local.get $c) (select (i32.const ")") (i32.const "}") (local.get $p)))
                  (then
                    (local.set $interp (i32.sub (local.get $interp) (i32.const 1)))
                    (if (i32.eqz (local.get $interp))
                      (then
                        ;; the bracket that closes the template returns to the string
                        (call $emitTok
                          (enum.get $Token.punctuation.special)
                          (local.get $lhs)
                          (global.get $ptr))
                        (local.set $str (local.get $interpStr))
                        (local.set $seg (global.get $ptr))
                        (br $tailE)))))))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            ;; V `fn (r T) name(`: a paren right after `fn` opens a receiver,
            ;; and a name after its `)` on the same line may be the method
            (if (i32.and (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $expect) (i32.const 1)))
              (then (local.set $recv (i32.const 1))))
            (if (i32.and (i32.eq (local.get $c) (i32.const ")")) (local.get $recv))
              (then
                (local.set $recv (i32.const 0))
                (if (call $lexIsIdentStart (call $templateByte (call $lexSkipSpaceAt (global.get $ptr))))
                  (then
                    (local.set $expect (i32.const 4))
                    (br $tailM)))))
            (if (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))
              (then (local.set $recv (i32.const 0))))
            (br $tailE)))

        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (if (i32.eq (local.get $c) (i32.const ";"))
              (then (local.set $recv (i32.const 0))))
            ;; lists go on: `has key, store`, `use IO, Math`
            (br_if $tailM
              (i32.and
                (i32.eq (local.get $c) (i32.const ","))
                (i32.or
                  (i32.eq (local.get $expect) (i32.const 5))
                  (i32.eq (i32.and (local.get $expect) (i32.const 3)) (i32.const 3)))))
            (br $tailE)))

        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            ;; V `:=`
            (if (i32.eq (local.get $c2) (i32.const "="))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $tailE)))
            (global.set $ptr
              (i32.add (local.get $lhs) (select (i32.const 2) (i32.const 1) (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (br_if $tailE (i32.ne (local.get $c2) (i32.const ":")))
            ;; `::` puts the next name in path position; a namespace capture goes on
            (if (i32.ne (i32.and (local.get $expect) (i32.const 3)) (i32.const 3))
              (then (local.set $expect (i32.const 0))))
            (local.set $member (i32.const 2))
            (br $next)))

        ;; `.` puts the next name in member position and keeps a pending
        ;; capture (`proc Point.norm`, `import net.http`); `..`, `..<`, and
        ;; `...` are operators
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr
                  (i32.add
                    (local.get $lhs)
                    (select
                      (i32.const 3)
                      (i32.const 2)
                      (i32.or (i32.eq (local.get $c3) (i32.const ".")) (i32.eq (local.get $c3) (i32.const "<"))))))
                (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
                (br $tailE)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 1))
            (br $next)))

        (if (byteset.get "!%&*+-/<=>?^|~" (local.get $c))
          (then
            (if (i32.eq (local.get $c) (i32.const "/"))
              (then
                ;; Ballerina `service /hello/world on`: the service path
                (if (i32.eq (local.get $expect) (i32.const 6))
                  (then
                    (global.set $ptr (local.get $lhs))
                    (block $pathDone
                      (loop $path
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (call $scanIdentRun (i32.const "-"))
                        (br_if $path (i32.eq (call $templateByte (global.get $ptr)) (i32.const "/")))))
                    (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                    (br $tailE)))
                ;; Cadence storage paths `/storage/vault`
                (if (i32.and (i32.eq (local.get $dialect) (i32.const 1)) (call $lexIsIdentStart (local.get $c2)))
                  (then
                    (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
                    (call $scanIdentRun (i32.const "_"))
                    (local.set $p (i32.sub (global.get $ptr) (local.get $lhs)))
                    (if
                      (i32.and
                        (i32.eq (call $templateByte (global.get $ptr)) (i32.const "/"))
                        (i32.or
                          (i32.and
                            (i32.eq (local.get $p) (i32.const 8))
                            (i32.or
                              (i64.eq
                                (i64.and (i64.load offset=1 (local.get $lhs)) (i64.const 0xffffffffffffff))
                                (i64.const "storage"))
                              (i64.eq
                                (i64.and (i64.load offset=1 (local.get $lhs)) (i64.const 0xffffffffffffff))
                                (i64.const "private"))))
                          (i32.and
                            (i32.eq (local.get $p) (i32.const 7))
                            (i64.eq
                              (i64.and (i64.load offset=1 (local.get $lhs)) (i64.const 0xffffffffffff))
                              (i64.const "public")))))
                      (then
                        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                        (call $scanIdentRun (i32.const "_"))
                        (call $emitTok (enum.get $Token.string.special) (local.get $lhs) (global.get $ptr))
                        (br $tailE)))
                    (global.set $ptr (local.get $lhs))))))
            ;; Ballerina `|}` closed records
            (if
              (i32.and
                (i32.eq (local.get $dialect) (i32.const 4))
                (i32.and (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c2) (i32.const "}"))))
              (then
                (global.set $ptr (i32.add (local.get $lhs) (i32.const 2)))
                (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
                (br $tailE)))
            (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
            (block $opDone
              (loop $op
                (local.set $c2 (call $templateByte (global.get $ptr)))
                (br_if $opDone (i32.eqz (byteset.get "!%&*+-/<=>?^|~" (local.get $c2))))
                ;; a comment opener ends the run
                (local.set $c3 (call $templateByte (i32.add (global.get $ptr) (i32.const 1))))
                (br_if $opDone
                  (i32.and
                    (i32.eq (local.get $c2) (i32.const "/"))
                    (i32.or (i32.eq (local.get $c3) (i32.const "/")) (i32.eq (local.get $c3) (i32.const "*")))))
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (br $op)))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            ;; an import path goes on after `/`: `import ballerina/http`
            (br_if $tailM (i32.eq (local.get $expect) (i32.const 7)))
            (br $tailE)))

        (global.set $ptr (i32.add (local.get $lhs) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr)))
        (local.set $expect (i32.const 0)))
        (local.set $member (i32.const 0))
        (br $next))))
)
