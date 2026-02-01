/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/Rule.java
 *
 * Purpose: Represents a single filter rule
 *
 * Key behaviors to replicate:
 * - Has a name and sequence number
 * - Contains JavaScript expression or Rule Builder criteria
 * - Can be enabled/disabled
 * - Operator determines how to combine with previous rules
 */

export type RuleOperator = 'AND' | 'OR' | 'NONE';

export type RuleType = 'JavaScript' | 'Rule Builder';

export interface RuleData {
  sequenceNumber?: number;
  name?: string;
  type?: RuleType;
  script?: string;
  enabled?: boolean;
  operator?: RuleOperator;
  data?: Record<string, unknown>;
}

export class Rule {
  private sequenceNumber: number;
  private name: string;
  private type: RuleType;
  private script: string;
  private enabled: boolean;
  private operator: RuleOperator;
  private data: Record<string, unknown>;

  constructor(ruleData: RuleData = {}) {
    this.sequenceNumber = ruleData.sequenceNumber ?? 0;
    this.name = ruleData.name ?? '';
    this.type = ruleData.type ?? 'JavaScript';
    this.script = ruleData.script ?? 'return true;';
    this.enabled = ruleData.enabled ?? true;
    this.operator = ruleData.operator ?? 'AND';
    this.data = ruleData.data ?? {};
  }

  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  setSequenceNumber(sequenceNumber: number): void {
    this.sequenceNumber = sequenceNumber;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  getType(): RuleType {
    return this.type;
  }

  setType(type: RuleType): void {
    this.type = type;
  }

  getScript(): string {
    return this.script;
  }

  setScript(script: string): void {
    this.script = script;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getOperator(): RuleOperator {
    return this.operator;
  }

  setOperator(operator: RuleOperator): void {
    this.operator = operator;
  }

  getData(): Record<string, unknown> {
    return this.data;
  }

  setData(data: Record<string, unknown>): void {
    this.data = data;
  }

  /**
   * Serialize to plain object for storage
   */
  toJSON(): RuleData {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      type: this.type,
      script: this.script,
      enabled: this.enabled,
      operator: this.operator,
      data: this.data,
    };
  }
}
