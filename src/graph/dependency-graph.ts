import { CycleError } from '../shared/errors.js';
import { topologicalSort } from './topological-sort.js';

export interface GraphNode {
  name: string;
  type: 'service' | 'package';
  path: string;
}

export type SortResult =
  | { ok: true; value: string[] }
  | { ok: false; error: CycleError };

export class DependencyGraph {
  /** node name → GraphNode metadata */
  private nodes = new Map<string, GraphNode>();
  /** node name → set of dependency names (edges: from depends on to) */
  private edges = new Map<string, Set<string>>();
  /** reverse edges: node name → set of dependents */
  private reverseEdges = new Map<string, Set<string>>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.name, node);
    if (!this.edges.has(node.name)) this.edges.set(node.name, new Set());
    if (!this.reverseEdges.has(node.name)) this.reverseEdges.set(node.name, new Set());
  }

  addEdge(from: string, to: string): void {
    // from depends on to
    if (!this.edges.has(from)) this.edges.set(from, new Set());
    if (!this.reverseEdges.has(to)) this.reverseEdges.set(to, new Set());
    this.edges.get(from)!.add(to);
    this.reverseEdges.get(to)!.add(from);
  }

  /** Get packages that `packageName` depends on */
  getDependencies(packageName: string): string[] {
    return [...(this.edges.get(packageName) ?? [])];
  }

  /** Get packages that depend on `packageName` */
  getDependents(packageName: string): string[] {
    return [...(this.reverseEdges.get(packageName) ?? [])];
  }

  /** Group nodes into independent parallel levels (BFS layers) */
  getIndependentGroups(): string[][] {
    const sortResult = this.topologicalSort();
    if (!sortResult.ok) return [];

    const sorted = sortResult.value;
    const levels: string[][] = [];
    const assigned = new Set<string>();

    while (assigned.size < sorted.length) {
      const level = sorted.filter(
        (n) => !assigned.has(n) && this.getDependencies(n).every((d) => assigned.has(d)),
      );
      if (level.length === 0) break;
      levels.push(level);
      level.forEach((n) => assigned.add(n));
    }

    return levels;
  }

  topologicalSort(): SortResult {
    return topologicalSort(this.edges);
  }

  getNode(name: string): GraphNode | undefined {
    return this.nodes.get(name);
  }

  getNodeNames(): string[] {
    return [...this.nodes.keys()];
  }

  get size(): number {
    return this.nodes.size;
  }
}
