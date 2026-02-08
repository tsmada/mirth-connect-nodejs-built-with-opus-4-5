/**
 * Topological sort for channel deployment ordering.
 *
 * Uses Kahn's algorithm to produce a stable deployment order where
 * dependencies are deployed before the channels that depend on them.
 * Detects cycles and reports them for user feedback.
 */

export interface DependencyGraph {
  nodes: string[];
  edges: Map<string, string[]>; // channelId -> [dependsOn channel IDs]
}

export interface SortResult {
  sorted: string[];
  cycles?: string[][];
  hasCycles: boolean;
}

export class DependencySort {
  /**
   * Topologically sort channel IDs based on dependency graph.
   * Uses Kahn's algorithm: repeatedly remove nodes with no incoming edges.
   * Returns sorted order for deployment (dependencies first).
   */
  static sort(graph: DependencyGraph): SortResult {
    if (graph.nodes.length === 0) {
      return { sorted: [], hasCycles: false };
    }

    // Build in-degree map and adjacency list (reversed: dependency -> dependent)
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // dep -> [nodes that depend on it]

    for (const node of graph.nodes) {
      inDegree.set(node, 0);
      if (!dependents.has(node)) {
        dependents.set(node, []);
      }
    }

    for (const node of graph.nodes) {
      const deps = graph.edges.get(node) ?? [];
      for (const dep of deps) {
        // Only count edges to nodes that are in the graph
        if (inDegree.has(dep)) {
          inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
          const list = dependents.get(dep);
          if (list) {
            list.push(node);
          }
        }
      }
    }

    // Start with nodes that have no dependencies (in-degree 0)
    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }
    // Sort queue for deterministic output
    queue.sort();

    const sorted: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      sorted.push(node);

      const deps = dependents.get(node) ?? [];
      const newReady: string[] = [];
      for (const dependent of deps) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          newReady.push(dependent);
        }
      }
      // Sort newly ready nodes for deterministic output
      newReady.sort();
      queue.push(...newReady);
    }

    if (sorted.length < graph.nodes.length) {
      const cycles = DependencySort.findCycles(graph);
      return { sorted, cycles, hasCycles: true };
    }

    return { sorted, hasCycles: false };
  }

  /**
   * Build a dependency graph from explicit and inferred dependencies.
   * Explicit: channelId -> [depends on these channels]
   * Inferred: channelId -> [routes to these channels] (reversed to get deps)
   */
  static buildGraph(
    explicitDeps: Map<string, string[]>,
    inferredDeps?: Map<string, string[]>
  ): DependencyGraph {
    const nodeSet = new Set<string>();
    const edges = new Map<string, string[]>();

    // Collect all nodes
    for (const [id, deps] of explicitDeps) {
      nodeSet.add(id);
      for (const dep of deps) {
        nodeSet.add(dep);
      }
    }

    if (inferredDeps) {
      for (const [id, targets] of inferredDeps) {
        nodeSet.add(id);
        for (const target of targets) {
          nodeSet.add(target);
        }
      }
    }

    // Build edges: explicit deps are direct
    for (const node of nodeSet) {
      const deps = new Set<string>(explicitDeps.get(node) ?? []);
      edges.set(node, [...deps]);
    }

    // Inferred deps: if A routes to B, then A depends on B (B must be deployed first)
    if (inferredDeps) {
      for (const [id, targets] of inferredDeps) {
        const existing = edges.get(id) ?? [];
        const existingSet = new Set(existing);
        for (const target of targets) {
          if (!existingSet.has(target)) {
            existing.push(target);
            existingSet.add(target);
          }
        }
        edges.set(id, existing);
      }
    }

    return { nodes: [...nodeSet], edges };
  }

  /**
   * Find cycle paths in the graph for error reporting.
   * Uses DFS with color marking (white/gray/black).
   */
  static findCycles(graph: DependencyGraph): string[][] {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const cycles: string[][] = [];

    for (const node of graph.nodes) {
      color.set(node, WHITE);
    }

    const dfs = (node: string): void => {
      color.set(node, GRAY);
      const deps = graph.edges.get(node) ?? [];

      for (const dep of deps) {
        if (!color.has(dep)) continue; // dep not in graph

        if (color.get(dep) === GRAY) {
          // Found a cycle — trace back
          const cycle: string[] = [dep];
          let cur = node;
          while (cur !== dep) {
            cycle.push(cur);
            cur = parent.get(cur) ?? dep;
          }
          cycle.push(dep);
          cycle.reverse();
          cycles.push(cycle);
        } else if (color.get(dep) === WHITE) {
          parent.set(dep, node);
          dfs(dep);
        }
      }

      color.set(node, BLACK);
    };

    for (const node of graph.nodes) {
      if (color.get(node) === WHITE) {
        parent.set(node, null);
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Get the reverse dependency map (who depends on me).
   */
  static getReverseDependencies(graph: DependencyGraph): Map<string, string[]> {
    const reverse = new Map<string, string[]>();

    for (const node of graph.nodes) {
      if (!reverse.has(node)) {
        reverse.set(node, []);
      }
    }

    for (const [node, deps] of graph.edges) {
      for (const dep of deps) {
        const list = reverse.get(dep);
        if (list) {
          list.push(node);
        } else {
          reverse.set(dep, [node]);
        }
      }
    }

    return reverse;
  }
}
