(module
  (import "../common.wat")

  (func $c3Byte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0)
      (i32.lt_u (local.get $p) (global.get $end))))

  ;; Group order is the dispatch order in $c3WordHl below. Group 8 holds the
  ;; compile-time words that only exist behind a `$` - `$sizeof`, `$vaarg` -
  ;; and is accepted only there; `$vaconst` and `$vasplat` share their hash
  ;; features with `$vacount` and get direct compares instead.
  (keyword-table $c3Words $mem.c3Words $mem.c3Words+1792 32 512
    (group ;; 1: control
      "if" "do" "asm" "for" "try" "case" "else" "break" "catch" "defer"
      "while" "assert" "return" "switch" "default" "foreach" "continue"
      "nextcase" "foreach_r")
    (group "fn" "macro") ;; 2: declaration, a function head follows
    (group ;; 3: declaration, next name is a type
      "def" "enum" "alias" "union" "struct" "attrdef" "typedef" "distinct"
      "faultdef" "bitstruct" "interface")
    (group "module")            ;; 4: declaration, next name is a namespace
    (group "import")            ;; 5: import
    (group ;; 6: declaration
      "var" "const" "extern" "inline" "static" "tlocal")
    (group ;; 7: built-in types
      "any" "int" "isz" "usz" "bool" "char" "iptr" "long" "uint" "uptr"
      "void" "fault" "float" "ichar" "short" "ulong" "double" "int128"
      "typeid" "ushort" "float16" "uint128" "anyfault" "bfloat16"
      "float128")
    (group ;; 8: compile-time only words, valid behind `$`
      "or" "and" "eval" "exec" "echo" "embed" "endif" "error" "varef"
      "vaarg" "checks" "concat" "vatype" "vaexpr" "append" "endfor"
      "kindof" "nameof" "sizeof" "typeof" "alignof" "defined" "feature"
      "include" "qnameof" "vacount" "offsetof" "evaltype" "is_const"
      "typefrom" "extnameof" "stringify" "endswitch" "endforeach")
    (group "true" "false") ;; 9: booleans
    (group "null"))        ;; 10: built-in constant

  ;; Token in the low byte; the high byte selects the next-name capture:
  ;; 1=function head, 2=type, 3=namespace. $ct is 1 when the word followed
  ;; `$`, where every keyword and compile-time word is a keyword and any
  ;; other name a compile-time variable. -1 means an ordinary identifier.
  (func $c3WordHl (param $lhs i32) (param $rhs i32) (param $ct i32) (result i32)
    (local $g i32)
    (local $w i64)
    (local.set $g (keyword-table.get $c3Words (local.get $lhs) (local.get $rhs)))
    (if (local.get $ct)
      (then
        (if (i32.eq (local.get $g) (i32.const 1))
          (then (return (enum.get $Token.keyword.control))))
        (if (local.get $g)
          (then (return (enum.get $Token.keyword))))
        ;; the two words the table cannot hold; the wide load stays inside
        ;; the input slack, as in the table's own compare
        (if (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 7))
          (then
            (local.set $w (i64.and (i64.load (local.get $lhs)) (i64.const 0x00ffffffffffffff)))
            (if (i32.or
                  (i64.eq (local.get $w) (i64.const "vaconst"))
                  (i64.eq (local.get $w) (i64.const "vasplat")))
              (then (return (enum.get $Token.keyword))))))
        (return (enum.get $Token.variable.special))))
    (if (i32.or (i32.eqz (local.get $g)) (i32.eq (local.get $g) (i32.const 8)))
      (then (return (i32.const -1))))
    (if (i32.eq (local.get $g) (i32.const 1))
      (then (return (enum.get $Token.keyword.control))))
    (if (i32.le_u (local.get $g) (i32.const 4))
      (then (return (i32.or (enum.get $Token.keyword.declaration)
        (i32.shl (i32.sub (local.get $g) (i32.const 1)) (i32.const 8))))))
    (if (i32.eq (local.get $g) (i32.const 5))
      (then (return (i32.or (enum.get $Token.keyword.import) (i32.const 768)))))
    (if (i32.eq (local.get $g) (i32.const 6))
      (then (return (enum.get $Token.keyword.declaration))))
    (if (i32.eq (local.get $g) (i32.const 7))
      (then (return (enum.get $Token.type.builtin))))
    (if (i32.eq (local.get $g) (i32.const 9))
      (then (return (enum.get $Token.boolean))))
    (enum.get $Token.constant.builtin))

  (func $c3IsOp (param $c i32) (result i32)
    (i32.or
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
        (i32.or (i32.eq (local.get $c) (i32.const "*")) (i32.eq (local.get $c) (i32.const "/"))))
      (i32.or
        (i32.or (i32.eq (local.get $c) (i32.const "%")) (i32.eq (local.get $c) (i32.const "=")))
        (i32.or
          (i32.or (i32.eq (local.get $c) (i32.const "!")) (i32.eq (local.get $c) (i32.const "<")))
          (i32.or
            (i32.or (i32.eq (local.get $c) (i32.const ">")) (i32.eq (local.get $c) (i32.const "&")))
            (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "|")) (i32.eq (local.get $c) (i32.const "^")))
              (i32.or (i32.eq (local.get $c) (i32.const "~")) (i32.eq (local.get $c) (i32.const "?")))))))))

  ;; $expect is the pending capture from $c3WordHl: 1 while a function head
  ;; is open - its return type and receiver are types, the name before `(`
  ;; the definition - 2 for a type name and 3 for a dotted module path.
  ;; $member is 1 after `.` and 2 after `::`. All are checkpointed.
  (func $hlC3
    (local $c i32) (local $c2 i32) (local $c3 i32)
    (local $gap i32) (local $lhs i32) (local $rhs i32) (local $p i32)
    (local $kind i32) (local $hl i32) (local $expect i32) (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $gap (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $gap) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (global.get $ptr)))
        (local.set $c2 (call $c3Byte (i32.add (global.get $ptr) (i32.const 1))))
        (local.set $c3 (call $c3Byte (i32.add (global.get $ptr) (i32.const 2))))

        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2) (select
              (enum.get $Token.comment.doc) (enum.get $Token.comment)
              (i32.eq (local.get $c3) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            ;; C3 block comments nest
            (call $lexNestedBlockComment (i32.const "/*") (i32.const "*/") (enum.get $Token.comment))
            (br $next)))
        ;; `<* ... *>` documents and constrains the declaration that follows
        (if (i32.and (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexNestedBlockComment (i32.const "<*") (i32.const "*>") (enum.get $Token.comment.doc))
            (br $next)))

        (if (i32.eq (local.get $c) (i32.const 34))
          (then
            (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const 39))
          (then
            (call $lexString (i32.const 39) (i32.const 0) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))
        ;; raw strings span lines and have no escapes
        (if (i32.eq (local.get $c) (i32.const "`"))
          (then
            (call $lexRawString (i32.const "`") (i32.const 1) (enum.get $Token.string))
            (local.set $member (i32.const 0))
            (br $next)))

        ;; `@attribute` and `@macro_call(...)`
        (if (i32.and (i32.eq (local.get $c) (i32.const "@")) (call $lexIsIdentStart (local.get $c2)))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $lexScanIdent)
            (call $emitTok (enum.get $Token.attribute) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            ;; `x"..."` and `b64"..."` are byte strings
            (if (i32.and
                  (i32.eq (call $c3Byte (local.get $rhs)) (i32.const 34))
                  (i32.or
                    (i32.and
                      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 1))
                      (i32.eq (local.get $c) (i32.const "x")))
                    (i32.and
                      (i32.eq (i32.sub (local.get $rhs) (local.get $lhs)) (i32.const 3))
                      (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "b64")))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (call $lexString (i32.const 34) (i32.const 0) (enum.get $Token.string))
                (local.set $member (i32.const 0))
                (br $next)))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            ;; `$if`, `$sizeof`, and `$Type` are compile-time words
            (if (i32.eq (local.get $c) (i32.const "$"))
              (then
                (call $emitTok
                  (call $c3WordHl (i32.add (local.get $lhs) (i32.const 1)) (local.get $rhs) (i32.const 1))
                  (local.get $lhs) (local.get $rhs))
                (local.set $member (i32.const 0))
                (br $next)))
            (local.set $kind (select (i32.const -1)
              (call $c3WordHl (local.get $lhs) (local.get $rhs) (i32.const 0))
              (i32.eq (local.get $member) (i32.const 1))))
            (if (i32.ge_s (local.get $kind) (i32.const 0))
              (then
                (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                ;; a keyword either arms a capture or ends it; a function
                ;; head keeps its return type keyword - `fn void main(`
                (if (i32.or
                      (i32.ne (local.get $expect) (i32.const 1))
                      (i32.ne (local.get $hl) (enum.get $Token.type.builtin)))
                  (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
              (else
                (if (i32.eq (local.get $expect) (i32.const 1))
                  (then
                    ;; the name before `(` is the definition; anything
                    ;; earlier is its return type, receiver, or module
                    (if (i32.eq (call $c3Byte (local.get $p)) (i32.const "("))
                      (then
                        (local.set $hl (enum.get $Token.function.definition))
                        (local.set $expect (i32.const 0)))
                      (else (local.set $hl (select (enum.get $Token.namespace) (enum.get $Token.type)
                        (i32.eq (call $c3Byte (local.get $p)) (i32.const ":")))))))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.type) (enum.get $Token.namespace)
                          (i32.eq (local.get $expect) (i32.const 2))))
                        ;; a `::` path keeps its capture
                        (if (i32.or
                              (i32.eq (local.get $expect) (i32.const 2))
                              (i32.ne (call $c3Byte (local.get $p)) (i32.const ":")))
                          (then (local.set $expect (i32.const 0)))))
                      (else
                        (if (i32.eq (call $c3Byte (local.get $p)) (i32.const "("))
                          (then
                            (local.set $hl (select
                              (enum.get $Token.function.method) (enum.get $Token.function)
                              (i32.eq (local.get $member) (i32.const 1))))
                            ;; `Foo(` and `Foo{` build a struct
                            (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type)))))
                          (else
                            (if (i32.eq (local.get $member) (i32.const 1))
                              (then (local.set $hl (enum.get $Token.property)))
                              (else
                                (if (call $lexIsConstCase (local.get $lhs) (local.get $rhs))
                                  (then (local.set $hl (enum.get $Token.constant)))
                                  (else
                                    (if (i32.le_u (i32.sub (i32.load8_u (local.get $lhs)) (i32.const "A")) (i32.const 25))
                                      (then (local.set $hl (enum.get $Token.type)))
                                      (else
                                        ;; `io::` names a module
                                        (local.set $hl (select (enum.get $Token.namespace) (enum.get $Token.variable)
                                          (i32.and
                                            (i32.eq (call $c3Byte (local.get $p)) (i32.const ":"))
                                            (i32.eq (call $c3Byte (i32.add (local.get $p) (i32.const 1))) (i32.const ":")))))))))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or (call $lexIsDigit (local.get $c))
                    (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (if (i32.or
              (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")")))
              (i32.or
                (i32.or (i32.eq (local.get $c) (i32.const "[")) (i32.eq (local.get $c) (i32.const "]")))
                (i32.or (i32.eq (local.get $c) (i32.const "{")) (i32.eq (local.get $c) (i32.const "}")))))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.bracket) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            ;; a function head survives its generic braces: `fn List{int}.push(`
            (if (i32.or
                  (i32.ne (local.get $expect) (i32.const 1))
                  (i32.or (i32.eq (local.get $c) (i32.const "(")) (i32.eq (local.get $c) (i32.const ")"))))
              (then (local.set $expect (i32.const 0))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const ",")) (i32.eq (local.get $c) (i32.const ";")))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (local.set $expect (i32.const 0))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const ":"))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (select (i32.const 2) (i32.const 1)
              (i32.eq (local.get $c2) (i32.const ":")))))
            (call $emitTok (enum.get $Token.punctuation.delimiter) (local.get $lhs) (global.get $ptr))
            (local.set $member (select (i32.const 2) (i32.const 0) (i32.eq (local.get $c2) (i32.const ":"))))
            (br $next)))
        (if (i32.eq (local.get $c) (i32.const "."))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.eq (local.get $c2) (i32.const "."))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.eq (local.get $c3) (i32.const "."))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (select (enum.get $Token.operator) (enum.get $Token.punctuation.delimiter)
              (i32.eq (local.get $c2) (i32.const "."))) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.ne (local.get $c2) (i32.const ".")))
            (br $next)))

        (if (call $c3IsOp (local.get $c))
          (then
            (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
            (if (i32.or (i32.eq (local.get $c2) (i32.const "="))
                        (i32.and (i32.eq (local.get $c) (local.get $c2))
                          (i32.or
                            (i32.or (i32.eq (local.get $c) (i32.const "+")) (i32.eq (local.get $c) (i32.const "-")))
                            (i32.or
                              (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                              (i32.or
                                (i32.or (i32.eq (local.get $c) (i32.const "&")) (i32.eq (local.get $c) (i32.const "|")))
                                (i32.or (i32.eq (local.get $c) (i32.const "?")) (i32.eq (local.get $c) (i32.const "!"))))))))
              (then
                (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
                (if (i32.and
                      (i32.or (i32.eq (local.get $c) (i32.const "<")) (i32.eq (local.get $c) (i32.const ">")))
                      (i32.eq (call $c3Byte (global.get $ptr)) (i32.const "=")))
                  (then (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))))))
            (call $emitTok (enum.get $Token.operator) (local.get $lhs) (global.get $ptr))
            (local.set $member (i32.const 0))
            (br $next)))

        (global.set $ptr (i32.add (global.get $ptr) (i32.const 1)))
        (call $emitTok (enum.get $Token.none) (local.get $lhs) (global.get $ptr))
        (local.set $member (i32.const 0))
        (br $next))))
)
