/**
 * Models for migration tasks and wave-based parallel execution.
 */

import type { ChangeSeverity, ComponentImpact } from './ChangeImpact.js';

/**
 * Priority level for a migration task.
 */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Status of a migration task.
 */
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'blocked' | 'skipped';

/**
 * A single migration task.
 */
export interface MigrationTask {
  /** Unique task ID (e.g., "3.10.0-http-connector") */
  id: string;
  /** Target version */
  targetVersion: string;
  /** Task priority */
  priority: TaskPriority;
  /** Task status */
  status: TaskStatus;
  /** Component category */
  category: string;
  /** Component name */
  component: string;
  /** Brief description */
  title: string;
  /** Detailed description */
  description?: string;
  /** Java files that changed */
  javaChanges: string[];
  /** TypeScript files to update */
  nodeFiles: string[];
  /** Wave number for parallel execution */
  wave: number;
  /** Task IDs that this task depends on */
  dependsOn: string[];
  /** Task IDs that depend on this task */
  blockedBy: string[];
  /** Estimated effort */
  effort: 'trivial' | 'small' | 'medium' | 'large' | 'significant';
  /** Severity of changes */
  severity: ChangeSeverity;
  /** Notes or additional context */
  notes?: string;
  /** Agent ID if assigned to an agent */
  assignedAgent?: string;
  /** Worktree path if created */
  worktreePath?: string;
  /** Branch name for this task */
  branchName?: string;
}

/**
 * A wave of parallel tasks.
 */
export interface TaskWave {
  /** Wave number (1-based) */
  number: number;
  /** Description of this wave */
  description: string;
  /** Tasks in this wave */
  tasks: MigrationTask[];
  /** Whether all tasks in previous waves are complete */
  canStart: boolean;
  /** Estimated total effort for this wave */
  totalEffort: string;
}

/**
 * Full upgrade plan with waves.
 */
export interface UpgradePlan {
  /** Source version */
  fromVersion: string;
  /** Target version */
  toVersion: string;
  /** When this plan was generated */
  generatedAt: string;
  /** Git branch for this upgrade */
  featureBranch: string;
  /** All tasks grouped into waves */
  waves: TaskWave[];
  /** Total number of tasks */
  totalTasks: number;
  /** Estimated total effort */
  estimatedEffort: string;
  /** Schema migrations to run */
  schemaTasks: MigrationTask[];
  /** Summary by severity */
  summary: {
    breaking: number;
    major: number;
    minor: number;
    patch: number;
  };
}

/**
 * Convert a task priority to a number for sorting.
 */
export function priorityToNumber(priority: TaskPriority): number {
  switch (priority) {
    case 'critical':
      return 0;
    case 'high':
      return 1;
    case 'medium':
      return 2;
    case 'low':
      return 3;
  }
}

/**
 * Determine task priority from severity.
 */
export function severityToPriority(severity: ChangeSeverity): TaskPriority {
  switch (severity) {
    case 'breaking':
      return 'critical';
    case 'major':
      return 'high';
    case 'minor':
      return 'medium';
    case 'patch':
      return 'low';
  }
}

/**
 * Create a task from a component impact.
 */
export function createTaskFromImpact(
  impact: ComponentImpact,
  targetVersion: string
): MigrationTask {
  return {
    id: `${targetVersion}-${impact.category}-${impact.component}`,
    targetVersion,
    priority: severityToPriority(impact.severity),
    status: 'pending',
    category: impact.category,
    component: impact.component,
    title: `Update ${impact.component} for ${targetVersion}`,
    description: `Apply changes from ${impact.javaFiles.length} Java file(s)`,
    javaChanges: impact.javaFiles,
    nodeFiles: impact.nodeFiles,
    wave: 0, // Will be assigned during wave detection
    dependsOn: [],
    blockedBy: [],
    effort: impact.effort,
    severity: impact.severity,
  };
}

/**
 * Assign tasks to waves based on dependencies.
 *
 * Wave assignment rules:
 * 1. Tasks with no dependencies go to Wave 1
 * 2. Schema migrations go to Wave 2 (depend on core updates)
 * 3. Tasks that modify the same file go to the same wave (or sequential)
 * 4. Integration/validation tasks go to final wave
 */
export function assignTasksToWaves(tasks: MigrationTask[]): TaskWave[] {
  // Build dependency graph
  const taskMap = new Map<string, MigrationTask>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  // Detect file conflicts (same file = dependency)
  const fileToTasks = new Map<string, string[]>();
  for (const task of tasks) {
    for (const file of task.nodeFiles) {
      const existing = fileToTasks.get(file) || [];
      if (existing.length > 0) {
        // Add dependency to previous task that touches this file
        const prevTaskId = existing[existing.length - 1]!;
        if (!task.dependsOn.includes(prevTaskId) && task.id !== prevTaskId) {
          task.dependsOn.push(prevTaskId);
        }
      }
      existing.push(task.id);
      fileToTasks.set(file, existing);
    }
  }

  // Topological sort to assign waves
  const waveAssignments = new Map<string, number>();
  let changed = true;
  let maxIterations = tasks.length + 1;

  // Initialize all tasks to wave 1
  for (const task of tasks) {
    waveAssignments.set(task.id, 1);
  }

  // Iterate until stable
  while (changed && maxIterations-- > 0) {
    changed = false;
    for (const task of tasks) {
      let maxDependencyWave = 0;
      for (const depId of task.dependsOn) {
        const depWave = waveAssignments.get(depId) || 0;
        maxDependencyWave = Math.max(maxDependencyWave, depWave);
      }
      const newWave = maxDependencyWave + 1;
      if (newWave > (waveAssignments.get(task.id) || 0)) {
        waveAssignments.set(task.id, newWave);
        task.wave = newWave;
        changed = true;
      }
    }
  }

  // Group tasks by wave
  const waveMap = new Map<number, MigrationTask[]>();
  for (const task of tasks) {
    const wave = waveAssignments.get(task.id) || 1;
    task.wave = wave;
    const waveTasks = waveMap.get(wave) || [];
    waveTasks.push(task);
    waveMap.set(wave, waveTasks);
  }

  // Create wave objects
  const waves: TaskWave[] = [];
  const sortedWaveNumbers = Array.from(waveMap.keys()).sort((a, b) => a - b);

  for (const waveNumber of sortedWaveNumbers) {
    const waveTasks = waveMap.get(waveNumber) || [];
    waves.push({
      number: waveNumber,
      description: getWaveDescription(waveNumber, waveTasks),
      tasks: waveTasks.sort(
        (a, b) => priorityToNumber(a.priority) - priorityToNumber(b.priority)
      ),
      canStart: waveNumber === 1,
      totalEffort: estimateWaveEffort(waveTasks),
    });
  }

  return waves;
}

/**
 * Generate a description for a wave based on its tasks.
 */
function getWaveDescription(waveNumber: number, tasks: MigrationTask[]): string {
  if (waveNumber === 1) {
    const categories = [...new Set(tasks.map((t) => t.category))];
    return `Independent updates (${categories.join(', ')})`;
  }

  const hasSchema = tasks.some(
    (t) => t.category === 'database' || t.component.includes('schema')
  );
  if (hasSchema) {
    return 'Schema migrations and dependent updates';
  }

  if (tasks.some((t) => t.category === 'validation')) {
    return 'Validation and integration updates';
  }

  return `Dependent updates (Wave ${waveNumber})`;
}

/**
 * Estimate total effort for a wave.
 */
function estimateWaveEffort(tasks: MigrationTask[]): string {
  let score = 0;
  for (const task of tasks) {
    switch (task.effort) {
      case 'trivial':
        score += 0.1;
        break;
      case 'small':
        score += 0.5;
        break;
      case 'medium':
        score += 1;
        break;
      case 'large':
        score += 3;
        break;
      case 'significant':
        score += 5;
        break;
    }
  }

  if (score < 0.5) return '< 1 hour';
  if (score < 2) return '1-4 hours';
  if (score < 5) return '0.5-1 day';
  if (score < 10) return '1-2 days';
  return '2+ days';
}

/**
 * Generate worktree commands for a wave.
 */
export function generateWorktreeCommands(
  wave: TaskWave,
  baseBranch: string,
  worktreeBase: string = '../mirth-upgrade'
): string[] {
  const commands: string[] = [];

  for (const task of wave.tasks) {
    const branchName = `upgrade/${task.targetVersion}-${task.component}`;
    const worktreePath = `${worktreeBase}-${task.component}`;

    task.branchName = branchName;
    task.worktreePath = worktreePath;

    commands.push(`git worktree add ${worktreePath} -b ${branchName} ${baseBranch}`);
  }

  return commands;
}

/**
 * Generate agent spawn command for a task.
 */
export function generateAgentCommand(task: MigrationTask): string {
  return `claude --background --cwd ${task.worktreePath} \\
  "Use mirth-porter to upgrade ${task.component} connector.
   Java source: ~/Projects/connect (tag ${task.targetVersion})
   Focus only on ${task.component}, do not modify other components."`;
}
