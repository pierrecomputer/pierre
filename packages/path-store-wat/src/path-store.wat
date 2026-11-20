(module
  (import "./memory.wat")
  (import "./segments.wat")
  (import "./state.wat")
  (import "./ingest.wat")
  (import "./lookup.wat")
  (import "./projection.wat")
  (import "./mutate.wat")

  ;; --- construction ----------------------------------------------------------
  ;;
  ;; Host sequence: reset, inputBegin + write bytes, storeInit(lines), ingest,
  ;; finishIngest, configure, optional expanded-path resolution, initCounts,
  ;; compact. Every call that may grow memory invalidates host views.

  (func (export "reset")
    (call $resetHeap)
    (global.set $flatten (i32.const 0))
    (global.set $defaultExpansion (i32.const 0))
    (global.set $collapsedOverrides (i32.const 0))
    (global.set $collapseNewDirs (i32.const 0))
    (global.set $hostSort (i32.const 0))
    (global.set $activeNodeCount (i32.const 0)))

  (func (export "inputBegin") (param $len i32) (result i32)
    (call $inputBegin (local.get $len)))

  (func (export "inputDrop")
    (call $inputDrop))

  (func (export "countLines") (param $ptr i32) (param $len i32) (result i32)
    (call $countLines (local.get $ptr) (local.get $len)))

  (func (export "storeInit") (param $lines i32)
    (call $storeInit (local.get $lines)))

  (func (export "ingest") (param $ptr i32) (param $len i32) (param $validate i32) (result i32)
    (call $ingest (local.get $ptr) (i32.add (local.get $ptr) (local.get $len)) (local.get $validate)))

  (func (export "finishIngest")
    (call $buildChildren)
    (call $inputDrop))

  (func (export "configure") (param $flatten i32) (param $defaultExpansion i32) (param $hostSort i32)
    (global.set $flatten (local.get $flatten))
    (global.set $defaultExpansion (local.get $defaultExpansion))
    (global.set $hostSort (local.get $hostSort)))

  (func (export "resolveExpandedPaths") (param $ptr i32) (param $len i32) (result i32)
    (call $resolveExpandedPaths (local.get $ptr) (local.get $len)))

  ;; every directory starts open and later directories start collapsed: the
  ;; "explicit open" fast path of the JS constructor, without per-node overrides
  (func (export "openAll")
    (local $i i32) (local $n i32) (local $metaBase i32) (local $o i32)
    (local.set $n (call $nodeCount))
    (local.set $metaBase (call $base (i32.const $A.meta)))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $o (i32.add (local.get $metaBase) (i32.shl (local.get $i) (i32.const 2))))
        (i32.store (local.get $o) (i32.and (i32.load (local.get $o)) (i32.xor (i32.const $F.override+32) (i32.const -1))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (global.set $defaultExpansion (i32.const 1))
    (global.set $collapsedOverrides (i32.const 0))
    (global.set $collapseNewDirs (i32.const 1)))

  (func (export "initCounts")
    (call $initCounts))

  (func (export "compact")
    (call $compact)
    (call $nodeSync))

  ;; --- counters ----------------------------------------------------------------

  (func (export "nodeCount") (result i32) (call $nodeCount))
  (func (export "activeNodeCount") (result i32) (global.get $activeNodeCount))
  (func (export "segmentCount") (result i32) (call $len (i32.const $A.segOff)))
  (func (export "segmentsAscii") (result i32) (i32.eqz (global.get $segArenaNonAscii)))
  (func (export "visibleCount") (result i32) (call $visibleOf (i32.const 0)))
  (func (export "collapsedOverrides") (result i32) (global.get $collapsedOverrides))
  (func (export "defaultExpansion") (result i32) (global.get $defaultExpansion))
  (func (export "collapseNewDirs") (result i32) (global.get $collapseNewDirs))
  (func (export "setCollapseNewDirs") (param $v i32) (global.set $collapseNewDirs (local.get $v)))

  ;; live directories other than the root, and how many of them are expanded
  (func (export "liveDirCount") (result i32)
    (local $i i32) (local $n i32) (local $count i32) (local $id i32)
    (local.set $n (call $len (i32.const $A.dNode)))
    (local.set $i (i32.const 1))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $id (call $get (i32.const $A.dNode) (local.get $i)))
        (local.set $count (i32.add (local.get $count) (i32.eqz (call $hasFlag (local.get $id) (i32.const $F.removed)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (local.get $count))

  (func (export "expandedDirCount") (result i32)
    (local $i i32) (local $n i32) (local $count i32) (local $id i32)
    (local.set $n (call $len (i32.const $A.dNode)))
    (local.set $i (i32.const 1))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $id (call $get (i32.const $A.dNode) (local.get $i)))
        (if (i32.eqz (call $hasFlag (local.get $id) (i32.const $F.removed)))
          (then (local.set $count (i32.add (local.get $count) (call $isExpanded (local.get $id))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (local.get $count))

  ;; --- strings in and out ----------------------------------------------------------

  (func (export "scratchBegin") (param $len i32) (result i32)
    (call $scratchReserve (local.get $len)))

  (func (export "lookup") (param $ptr i32) (param $len i32) (param $requireDir i32) (result i32)
    (call $lookupPath (local.get $ptr) (local.get $len) (local.get $requireDir)))

  (func (export "nodePath") (param $id i32)
    (call $outReset)
    (call $writeNodePath (local.get $id)))

  (func (export "listPaths") (param $id i32)
    (call $outReset)
    (call $listPaths (local.get $id)))

  (func (export "internSegment") (param $ptr i32) (param $len i32) (result i32)
    (call $internBytes (local.get $ptr) (local.get $len)))

  (func (export "findChild") (param $parent i32) (param $name i32) (result i32)
    (call $chFind (local.get $parent) (local.get $name)))

  ;; --- projection ----------------------------------------------------------------------

  (func (export "collectRows") (param $start i32) (param $count i32)
    (call $collectRows (local.get $start) (local.get $count)))

  (func (export "rowContext") (param $index i32)
    (call $rowContext (local.get $index)))

  (func (export "visibleIndexOf") (param $id i32) (result i32)
    (call $visibleIndexOf (local.get $id)))

  (func (export "flattenTerminal") (param $id i32) (result i32)
    (call $flattenTerminal (local.get $id)))

  (func (export "flattenedChild") (param $id i32) (result i32)
    (call $flattenedChild (local.get $id)))

  (func (export "flattenChain") (param $id i32)
    (call $flattenChain (local.get $id)))

  (func (export "isExpanded") (param $id i32) (result i32)
    (call $isExpanded (local.get $id)))

  (func (export "setExpanded") (param $id i32) (param $v i32)
    (call $setExpanded (local.get $id) (local.get $v)))

  (func (export "recomputeUpward") (param $id i32)
    (call $recomputeUpward (local.get $id)))

  ;; --- mutations ----------------------------------------------------------------------------

  (func (export "ensureDirChain") (param $ptr i32) (param $len i32) (result i32)
    (call $ensureDirChain (local.get $ptr) (local.get $len)))

  (func (export "deepestExistingDir") (param $ptr i32) (param $len i32) (result i32)
    (call $deepestExistingDir (local.get $ptr) (local.get $len)))

  (func (export "createFile") (param $parent i32) (param $ptr i32) (param $len i32) (result i32)
    (call $createFile (local.get $parent) (local.get $ptr) (local.get $len)))

  (func (export "addFlag") (param $id i32) (param $f i32)
    (call $addFlag (local.get $id) (local.get $f)))

  (func (export "removeNode") (param $id i32)
    (call $removeNode (local.get $id)))

  (func (export "moveNode") (param $source i32) (param $targetParent i32) (param $targetName i32) (result i32)
    (call $moveNode (local.get $source) (local.get $targetParent) (local.get $targetName)))

  ;; --- cleanup ----------------------------------------------------------------------------

  (func (export "recomputeAllCounts")
    (call $recomputeAllCounts))

  (func (export "trimTrailingRemoved")
    (call $trimTrailingRemoved))

  (func (export "compactSegments")
    (call $compactSegments))

  (func (export "isAncestor") (param $ancestor i32) (param $id i32) (result i32)
    (call $isAncestor (local.get $ancestor) (local.get $id)))

  (func (export "signature") (param $id i32)
    (call $signature (local.get $id)))

  (func (export "compareSiblings") (param $a i32) (param $b i32) (result i32)
    (call $compareSiblings (local.get $a) (local.get $b)))
)
