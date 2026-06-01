import { CycleError } from '../shared/errors.js';

export type SortResult =
  | { ok: true; value: string[] }
  | { ok: false; error: CycleError };

/**
 * Kahn's Algorithm — topological sort with cycle detection.
 * `edges` maps each node to the set of nodes it depends on (outgoing edges point to dependencies).
 */
export function topologicalSort(edges: Map<string, Set<string>>): SortResult {
  // In-degree: how many nodes depend on this node? No — in-degree = how many dependencies point INTO this node.
  // Actually for Kahn's: in-degree of a node = number of prerequisites it has.
  // We want to produce an order where dependencies come first.
  // edges: from → {deps it depends on}. So "from depends on to" means to must come before from.
  // In-degree of `from` = edges.get(from).size (number of things it depends on).

  const inDegree = new Map<string, number>();
  // Initialize all nodes
  for (const [node] of edges) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
  }
  // Calculate in-degree: for each node, its in-degree is the count of its dependencies
  for (const [node, deps] of edges) {
    inDegree.set(node, deps.size);
    // Ensure all dependency targets are in the map
    for (const dep of deps) {
      if (!inDegree.has(dep)) inDegree.set(dep, 0);
    }
  }

  // Enqueue nodes with in-degree 0 (no dependencies)
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    // For each other node that depends on `node`, decrement its in-degree
    for (const [candidate, deps] of edges) {
      if (deps.has(node)) {
        const newDegree = inDegree.get(candidate)! - 1;
        inDegree.set(candidate, newDegree);
        if (newDegree === 0) queue.push(candidate);
      }
    }
  }

  if (result.length !== inDegree.size) {
    // Cycle detected — trace it
    const cycleNodes = [...inDegree.entries()]
      .filter(([, d]) => d > 0)
      .map(([n]) => n);
    const cycle = traceCycle(edges, cycleNodes);
    return {
      ok: false,
      error: new CycleError(
        `Dependency cycle detected: ${cycle.join(' -> ')}`,
        cycle,
      ),
    };
  }

  return { ok: true, value: result };
}

/** Trace a cycle path from the remaining nodes with in-degree > 0 */
function traceCycle(edges: Map<string, Set<string>>, cycleNodes: string[]): string[] {
  const inCycle = new Set(cycleNodes);
  if (cycleNodes.length === 0) return [];

  const start = cycleNodes[0];
  const path: string[] = [start];
  const visited = new Set<string>([start]);
  let current = start;

  while (true) {
    const deps = edges.get(current);
    if (!deps) break;
    const next = [...deps].find((d) => inCycle.has(d) && !visited.has(d));
    if (!next) {
      // Close the cycle back to start
      const closing = [...deps].find((d) => d === start);
      if (closing) path.push(closing);
      else {
        // Find any node already in path to close
        const back = [...deps].find((d) => path.includes(d));
        if (back) path.push(back);
        else path.push(start);
      }
      break;
    }
    path.push(next);
    visited.add(next);
    current = next;
  }

  return path;
}
