# Performance Options

This file tracks rendering and interaction optimizations for larger graphs. The current canvas renderer is immediate-mode: every redraw clears the canvas and walks the graph again. A graph with 10,000 nodes can therefore be much slower than 1,000 nodes even after layout is complete.

## Current Bottlenecks

- Full redraw on zoom and pan: the renderer loops through all visible-display edges and nodes on each draw, even when most of the graph is off screen.
- No viewport culling: zooming into a small region does not skip off-screen graph elements yet.
- Mouse hover hit testing is global: mouse movement scans nodes and edges until it finds a hit. Edge checks are especially expensive because Bezier curves are sampled.
- Canvas backing size is reset during draw. This should only happen when canvas dimensions or device pixel ratio change.
- Frontend-derived color modes can become expensive. `gc-content` has been removed; future expensive coloring should be precomputed or indexed.
- Path overlays can multiply draw work because one displayed edge may render many path traversals.

## Near-Term Fixes

1. Precompute graph-level drawing metadata once per graph.
   - Node color strings for the active color mode.
   - Node bounding boxes in graph coordinates.
   - Edge geometry or edge bounding boxes where possible.

2. Add viewport culling.
   - Convert the canvas viewport back into graph coordinates using the current transform.
   - Skip nodes whose bounding boxes do not intersect the viewport.
   - Skip edges whose endpoints/control-point bounds do not intersect the viewport.
   - Add padding around the viewport so thick lines and labels do not pop in late.

3. Move canvas resize out of the draw loop.
   - Resize only when `width`, `height`, or `window.devicePixelRatio` changes.
   - Keep normal redraws limited to `clearRect`/background fill and drawing commands.

4. Throttle or defer hover detection.
   - Run hit testing with `requestAnimationFrame`.
   - Skip hit testing while wheel zooming or panning.
   - Avoid setting hover state when the hovered item did not change.

5. Add a spatial index for interactions.
   - A simple grid index is probably enough at first.
   - Store node and edge bounding boxes by grid cell.
   - On mouse move, test only nearby cells instead of the whole graph.

## Medium-Term Options

1. Level-of-detail rendering.
   - At low zoom, draw simplified nodes/edges and hide labels/path arrows.
   - At high zoom, draw full geometry and optional labels.
   - Consider a visible node/edge count threshold for automatically reducing detail.

2. Precomputed backend styling.
   - Backend can attach color tags, numeric categories, or direct color values to nodes.
   - Frontend should map those values to already-decided CSS/canvas colors without scanning the whole graph.
   - Possible node fields: `color`, `tags`, `category`, `highlightGroup`, `scoreBucket`.

3. Cached static layer.
   - Draw the unselected/unhovered graph into an offscreen canvas.
   - On pan/zoom, redraw from cache where possible, then draw hover/selection overlays separately.
   - This is useful only after culling and metadata caching are in place.

4. Worker-side preprocessing.
   - Build display graph metadata, bounding boxes, color maps, and spatial indexes in a Web Worker.
   - Keep the main thread focused on input and canvas drawing.

5. WebGL renderer.
   - If canvas 2D remains too slow for very large graphs, move nodes/edges to WebGL.
   - This is a larger rewrite and should come after simpler 2D optimizations.

## Suggested Order

1. Remove frontend-heavy color calculations. Done for `gc-content`.
2. Move canvas resizing out of draw.
3. Add viewport culling for nodes.
4. Add viewport culling for edges.
5. Add a grid spatial index for hover detection.
6. Add level-of-detail rules for labels, arrows, and path overlays.
7. Decide the backend-provided color/tag format.
