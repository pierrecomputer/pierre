# WebAssembly 128-bit packed SIMD Extension

This specification describes a 128-bit packed *Single Instruction Multiple
Data* (SIMD) extension to WebAssembly that can be implemented efficiently on
current popular instruction set architectures.

See also [The binary encoding of SIMD instructions](BinarySIMD.md).

## Motivation

WebAssembly aims to take advantage of [common hardware capabilities](https://github.com/WebAssembly/design/blob/master/Portability.md#assumptions-for-efficient-execution)
for near native speed. The motivation for this proposal is to introduce
WebAssembly operations that map to commonly available [SIMD](https://en.wikipedia.org/wiki/SIMD)
instructions in hardware.

SIMD instructions in hardware work by performing simultaneous computations over
packed data in one instruction. These are commonly used to improve performance
for multimedia applications. The set of SIMD instructions in hardware is large,
and varies across different versions of hardware. This proposal is comprised
of a portable subset of operations that in most cases map to commonly used
instructions in modern hardware.


# Types

WebAssembly is extended with a new `v128` value type and a number of new kinds
of immediate operands used by the SIMD instructions.

## SIMD value type

The `v128` value type is the _only_ type introduced in this extension. It has a
concrete mapping to a 128-bit representation with bits numbered 0–127. The
`v128` type corresponds to a vector register in a typical SIMD ISA. The
interpretation of the 128 bits in the vector register is provided by the
individual instructions. When a `v128` value is represented as 16 bytes, bits
0-7 go in the first byte with bit 0 as the LSB, bits 8-15 go in the second byte,
etc.

## Immediate operands

Some of the new SIMD instructions defined here have immediate operands that are
encoded as individual bytes in the binary encoding. Many have a limited valid
range, and it is a validation error if the immediate operands are out of range.

* `ImmByte`: A single unconstrained byte (0-255).
* `ImmLaneIdx2`: A byte with values in the range 0–1 identifying a lane.
* `ImmLaneIdx4`: A byte with values in the range 0–3 identifying a lane.
* `ImmLaneIdx8`: A byte with values in the range 0–7 identifying a lane.
* `ImmLaneIdx16`: A byte with values in the range 0–15 identifying a lane.
* `ImmLaneIdx32`: A byte with values in the range 0–31 identifying a lane.

## Operations on the SIMD value type

The _single_ `v128` SIMD type can be used to represent different types of packed
data, e.g., it can represent four 32-bit floating point values, 8 16-bit signed
or unsigned integer values, etc.

The instructions introduced in this specification are named according to the
following schema: `{interpretation}.{operation}`. Where the `{interpretation}`
prefix denotes how the bytes of the `v128` type are interpreted by the `{operation}`.

For example, the instructions `f32x4.extract_lane` and `i64x2.extract_lane`
perform the same semantic operation: extracting the scalar value of a vector
lane. However, the `f32x4.extract_lane` instruction returns a 32-bit wide
floating point value, while the `i64x2.extract_lane` instruction returns a
64-bit wide integer value.

The `v128` vector type interpretation interprets the vector as a bag of bits.
The `v{lane_width}x{n}` interpretations (e.g. `v32x4`) interpret the vector as
`n` lanes of `lane_width` bits. The `{t}{lane_width}x{n}` interpretations (e.g.
`i32x4` or `f32x4`) interpret the vector as `n` lanes of type `{t}{lane_width}`.

### Lane division interpretation

The first level of interpretations of the `v128` type imposes a lane structure on
the bits:

* `v8x16 : v128`: 8-bit lanes numbered 0–15. Lane n corresponds to bits 8n – 8n+7.
* `v16x8 : v128`: 16-bit lanes numbered 0–7. Lane n corresponds to bits 16n – 16n+15.
* `v32x4 : v128`: 32-bit lanes numbered 0–3. Lane n corresponds to bits 32n – 32n+31.
* `v64x2 : v128`: 64-bit lanes numbered 0–1. Lane n corresponds to bits 64n – 64n+63.

The lane dividing interpretations don't say anything about the semantics of the
bits in each lane. The interpretations have *properties* used by the semantic
specification pseudo-code below:

|    S    | S.LaneBits | S.Lanes | S.MaskType |
|---------|-----------:|--------:|:----------:|
| `v8x16` |          8 |      16 | `i8x16`    |
| `v16x8` |         16 |       8 | `i16x8`    |
| `v32x4` |         32 |       4 | `i32x4`    |
| `v64x2` |         64 |       2 | `i64x2`    |

Since WebAssembly is little-endian, the least significant bit in each lane is
the bit with the lowest number.

### Modulo integer interpretations

The bits in a lane can be interpreted as integers with modulo arithmetic
semantics. Many arithmetic operations can be defined on these types which don't
impose a signed or unsigned integer interpretation.

* `i8x16 : v8x16`: Each lane is an `i8`.
* `i16x8 : v16x8`: Each lane is an `i16`.
* `i32x4 : v32x4`: Each lane is an `i32`.
* `i64x2 : v64x2`: Each lane is an `i64`.

Additional properties:

|    S    |  S.Smin | S.Smax | S.Umax |
|---------|--------:|-------:|-------:|
| `i8x16` |    -2^7 |  2^7-1 |  2^8-1 |
| `i16x8` |   -2^15 | 2^15-1 | 2^16-1 |
| `i32x4` |   -2^31 | 2^31-1 | 2^32-1 |
| `i64x2` |   -2^63 | 2^63-1 | 2^64-1 |

Some operations interpret each lane specifically as a signed or unsigned
integer. These operations have `_s` and `_u` suffixes as is the convention is
WebAssembly.

### Floating-point interpretations

Each lane is interpreted as an IEEE floating-point number.

* `f32x4 : v32x4`: Each lane is an `f32`.
* `f64x2 : v64x2`: Each lane is an `f64`.

The floating-point operations in this specification aim to be compatible with
WebAssembly's scalar floating-point operations. In particular, the rules about
NaN propagation and default NaN values are the same, and all operations use the
default *roundTiesToEven* rounding mode.

# JavaScript API and SIMD Values

Accessing WebAssembly module imports or exports containing SIMD Type from JavaScript will throw.

### Module Function Imports

Calling an imported function from JavaScript when the function arguments or result is of type v128 will cause the host function to immediately throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror).

### Exported Function Exotic Objects

Invoking the [[Call]] method of an Exported Function Exotic Object when the function type of its [[Closure]] has an argument or result of type v128 will cause the host function to immediately throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror).


## WebAssembly Module Instantiation

Instantiating a WebAssembly Module from a Module moduleObject will throw a LinkError exception, when the global's valtype is v128 and the imported objects type is not WebAssembly.Global.

## Exported Functions

### Exported Function Call

Calling an Exported Function will throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror), when parameters or results contains a v128. This error is thrown each time the [[Call]] method is invoked.

### Creating a host function

Creating a host function from JavaScript object will throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror), when the host function signature contains a v128.

### Global constructor

If Global(descriptor, v) constructor will throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror), when invoked with v of valuetype v128.

## JavaScript coercion

### ToJSValue

The algorithm toJSValue(w) should have an assertion ensuring w is not of the form v128.const v128.

### ToWebAssemblyValue

The algorithm ToWebAssemblyValue(v, type)  should have an assertion ensuring type is not v128.

## JavaScript API Global Object algorithms

### ToValueType

The algorithm ToValueType(s) will return 'v128' if s equals "v128".

### DefaultValue

The algorithm DefaultValueType(valueType) will return v128.const 0.

### GetGlobalValue

The algorithm GetGlobalValue(Global global) will throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror), when type_global(store, global.[[Global]]) is of the form mut v128.

### Global value attribute Setter

The setter of the value attribute of Global will throw a [`TypeError`](https://tc39.github.io/ecma262/#sec-native-error-types-used-in-this-standard-typeerror), when invoked with a value v of valuetype v128.

# Operations

The SIMD operations described in this sections are generally named
`S.Op`, where `S` is either a SIMD type or one of the interpretations
of a SIMD type. Immediate mode operands are prefixed with `imm`.

Many operations are simply the lane-wise application of a scalar operation:

```python
def S.lanewise_unary(func, a):
    result = S.New()
    for i in range(S.Lanes):
        result[i] = func(a[i])
    return result

def S.lanewise_binary(func, a, b):
    result = S.New()
    for i in range(S.Lanes):
        result[i] = func(a[i], b[i])
    return result
```

Comparison operators produce a mask vector where the bits in each lane are 0
for false and all ones for true:

```python
def S.lanewise_comparison(func, a, b):
    all_ones = S.MaskType.Umax
    result = S.MaskType.New()
    for i in range(S.Lanes):
        result[i] = all_ones if func(a[i], b[i]) else 0
    return result
```

## Constructing SIMD values

### Constant
* `v128.const(imm: ImmByte[16]) -> v128`

Materialize a constant `v128` SIMD value from the 16 immediate bytes in the
immediate mode operand `imm` . The `v128.const` instruction is encoded with 16
immediate bytes which provide the bits of the vector directly.

### Create vector with identical lanes
* `i8x16.splat(x: i32) -> v128`
* `i16x8.splat(x: i32) -> v128`
* `i32x4.splat(x: i32) -> v128`
* `i64x2.splat(x: i64) -> v128`
* `f32x4.splat(x: f32) -> v128`
* `f64x2.splat(x: f64) -> v128`

Construct a vector with `x` replicated to all lanes:

```python
def S.splat(x):
    result = S.New()
    for i in range(S.Lanes):
        result[i] = S.Reduce(x)
    return result
```

## Accessing lanes

### Extract lane as a scalar
* `i8x16.extract_lane_s(a: v128, imm: ImmLaneIdx16) -> i32`
* `i8x16.extract_lane_u(a: v128, imm: ImmLaneIdx16) -> i32`
* `i16x8.extract_lane_s(a: v128, imm: ImmLaneIdx8) -> i32`
* `i16x8.extract_lane_u(a: v128, imm: ImmLaneIdx8) -> i32`
* `i32x4.extract_lane(a: v128, imm: ImmLaneIdx4) -> i32`
* `i64x2.extract_lane(a: v128, imm: ImmLaneIdx2) -> i64`
* `f32x4.extract_lane(a: v128, imm: ImmLaneIdx4) -> f32`
* `f64x2.extract_lane(a: v128, imm: ImmLaneIdx2) -> f64`

Extract the scalar value of lane specified in the immediate mode operand `imm`
in `a`. The `{interpretation}.extract_lane{_s}{_u}` instructions are encoded
with one immediate byte providing the index of the lane to extract.

```python
def S.extract_lane(a, i):
    return a[i]
```

The `_s` and `_u` variants will sign-extend or zero-extend the lane value to
`i32` respectively.

### Replace lane value
* `i8x16.replace_lane(a: v128, imm: ImmLaneIdx16, x: i32) -> v128`
* `i16x8.replace_lane(a: v128, imm: ImmLaneIdx8, x: i32) -> v128`
* `i32x4.replace_lane(a: v128, imm: ImmLaneIdx4, x: i32) -> v128`
* `i64x2.replace_lane(a: v128, imm: ImmLaneIdx2, x: i64) -> v128`
* `f32x4.replace_lane(a: v128, imm: ImmLaneIdx4, x: f32) -> v128`
* `f64x2.replace_lane(a: v128, imm: ImmLaneIdx2, x: f64) -> v128`

Return a new vector with lanes identical to `a`, except for the lane specified
in the immediate mode operand `imm` which has the value `x`. The
`{interpretation}.replace_lane` instructions are encoded with an immediate byte
providing the index of the lane the value of which is to be replaced.

```python
def S.replace_lane(a, i, x):
    result = S.New()
    for j in range(S.Lanes):
        result[j] = a[j]
    result[i] = x
    return result
```

The input lane value, `x`, is interpreted the same way as for the splat
instructions. For the `i8` and `i16` lanes, the high bits of `x` are ignored.

### Shuffling using immediate indices
* `i8x16.shuffle(a: v128, b: v128, imm: ImmLaneIdx32[16]) -> v128`

Returns a new vector with lanes selected from the lanes of the two input vectors
`a` and `b` specified in the 16 byte wide immediate mode operand `imm`. This
instruction is encoded with 16 bytes providing the indices of the elements to
return. The indices `i` in range `[0, 15]` select the `i`-th element of `a`. The
indices in range `[16, 31]` select the `i - 16`-th element of `b`.

```python
def S.shuffle(a, b, s):
    result = S.New()
    for i in range(S.Lanes):
        if s[i] < S.lanes:
            result[i] = a[s[i]]
        else:
            result[i] = b[s[i] - S.lanes]
    return result
```

### Swizzling using variable indices
* `i8x16.swizzle(a: v128, s: v128) -> v128`

Returns a new vector with lanes selected from the lanes of the first input
vector `a` specified in the second input vector `s`. The indices `i` in range
`[0, 15]` select the `i`-th element of `a`. For indices outside of the range
the resulting lane is initialized to 0.

```python
def S.swizzle(a, s):
    result = S.New()
    for i in range(S.Lanes):
        if s[i] < S.lanes:
            result[i] = a[s[i]]
        else:
            result[i] = 0
    return result
```

## Integer arithmetic

Wrapping integer arithmetic discards the high bits of the result.

```python
def S.Reduce(x):
    bitmask = (1 << S.LaneBits) - 1
    return x & bitmask
```

There is no integer division operation provided here. This operation is not
commonly part of 128-bit SIMD ISAs.

### Integer addition
* `i8x16.add(a: v128, b: v128) -> v128`
* `i16x8.add(a: v128, b: v128) -> v128`
* `i32x4.add(a: v128, b: v128) -> v128`
* `i64x2.add(a: v128, b: v128) -> v128`

Lane-wise wrapping integer addition:

```python
def S.add(a, b):
    def add(x, y):
        return S.Reduce(x + y)
    return S.lanewise_binary(add, a, b)
```

### Integer subtraction
* `i8x16.sub(a: v128, b: v128) -> v128`
* `i16x8.sub(a: v128, b: v128) -> v128`
* `i32x4.sub(a: v128, b: v128) -> v128`
* `i64x2.sub(a: v128, b: v128) -> v128`

Lane-wise wrapping integer subtraction:

```python
def S.sub(a, b):
    def sub(x, y):
        return S.Reduce(x - y)
    return S.lanewise_binary(sub, a, b)
```

### Integer multiplication
* `i16x8.mul(a: v128, b: v128) -> v128`
* `i32x4.mul(a: v128, b: v128) -> v128`
* `i64x2.mul(a: v128, b: v128) -> v128`

Lane-wise wrapping integer multiplication:

```python
def S.mul(a, b):
    def mul(x, y):
        return S.Reduce(x * y)
    return S.lanewise_binary(mul, a, b)
```

### Integer dot product
* `i32x4.dot_i16x8_s(a: v128, b: v128) -> v128`

Lane-wise multiply signed 16-bit integers in the two input vectors and add adjacent pairs of the full 32-bit results.

### Integer negation
* `i8x16.neg(a: v128) -> v128`
* `i16x8.neg(a: v128) -> v128`
* `i32x4.neg(a: v128) -> v128`
* `i64x2.neg(a: v128) -> v128`

Lane-wise wrapping integer negation. In wrapping arithmetic, `y = -x` is the
unique value such that `x + y == 0`.

```python
def S.neg(a):
    def neg(x):
        return S.Reduce(-x)
    return S.lanewise_unary(neg, a)
```

## Extended integer arithmetic

### Extended integer multiplication
* `i16x8.extmul_low_i8x16_s(a: v128, b: v128) -> v128`
* `i16x8.extmul_high_i8x16_s(a: v128, b: v128) -> v128`
* `i16x8.extmul_low_i8x16_u(a: v128, b: v128) -> v128`
* `i16x8.extmul_high_i8x16_u(a: v128, b: v128) -> v128`
* `i32x4.extmul_low_i16x8_s(a: v128, b: v128) -> v128`
* `i32x4.extmul_high_i16x8_s(a: v128, b: v128) -> v128`
* `i32x4.extmul_low_i16x8_u(a: v128, b: v128) -> v128`
* `i32x4.extmul_high_i16x8_u(a: v128, b: v128) -> v128`
* `i64x2.extmul_low_i32x4_s(a: v128, b: v128) -> v128`
* `i64x2.extmul_high_i32x4_s(a: v128, b: v128) -> v128`
* `i64x2.extmul_low_i32x4_u(a: v128, b: v128) -> v128`
* `i64x2.extmul_high_i32x4_u(a: v128, b: v128) -> v128`

Lane-wise integer extended multiplication producing twice wider result than the inputs.

These instructions provide a more performant equivalent to the following composite operations:
- `i16x8.extmul_low_i8x16_s(a, b)` is equivalent to `i16x8.mul(i16x8.extend_low_i8x16_s(a), i16x8.extend_low_i8x16_s(b))`.
- `i16x8.extmul_high_i8x16_s(a, b)` is equivalent to `i16x8.mul(i16x8.extend_high_i8x16_s(a), i16x8.extend_high_i8x16_s(b))`.
- `i16x8.extmul_low_i8x16_u(a, b)` is equivalent to `i16x8.mul(i16x8.extend_low_i8x16_u(a), i16x8.extend_low_i8x16_u(b))`.
- `i16x8.extmul_high_i8x16_u(a, b)` is equivalent to `i16x8.mul(i16x8.extend_high_i8x16_u(a), i16x8.extend_high_i8x16_u(b))`.
- `i32x4.extmul_low_i16x8_s(a, b)` is equivalent to `i32x4.mul(i32x4.extend_low_i16x8_s(a), i32x4.extend_low_i16x8_s(b))`.
- `i32x4.extmul_high_i16x8_s(a, b)` is equivalent to `i32x4.mul(i32x4.extend_high_i16x8_s(a), i32x4.extend_high_i16x8_s(b))`.
- `i32x4.extmul_low_i16x8_u(a, b)` is equivalent to `i32x4.mul(i32x4.extend_low_i16x8_u(a), i32x4.extend_low_i16x8_u(b))`.
- `i32x4.extmul_high_i16x8_u(a, b)` is equivalent to `i32x4.mul(i32x4.extend_high_i16x8_u(a), i32x4.extend_high_i16x8_u(b))`.
- `i64x2.extmul_low_i32x4_s(a, b)` is equivalent to `i64x2.mul(i64x2.extend_low_i32x4_s(a), i64x2.extend_low_i32x4_s(b))`.
- `i64x2.extmul_high_i32x4_s(a, b)` is equivalent to `i64x2.mul(i64x2.extend_high_i32x4_s(a), i64x2.extend_high_i32x4_s(b))`.
- `i64x2.extmul_low_i32x4_u(a, b)` is equivalent to `i64x2.mul(i64x2.extend_low_i32x4_u(a), i64x2.extend_low_i32x4_u(b))`.
- `i64x2.extmul_high_i32x4_u(a, b)` is equivalent to `i64x2.mul(i64x2.extend_high_i32x4_u(a), i64x2.extend_high_i32x4_u(b))`.

### Extended pairwise integer addition
* `i16x8.extadd_pairwise_i8x16_s(a: v128) -> v128`
* `i16x8.extadd_pairwise_i8x16_u(a: v128) -> v128`
* `i32x4.extadd_pairwise_i16x8_s(a: v128) -> v128`
* `i32x4.extadd_pairwise_i16x8_u(a: v128) -> v128`

Lane-wise integer extended pairwise addition producing extended results (twice wider results than the inputs).

```python
def S.extadd_pairwise_T(ext, a):
    result = S.New()
    for i in range(S.Lanes):
        result[i] = ext(a[i*2]) + ext(a[i*2+1])

def S.extadd_pairwise_T_s(a):
    return S.extadd_pairwise_T(Sext, a)

def S.extadd_pairwise_T_u(a):
    return S.extadd_pairwise_T(Zext, a)
```

## Saturating integer arithmetic

Saturating integer arithmetic behaves differently on signed and unsigned lanes.
It is only defined here for 8-bit and 16-bit integer lanes.

```python
def S.SignedSaturate(x):
    if x < S.Smin:
        return S.Smin
    if x > S.Smax:
        return S.Smax
    return x

def S.UnsignedSaturate(x):
    if x < 0:
        return 0
    if x > S.Umax:
        return S.Umax
    return x
```

### Saturating integer addition
* `i8x16.add_sat_s(a: v128, b: v128) -> v128`
* `i8x16.add_sat_u(a: v128, b: v128) -> v128`
* `i16x8.add_sat_s(a: v128, b: v128) -> v128`
* `i16x8.add_sat_u(a: v128, b: v128) -> v128`

Lane-wise saturating addition:

```python
def S.add_sat_s(a, b):
    def addsat(x, y):
        return S.SignedSaturate(x + y)
    return S.lanewise_binary(addsat, S.AsSigned(a), S.AsSigned(b))

def S.add_sat_u(a, b):
    def addsat(x, y):
        return S.UnsignedSaturate(x + y)
    return S.lanewise_binary(addsat, S.AsUnsigned(a), S.AsUnsigned(b))
```

### Saturating integer subtraction
* `i8x16.sub_sat_s(a: v128, b: v128) -> v128`
* `i8x16.sub_sat_u(a: v128, b: v128) -> v128`
* `i16x8.sub_sat_s(a: v128, b: v128) -> v128`
* `i16x8.sub_sat_u(a: v128, b: v128) -> v128`

Lane-wise saturating subtraction:

```python
def S.sub_sat_s(a, b):
    def subsat(x, y):
        return S.SignedSaturate(x - y)
    return S.lanewise_binary(subsat, S.AsSigned(a), S.AsSigned(b))

def S.sub_sat_u(a, b):
    def subsat(x, y):
        return S.UnsignedSaturate(x - y)
    return S.lanewise_binary(subsat, S.AsUnsigned(a), S.AsUnsigned(b))
```

### Saturating integer Q-format rounding multiplication

* `i16x8.q15mulr_sat_s(a: v128, b: v128) -> v128`

Lane-wise saturating rounding multiplication in Q15 format:

```python
def S.q15mulr_sat_s(a, b):
    def subq15mulr(x, y):
        return S.SignedSaturate((x * y + 0x4000) >> 15)
    return S.lanewise_binary(subq15mulr, S.AsSigned(a), S.AsSigned(b))
```

### Lane-wise integer minimum
* `i8x16.min_s(a: v128, b: v128) -> v128`
* `i8x16.min_u(a: v128, b: v128) -> v128`
* `i16x8.min_s(a: v128, b: v128) -> v128`
* `i16x8.min_u(a: v128, b: v128) -> v128`
* `i32x4.min_s(a: v128, b: v128) -> v128`
* `i32x4.min_u(a: v128, b: v128) -> v128`

Compares lane-wise signed/unsigned integers, and returns the minimum of
each pair.

```python
def S.min(a, b):
    return S.lanewise_binary(min, a, b)
```

### Lane-wise integer maximum
* `i8x16.max_s(a: v128, b: v128) -> v128`
* `i8x16.max_u(a: v128, b: v128) -> v128`
* `i16x8.max_s(a: v128, b: v128) -> v128`
* `i16x8.max_u(a: v128, b: v128) -> v128`
* `i32x4.max_s(a: v128, b: v128) -> v128`
* `i32x4.max_u(a: v128, b: v128) -> v128`

Compares lane-wise signed/unsigned integers, and returns the maximum of
each pair.

```python
def S.max(a, b):
    return S.lanewise_binary(max, a, b)
```

### Lane-wise integer rounding average
* `i8x16.avgr_u(a: v128, b: v128) -> v128`
* `i16x8.avgr_u(a: v128, b: v128) -> v128`

Lane-wise rounding average:

```python
def S.RoundingAverage(x, y):
    return (x + y + 1) // 2

def S.avgr_u(a, b):
    return S.lanewise_binary(S.RoundingAverage, S.AsUnsigned(a), S.AsUnsigned(b))
```

### Lane-wise integer absolute value
* `i8x16.abs(a: v128) -> v128`
* `i16x8.abs(a: v128) -> v128`
* `i32x4.abs(a: v128) -> v128`
* `i64x2.abs(a: v128) -> v128`

Lane-wise wrapping absolute value.

```python
def S.abs(a):
    return S.lanewise_unary(abs, S.AsSigned(a))
```

## Bit shifts

### Left shift by scalar
* `i8x16.shl(a: v128, y: i32) -> v128`
* `i16x8.shl(a: v128, y: i32) -> v128`
* `i32x4.shl(a: v128, y: i32) -> v128`
* `i64x2.shl(a: v128, y: i32) -> v128`

Shift the bits in each lane to the left by the same amount. The shift count is
taken modulo lane width:

```python
def S.shl(a, y):
    # Number of bits to shift: 0 .. S.LaneBits - 1.
    amount = y mod S.LaneBits
    def shift(x):
        return S.Reduce(x << amount)
    return S.lanewise_unary(shift, a)
```

### Right shift by scalar
* `i8x16.shr_s(a: v128, y: i32) -> v128`
* `i8x16.shr_u(a: v128, y: i32) -> v128`
* `i16x8.shr_s(a: v128, y: i32) -> v128`
* `i16x8.shr_u(a: v128, y: i32) -> v128`
* `i32x4.shr_s(a: v128, y: i32) -> v128`
* `i32x4.shr_u(a: v128, y: i32) -> v128`
* `i64x2.shr_s(a: v128, y: i32) -> v128`
* `i64x2.shr_u(a: v128, y: i32) -> v128`

Shift the bits in each lane to the right by the same amount. The shift count is
taken modulo lane width.  This is an arithmetic right shift for the `_s`
variants and a logical right shift for the `_u` variants.

```python
def S.shr_s(a, y):
    # Number of bits to shift: 0 .. S.LaneBits - 1.
    amount = y mod S.LaneBits
    def shift(x):
        return x >> amount
    return S.lanewise_unary(shift, S.AsSigned(a))

def S.shr_u(a, y):
    # Number of bits to shift: 0 .. S.LaneBits - 1.
    amount = y mod S.LaneBits
    def shift(x):
        return x >> amount
    return S.lanewise_unary(shift, S.AsUnsigned(a))
```


## Bitwise operations

Bitwise operations treat a `v128` value type as a vector of 128 independent bits.

### Bitwise logic
* `v128.and(a: v128, b: v128) -> v128`
* `v128.or(a: v128, b: v128) -> v128`
* `v128.xor(a: v128, b: v128) -> v128`
* `v128.not(a: v128) -> v128`

The logical operations defined on the scalar integer types are also available
on the `v128` type where they operate bitwise the same way C's `&`, `|`, `^`,
and `~` operators work on an `unsigned` type.

### Bitwise AND-NOT

* `v128.andnot(a: v128, b: v128) -> v128`

Bitwise AND of bits of `a` and the logical inverse of bits of `b`. This operation is equivalent to `v128.and(a, v128.not(b))`.

### Bitwise select
* `v128.bitselect(v1: v128, v2: v128, c: v128) -> v128`

Use the bits in the control mask `c` to select the corresponding bit from `v1`
when 1 and `v2` when 0.
This is the same as `v128.or(v128.and(v1, c), v128.and(v2, v128.not(c)))`.

Note that the normal WebAssembly `select` instruction also works with vector
types. It selects between two whole vectors controlled by a single scalar value,
rather than selecting bits controlled by a control mask vector.

### Lane-wise Population Count
* `i8x16.popcnt(v: v128) -> v128`

Count the number of bits set to one within each lane.

```python
def S.popcnt(v):
    return S.lanewise_unary(popcnt, v)
```

## Boolean horizontal reductions

These operations reduce all the lanes of an integer vector to a single scalar
0 or 1 value. A lane is considered "true" if it is non-zero.

### Any bit true
* `v128.any_true(a: v128) -> i32`

These functions return 1 if any bit in `a` is non-zero, 0 otherwise.

### All lanes true
* `i8x16.all_true(a: v128) -> i32`
* `i16x8.all_true(a: v128) -> i32`
* `i32x4.all_true(a: v128) -> i32`
* `i64x2.all_true(a: v128) -> i32`

These functions return 1 if all lanes in `a` are non-zero, 0 otherwise.

```python
def S.all_true(a):
    for i in range(S.Lanes):
        if a[i] == 0:
            return 0
    return 1
```

## Bitmask extraction

* `i8x16.bitmask(a: v128) -> i32`
* `i16x8.bitmask(a: v128) -> i32`
* `i32x4.bitmask(a: v128) -> i32`
* `i64x2.bitmask(a: v128) -> i32`

These operations extract the high bit for each lane in `a` and produce a scalar
mask with all bits concatenated.

```python
def S.bitmask(a):
    result = 0
    for i in range(S.Lanes):
        if a[i] < 0:
            result = result | (1 << i)
    return result
```

## Comparisons

The comparison operations all compare two vectors lane-wise, and produce a mask
vector with the same number of lanes as the input interpretation where the bits
in each lane are `0` for `false` and all ones for `true`.

### Equality
* `i8x16.eq(a: v128, b: v128) -> v128`
* `i16x8.eq(a: v128, b: v128) -> v128`
* `i32x4.eq(a: v128, b: v128) -> v128`
* `i64x2.eq(a: v128, b: v128) -> v128`
* `f32x4.eq(a: v128, b: v128) -> v128`
* `f64x2.eq(a: v128, b: v128) -> v128`

Integer equality is independent of the signed/unsigned interpretation. Floating
point equality follows IEEE semantics, so a NaN lane compares not equal with
anything, including itself, and +0.0 is equal to -0.0:

```python
def S.eq(a, b):
    def eq(x, y):
        return x == y
    return S.lanewise_comparison(eq, a, b)
```

### Non-equality
* `i8x16.ne(a: v128, b: v128) -> v128`
* `i16x8.ne(a: v128, b: v128) -> v128`
* `i32x4.ne(a: v128, b: v128) -> v128`
* `i64x2.ne(a: v128, b: v128) -> v128`
* `f32x4.ne(a: v128, b: v128) -> v128`
* `f64x2.ne(a: v128, b: v128) -> v128`

The `ne` operations produce the inverse of their `eq` counterparts:

```python
def S.ne(a, b):
    def ne(x, y):
        return x != y
    return S.lanewise_comparison(ne, a, b)
```

### Less than
* `i8x16.lt_s(a: v128, b: v128) -> v128`
* `i8x16.lt_u(a: v128, b: v128) -> v128`
* `i16x8.lt_s(a: v128, b: v128) -> v128`
* `i16x8.lt_u(a: v128, b: v128) -> v128`
* `i32x4.lt_s(a: v128, b: v128) -> v128`
* `i32x4.lt_u(a: v128, b: v128) -> v128`
* `i64x2.lt_s(a: v128, b: v128) -> v128`
* `f32x4.lt(a: v128, b: v128) -> v128`
* `f64x2.lt(a: v128, b: v128) -> v128`

### Less than or equal
* `i8x16.le_s(a: v128, b: v128) -> v128`
* `i8x16.le_u(a: v128, b: v128) -> v128`
* `i16x8.le_s(a: v128, b: v128) -> v128`
* `i16x8.le_u(a: v128, b: v128) -> v128`
* `i32x4.le_s(a: v128, b: v128) -> v128`
* `i32x4.le_u(a: v128, b: v128) -> v128`
* `i64x2.le_s(a: v128, b: v128) -> v128`
* `f32x4.le(a: v128, b: v128) -> v128`
* `f64x2.le(a: v128, b: v128) -> v128`

### Greater than
* `i8x16.gt_s(a: v128, b: v128) -> v128`
* `i8x16.gt_u(a: v128, b: v128) -> v128`
* `i16x8.gt_s(a: v128, b: v128) -> v128`
* `i16x8.gt_u(a: v128, b: v128) -> v128`
* `i32x4.gt_s(a: v128, b: v128) -> v128`
* `i32x4.gt_u(a: v128, b: v128) -> v128`
* `i64x2.gt_s(a: v128, b: v128) -> v128`
* `f32x4.gt(a: v128, b: v128) -> v128`
* `f64x2.gt(a: v128, b: v128) -> v128`

### Greater than or equal
* `i8x16.ge_s(a: v128, b: v128) -> v128`
* `i8x16.ge_u(a: v128, b: v128) -> v128`
* `i16x8.ge_s(a: v128, b: v128) -> v128`
* `i16x8.ge_u(a: v128, b: v128) -> v128`
* `i32x4.ge_s(a: v128, b: v128) -> v128`
* `i32x4.ge_u(a: v128, b: v128) -> v128`
* `i64x2.ge_s(a: v128, b: v128) -> v128`
* `f32x4.ge(a: v128, b: v128) -> v128`
* `f64x2.ge(a: v128, b: v128) -> v128`

## Load and store

Load and store operations are provided for the `v128` vectors. The memory
operations take the same arguments and have the same semantics as the existing
scalar WebAssembly load and store instructions (see
[memarg](https://webassembly.github.io/spec/core/bikeshed/index.html#syntax-memarg).
The difference is that the memory access size is 16 bytes which is also the
natural alignment.

### Load

* `v128.load(m: memarg) -> v128`

Load a `v128` vector from the given heap address.

```python
def S.load(m: memarg):
    return S.from_bytes(memory[memarg.offset:memarg.offset + 16])
```

### Load and Zero-Pad

* `v128.load32_zero(m: memarg) -> v128`
* `v128.load64_zero(m: memarg) -> v128`

Load a single 32-bit or 64-bit element into the lowest bits of a `v128` vector,
and initialize all other bits of the `v128` vector to zero.

```python
def S.load32_zero(m: memarg):
    return S.from_bytes(memory[memarg.offset:memarg.offset + 4])
```

```python
def S.load64_zero(m: memarg):
    return S.from_bytes(memory[memarg.offset:memarg.offset + 8])
```

### Load and Splat

* `v128.load8_splat(m: memarg) -> v128`
* `v128.load16_splat(m: memarg) -> v128`
* `v128.load32_splat(m: memarg) -> v128`
* `v128.load64_splat(m: memarg) -> v128`

Load a single element and splat to all lanes of a `v128` vector. The natural
alignment is the size of the element loaded.

```python
def S.load_splat(m: memarg):
    val_bytes = memory[memarg.offset:memarg.offset + S.LaneBytes])
    return S.splat(S.LaneType.from_bytes(val_bytes))
```

### Load Lane

* `v128.load8_lane(m: memarg, x: v128, imm: ImmLaneIdx16) -> v128`
* `v128.load16_lane(m: memarg, x: v128, imm: ImmLaneIdx8) -> v128`
* `v128.load32_lane(m: memarg, x: v128, imm: ImmLaneIdx4) -> v128`
* `v128.load64_lane(m: memarg, x: v128, imm: ImmLaneIdx2) -> v128`

Load a single element from `m` into the lane of `x` specified in the immediate
mode operand `imm`. The values of all other lanes of `x` are bypassed as is.

### Load and Extend

* `v128.load8x8_s(m: memarg) -> v128`: load eight 8-bit integers and sign extend each one to a 16-bit lane
* `v128.load8x8_u(m: memarg) -> v128`: load eight 8-bit integers and zero extend each one to a 16-bit lane
* `v128.load16x4_s(m: memarg) -> v128`: load four 16-bit integers and sign extend each one to a 32-bit lane
* `v128.load16x4_u(m: memarg) -> v128`: load four 16-bit integers and zero extend each one to a 32-bit lane
* `v128.load32x2_s(m: memarg) -> v128`: load two 32-bit integers and sign extend each one to a 64-bit lane
* `v128.load32x2_u(m: memarg) -> v128`: load two 32-bit integers and zero extend each one to a 64-bit lane

Fetch consecutive integers up to 32-bit wide and produce a vector with lanes up
to 64 bits. The natural alignment is 8 bytes.

```python
def S.load_extend(ext, m: memarg):
    result = S.New()
    bytes = memory[memarg.offset:memarg.offset + 8])
    for i in range(S.Lanes):
        result[i] = ext(S.LaneType.from_bytes(bytes[(i * S.LaneBytes/2):((i+1) * S.LaneBytes/2)]))
    return result

def S.load_extend_s(m: memarg):
    return S.load_extend(Sext, memarg)

def S.load_extend_u(m: memarg):
    return S.load_extend(Zext, memarg)
```

### Store

* `v128.store(m: memarg, data: v128)`

Store a `v128` vector to the given heap address.

```python
def S.store(m: memarg, a):
    memory[memarg.offset:memarg.offset + 16] = bytes(a)
```

### Store Lane

* `v128.store8_lane(m: memarg, data: v128, imm: ImmLaneIdx16)`
* `v128.store16_lane(m: memarg, data: v128, imm: ImmLaneIdx8)`
* `v128.store32_lane(m: memarg, data: v128, imm: ImmLaneIdx4)`
* `v128.store64_lane(m: memarg, data: v128, imm: ImmLaneIdx2)`

Store into `m` the lane of `data` specified in the immediate mode operand `imm`.

## Floating-point sign bit operations

These floating point operations are simple manipulations of the sign bit. No
changes are made to the exponent or trailing significand bits, even for NaN
inputs.

### Negation
* `f32x4.neg(a: v128) -> v128`
* `f64x2.neg(a: v128) -> v128`

Apply the IEEE `negate(x)` function to each lane. This simply inverts the sign
bit, preserving all other bits.

```python
def S.neg(a):
    return S.lanewise_unary(ieee.negate, a)
```

### Floating-point absolute value
* `f32x4.abs(a: v128) -> v128`
* `f64x2.abs(a: v128) -> v128`

Apply the IEEE `abs(x)` function to each lane. This simply clears the sign bit,
preserving all other bits.

```python
def S.abs(a):
    return S.lanewise_unary(ieee.abs, a)
```

## Floating-point min and max

These operations are not part of the IEEE 754-2008 standard. They are lane-wise
versions of the existing scalar WebAssembly operations.

### NaN-propagating minimum
* `f32x4.min(a: v128, b: v128) -> v128`
* `f64x2.min(a: v128, b: v128) -> v128`

Lane-wise minimum value, propagating NaNs.

### NaN-propagating maximum
* `f32x4.max(a: v128, b: v128) -> v128`
* `f64x2.max(a: v128, b: v128) -> v128`

Lane-wise maximum value, propagating NaNs.

### Pseudo-minimum
* `f32x4.pmin(a: v128, b: v128) -> v128`
* `f64x2.pmin(a: v128, b: v128) -> v128`

Lane-wise minimum value, defined as `b < a ? b : a`.

### Pseudo-maximum
* `f32x4.pmax(a: v128, b: v128) -> v128`
* `f64x2.pmax(a: v128, b: v128) -> v128`

Lane-wise maximum value, defined as `a < b ? b : a`.

## Floating-point arithmetic

The floating-point arithmetic operations are all lane-wise versions of the
existing scalar WebAssembly operations.

### Addition
* `f32x4.add(a: v128, b: v128) -> v128`
* `f64x2.add(a: v128, b: v128) -> v128`

Lane-wise IEEE `addition`.

### Subtraction
* `f32x4.sub(a: v128, b: v128) -> v128`
* `f64x2.sub(a: v128, b: v128) -> v128`

Lane-wise IEEE `subtraction`.

### Division
* `f32x4.div(a: v128, b: v128) -> v128`
* `f64x2.div(a: v128, b: v128) -> v128`

Lane-wise IEEE `division`.

### Multiplication
* `f32x4.mul(a: v128, b: v128) -> v128`
* `f64x2.mul(a: v128, b: v128) -> v128`

Lane-wise IEEE `multiplication`.

### Square root
* `f32x4.sqrt(a: v128) -> v128`
* `f64x2.sqrt(a: v128) -> v128`

Lane-wise IEEE `squareRoot`.

### Round to integer above (ceiling)
* `f32x4.ceil(a: v128) -> v128`
* `f64x2.ceil(a: v128) -> v128`

Lane-wise rounding to the nearest integral value not smaller than the input.

### Round to integer below (floor)
* `f32x4.floor(a: v128) -> v128`
* `f64x2.floor(a: v128) -> v128`

Lane-wise rounding to the nearest integral value not greater than the input.

### Round to integer toward zero (truncate to integer)
* `f32x4.trunc(a: v128) -> v128`
* `f64x2.trunc(a: v128) -> v128`

Lane-wise rounding to the nearest integral value with the magnitude not larger than the input.

### Round to nearest integer, ties to even
* `f32x4.nearest(a: v128) -> v128`
* `f64x2.nearest(a: v128) -> v128`

Lane-wise rounding to the nearest integral value; if two values are equally near, rounds to the even one.

## Conversions
### Integer to single-precision floating point
* `f32x4.convert_i32x4_s(a: v128) -> v128`
* `f32x4.convert_i32x4_u(a: v128) -> v128`

Lane-wise conversion from integer to floating point. Integer values not
representable as single-precision floating-point numbers will be rounded to the
nearest-even representable number.

### Integer to double-precision floating point
* `f64x2.convert_low_i32x4_s(a: v128) -> v128`
* `f64x2.convert_low_i32x4_u(a: v128) -> v128`

Lane-wise conversion from integer to floating point.

### Single-precision floating point to integer with saturation
* `i32x4.trunc_sat_f32x4_s(a: v128) -> v128`
* `i32x4.trunc_sat_f32x4_u(a: v128) -> v128`

Lane-wise saturating conversion from single-precision floating point to integer
using the IEEE `convertToIntegerTowardZero` function. If any input lane is a
NaN, the resulting lane is 0. If the rounded integer value of a lane is outside
the range of the destination type, the result is saturated to the nearest
representable integer value.

### Double-precision floating point to integer with saturation
* `i32x4.trunc_sat_f64x2_s_zero(a: v128) -> v128`
* `i32x4.trunc_sat_f64x2_u_zero(a: v128) -> v128`

Saturating conversion of the two double-precision floating point lanes to two
lower integer lanes using the IEEE `convertToIntegerTowardZero` function. The
two higher lanes of the result are initialized to zero. If any input lane is a
NaN, the resulting lane is 0. If the rounded integer value of a lane is outside
the range of the destination type, the result is saturated to the nearest
representable integer value.

### Double-precision floating point to single-precision
* `f32x4.demote_f64x2_zero(a: v128) -> v128`

Conversion of the two double-precision floating point lanes to two lower
single-precision lanes of the result. The two higher lanes of the result are
initialized to zero. If the conversion result is not representable as a
single-precision floating point number, it is rounded to the nearest-even
representable number.

### Single-precision floating point to double-precision
* `f64x2.promote_low_f32x4(a: v128) -> v128`

Conversion of the two lower single-precision floating point lanes to the two
double-precision lanes of the result.

### Integer to integer narrowing
* `i8x16.narrow_i16x8_s(a: v128, b: v128) -> v128`
* `i8x16.narrow_i16x8_u(a: v128, b: v128) -> v128`
* `i16x8.narrow_i32x4_s(a: v128, b: v128) -> v128`
* `i16x8.narrow_i32x4_u(a: v128, b: v128) -> v128`

Converts two input vectors into a smaller lane vector by narrowing each lane,
signed or unsigned. The signed narrowing operation will use signed saturation
to handle overflow, 0x7f or 0x80 for i8x16, the unsigned narrowing operation
will use unsigned saturation to handle overflow, 0x00 or 0xff for i8x16.
Regardless of the whether the operation is signed or unsigned, the input lanes
are interpreted as signed integers.

```python
def S.narrow_T_s(a, b):
    result = S.New()
    for i in range(T.Lanes):
        result[i] = S.SignedSaturate(a[i])
    for i in range(T.Lanes):
        result[T.Lanes + i] = S.SignedSaturate(b[i])
    return result

def S.narrow_T_u(a, b):
    result = S.New()
    for i in range(T.Lanes):
        result[i] = S.UnsignedSaturate(a[i])
    for i in range(T.Lanes):
        result[T.Lanes + i] = S.UnsignedSaturate(b[i])
    return result
```

### Integer to integer extension
* `i16x8.extend_low_i8x16_s(a: v128) -> v128`
* `i16x8.extend_high_i8x16_s(a: v128) -> v128`
* `i16x8.extend_low_i8x16_u(a: v128) -> v128`
* `i16x8.extend_high_i8x16_u(a: v128) -> v128`
* `i32x4.extend_low_i16x8_s(a: v128) -> v128`
* `i32x4.extend_high_i16x8_s(a: v128) -> v128`
* `i32x4.extend_low_i16x8_u(a: v128) -> v128`
* `i32x4.extend_high_i16x8_u(a: v128) -> v128`
* `i64x2.extend_low_i32x4_s(a: v128) -> v128`
* `i64x2.extend_high_i32x4_s(a: v128) -> v128`
* `i64x2.extend_low_i32x4_u(a: v128) -> v128`
* `i64x2.extend_high_i32x4_u(a: v128) -> v128`

Converts low or high half of the smaller lane vector to a larger lane vector,
sign extended or zero (unsigned) extended.

```python
def S.extend_low_T(ext, a):
    result = S.New()
    for i in range(S.Lanes):
        result[i] = ext(a[i])

def S.extend_high_T(ext, a):
    result = S.New()
    for i in range(S.Lanes):
        result[i] = ext(a[S.Lanes + i])

def S.extend_low_T_s(a):
    return S.extend_low_T(Sext, a)

def S.extend_high_T_s(a):
    return S.extend_high_T(Sext, a)

def S.extend_low_T_u(a):
    return S.extend_low_T(Zext, a)

def S.extend_high_T_u(a):
    return S.extend_high_T(Zext, a)
```
