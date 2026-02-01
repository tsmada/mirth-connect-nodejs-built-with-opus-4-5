/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/model/Filter.java
 *
 * Purpose: Represents a filter configuration with rules
 *
 * Key behaviors to replicate:
 * - Contains ordered list of filter rules
 * - Rules can accept or reject messages
 * - Rules are evaluated in sequence
 */

import { Rule, RuleData } from './Rule.js';

export interface FilterData {
  rules?: RuleData[];
}

export class Filter {
  private rules: Rule[] = [];

  constructor(data: FilterData = {}) {
    if (data.rules) {
      this.rules = data.rules.map((r) => new Rule(r));
    }
  }

  getRules(): Rule[] {
    return this.rules;
  }

  setRules(rules: Rule[]): void {
    this.rules = rules;
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  removeRule(index: number): void {
    this.rules.splice(index, 1);
  }

  /**
   * Check if filter has any rules
   */
  hasRules(): boolean {
    return this.rules.length > 0;
  }

  /**
   * Get the number of rules
   */
  getRuleCount(): number {
    return this.rules.length;
  }

  /**
   * Generate the combined filter script from all rules
   */
  generateScript(): string {
    if (this.rules.length === 0) {
      return 'return true;'; // No filter, accept all
    }

    const ruleScripts = this.rules.map((rule, index) => {
      const script = rule.getScript();
      const operator = rule.getOperator();

      if (index === 0) {
        return `(${script})`;
      }

      // AND means all must pass, OR means any can pass
      const connector = operator === 'AND' ? '&&' : '||';
      return `${connector} (${script})`;
    });

    return `return ${ruleScripts.join(' ')};`;
  }

  /**
   * Serialize to plain object for storage
   */
  toJSON(): FilterData {
    return {
      rules: this.rules.map((r) => r.toJSON()),
    };
  }
}
