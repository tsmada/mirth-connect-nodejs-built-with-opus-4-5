/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/Transformer.java
 *
 * Purpose: Represents a transformer configuration with steps
 *
 * Key behaviors to replicate:
 * - Contains ordered list of transformer steps
 * - Steps modify the message in sequence
 * - Supports multiple step types (JavaScript, Mapper, etc.)
 */

import { Step, StepData } from './Step.js';

export interface TransformerData {
  steps?: StepData[];
  inboundDataType?: string;
  outboundDataType?: string;
  inboundTemplate?: string;
  outboundTemplate?: string;
}

export class Transformer {
  private steps: Step[] = [];
  private inboundDataType: string;
  private outboundDataType: string;
  private inboundTemplate: string;
  private outboundTemplate: string;

  constructor(data: TransformerData = {}) {
    if (data.steps) {
      this.steps = data.steps.map((s) => new Step(s));
    }
    this.inboundDataType = data.inboundDataType ?? 'HL7V2';
    this.outboundDataType = data.outboundDataType ?? 'HL7V2';
    this.inboundTemplate = data.inboundTemplate ?? '';
    this.outboundTemplate = data.outboundTemplate ?? '';
  }

  getSteps(): Step[] {
    return this.steps;
  }

  setSteps(steps: Step[]): void {
    this.steps = steps;
  }

  addStep(step: Step): void {
    this.steps.push(step);
  }

  removeStep(index: number): void {
    this.steps.splice(index, 1);
  }

  getInboundDataType(): string {
    return this.inboundDataType;
  }

  setInboundDataType(dataType: string): void {
    this.inboundDataType = dataType;
  }

  getOutboundDataType(): string {
    return this.outboundDataType;
  }

  setOutboundDataType(dataType: string): void {
    this.outboundDataType = dataType;
  }

  getInboundTemplate(): string {
    return this.inboundTemplate;
  }

  setInboundTemplate(template: string): void {
    this.inboundTemplate = template;
  }

  getOutboundTemplate(): string {
    return this.outboundTemplate;
  }

  setOutboundTemplate(template: string): void {
    this.outboundTemplate = template;
  }

  /**
   * Check if transformer has any steps
   */
  hasSteps(): boolean {
    return this.steps.length > 0;
  }

  /**
   * Get the number of steps
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * Generate the combined transformer script from all steps
   */
  generateScript(): string {
    if (this.steps.length === 0) {
      return ''; // No transformation
    }

    const stepScripts = this.steps
      .filter((step) => step.isEnabled())
      .map((step) => step.getScript());

    return stepScripts.join('\n\n');
  }

  /**
   * Serialize to plain object for storage
   */
  toJSON(): TransformerData {
    return {
      steps: this.steps.map((s) => s.toJSON()),
      inboundDataType: this.inboundDataType,
      outboundDataType: this.outboundDataType,
      inboundTemplate: this.inboundTemplate,
      outboundTemplate: this.outboundTemplate,
    };
  }
}
