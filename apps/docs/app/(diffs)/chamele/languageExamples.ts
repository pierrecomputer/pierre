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
] as const satisfies readonly (readonly [Lang, string, string])[];

export type PlaygroundLanguage = (typeof PLAYGROUND_LANGUAGES)[number][0];
