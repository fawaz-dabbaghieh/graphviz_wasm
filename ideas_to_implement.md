# Ideas To Implement

## Anchored rGFA / Reference-Aware Layout

Goal: support a layout mode where reference-path nodes are fixed along a
coordinate-aware reference line, while non-reference graph nodes are arranged
around those anchors. This would make rGFA visualizations closer to a reference
genome view: the reference path stays interpretable as genomic coordinates, and
alternate/bubble nodes appear around the relevant reference interval.

### Current Layout Model

The frontend currently sends the WASM layout engine a simplified graph:

```ts
{
  nodes: [{ id, name, length, depth }],
  edges: [{ from, to, overlap }]
}
```

The WASM/C++ layout engine returns only geometry:

```ts
{
  nodePositions: {
    "node+": [{ x, y }, { x, y }]
  }
}
```

This output shape can probably stay the same. The main change would be adding
more layout metadata to the input graph so the C++ layout can distinguish fixed
reference nodes from free non-reference nodes.

### Proposed User-Facing Behavior

- For rGFA graphs, identify nodes that belong to the chosen reference path.
- Draw a horizontal reference coordinate ruler above or through the graph.
- Place reference nodes according to their reference coordinates.
- Keep those reference nodes fixed during layout.
- Lay out non-reference nodes around the fixed reference nodes.
- Preserve the existing path coloring/selection behavior.

Example conceptual layout:

```text
reference: 0 bp ---- 100 kb ---- 200 kb ---- 300 kb

           [refA]----[refB]----[refC]----[refD]
              \        /  \        /
               alt1---    alt2----
```

### Data Needed From rGFA

We probably need to parse and preserve:

- Which path or sample is the reference.
- Which nodes belong to that reference.
- Reference coordinate start/end for each reference node.
- Node orientation on the reference path.
- Possibly rank/order information if exact coordinates are unavailable.

The existing parser already keeps GFA tags in some places, but the frontend graph
model sent to WASM does not currently expose reference-coordinate metadata.

Potential frontend model extension:

```ts
interface GraphNode {
  id: string
  name: string
  length: number
  depth: number
  sequence?: string
  referenceAnchor?: {
    referenceName: string
    start: number
    end: number
    strand: '+' | '-'
    fixedX: number
    fixedY: number
  }
}
```

The exact fields should be decided after checking the rGFA tags we want to
support.

### WASM / C++ Changes

The C++ binding in `src/bindings.cpp` would need to read the extra anchor fields
from JavaScript and store them in the internal graph/node representation.

The layout code in `src/graphlayout.cpp` would need a new layout mode, for
example:

```ts
layoutMode: 'force' | 'linear' | 'anchored-reference'
```

For anchored layout, reference nodes should be initialized to their fixed
coordinates and kept fixed while non-reference nodes move. This likely requires
more than the current `linearLayout` option, because the current linear layout
only seeds initial positions; it does not guarantee that nodes stay pinned.

Possible implementation strategies:

- Seeded layout: start reference nodes at fixed coordinates, but allow OGDF to
  move them. This is easiest, but may not preserve the reference line.
- Pinned-node layout: modify or configure the layout process so reference nodes
  remain fixed and only non-reference nodes move. This is likely the proper
  approach.
- Custom reference-aware layout: place reference nodes directly by coordinate,
  then arrange nearby alternate nodes/bubbles above or below the reference using
  a simpler custom algorithm. This may produce more interpretable rGFA views than
  a generic force-directed layout.

### Incremental Plan

1. Add parser support for the rGFA reference-coordinate fields we care about.
2. Extend the frontend `GraphNode` model with optional reference anchor metadata.
3. Add UI controls for selecting a reference path/sample and enabling anchored
   layout mode.
4. Pass anchor metadata and layout mode into the WASM worker.
5. Extend `bindings.cpp` to parse fixed-node metadata.
6. Add an anchored/reference-aware layout path in `graphlayout.cpp`.
7. Return the same `nodePositions` object as today, so the renderer can remain
   mostly unchanged.
8. Add a frontend reference ruler using the same coordinate transform as the
   graph canvas.
9. Add test rGFA examples with known coordinates and expected visual behavior.

### Open Questions

- Which exact rGFA tags should define the reference coordinates?
- Should the reference line be drawn above the graph, through the graph, or as
  the graph backbone itself?
- Should alternate nodes be drawn above and below by haplotype/path, by graph
  topology, or by local bubble structure?
- How should very long reference intervals be scaled relative to normal Bandage
  node length scaling?
- Should multiple references be supported, or only one active reference at a
  time?

This should be treated as a new layout mode rather than a small rendering tweak.
The best first milestone is probably a simple pinned-reference prototype on a
small rGFA where reference node coordinates are known and easy to validate.
