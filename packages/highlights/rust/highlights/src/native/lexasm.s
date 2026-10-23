// The token loop of the native JS/TS lexer (see `lexasm.rs`).
//
// Registers held for the whole run (callee-saved, so they survive the Rust
// callbacks):
//   x19 the `AsmState`        x20 source bytes      x21 input end
//   x22 position              x23 next record slot  x24 record capacity end
//   x25 `AsmTables`           w26 last scanned non-comment kind (lto)
//   w27 last classified kind (prev)                 x28 end of the last
//                                                       emitted token (done)
// Caller-saved, spilled around callbacks:
//   w12 last record's token   w13 waiting kind (0 none)
//   w14 parameter-list machine busy                 w9 line break before
//                                                      the token
//   x10 token start   x11 token end   w15 token kind   w16 its flags
// v16..v26 hold byte-class constants (`VCONST`), reloaded after each
// callback. Everything else stays in the `AsmState` in memory.

.macro SPILL
    stp x9, x10, [sp, #96]
    stp x11, x12, [sp, #112]
    stp x13, x14, [sp, #128]
    stp x15, x16, [sp, #144]
.endm
.macro UNSPILL
    ldp x9, x10, [sp, #96]
    ldp x11, x12, [sp, #112]
    ldp x13, x14, [sp, #128]
    ldp x15, x16, [sp, #144]
    VCONST
.endm
// The byte-class constants for identifiers, whitespace, and strings in
// v16..v26, which calls clobber.
.macro VCONST
    movi v16.16b, #0x20
    movi v17.16b, #97
    movi v18.16b, #25
    movi v19.16b, #48
    movi v20.16b, #9
    movi v21.16b, #95
    movi v22.16b, #36
    movi v23.16b, #4
    movi v24.16b, #10
    movi v25.16b, #13
    movi v26.16b, #92
.endm
// w14 = whether the parameter-list machine has a list open or a function
// head pending.
.macro BUSY
    ldrb w14, [x19, #{O_FN_PEND}]
    ldr w0, [x19, #{O_MASK}]
    cmp w0, #0
    cset w0, ne
    orr w14, w14, w0
.endm
// Append a record of token \hl ending at \endw, merging with a
// same-colored last record; a full vector traps.
.macro EMIT hl, endw
    cmp w12, \hl
    cset x1, eq
    sub x23, x23, x1, lsl #3
    cmp x23, x24
    b.eq Lhl_trap
    stp \endw, \hl, [x23], #8
    mov w12, \hl
.endm
// \dst = the byte at token start + \k, or 0 at and past the end.
.macro BYTEAT dst, k
    add x7, x10, #\k
    cmp x7, x21
    ldrb \dst, [x20, x7]
    csel \dst, \dst, wzr, lo
.endm
// A fixed-length token.
.macro TAKE kind, len
    mov w15, #\kind
    add x11, x10, #\len
    b Lhl_finish
.endm
// An operator family from single kind \x and forms \forms (see
// `Lhl_family`); the byte is in w0.
.macro FAMILY x, forms
    mov w3, #\x
    mov w4, #\forms
    b Lhl_family
.endm
// Push \reg on the bracket stack (`$brkPush`).
.macro BRK_PUSH reg
    ldr x0, [x19, #{O_BRK_SP}]
    cmp x0, #{BRACKETS}
    b.hs 61f
    add x1, x19, #{O_BRK}
    strb \reg, [x1, x0]
61:
    add x0, x0, #1
    str x0, [x19, #{O_BRK_SP}]
.endm
// Pop the bracket stack, setting the regexp-after-closer flag
// (`$brkPop`).
.macro BRK_POP
    mov w2, #0
    ldr x0, [x19, #{O_BRK_SP}]
    cbz x0, 62f
    sub x0, x0, #1
    str x0, [x19, #{O_BRK_SP}]
    cmp x0, #{BRACKETS}
    b.hs 62f
    add x1, x19, #{O_BRK}
    ldrb w2, [x1, x0]
    and w2, w2, #1
62:
    strb w2, [x19, #{O_RX_CLOSER}]
.endm
// w2 = whether `/` after the last kind starts a regexp (`$rxAllowedAfter`).
.macro RX
    add x0, x25, #256
    ldr w1, [x0, w26, uxtw #2]
    tbnz w1, #{B_RX_DYNAMIC}, 63f
    ubfx w2, w1, #{B_RX_OK}, #1
    b 66f
63:
    cmp w26, #{STRING_LITERAL}
    b.ne 65f
    mov w2, #0
    cbz w9, 66f
    ldrb w0, [x19, #{O_BEFORE_STRING}]
    cmp w0, #{CTXWORD_FROM}
    b.eq 64f
    cmp w0, #{KEYWORD_IMPORT}
    b.eq 64f
    cmp w0, #{KEYWORD_EXPORT}
    b.ne 66f
64:
    mov w2, #1
    b 66f
65:
    ldrb w2, [x19, #{O_RX_CLOSER}]
    cmp w2, #0
    cset w2, ne
66:
.endm
// x11 = the end of an identifier tail starting at token start + 1:
// one byte checked by table, then 16 bytes at a time.
.macro TAIL
    add x11, x10, #1
    ldrb w1, [x20, x11]
    ldrb w2, [x25, x1]
    tbz w2, #{C_IDENT_CONT}, 72f
    sub x11, x11, #16
69:
    add x11, x11, #16
    ldr q0, [x20, x11]
    orr v1.16b, v0.16b, v16.16b
    sub v1.16b, v1.16b, v17.16b
    cmhs v1.16b, v18.16b, v1.16b
    sub v2.16b, v0.16b, v19.16b
    cmhs v2.16b, v20.16b, v2.16b
    cmeq v3.16b, v0.16b, v21.16b
    cmeq v4.16b, v0.16b, v22.16b
    orr v1.16b, v1.16b, v2.16b
    orr v3.16b, v3.16b, v4.16b
    orr v1.16b, v1.16b, v3.16b
    mvn v1.16b, v1.16b
    shrn v1.8b, v1.8h, #4
    fmov x0, d1
    cbz x0, 69b
    rbit x0, x0
    clz x0, x0
    add x11, x11, x0, lsr #2
    ldrb w1, [x20, x11]
72:
    cmp w1, #128
    b.lo 73f
    SPILL
    mov x0, x19
    mov x1, x11
    bl {cb_ident_unicode}
    mov x7, x0
    UNSPILL
    mov x11, x7
73:
.endm
// x11 = the end of the line from token start + \start (`$scanToLineEnd`).
.macro LINE_END start
    add x11, x10, #\start
    movi v1.16b, #10
    movi v2.16b, #13
74:
    cmp x11, x21
    b.hs 76f
    ldr q0, [x20, x11]
    cmeq v3.16b, v0.16b, v1.16b
    cmeq v4.16b, v0.16b, v2.16b
    orr v3.16b, v3.16b, v4.16b
    shrn v3.8b, v3.8h, #4
    fmov x0, d3
    cbnz x0, 75f
    add x11, x11, #16
    b 74b
75:
    rbit x0, x0
    clz x0, x0
    add x11, x11, x0, lsr #2
76:
    cmp x11, x21
    csel x11, x11, x21, lo
.endm
// Hand a token to `cb_scan` (\code: 0 string, 1 regexp, 2 template, 3
// resumed template, 4 block comment) and finish it.
.macro SCAN code
    SPILL
    mov x0, x19
    mov w1, #\code
    mov x2, x10
    bl {cb_scan}
    mov w6, w0
    mov x7, x1
    UNSPILL
    mov w15, w6
    mov x11, x7
    b Lhl_finish
.endm
// Dispatch the next token: whitespace goes to `Lhl_ws`, letters to
// `Lhl_ident`, every other byte through the jump table.
.macro NEXT
    ldrb w0, [x20, x22]
    mov w9, #0
    sub w1, w0, #33
    cmp w1, #93
    b.hi Lhl_ws
    DISPATCH
.endm
// Dispatch the token starting at x22 with first byte w0.
.macro DISPATCH
    mov x10, x22
    orr w1, w0, #0x20
    sub w1, w1, #97
    cmp w1, #26
    b.lo Lhl_ident
    adr x2, Lhl_jt
    ldrh w2, [x2, x0, lsl #1]
    adr x3, Lhl_jbase
    add x3, x3, x2, lsl #2
    br x3
.endm
// Call \fn with the waiting identifier's packed kinds and ranges; its
// color comes back in w0. x2..x5 (pending start, end, metadata marker,
// length) are kept.
.macro CALL_IDENT fn
    SPILL
    stp x2, x3, [sp, #160]
    stp x4, x5, [sp, #176]
    orr w1, w27, w13, lsl #8
    orr w1, w1, w15, lsl #16
    orr w1, w1, w9, lsl #24
    mov x0, x19
    mov x4, x2
    mov x5, x3
    mov x2, x10
    mov x3, x11
    bl \fn
    mov w6, w0
    ldp x2, x3, [sp, #160]
    ldp x4, x5, [sp, #176]
    UNSPILL
    mov w0, w6
.endm

    stp x29, x30, [sp, #-208]!
    mov x29, sp
    stp x19, x20, [sp, #16]
    stp x21, x22, [sp, #32]
    stp x23, x24, [sp, #48]
    stp x25, x26, [sp, #64]
    stp x27, x28, [sp, #80]
    mov x19, x0
    mov x25, x1
    ldr x20, [x19, #{O_SRC}]
    ldr x21, [x19, #{O_END}]
    ldr x22, [x19, #{O_SOURCE_START}]
    ldr x23, [x19, #{O_CUR}]
    ldr x24, [x19, #{O_LIMIT}]
    ldr w12, [x19, #{O_LAST}]
    mov w26, #{EOF}
    mov w27, #{EOF}
    mov w13, #{EOF}
    mov w14, #0
    mov x28, x22
    VCONST

    NEXT

// Spaces, or a line break and indentation, eight bytes at a time; other
// whitespace goes to `skip_space`.
    .p2align 4
Lhl_ws:
    cmp w0, #32
    b.ne Lhl_ws_nl
    .p2align 4
Lhl_ws_sp:
    ldr x0, [x20, x22]
    eor x0, x0, #0x2020202020202020
    cbz x0, Lhl_ws_8
    rbit x0, x0
    clz x0, x0
    add x22, x22, x0, lsr #3
    ldrb w0, [x20, x22]
    sub w1, w0, #33
    cmp w1, #93
    b.hi Lhl_ws_slow
    DISPATCH
Lhl_ws_8:
    add x22, x22, #8
    b Lhl_ws_sp
Lhl_ws_nl:
    cmp w0, #10
    b.ne Lhl_ws_slow
    mov w9, #1
    add x22, x22, #1
    b Lhl_ws_sp
Lhl_ws_slow:
    SPILL
    mov x0, x19
    mov x1, x22
    bl {cb_skip_space}
    mov x22, x0
    mov x7, x1
    UNSPILL
    orr w9, w9, w7
    ldrb w0, [x20, x22]
    DISPATCH

Lhl_jbase:
    .p2align 4
Lhl_digit:
    add x11, x10, #1
    mov w4, #0
    b Lhl_number
    .p2align 4
Lhl_nul:
    cmp x10, x21
    b.lo Lhl_invalid1
    mov w15, #{EOF}
    mov x11, x10
    b Lhl_finish
    .p2align 4
Lhl_invalid1:
    TAKE {INVALID}, 1
    .p2align 4
Lhl_nonascii:
    SPILL
    mov x0, x19
    mov x1, x10
    bl {cb_non_ascii}
    mov w6, w0
    mov x7, x1
    UNSPILL
    mov w15, w6
    mov x11, x7
    b Lhl_finish
    .p2align 4
Lhl_lparen:
    add x0, x25, #256
    ldr w2, [x0, w26, uxtw #2]
    ubfx w2, w2, #{B_CTRL_PAREN_PREV}, #1
    BRK_PUSH w2
    TAKE {L_PAREN}, 1
    .p2align 4
Lhl_rparen:
    BRK_POP
    TAKE {R_PAREN}, 1
    .p2align 4
Lhl_lbracket:
    mov w2, #0
    BRK_PUSH w2
    TAKE {L_BRACKET}, 1
    .p2align 4
Lhl_rbracket:
    BRK_POP
    TAKE {R_BRACKET}, 1
    .p2align 4
Lhl_lbrace:
    RX
    add x0, x25, #256
    ldr w1, [x0, w26, uxtw #2]
    ubfx w1, w1, #{B_BRACE_BLOCK_PREV}, #1
    eor w2, w2, #1
    orr w2, w2, w1
    BRK_PUSH w2
    ldr w0, [x19, #{O_BRACE_DEPTH}]
    add w0, w0, #1
    str w0, [x19, #{O_BRACE_DEPTH}]
    TAKE {L_BRACE}, 1
    .p2align 4
Lhl_rbrace:
    // A `}}` at the depth of an open `${{` resumes the template.
    ldr x0, [x19, #{O_TPL_SP}]
    cbz x0, 1f
    add x1, x19, #{O_TPL}
    sub x0, x0, #1
    ldr w1, [x1, x0, lsl #2]
    ldr w2, [x19, #{O_BRACE_DEPTH}]
    cmp w1, w2
    b.ne 1f
    SCAN 3
1:
    BRK_POP
    ldr w0, [x19, #{O_BRACE_DEPTH}]
    sub w0, w0, #1
    str w0, [x19, #{O_BRACE_DEPTH}]
    TAKE {R_BRACE}, 1
    .p2align 4
Lhl_dot:
    BYTEAT w5, 1
    cmp w5, #46
    b.ne 1f
    BYTEAT w6, 2
    cmp w6, #46
    b.ne 1f
    TAKE {SPREAD}, 3
1:
    sub w6, w5, #48
    cmp w6, #9
    b.hi 2f
    add x11, x10, #1
    mov w4, #1
    b Lhl_number
2:
    TAKE {DOT}, 1
    .p2align 4
Lhl_semi:
    TAKE {SEMICOLON}, 1
    .p2align 4
Lhl_comma:
    TAKE {COMMA}, 1
    .p2align 4
Lhl_colon:
    TAKE {COLON}, 1
    .p2align 4
Lhl_tilde:
    TAKE {TILDE}, 1
    .p2align 4
Lhl_eq:
    BYTEAT w5, 1
    cmp w5, #62
    b.ne 1f
    TAKE {FUNCTION_ARROW}, 2
1:
    FAMILY {EQUAL}, 6
    .p2align 4
Lhl_slash:
    BYTEAT w5, 1
    cmp w5, #47
    b.ne 1f
    LINE_END 2
    mov w15, #{COMMENT}
    b Lhl_finish
1:
    cmp w5, #42
    b.ne 2f
    SCAN 4
2:
    RX
    cbz w2, 3f
    SCAN 1
3:
    mov w0, #47
    FAMILY {SLASH}, 1
    .p2align 4
Lhl_amp:
    FAMILY {AMPERSAND}, 7
    .p2align 4
Lhl_bang:
    BYTEAT w5, 1
    cmp w5, #61
    b.ne 2f
    BYTEAT w6, 2
    cmp w6, #61
    b.ne 1f
    TAKE {BANG_EQUAL_EQUAL}, 3
1:
    TAKE {BANG_EQUAL}, 2
2:
    TAKE {BANG}, 1
    .p2align 4
Lhl_pipe:
    FAMILY {PIPE}, 7
    .p2align 4
Lhl_question:
    BYTEAT w5, 1
    cmp w5, #46
    b.ne 2f
    BYTEAT w6, 2
    sub w6, w6, #48
    cmp w6, #9
    b.hi 1f
    TAKE {QUESTION_MARK}, 1
1:
    TAKE {QUESTION_MARK_DOT}, 2
2:
    FAMILY {QUESTION_MARK}, 6
// A string with no escape or line break ends at its first quote; any
// other string goes to `scan_string`.
    .p2align 4
Lhl_quote:
    dup v5.16b, w0
    add x11, x10, #1
1:
    cmp x11, x21
    b.hs 3f
    ldr q0, [x20, x11]
    cmeq v1.16b, v0.16b, v5.16b
    cmeq v2.16b, v0.16b, v26.16b
    cmeq v3.16b, v0.16b, v24.16b
    cmeq v4.16b, v0.16b, v25.16b
    orr v1.16b, v1.16b, v2.16b
    orr v3.16b, v3.16b, v4.16b
    orr v1.16b, v1.16b, v3.16b
    shrn v1.8b, v1.8h, #4
    fmov x1, d1
    cbz x1, 2f
    rbit x1, x1
    clz x1, x1
    add x11, x11, x1, lsr #2
    cmp x11, x21
    b.hs 3f
    ldrb w1, [x20, x11]
    cmp w1, w0
    b.ne 3f
    add x11, x11, #1
    mov w15, #{STRING_LITERAL}
    b Lhl_finish
2:
    add x11, x11, #16
    b 1b
3:
    SCAN 0
    .p2align 4
Lhl_lt:
    FAMILY {L_ANGLE}, 7
    .p2align 4
Lhl_gt:
    BYTEAT w5, 1
    cmp w5, #62
    b.ne 2f
    BYTEAT w6, 2
    cmp w6, #62
    b.ne 2f
    BYTEAT w6, 3
    cmp w6, #61
    b.ne 1f
    TAKE {R_UNSIGNED_SHIFT_EQUAL}, 4
1:
    TAKE {R_UNSIGNED_SHIFT}, 3
2:
    FAMILY {R_ANGLE}, 7
    .p2align 4
Lhl_plus:
    FAMILY {PLUS}, 3
    .p2align 4
Lhl_minus:
    FAMILY {MINUS}, 3
    .p2align 4
Lhl_star:
    FAMILY {ASTERISK}, 7
    .p2align 4
Lhl_percent:
    FAMILY {PERCENT}, 1
    .p2align 4
Lhl_caret:
    FAMILY {CARET}, 1
    .p2align 4
Lhl_backtick:
    SCAN 2
    .p2align 4
Lhl_at:
    TAIL
    mov w15, #{AT_IDENTIFIER}
    b Lhl_finish
    .p2align 4
Lhl_hash:
    ldr x0, [x19, #{O_SOURCE_START}]
    cmp x10, x0
    b.ne 1f
    BYTEAT w5, 1
    cmp w5, #33
    b.ne 1f
    LINE_END 2
    mov w15, #{HASH_BANG}
    b Lhl_finish
1:
    TAIL
    mov w15, #{HASH_IDENTIFIER}
    b Lhl_finish

// An operator family: `XX=`, `XX`, `X=`, or `X` for byte w0, whose kinds
// sit at w3 - 3, - 2, - 1, and w3. Forms w4: 1 `X=`, 2 `XX`, 4 `XX=`.
    .p2align 4
Lhl_family:
    BYTEAT w5, 1
    cmp w5, w0
    b.ne 1f
    tbz w4, #1, 1f
    tbz w4, #2, 2f
    BYTEAT w6, 2
    cmp w6, #61
    b.ne 2f
    sub w15, w3, #3
    add x11, x10, #3
    b Lhl_finish
2:
    sub w15, w3, #2
    add x11, x10, #2
    b Lhl_finish
1:
    tbz w4, #0, 3f
    cmp w5, #61
    b.ne 3f
    sub w15, w3, #1
    add x11, x10, #2
    b Lhl_finish
3:
    mov w15, w3
    add x11, x10, #1
    b Lhl_finish

// A number's tail from x11; w4 is set when a dot was already consumed
// (`$scanNumber`).
    .p2align 4
Lhl_number:
    ldrb w0, [x20, x10]
    mov w5, #0
    cmp w0, #48
    b.ne 1f
    BYTEAT w1, 1
    orr w1, w1, #32
    cmp w1, #120
    cset w5, eq
1:
    mov w6, #0
2:
    cmp x11, x21
    b.hs 9f
    ldrb w0, [x20, x11]
    ldrb w1, [x25, x0]
    tbnz w1, #{C_ALNUM_}, 3f
    cmp w0, #43
    b.eq 4f
    cmp w0, #45
    b.ne 5f
4:
    cbnz w5, 9f
    orr w1, w6, #32
    cmp w1, #101
    b.ne 9f
    b 3f
5:
    cmp w0, #46
    b.ne 9f
    cbnz w4, 9f
    mov w4, #1
3:
    mov w6, w0
    add x11, x11, #1
    b 2b
9:
    mov w15, #{NUMBER_LITERAL}
    b Lhl_finish

// An identifier, keyword, or contextual word.
    .p2align 4
Lhl_ident:
    TAIL
    mov w15, #{IDENTIFIER}
    cmp w26, #{DOT}
    b.eq Lhl_finish
    cmp w26, #{QUESTION_MARK_DOT}
    b.eq Lhl_finish
    // The keyword hash of the first two bytes, last byte, and length.
    sub x0, x11, x10
    sub x1, x0, #2
    cmp x1, #8
    b.hi Lhl_finish
    add x2, x20, x10
    ldrb w3, [x2]
    ldrb w4, [x2, #1]
    orr w3, w3, w4, lsl #8
    add x4, x20, x11
    ldurb w4, [x4, #-1]
    orr w3, w3, w4, lsl #16
    orr w3, w3, w0, lsl #24
    mov w4, #0x0d8d
    movk w4, #0x90f0, lsl #16
    mul w3, w3, w4
    lsr w3, w3, #24
    adrp x4, {kw}@PAGE
    add x4, x4, {kw}@PAGEOFF
    add x3, x4, x3, lsl #5
    ldrb w4, [x3, #16]
    cmp w4, #{INVALID}
    b.eq Lhl_finish
    ldr x5, [x2]
    cmp x0, #8
    b.hs 4f
    mov x6, #64
    sub x6, x6, x0, lsl #3
    lsl x5, x5, x6
    lsr x5, x5, x6
    ldr x6, [x3]
    cmp x5, x6
    b.ne Lhl_finish
    ldr x6, [x3, #8]
    cbnz x6, Lhl_finish
    b 5f
4:
    ldr x6, [x3]
    cmp x5, x6
    b.ne Lhl_finish
    ldr x5, [x2, #8]
    sub x6, x0, #8
    lsl x6, x6, #3
    mov x7, #1
    lsl x7, x7, x6
    sub x7, x7, #1
    and x5, x5, x7
    ldr x6, [x3, #8]
    cmp x5, x6
    b.ne Lhl_finish
5:
    // TypeScript-only contextual words are identifiers in JavaScript.
    ldrb w5, [x19, #{O_TS}]
    cbnz w5, 6f
    cmp w4, #{CTXWORD_ABSTRACT}
    b.hs Lhl_finish
6:
    mov w15, w4

// Finish token w15 at x10..x11: track the last kind, color the waiting
// token, extend the gap, then emit this token or make it wait. The common
// paths fall through; rare cases branch out and back.
    .p2align 4
Lhl_finish:
    mov x22, x11
    add x0, x25, #256
    ldr w16, [x0, w15, uxtw #2]
    tbnz w16, #{B_NOT_LTO}, Lhl_lto_done
    cmp w15, #{STRING_LITERAL}
    b.eq Lhl_lto_string
    mov w26, w15
Lhl_lto_done:
    cbz w13, Lhl_gap

// Color the waiting token w13 at the pending range, now that token w15
// (flags w16) at x10..x11 follows it. x2..x5 hold the pending start, end,
// metadata marker, and length.
    ldr x2, [x19, #{O_PEND_LHS}]
    ldr x3, [x19, #{O_PEND_RHS}]
    sub x5, x3, x2
    cmp w13, #{IDENTIFIER}
    b.ne Lhl_res_other
    mov w4, #0
    cmp w27, #{EOF}
    ccmp w27, #{L_BRACE}, #4, ne
    ccmp w27, #{COMMA}, #4, ne
    b.eq Lhl_meta
    // The identifier rules, with fast paths for what no context rule
    // can match.
Lhl_id:
    cbnz w14, Lhl_id_slow
    mov w6, #{QUESTION_MARK_DOT}
    cmp w27, #{DOT}
    ccmp w27, w6, #4, ne
    b.eq Lhl_id_member
    cmp w15, #{L_PAREN}
    b.eq Lhl_id_call
Lhl_id_flags:
    add x6, x25, #256
    ldr w7, [x6, w27, uxtw #2]
    tbnz w7, #{B_ID_PREV}, Lhl_id_slow
    tbnz w16, #{B_ID_NEXT}, Lhl_id_slow
    tbnz w7, #{B_KEY_PREV}, Lhl_id_key
Lhl_id_after_key:
    cmp w27, #{L_PAREN}
    b.eq Lhl_id_param
Lhl_id_plain:
    ldrb w6, [x20, x2]
    ldrb w6, [x25, x6]
    tbz w6, #{C_PLAIN_START}, Lhl_id_word
    cmp w15, #{L_PAREN}
    mov w0, #{T_VARIABLE}
    mov w1, #{T_FUNCTION}
    csel w0, w1, w0, eq
    .p2align 4
Lhl_res_emit:
    EMIT w0, w3
    // The marker: the metadata key's, or a 3- or 4-byte template tag's.
    cbnz w4, Lhl_res_marker
    sub x6, x5, #3
    cmp x6, #1
    b.ls Lhl_res_tag
Lhl_res_marker:
    str w4, [x19, #{O_MARKER}]
    mov x28, x3
    mov w27, #{IDENTIFIER}
    mov w13, #{EOF}

    .p2align 4
Lhl_gap:
    cmp x28, x10
    b.lo Lhl_gap_fill
Lhl_emit:
    cbz w15, Lhl_exit
    tbnz w16, #{B_DEFER}, Lhl_defer
    tbz w16, #{B_PLAIN}, Lhl_notplain
    tbnz w16, #{B_IMPORT_END}, Lhl_import_end
Lhl_plain:
    cbnz w14, Lhl_sigbusy
    tbnz w16, #{B_SIG_IDLE}, Lhl_sig_idle
    .p2align 4
Lhl_emitplain:
    lsr w0, w16, #24
    EMIT w0, w11
    str wzr, [x19, #{O_MARKER}]
    mov w27, w15
    mov x28, x11
    NEXT
    .p2align 4
Lhl_defer:
    mov w13, w15
    str x10, [x19, #{O_PEND_LHS}]
    str x11, [x19, #{O_PEND_RHS}]
    NEXT

Lhl_lto_string:
    strb w26, [x19, #{O_BEFORE_STRING}]
    mov w26, w15
    b Lhl_lto_done
Lhl_gap_fill:
    ldr x0, [x19, #{O_RP}]
    cmp x23, x0
    b.eq 4f
    stur w10, [x23, #-8]
    b Lhl_emit
4:
    mov w0, #{T_NONE}
    EMIT w0, w10
    b Lhl_emit
Lhl_import_end:
    ldrb w0, [x19, #{O_IMPORT}]
    cbnz w0, Lhl_other
    b Lhl_plain
Lhl_sig_idle:
    cmp w15, #{L_PAREN}
    b.ne 5f
    ldr w0, [x19, #{O_PARENS}]
    add w0, w0, #1
    str w0, [x19, #{O_PARENS}]
    b Lhl_emitplain
5:
    cmp w15, #{R_PAREN}
    b.ne 6f
    ldr w0, [x19, #{O_PARENS}]
    subs w0, w0, #1
    csel w0, w0, wzr, hs
    str w0, [x19, #{O_PARENS}]
    b Lhl_emitplain
6:
    mov w0, #1
    strb w0, [x19, #{O_FN_PEND}]
    str wzr, [x19, #{O_FN_ANGLE}]
    mov w14, #1
    b Lhl_emitplain
Lhl_sigbusy:
    SPILL
    mov x0, x19
    mov w1, w27
    mov w2, w15
    mov x3, x10
    mov x4, x11
    bl {cb_sig_busy}
    mov w6, w0
    UNSPILL
    mov w14, w6
    b Lhl_emitplain
Lhl_notplain:
    // A line comment keeps the marker and the previous kind.
    cmp w15, #{COMMENT}
    b.eq 7f
    cmp w15, #{HASH_BANG}
    b.ne Lhl_other
7:
    mov w0, #{T_COMMENT}
    EMIT w0, w11
    NEXT
Lhl_other:
    str x23, [x19, #{O_CUR}]
    str w12, [x19, #{O_LAST}]
    SPILL
    mov x0, x19
    mov w1, w27
    mov w2, w15
    mov x3, x10
    mov x4, x11
    bl {cb_other}
    UNSPILL
    ldr x23, [x19, #{O_CUR}]
    ldr x24, [x19, #{O_LIMIT}]
    ldr w12, [x19, #{O_LAST}]
    BUSY
    tbnz w16, #{B_COMMENT}, 8f
    mov w27, w15
8:
    mov x28, x11
    NEXT

// A component metadata key: `template` or `styles` after `{{{{`, `,`, or
// the start.
Lhl_meta:
    ldr x6, [x20, x2]
    cmp x5, #8
    b.ne 1f
    movz x7, #0x6574
    movk x7, #0x706d, lsl #16
    movk x7, #0x616c, lsl #32
    movk x7, #0x6574, lsl #48
    cmp x6, x7
    b.ne Lhl_id
    mov w4, #1
    movk w4, #0xc000, lsl #16
    b 2f
1:
    cmp x5, #6
    b.ne Lhl_id
    and x6, x6, #0xffffffffffff
    movz x7, #0x7473
    movk x7, #0x6c79, lsl #16
    movk x7, #0x7365, lsl #32
    cmp x6, x7
    b.ne Lhl_id
    mov w4, #0x0104
    movk w4, #0x4000, lsl #16
2:
    mov w0, #{T_PROPERTY}
    cmp w15, #{COLON}
    b.eq Lhl_res_emit
    cbz w15, Lhl_res_emit
    tbnz w16, #{B_COMMENT}, Lhl_res_emit
    b Lhl_id
    .p2align 4
Lhl_id_member:
    mov w0, #{T_PROPERTY}
    cmp w15, #{L_PAREN}
    b.ne Lhl_res_emit
    cmp x5, #11
    b.eq Lhl_id_slow
    ldrb w6, [x20, x2]
    ldrb w6, [x25, x6]
    tbnz w6, #{C_UPPER}, Lhl_id_slow
    mov w0, #{T_FUNCTION_METHOD}
    b Lhl_res_emit
Lhl_id_call:
    cmp x5, #11
    b.eq Lhl_id_slow
    b Lhl_id_flags
Lhl_id_key:
    tbnz w16, #{B_KEY_NEXT}, Lhl_id_slow
    b Lhl_id_after_key
Lhl_id_param:
    tbnz w16, #{B_ID_PAREN_NEXT}, Lhl_id_slow
    b Lhl_id_plain
Lhl_id_word:
    CALL_IDENT {cb_ident_word}
    b Lhl_res_emit
Lhl_id_slow:
    CALL_IDENT {cb_classify_ident}
    mov w6, w0
    BUSY
    mov w0, w6
    b Lhl_res_emit
Lhl_res_tag:
    ldr w6, [x20, x2]
    cmp x5, #4
    b.ne 10f
    movz w7, #0x7468
    movk w7, #0x6c6d, lsl #16
    cmp w6, w7
    cset w4, eq
    b Lhl_res_marker
10:
    and w6, w6, #0xffffff
    movz w7, #0x7363
    movk w7, #0x73, lsl #16
    cmp w6, w7
    b.ne Lhl_res_marker
    mov w4, #260
    b Lhl_res_marker
Lhl_res_other:
    SPILL
    stp x2, x3, [sp, #160]
    orr w1, w27, w13, lsl #8
    orr w1, w1, w15, lsl #16
    orr w1, w1, w9, lsl #24
    mov x0, x19
    mov x4, x2
    mov x5, x3
    mov x2, x10
    mov x3, x11
    bl {cb_resolve_other}
    mov w6, w0
    ldp x2, x3, [sp, #160]
    UNSPILL
    BUSY
    EMIT w6, w3
    mov x28, x3
    mov w27, w13
    mov w13, #{EOF}
    b Lhl_gap

Lhl_exit:
    str x23, [x19, #{O_CUR}]
    str w12, [x19, #{O_LAST}]
    ldp x19, x20, [sp, #16]
    ldp x21, x22, [sp, #32]
    ldp x23, x24, [sp, #48]
    ldp x25, x26, [sp, #64]
    ldp x27, x28, [sp, #80]
    ldp x29, x30, [sp], #208
    ret
Lhl_trap:
    bl {cb_trap}

// Dispatch offsets from `Lhl_jbase`, in instructions, by first byte.
    .p2align 1
Lhl_jt:
    .hword (Lhl_nul - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_bang - Lhl_jbase) / 4
    .hword (Lhl_quote - Lhl_jbase) / 4
    .hword (Lhl_hash - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_percent - Lhl_jbase) / 4
    .hword (Lhl_amp - Lhl_jbase) / 4
    .hword (Lhl_quote - Lhl_jbase) / 4
    .hword (Lhl_lparen - Lhl_jbase) / 4
    .hword (Lhl_rparen - Lhl_jbase) / 4
    .hword (Lhl_star - Lhl_jbase) / 4
    .hword (Lhl_plus - Lhl_jbase) / 4
    .hword (Lhl_comma - Lhl_jbase) / 4
    .hword (Lhl_minus - Lhl_jbase) / 4
    .hword (Lhl_dot - Lhl_jbase) / 4
    .hword (Lhl_slash - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_digit - Lhl_jbase) / 4
    .hword (Lhl_colon - Lhl_jbase) / 4
    .hword (Lhl_semi - Lhl_jbase) / 4
    .hword (Lhl_lt - Lhl_jbase) / 4
    .hword (Lhl_eq - Lhl_jbase) / 4
    .hword (Lhl_gt - Lhl_jbase) / 4
    .hword (Lhl_question - Lhl_jbase) / 4
    .hword (Lhl_at - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_lbracket - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_rbracket - Lhl_jbase) / 4
    .hword (Lhl_caret - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_backtick - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_ident - Lhl_jbase) / 4
    .hword (Lhl_lbrace - Lhl_jbase) / 4
    .hword (Lhl_pipe - Lhl_jbase) / 4
    .hword (Lhl_rbrace - Lhl_jbase) / 4
    .hword (Lhl_tilde - Lhl_jbase) / 4
    .hword (Lhl_invalid1 - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
    .hword (Lhl_nonascii - Lhl_jbase) / 4
