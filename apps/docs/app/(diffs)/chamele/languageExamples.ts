import type { Lang } from '@pierre/chamele';

export const PLAYGROUND_LANGUAGES = [
  [
    'ts',
    'TypeScript',
    `/**
 * An interface for a point in 2D space.
 */
interface Point {
  x: number;
  y: number;
}

/**
 * Calculates the distance between two points.
 * @param {Point} a - The first point.
 * @param {Point} b - The second point.
 * @returns The distance between a and b.
 */
function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

console.log(distance({ x: 0, y: 0 }, { x: 3, y: 4 }));`,
  ],
  [
    'js',
    'JavaScript',
    `/**
 * Memoizes a function.
 * @param {Function} fn - The function to memoize.
 * @returns {Function} The memoized function.
 */
function memoize(fn) {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key);
  };
}

// Slugifies a title.
const slug = memoize((title) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
);

console.log(\`slug: \${slug("Hello, WAT & Wasm!")}\`);`,
  ],
  [
    'tsx',
    'TSX',
    `// Badge.tsx

import { useState } from "react";

type BadgeProps = {
  /** The label of the badge. */
  label: string;
  /** The count of the badge. */
  count?: number;
};

export default function Badge({ label, count = 0 }: BadgeProps) {
  const [hot, setHot] = useState(count > 99);
  return (
    <button className={\`badge \${hot ? "hot" : "calm"}\`} onClick={() => setHot(!hot)}>
      {label}: <strong>{count.toLocaleString()}</strong>
    </button>
  );
}`,
  ],
  [
    'html',
    'HTML',
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello, chamele</title>
  <style>
    body { font: 16px/1.5 system-ui; background: #0a0a0a; color: #fafafa; }
    .card { padding: 1rem; border: 1px solid #333; border-radius: 8px; }
  </style>
</head>
<body>
  <!-- one pass over WebAssembly linear memory -->
  <main class="card" data-lang="html">
    <h1>Fast &amp; tiny</h1>
    <button id="go" disabled>Highlight</button>
  </main>
  <script type="module">
    const btn = document.querySelector("#go");
    btn.disabled = false;
    btn.addEventListener("click", () => console.log("go!"));
  </script>
</body>
</html>`,
  ],
  [
    'css',
    'CSS',
    `/* style.css */

:root {
  --accent: #60d199;
  color-scheme: dark;
}

.panel {
  display: grid;
  gap: 0.5rem 1rem;
  background: color-mix(in srgb, var(--accent) 12%, transparent);

  /* nested selectors are supported */
  & > header {
    font-weight: 600;

    &:hover { color: var(--accent) !important; }
  }
}

@media (width < 40rem) {
  .panel { grid-template-columns: 1fr; }
}`,
  ],
  [
    'jsonc',
    'JSON/JSONC',
    `// comments and trailing commas are supported
{
  "name": "chamele-playground",
  "theme": "pierre-dark",
  "langs": ["tsx", "html", "css", "jsonc"],
  "wasm": {
    "simd": true, /* 16 bytes per step */
    "pages": 3,
  },
  "escape": "a\\nb \\u0041",
  "fallback": null,
}`,
  ],
  [
    'bash',
    'Bash',
    `#!/usr/bin/env bash
set -euo pipefail

greet() {
  local name="\${1:-world}"
  printf "Hello, %s!\\n" "$name"
}

for name in Ada Linus; do
  greet "$name"
done`,
  ],
  [
    'c',
    'C',
    `#include <stdio.h>

typedef struct { int x, y; } Point;

static int distance_squared(Point a, Point b) {
  int dx = a.x - b.x;
  int dy = a.y - b.y;
  return dx * dx + dy * dy;
}

int main(void) {
  printf("%d\\n", distance_squared((Point){0, 0}, (Point){3, 4}));
}`,
  ],
  [
    'cpp',
    'C++',
    `#include <iostream>

struct Point {
  int x;
  int y;
};

constexpr int distance_squared(Point a, Point b) {
  const auto dx = a.x - b.x;
  const auto dy = a.y - b.y;
  return dx * dx + dy * dy;
}

int main() {
  std::cout << distance_squared({0, 0}, {3, 4}) << "\\n";
}`,
  ],
  [
    'go',
    'Go',
    `package main

import "fmt"

type Point struct {
    X, Y int
}

func distanceSquared(a, b Point) int {
    dx, dy := a.X-b.X, a.Y-b.Y
    return dx*dx + dy*dy
}

func main() {
    fmt.Println(distanceSquared(Point{0, 0}, Point{3, 4}))
}`,
  ],
  [
    'python',
    'Python',
    `from dataclasses import dataclass

@dataclass(frozen=True)
class Point:
    x: float
    y: float

def distance_squared(a: Point, b: Point) -> float:
    dx, dy = a.x - b.x, a.y - b.y
    return dx ** 2 + dy ** 2

print(f"distance² = {distance_squared(Point(0, 0), Point(3, 4))}")`,
  ],
  [
    'rust',
    'Rust',
    `#[derive(Clone, Copy, Debug)]
struct Point {
    x: i32,
    y: i32,
}

impl Point {
    fn distance_squared(self, other: Self) -> i32 {
        let (dx, dy) = (self.x - other.x, self.y - other.y);
        dx * dx + dy * dy
    }
}

fn main() {
    let origin = Point { x: 0, y: 0 };
    println!("{}", origin.distance_squared(Point { x: 3, y: 4 }));
}`,
  ],
  [
    'yaml',
    'YAML',
    `defaults: &defaults
  retries: 3
  enabled: true

service:
  <<: *defaults
  name: chamele
  languages: [rust, python, yaml]
  command: >-
    pnpm test

metadata:
  owner: wat-labs
  stable: false`,
  ],
  [
    'php',
    'PHP',
    `<?php
declare(strict_types=1);

function greet(string $name): string {
    return "Hello, {$name}!";
}

$names = ["Ada", "Linus"];
?>
<ul>
<?php foreach ($names as $name): ?>
  <li><?= greet($name) ?></li>
<?php endforeach ?>
</ul>`,
  ],
  [
    'sql',
    'SQL',
    `WITH active_users AS (
  SELECT id, name, created_at
  FROM users
  WHERE active = TRUE AND created_at >= :since
), project_totals AS (
  SELECT owner_id, COUNT(*) AS projects
  FROM projects
  WHERE archived_at IS NULL
  GROUP BY owner_id
)
SELECT u.name, u.created_at, COALESCE(p.projects, 0) AS projects
FROM active_users AS u
LEFT JOIN project_totals AS p ON p.owner_id = u.id
WHERE COALESCE(p.projects, 0) > 3
ORDER BY projects DESC, u.name ASC
LIMIT 10;`,
  ],
  [
    'swift',
    'Swift',
    `struct Point {
    let x: Double
    let y: Double

    func distanceSquared(to other: Point) -> Double {
        let dx = x - other.x
        let dy = y - other.y
        return dx * dx + dy * dy
    }
}

let origin = Point(x: 0, y: 0)
print("distance² = \\(origin.distanceSquared(to: Point(x: 3, y: 4)))")`,
  ],
  [
    'haskell',
    'Haskell',
    `module Main where

data Point = Point Int Int
  deriving (Eq, Show)

distanceSquared :: Point -> Point -> Int
distanceSquared (Point ax ay) (Point bx by) =
  let dx = ax - bx
      dy = ay - by
  in dx * dx + dy * dy

main :: IO ()
main = print (distanceSquared (Point 0 0) (Point 3 4))`,
  ],
  [
    'kotlin',
    'Kotlin',
    `data class Point(val x: Int, val y: Int)

fun distanceSquared(a: Point, b: Point): Int {
    val dx = a.x - b.x
    val dy = a.y - b.y
    return dx * dx + dy * dy
}

fun main() {
    val distance = distanceSquared(Point(0, 0), Point(3, 4))
    println("distance² = \${distance}")
}`,
  ],
  [
    'astro',
    'Astro',
    `---
interface Props {
  name?: string;
}

const { name = "world" } = Astro.props;
const languages = ["Rust", "Python", "WAT"];
---
<main>
  <h1>Hello, {name}!</h1>
  <ul>{languages.map((lang) => <li>{lang}</li>)}</ul>
</main>

<style>
  h1 { color: rebeccapurple; }
</style>`,
  ],
  [
    'vue',
    'Vue',
    `<script setup lang="ts">
import { computed, ref } from "vue";

const count = ref(0);
const label = computed(() => "Clicks: " + count.value);
</script>

<template>
  <button class="counter" @click="count++">
    {{ label }}
  </button>
</template>

<style scoped>
.counter { color: #60d199; }
</style>`,
  ],
  [
    'svelte',
    'Svelte',
    `<script lang="ts">
  let count = 0;
  $: doubled = count * 2;
</script>

<button class:active={count > 0} on:click={() => count += 1}>
  Count: {count} · doubled: {doubled}
</button>

<style>
  button.active { color: #60d199; }
</style>`,
  ],
  [
    'xml',
    'XML',
    `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:lang="urn:languages">
  <!-- XML remains case-sensitive markup. -->
  <lang:item id="wat" stable="true">
    <name>WebAssembly Text</name>
    <sample><![CDATA[(module (func $run))]]></sample>
  </lang:item>
  <lang:item id="rust" stable="true">
    <name>Rust</name>
    <sample><![CDATA[fn main() { println!("hello"); }]]></sample>
  </lang:item>
  <lang:item id="zig" stable="false">
    <name>Zig</name>
    <sample><![CDATA[pub fn main() void {}]]></sample>
  </lang:item>
</catalog>`,
  ],
  [
    'markdown',
    'Markdown',
    `---
title: Fast highlighting
draft: false
tags: [wasm, simd]
---

# Chamele

Use \`codeToHtml\` to highlight code in one pass.

<aside data-kind="tip">Inline HTML is highlighted too.</aside>

\`\`\`rust
fn main() {
    println!("hello");
}
\`\`\``,
  ],
  [
    'mdx',
    'MDX',
    `export const meta = { title: "Language examples" };
export const languages = ["Rust", "WAT", "MDX"];

# {meta.title}

<Card tone="accent">
  MDX mixes **Markdown** with <code>JSX</code>.
</Card>

<Grid columns={3}>
  {languages.map((lang, index) => (
    <Badge key={lang} featured={index === 0}>
      {index + 1}. {lang}
    </Badge>
  ))}
</Grid>`,
  ],
  [
    'asm',
    'Assembly',
    `section .data
message: db "Hello, assembly!", 10
length: equ $ - message

section .text
global _start

_start:
    mov rax, 1
    mov rdi, 1
    mov rsi, message
    mov rdx, length
    syscall`,
  ],
  [
    'wat',
    'WebAssembly Text',
    `(module
  (memory (export "memory") 1)

  (func $square (param $x i32) (result i32)
    local.get $x
    local.get $x
    i32.mul)

  (func $store (param $address i32) (param $value i32)
    local.get $address
    local.get $value
    i32.store)

  (export "square" (func $square))
  (export "store" (func $store))
)`,
  ],
  [
    'diff',
    'Diff',
    `diff --git a/src/config.js b/src/config.js
index 1a2b3c4..5d6e7f8 100644
--- a/src/config.js
+++ b/src/config.js
@@ -1,4 +1,5 @@
 export const config = {
-  mode: "slow",
+  mode: "simd",
+  batchSize: 16,
 };`,
  ],
  [
    'glsl',
    'GLSL',
    `#version 450

layout(location = 0) in vec3 normal;
layout(location = 1) in vec2 uv;
layout(location = 0) out vec4 outColor;

uniform sampler2D albedo;

void main() {
  vec3 light = normalize(vec3(0.4, 0.8, 0.2));
  float diffuse = max(dot(normal, light), 0.0);
  outColor = texture(albedo, uv) * vec4(vec3(diffuse), 1.0);
}`,
  ],
  [
    'lua',
    'Lua',
    `local function greet(name)
  return ("Hello, %s!"):format(name)
end

local users = { "Ada", "Linus", "Grace" }
local greetings = {}

for index, name in ipairs(users) do
  greetings[index] = greet(name)
end

table.sort(greetings)

for index, message in ipairs(greetings) do
  print(index, message)
end`,
  ],
  [
    'zig',
    'Zig',
    `const std = @import("std");

const Point = struct {
    x: i32,
    y: i32,
};

fn distanceSquared(a: Point, b: Point) i32 {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

pub fn main() void {
    std.debug.print("distance² = {d}\\n", .{distanceSquared(.{ .x = 0, .y = 0 }, .{ .x = 3, .y = 4 })});
}`,
  ],
  [
    'toml',
    'TOML',
    `title = "chamele"
enabled = true
languages = ["zig", "toml", "wat"]

[wasm]
simd = true
pages = 3

[theme]
name = "pierre-dark"
colors = { background = "#0a0a0a", foreground = "#fafafa" }

[build]
target = "wasm32-unknown-unknown"
optimize = "speed"

[build.features]
simd128 = true
bulk_memory = true`,
  ],
  [
    'java',
    'Java',
    `package demo;

import java.util.List;

/** A labelled counter. */
public record Counter(String label, int count) {
  private static final int MAX = 10;

  public Counter increment() {
    if (count >= MAX) throw new IllegalStateException("full");
    return new Counter(label, count + 1);
  }

  public static void main(String[] args) {
    var c = new Counter("hits", 0).increment();
    System.out.printf("%s=%d%n", c.label(), c.count());
  }
}`,
  ],
  [
    'csharp',
    'C#',
    `using System.Collections.Generic;

namespace Demo;

/// <summary>A labelled counter.</summary>
public sealed record Counter(string Label, int Count)
{
    private const int Max = 10;

    public Counter Increment() =>
        Count >= Max ? throw new InvalidOperationException("full")
                     : this with { Count = Count + 1 };

    public static void Main()
    {
        var c = new Counter("hits", 0).Increment();
        Console.WriteLine($"{c.Label}={c.Count}");
    }
}`,
  ],
  [
    'dart',
    'Dart',
    `import 'dart:math';

/// A point in 2D space.
class Point {
  final double x, y;
  const Point(this.x, this.y);

  double distanceTo(Point other) {
    final dx = x - other.x, dy = y - other.y;
    return sqrt(dx * dx + dy * dy);
  }

  @override
  String toString() => 'Point($x, $y)';
}

void main() {
  const a = Point(0, 0);
  print('\${a.distanceTo(const Point(3, 4))}');
}`,
  ],
  [
    'ruby',
    'Ruby',
    `# frozen_string_literal: true

require 'json'

module Demo
  # A labelled counter.
  class Counter
    MAX = 10
    attr_reader :label, :count

    def initialize(label:, count: 0)
      @label = label
      @count = count
    end

    def increment
      raise ArgumentError, "full" if @count >= MAX

      Counter.new(label: @label, count: @count + 1)
    end

    def to_s = "#{label}=#{count}"
  end
end

puts Demo::Counter.new(label: :hits).increment`,
  ],
  [
    'elixir',
    'Elixir',
    `defmodule Demo.Counter do
  @moduledoc """
  A labelled counter.
  """
  @max 10

  defstruct label: nil, count: 0

  def increment(%__MODULE__{count: count}) when count >= @max do
    {:error, :full}
  end

  def increment(%__MODULE__{} = counter) do
    {:ok, %{counter | count: counter.count + 1}}
  end

  def to_string(%{label: label, count: count}), do: "#{label}=#{count}"
end

{:ok, c} = Demo.Counter.increment(%Demo.Counter{label: :hits})
IO.puts(Demo.Counter.to_string(c))`,
  ],
  [
    'perl',
    'Perl',
    `#!/usr/bin/perl
use strict;
use warnings;

package Demo::Counter;

my $MAX = 10;

sub new {
    my ($class, %args) = @_;
    return bless { label => $args{label}, count => $args{count} // 0 }, $class;
}

sub increment {
    my $self = shift;
    die "full\n" if $self->{count} >= $MAX;
    return Demo::Counter->new(%$self, count => $self->{count} + 1);
}

my $c = Demo::Counter->new(label => 'hits')->increment;
printf "%s=%d\n", $c->{label}, $c->{count};`,
  ],
  [
    'ocaml',
    'OCaml',
    `(* A labelled counter. *)
type counter = { label : string; count : int }

exception Full of string

let max = 10

let increment c =
  if c.count >= max then raise (Full c.label)
  else { c with count = c.count + 1 }

let to_string { label; count } = Printf.sprintf "%s=%d" label count

let () =
  let c = increment { label = "hits"; count = 0 } in
  print_endline (to_string c)`,
  ],
  [
    'lisp',
    'Lisp',
    `;;; A labelled counter.
(defpackage :demo (:use :cl))
(in-package :demo)

(defconstant +max+ 10)

(defstruct counter label (count 0))

(defun increment (c)
  "Return a copy of C with its count bumped."
  (when (>= (counter-count c) +max+)
    (error "full: ~a" (counter-label c)))
  (make-counter :label (counter-label c)
                :count (1+ (counter-count c))))

(let ((c (increment (make-counter :label :hits))))
  (format t "~a=~d~%" (counter-label c) (counter-count c)))`,
  ],
  [
    'objc',
    'Objective-C',
    `#import <Foundation/Foundation.h>

@interface Counter : NSObject
@property (nonatomic, copy, readonly) NSString *label;
@property (nonatomic, readonly) NSInteger count;
- (instancetype)initWithLabel:(NSString *)label count:(NSInteger)count;
- (Counter *)increment;
@end

@implementation Counter
- (instancetype)initWithLabel:(NSString *)label count:(NSInteger)count {
  if ((self = [super init])) {
    _label = [label copy];
    _count = count;
  }
  return self;
}

- (Counter *)increment {
  return [[Counter alloc] initWithLabel:self.label count:self.count + 1];
}
@end

int main(void) {
  @autoreleasepool {
    Counter *c = [[[Counter alloc] initWithLabel:@"hits" count:0] increment];
    NSLog(@"%@=%ld", c.label, (long)c.count);
  }
  return 0;
}`,
  ],
  [
    'c3',
    'C3',
    `module demo;
import std::io;

const int MAX = 10;

struct Counter {
    String label;
    int count;
}

fault CounterError { FULL }

<* Return a copy with the count bumped. *>
fn Counter! Counter.increment(&self) {
    if (self.count >= MAX) return CounterError.FULL?;
    return { .label = self.label, .count = self.count + 1 };
}

fn void main() {
    Counter c = { .label = "hits", .count = 0 };
    Counter! next = c.increment();
    if (catch err = next) {
        io::printfn("error: %s", err);
        return;
    }
    io::printfn("%s=%d", next.label, next.count);
}`,
  ],
  [
    'proto',
    'Protocol Buffers',
    `syntax = "proto3";

package demo.v1;

import "google/protobuf/timestamp.proto";

option java_package = "com.demo.v1";

// A labelled counter.
message Counter {
  string label = 1;
  int32 count = 2;
  google.protobuf.Timestamp updated_at = 3;
  repeated string tags = 4 [deprecated = true];
  reserved 5 to 9;
}

enum Status {
  STATUS_UNSPECIFIED = 0;
  STATUS_ACTIVE = 1;
}

service Counters {
  rpc Increment(Counter) returns (Counter);
  rpc Watch(Counter) returns (stream Counter);
}`,
  ],
  [
    'terraform',
    'Terraform',
    `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "env" {
  type    = string
  default = "dev"
}

locals {
  name = "counter-\${var.env}"
  tags = { for k, v in var.tags : k => upper(v) if v != null }
}

resource "aws_instance" "counter" {
  count         = var.env == "prod" ? 3 : 1
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.micro"
  user_data     = <<-EOT
    #!/bin/bash
    echo "hello \${local.name}"
  EOT
  tags = merge(local.tags, { Name = local.name })
}

output "ip" {
  value = aws_instance.counter[*].public_ip
}`,
  ],
  [
    'less',
    'Less',
    `// Variables and mixins
@primary: #3b82f6;
@radius: 4px;

.rounded(@r: @radius) {
  border-radius: @r;
}

.card {
  .rounded();
  color: darken(@primary, 10%);
  padding: (@radius * 2);

  &-title {
    font-weight: bold;
  }

  &:hover when (lightness(@primary) > 50%) {
    background: @primary;
  }

  @media (min-width: 768px) {
    width: ~"calc(100% - @{radius})";
  }
}`,
  ],
  [
    'scss',
    'SCSS',
    `@use "sass:math";

// Variables and mixins
$primary: #3b82f6 !default;
$sizes: (sm: 4px, md: 8px);

@mixin rounded($r: map-get($sizes, sm)) {
  border-radius: $r;
}

.card {
  @include rounded;
  color: darken($primary, 10%);
  padding: math.div(16px, 2);

  &-title {
    font-weight: bold;
  }

  @each $name, $size in $sizes {
    &.pad-#{$name} {
      padding: $size;
    }
  }

  @if lightness($primary) > 50% {
    background: $primary;
  } @else {
    background: white;
  }
}`,
  ],
  [
    'sass',
    'Sass',
    `// Variables and mixins
$primary: #3b82f6
$radius: 4px

=rounded($r: $radius)
  border-radius: $r

.card
  +rounded
  color: darken($primary, 10%)
  padding: $radius * 2

  &-title
    font-weight: bold

  &:hover
    background: $primary

  @media (min-width: 768px)
    width: calc(100% - #{$radius})`,
  ],
  [
    'hlsl',
    'HLSL',
    `cbuffer Params : register(b0) {
  float4x4 mvp;
  float2 uv_scale;
};

Texture2D<float4> tex : register(t0);
SamplerState samp : register(s0);

struct VSOut {
  float4 pos : SV_Position;
  float2 uv : TEXCOORD0;
};

VSOut vs_main(float3 pos : POSITION, float2 uv : TEXCOORD0) {
  VSOut o;
  o.pos = mul(mvp, float4(pos, 1.0));
  o.uv = uv * uv_scale;
  return o;
}

[earlydepthstencil]
float4 ps_main(VSOut i) : SV_Target {
  float4 c = tex.Sample(samp, i.uv);
  if (c.a < 0.5f) discard;
  return c * 0.5h;
}`,
  ],
  [
    'wgsl',
    'WGSL',
    `struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const SCALE: f32 = 0.5;

@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) uv: vec2f) -> VertexOutput {
  var out: VertexOutput;
  out.pos = mvp * vec4<f32>(pos, 1.0);
  out.uv = uv * SCALE;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let c = textureSample(tex, samp, in.uv);
  if (c.a < 0.5) { discard; }
  return c;
}`,
  ],
  [
    'dockerfile',
    'Dockerfile',
    `# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.pnpm \
    corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.27 AS runtime
ARG PORT=8080
ENV PORT=\${PORT}
COPY --from=build /app/dist /usr/share/nginx/html
RUN <<EOF
echo "listen \${PORT}" >> /etc/nginx/conf.d/port.conf
EOF
EXPOSE 8080
HEALTHCHECK --interval=30s CMD wget -q -O - http://localhost:\${PORT}/ || exit 1
CMD ["nginx", "-g", "daemon off;"]`,
  ],
  [
    'erlang',
    'Erlang',
    `-module(counter).
-behaviour(gen_server).
-export([start_link/0, add/1]).
-record(state, {count = 0 :: integer()}).
-define(TIMEOUT, 5000).

%% Public API
start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

add(N) when is_integer(N), N > 0 ->
    gen_server:call(?MODULE, {add, N}, ?TIMEOUT).

%% Callbacks
init([]) -> {ok, #state{}}.

handle_call({add, N}, _From, State = #state{count = C}) ->
    io:format("adding ~p~n", [N]),
    {reply, C + N, State#state{count = C + N}};
handle_call(_Msg, _From, State) ->
    {reply, {error, unknown}, State}.

handle_cast(_Msg, State) -> {noreply, State}.`,
  ],
  [
    'gleam',
    'Gleam',
    `import gleam/int
import gleam/io
import gleam/list
import gleam/string

/// A geometric shape.
pub type Shape {
  Circle(radius: Float)
  Rect(width: Float, height: Float)
}

pub fn area(shape: Shape) -> Float {
  case shape {
    Circle(radius: r) -> 3.14159 *. r *. r
    Rect(width: w, height: h) -> w *. h
  }
}

@external(erlang, "erlang", "system_time")
fn now() -> Int

pub fn main() {
  let shapes = [Circle(1.0), Rect(2.0, 3.5)]
  let total =
    shapes
    |> list.map(area)
    |> list.fold(0.0, fn(acc, x) { acc +. x })
  let assert Ok(count) = int.parse("42")
  io.println("total: " <> string.inspect(total) <> " of " <> int.to_string(count))
  io.println("at " <> int.to_string(now()))
}`,
  ],
  [
    'graphql',
    'GraphQL',
    `"""
A registered user.
"""
type User implements Node {
  id: ID!
  name: String!
  role: Role = MEMBER
  posts(first: Int = 10, after: String): PostConnection!
}

enum Role {
  ADMIN
  MEMBER
}

input NewUser {
  name: String!
  email: String!
}

directive @auth(role: Role = MEMBER) on FIELD_DEFINITION

# Fetch a user with their latest posts
query GetUser($id: ID!, $withPosts: Boolean = false) {
  user(id: $id) {
    id
    name
    ...UserFields
    posts(first: 3) @include(if: $withPosts) {
      edges { node { title } }
    }
  }
}

fragment UserFields on User {
  role
}

mutation CreateUser($input: NewUser!) {
  createUser(input: $input) { id }
}`,
  ],
  [
    'powershell',
    'PowerShell',
    `#Requires -Version 7
<#
.SYNOPSIS
  Summarize the largest files under a path.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$Path,
  [int]$Top = 5
)

function Format-Size {
  param([long]$Bytes)
  if ($Bytes -gt 1mb) { return "{0:N1} MB" -f ($Bytes / 1mb) }
  return "$([math]::Round($Bytes / 1kb, 1)) KB"
}

$files = Get-ChildItem -Path $Path -Recurse -File |
  Where-Object { $_.Length -gt 0 -and -not $_.Name.StartsWith('.') } |
  Sort-Object Length -Descending |
  Select-Object -First $Top

foreach ($file in $files) {
  $label = Format-Size -Bytes $file.Length
  Write-Host "\${label}  $($file.FullName)" -ForegroundColor Cyan
}

$report = @"
Scanned $Path
Top $Top of $($files.Count) files
"@
Write-Output $report`,
  ],
  [
    'r',
    'R',
    `#' Fit a simple model and summarize it.
library(dplyr)
library(ggplot2)

fib <- function(n = 10L) {
  if (n <= 1L) return(n)
  fib(n - 1L) + fib(n - 2L)
}

data <- tibble(x = 1:20, y = 2.5 * x + rnorm(20, sd = 3))

summary_stats <- data %>%
  filter(!is.na(y)) |>
  mutate(z = (y - mean(y)) / sd(y), \`odd row\` = x %% 2 == 1) %>%
  summarise(across(c(x, y), list(mean = mean, sd = sd)))

fit <- lm(y ~ x, data = data)
coefs <- coef(fit)
cat(sprintf("slope %.2f, intercept %.2f\\n", coefs[["x"]], coefs[[1]]))

square <- \\(v) v^2
for (i in seq_len(3)) if (i %in% c(1, 3)) print(square(i)) else next
raw <- r"(C:\\data\\input.csv)"
stats::median(data$y, na.rm = TRUE)`,
  ],
  [
    'scala',
    'Scala',
    `package geometry

import scala.math.{Pi, sqrt}

/** A closed shape with an area. */
sealed trait Shape derives CanEqual
final case class Circle(radius: Double) extends Shape
final case class Rect(width: Double, height: Double) extends Shape

object Shape:
  given Ordering[Shape] = Ordering.by(area)

  def area(shape: Shape): Double = shape match
    case Circle(r) if r > 0 => Pi * r * r
    case Rect(w, h)         => w * h
    case _                  => 0.0

  extension (c: Circle) def scaled(k: Double): Circle = c.copy(radius = c.radius * k)

@main def run(): Unit =
  val shapes = List(Circle(1.5), Rect(2, 3), Circle(0.5).scaled(4))
  val total = shapes.map(Shape.area).sum
  println(s"\${shapes.size} shapes, total area $total")
  val report = """|areas:
                  |\${shapes.map(Shape.area).mkString(", ")}""".stripMargin
  for s <- shapes.sorted do println(f"\${Shape.area(s)}%.2f")
  lazy val largest: Option[Shape] = shapes.maxOption`,
  ],
] as const satisfies readonly (readonly [Lang, string, string])[];

export type PlaygroundLanguage = (typeof PLAYGROUND_LANGUAGES)[number][0];
