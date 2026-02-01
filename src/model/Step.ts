/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/Step.java
 *
 * Purpose: Represents a single transformer step
 *
 * Key behaviors to replicate:
 * - Has a name and sequence number
 * - Contains JavaScript code or step-specific configuration
 * - Can be enabled/disabled
 * - Multiple types: JavaScript, Mapper, Message Builder, XSLT, etc.
 */

export type StepType =
  | 'JavaScript'
  | 'Mapper'
  | 'Message Builder'
  | 'XSLT'
  | 'External Script'
  | 'Destination Set Filter';

export interface StepData {
  sequenceNumber?: number;
  name?: string;
  type?: StepType;
  script?: string;
  enabled?: boolean;
  data?: Record<string, unknown>;
}

export class Step {
  private sequenceNumber: number;
  private name: string;
  private type: StepType;
  private script: string;
  private enabled: boolean;
  private data: Record<string, unknown>;

  constructor(stepData: StepData = {}) {
    this.sequenceNumber = stepData.sequenceNumber ?? 0;
    this.name = stepData.name ?? '';
    this.type = stepData.type ?? 'JavaScript';
    this.script = stepData.script ?? '';
    this.enabled = stepData.enabled ?? true;
    this.data = stepData.data ?? {};
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

  getType(): StepType {
    return this.type;
  }

  setType(type: StepType): void {
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

  getData(): Record<string, unknown> {
    return this.data;
  }

  setData(data: Record<string, unknown>): void {
    this.data = data;
  }

  /**
   * Serialize to plain object for storage
   */
  toJSON(): StepData {
    return {
      sequenceNumber: this.sequenceNumber,
      name: this.name,
      type: this.type,
      script: this.script,
      enabled: this.enabled,
      data: this.data,
    };
  }
}
