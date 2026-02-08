import { DependencySort } from '../../../src/artifact/DependencySort';
import type { DependencyGraph } from '../../../src/artifact/DependencySort';

describe('DependencySort', () => {
  describe('sort', () => {
    it('should sort a linear chain with dependencies first', () => {
      // A depends on B, B depends on C → deploy order: C, B, A
      const graph: DependencyGraph = {
        nodes: ['A', 'B', 'C'],
        edges: new Map([
          ['A', ['B']],
          ['B', ['C']],
          ['C', []],
        ]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(false);
      expect(result.sorted).toEqual(['C', 'B', 'A']);
    });

    it('should sort a diamond dependency graph', () => {
      // A→B, A→C, B→D, C→D → D must come first, then B and C, then A
      const graph: DependencyGraph = {
        nodes: ['A', 'B', 'C', 'D'],
        edges: new Map([
          ['A', ['B', 'C']],
          ['B', ['D']],
          ['C', ['D']],
          ['D', []],
        ]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(false);

      // D must be first, A must be last
      expect(result.sorted[0]).toBe('D');
      expect(result.sorted[result.sorted.length - 1]).toBe('A');

      // B and C must come before A but after D
      const idxB = result.sorted.indexOf('B');
      const idxC = result.sorted.indexOf('C');
      const idxA = result.sorted.indexOf('A');
      const idxD = result.sorted.indexOf('D');
      expect(idxB).toBeGreaterThan(idxD);
      expect(idxC).toBeGreaterThan(idxD);
      expect(idxA).toBeGreaterThan(idxB);
      expect(idxA).toBeGreaterThan(idxC);
    });

    it('should handle isolated nodes with no dependencies', () => {
      const graph: DependencyGraph = {
        nodes: ['X', 'Y', 'Z'],
        edges: new Map([
          ['X', []],
          ['Y', []],
          ['Z', []],
        ]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(false);
      expect(result.sorted).toHaveLength(3);
      expect(new Set(result.sorted)).toEqual(new Set(['X', 'Y', 'Z']));
    });

    it('should detect cycles: A→B→C→A', () => {
      const graph: DependencyGraph = {
        nodes: ['A', 'B', 'C'],
        edges: new Map([
          ['A', ['B']],
          ['B', ['C']],
          ['C', ['A']],
        ]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(true);
      expect(result.cycles).toBeDefined();
      expect(result.cycles!.length).toBeGreaterThan(0);
      // Not all nodes will be in sorted output
      expect(result.sorted.length).toBeLessThan(3);
    });

    it('should detect self-cycles: A→A', () => {
      const graph: DependencyGraph = {
        nodes: ['A'],
        edges: new Map([['A', ['A']]]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(true);
      expect(result.sorted).toHaveLength(0);
    });

    it('should handle an empty graph', () => {
      const graph: DependencyGraph = {
        nodes: [],
        edges: new Map(),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(false);
      expect(result.sorted).toEqual([]);
    });

    it('should handle a single node', () => {
      const graph: DependencyGraph = {
        nodes: ['A'],
        edges: new Map([['A', []]]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(false);
      expect(result.sorted).toEqual(['A']);
    });

    it('should ignore edges to nodes not in the graph', () => {
      const graph: DependencyGraph = {
        nodes: ['A', 'B'],
        edges: new Map([
          ['A', ['B', 'MISSING']],
          ['B', []],
        ]),
      };

      const result = DependencySort.sort(graph);
      expect(result.hasCycles).toBe(false);
      expect(result.sorted).toEqual(['B', 'A']);
    });

    it('should produce deterministic output for same-level nodes', () => {
      // Multiple runs should produce the same order
      const graph: DependencyGraph = {
        nodes: ['C', 'A', 'B'],
        edges: new Map([
          ['A', []],
          ['B', []],
          ['C', []],
        ]),
      };

      const result1 = DependencySort.sort(graph);
      const result2 = DependencySort.sort(graph);
      expect(result1.sorted).toEqual(result2.sorted);
      // Alphabetically sorted since all have same in-degree
      expect(result1.sorted).toEqual(['A', 'B', 'C']);
    });
  });

  describe('buildGraph', () => {
    it('should build from explicit dependencies', () => {
      const explicit = new Map([
        ['ch1', ['ch2', 'ch3']],
        ['ch2', []],
        ['ch3', []],
      ]);

      const graph = DependencySort.buildGraph(explicit);
      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges.get('ch1')).toEqual(['ch2', 'ch3']);
    });

    it('should merge explicit and inferred dependencies', () => {
      const explicit = new Map([
        ['ch1', ['ch2']],
        ['ch2', []],
      ]);
      const inferred = new Map([
        ['ch1', ['ch3']],
        ['ch3', []],
      ]);

      const graph = DependencySort.buildGraph(explicit, inferred);
      expect(graph.nodes).toContain('ch1');
      expect(graph.nodes).toContain('ch2');
      expect(graph.nodes).toContain('ch3');

      const ch1Edges = graph.edges.get('ch1')!;
      expect(ch1Edges).toContain('ch2');
      expect(ch1Edges).toContain('ch3');
    });

    it('should not duplicate edges from both sources', () => {
      const explicit = new Map([['ch1', ['ch2']]]);
      const inferred = new Map([['ch1', ['ch2']]]);

      const graph = DependencySort.buildGraph(explicit, inferred);
      const ch1Edges = graph.edges.get('ch1')!;
      expect(ch1Edges.filter(e => e === 'ch2')).toHaveLength(1);
    });
  });

  describe('findCycles', () => {
    it('should find cycle in circular graph', () => {
      const graph: DependencyGraph = {
        nodes: ['A', 'B', 'C'],
        edges: new Map([
          ['A', ['B']],
          ['B', ['C']],
          ['C', ['A']],
        ]),
      };

      const cycles = DependencySort.findCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);
      // Cycle should contain all three nodes
      const flatCycle = cycles[0]!;
      expect(flatCycle).toContain('A');
      expect(flatCycle).toContain('B');
      expect(flatCycle).toContain('C');
    });

    it('should return empty array for acyclic graph', () => {
      const graph: DependencyGraph = {
        nodes: ['A', 'B'],
        edges: new Map([
          ['A', ['B']],
          ['B', []],
        ]),
      };

      const cycles = DependencySort.findCycles(graph);
      expect(cycles).toHaveLength(0);
    });

    it('should detect self-cycle', () => {
      const graph: DependencyGraph = {
        nodes: ['A'],
        edges: new Map([['A', ['A']]]),
      };

      const cycles = DependencySort.findCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('getReverseDependencies', () => {
    it('should compute reverse dependency map', () => {
      const graph: DependencyGraph = {
        nodes: ['A', 'B', 'C'],
        edges: new Map([
          ['A', ['B', 'C']],
          ['B', ['C']],
          ['C', []],
        ]),
      };

      const reverse = DependencySort.getReverseDependencies(graph);

      // C is depended on by A and B
      expect(reverse.get('C')).toEqual(expect.arrayContaining(['A', 'B']));
      // B is depended on by A
      expect(reverse.get('B')).toEqual(['A']);
      // A is depended on by nobody
      expect(reverse.get('A')).toEqual([]);
    });

    it('should handle graph with no edges', () => {
      const graph: DependencyGraph = {
        nodes: ['A', 'B'],
        edges: new Map([
          ['A', []],
          ['B', []],
        ]),
      };

      const reverse = DependencySort.getReverseDependencies(graph);
      expect(reverse.get('A')).toEqual([]);
      expect(reverse.get('B')).toEqual([]);
    });
  });
});
