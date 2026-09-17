(module
  (import "../common.wat")

  (func $solByte (param $p i32) (result i32)
    (select (i32.load8_u (local.get $p)) (i32.const 0) (i32.lt_u (local.get $p) (global.get $end))))

  (keyword-table $solidityWords $mem.solidityWords $mem.swiftWords
    (group $Token.keyword.declaration+256 "function" "modifier" "event" "error")
    (group $Token.keyword.declaration+512 "contract" "interface" "library" "struct" "enum" "type")
    (group $Token.keyword.declaration "constructor" "fallback" "receive" "let")
    (group $Token.keyword.control
      "if" "else" "for" "while" "do" "break" "continue" "return" "returns" "try" "catch"
      "revert" "emit" "throw" "switch" "case" "default" "leave")
    (group $Token.keyword.import "import" "from" "as" "using")
    (group $Token.keyword
      "pragma" "abstract" "is" "public" "private" "internal" "external" "view" "pure"
      "payable" "immutable" "memory" "storage" "calldata" "transient" "virtual"
      "override" "anonymous" "indexed" "new" "delete" "unchecked" "assembly" "global")
    (group $Token.type.builtin "address" "bool" "string" "bytes" "byte" "int" "uint" "fixed" "ufixed" "mapping")
    (group $Token.boolean "true" "false")
    (group $Token.variable.special "this" "super" "msg" "block" "tx" "abi")
    (group $Token.constant.builtin "wei" "gwei" "ether" "seconds" "minutes" "hours" "days" "weeks")
    (group $Token.function
      "assert" "keccak256" "sha256" "ripemd160" "ecrecover" "addmod" "mulmod"
      "selfdestruct" "gasleft" "blockhash" "blobhash" "sload" "sstore" "mload" "mstore"
      "calldataload" "calldatacopy" "returndatacopy" "returndatasize" "delegatecall" "staticcall"))

  ;; Declarations retain the next name's kind across comments and line breaks.
  (func $hlSolidity
    (local $c i32)
    (local $c2 i32)
    (local $lhs i32)
    (local $rhs i32)
    (local $p i32)
    (local $n i32)
    (local $kind i32)
    (local $hl i32)
    (local $expect i32)
    (local $member i32)
    (call $lexEmitLeadingContinuation)
    (block $done
      (loop $next
        (local.set $lhs (global.get $ptr))
        (call $scanWhitespace)
        (call $emitGap (local.get $lhs) (global.get $ptr))
        (br_if $done (i32.ge_u (global.get $ptr) (global.get $end)))
        (local.set $lhs (global.get $ptr))
        (local.set $c (i32.load8_u (local.get $lhs)))
        (local.set $c2 (call $solByte (i32.add (local.get $lhs) (i32.const 1))))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "/")))
          (then
            (call $lexLineComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.eq (call $solByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "/"))))
            (br $next)))
        (if (i32.and (i32.eq (local.get $c) (i32.const "/")) (i32.eq (local.get $c2) (i32.const "*")))
          (then
            (call $lexBlockComment (i32.const 2)
              (select (enum.get $Token.comment.doc) (enum.get $Token.comment)
                (i32.eq (call $solByte (i32.add (local.get $lhs) (i32.const 2))) (i32.const "*"))))
            (br $next)))
        (if (i32.or (i32.eq (local.get $c) (i32.const 34)) (i32.eq (local.get $c) (i32.const 39)))
          (then
            (call $lexString (local.get $c) (i32.const 0) (enum.get $Token.string))
            (br $next)))
        (if (call $lexIsIdentStart (local.get $c))
          (then
            (call $lexScanIdent)
            (local.set $rhs (global.get $ptr))
            (local.set $n (i32.sub (local.get $rhs) (local.get $lhs)))
            ;; Prefixes belong to the following string, including Unicode text.
            (if
              (i32.and
                (i32.or (i32.eq (call $solByte (local.get $rhs)) (i32.const 34))
                  (i32.eq (call $solByte (local.get $rhs)) (i32.const 39)))
                (i32.or
                  (i32.and (i32.eq (local.get $n) (i32.const 3))
                    (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "hex")))
                  (i32.and (i32.eq (local.get $n) (i32.const 7))
                    (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff)) (i64.const "unicode")))))
              (then
                (call $emitTok (enum.get $Token.string) (local.get $lhs) (local.get $rhs))
                (call $lexString (call $solByte (local.get $rhs)) (i32.const 0) (enum.get $Token.string))
                (br $next)))
            (local.set $kind (keyword-table.value $solidityWords (local.get $lhs) (local.get $rhs)))
            ;; These words collide under the table's prefix/suffix hash.
            (if
              (i32.and
                (i32.eq (local.get $n) (i32.const 8))
                (i64.eq (i64.load (local.get $lhs)) (i64.const "constant")))
              (then (local.set $kind (enum.get $Token.keyword))))
            (if
              (i32.and
                (i32.eq (local.get $n) (i32.const 7))
                (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffffffff)) (i64.const "require")))
              (then (local.set $kind (enum.get $Token.function))))
            ;; Sized integer and byte types avoid dozens of keyword entries.
            (local.set $p (local.get $lhs))
            (if (i32.and (i32.gt_u (local.get $n) (i32.const 3))
                  (i32.eq (i32.and (i32.load (local.get $lhs)) (i32.const 0xffffff)) (i32.const "int")))
              (then (local.set $p (i32.add (local.get $lhs) (i32.const 3)))))
            (if (i32.and (i32.gt_u (local.get $n) (i32.const 4))
                  (i32.eq (i32.load (local.get $lhs)) (i32.const "uint")))
              (then (local.set $p (i32.add (local.get $lhs) (i32.const 4)))))
            (if (i32.and (i32.gt_u (local.get $n) (i32.const 5))
                  (i64.eq (i64.and (i64.load (local.get $lhs)) (i64.const 0xffffffffff)) (i64.const "bytes")))
              (then (local.set $p (i32.add (local.get $lhs) (i32.const 5)))))
            (if (i32.and (i32.ne (local.get $p) (local.get $lhs))
                  (i32.and (i32.le_u (i32.sub (local.get $rhs) (local.get $p)) (i32.const 3))
                    (i32.ne (i32.load8_u (local.get $p)) (i32.const "0"))))
              (then
                (local.set $c2 (i32.eq (i32.sub (local.get $p) (local.get $lhs)) (i32.const 5)))
                (local.set $hl (i32.const 0))
                (block $digitsDone
                  (loop $digits
                    (br_if $digitsDone (i32.ge_u (local.get $p) (local.get $rhs)))
                    (br_if $digitsDone (i32.eqz (call $lexIsDigit (i32.load8_u (local.get $p)))))
                    (local.set $hl (i32.add (i32.mul (local.get $hl) (i32.const 10))
                      (i32.sub (i32.load8_u (local.get $p)) (i32.const "0"))))
                    (local.set $p (i32.add (local.get $p) (i32.const 1)))
                    (br $digits)))
                ;; bytes1..32; int/uint widths are 8..256 in multiples of eight.
                (if (i32.and (i32.eq (local.get $p) (local.get $rhs))
                      (select (i32.le_u (local.get $hl) (i32.const 32))
                        (i32.and (i32.le_u (local.get $hl) (i32.const 256))
                          (i32.eqz (i32.and (local.get $hl) (i32.const 7))))
                        (local.get $c2)))
                  (then (local.set $kind (enum.get $Token.type.builtin))))))
            (local.set $p (call $lexSkipSpaceAt (local.get $rhs)))
            (local.set $hl (enum.get $Token.variable))
            (if (local.get $member)
              (then
                (local.set $hl (select (enum.get $Token.function.method) (enum.get $Token.property)
                  (i32.eq (call $solByte (local.get $p)) (i32.const "(")))))
              (else
                (if (i32.ge_s (local.get $kind) (i32.const 0))
                  (then
                    (local.set $hl (i32.and (local.get $kind) (i32.const 255)))
                    (if (i32.shr_u (local.get $kind) (i32.const 8))
                      (then (local.set $expect (i32.shr_u (local.get $kind) (i32.const 8))))))
                  (else
                    (if (local.get $expect)
                      (then
                        (local.set $hl (select (enum.get $Token.function.definition) (enum.get $Token.type)
                          (i32.eq (local.get $expect) (i32.const 1))))
                        (local.set $expect (i32.const 0)))
                      (else
                        (if (i32.eq (call $solByte (local.get $p)) (i32.const "("))
                          (then (local.set $hl (enum.get $Token.function)))
                          (else
                            (if (i32.le_u (i32.sub (local.get $c) (i32.const "A")) (i32.const 25))
                              (then (local.set $hl (enum.get $Token.type))))))))))))
            (call $emitTok (local.get $hl) (local.get $lhs) (local.get $rhs))
            (local.set $member (i32.const 0))
            (br $next)))
        (if (i32.or (call $lexIsDigit (local.get $c))
              (i32.and (i32.eq (local.get $c) (i32.const ".")) (call $lexIsDigit (local.get $c2))))
          (then
            (call $lexScanNumber)
            (call $emitTok (enum.get $Token.number) (local.get $lhs) (global.get $ptr))
            (br $next)))
        (global.set $ptr (call $utf8SpanEnd (i32.add (local.get $lhs) (i32.const 1)) (global.get $end)))
        (local.set $hl (enum.get $Token.none))
        (if (byteset.get "()[]{}" (local.get $c))
          (then
            (local.set $hl (enum.get $Token.punctuation.bracket))
            (local.set $expect (i32.const 0))))
        (if (byteset.get ".,;:" (local.get $c))
          (then (local.set $hl (enum.get $Token.punctuation.delimiter))))
        (if (byteset.get "+-*/%=!<>&|^~?" (local.get $c))
          (then (local.set $hl (enum.get $Token.operator))))
        (local.set $member (i32.eq (local.get $c) (i32.const ".")))
        (call $emitTok (local.get $hl) (local.get $lhs) (global.get $ptr))
        (br $next))))
)
