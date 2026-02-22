# Project Agents

This directory contains specialized subagent specifications for automating complex workflows in the Mirth Connect Node.js project.

## What Are Agents?

Agents are reusable AI assistants with specific expertise. They follow documented workflows, maintain guardrails, and produce consistent outputs. Use them to:

- Offload repetitive multi-step tasks
- Ensure consistent patterns across similar work
- Reduce context window usage in main conversation
- Parallelize independent work streams

## Available Agents

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| [mirth-porter](./mirth-porter.md) | Port Java Mirth code to TypeScript | New connectors, API endpoints, plugins, validation gaps |
| [version-upgrader](./version-upgrader.md) | Orchestrate version upgrades with parallel agents | Upgrading to new Mirth versions (3.9.1 → 3.10.0, etc.) |
| [subtle-bug-finder](./subtle-bug-finder.md) | Detect Java→Node.js porting discrepancies | Post-porting validation, debugging unexpected API behavior, pre-release checks |
| [parity-checker](./parity-checker.md) | Detect Java↔Node.js pipeline coverage gaps | DAO method gaps, missing content persistence, incomplete pipeline stages |
| [api-parity-checker](./api-parity-checker.md) | Detect Java↔Node.js REST API servlet gaps | Missing endpoints, parameter mismatches, permission drift, response format differences |
| [channel-deployer](./channel-deployer.md) | Design and build git-backed channel config management and promotion | Git sync, channel diff, env promotion, decomposed export, sensitive data handling |
| [js-runtime-checker](./js-runtime-checker.md) | Detect Java↔Node.js JavaScript runtime parity gaps | E4X transpilation gaps, scope variable mismatches, userutil API drift, script builder divergences |
| [connector-parity-checker](./connector-parity-checker.md) | Detect Java↔Node.js connector implementation gaps | Missing config properties, connection lifecycle gaps, protocol behavior differences, auth method gaps |
| [serializer-parity-checker](./serializer-parity-checker.md) | Detect Java↔Node.js data type serializer gaps | Missing serializer methods, property mismatches, batch adaptor gaps, factory registration holes, metadata divergences |
| [transformation-quality-checker](./transformation-quality-checker.md) | Detect pipeline bugs where correct status masks wrong content | Silent data loss, E4X runtime errors, scope wiring gaps, generated code bugs, XMLProxy behavioral gaps, map propagation errors |

## How to Invoke an Agent

### Via Claude Code Task Tool

```
Use the mirth-porter agent to port the SMTP connector.

Parameters:
- componentName: SmtpDispatcher
- targetCategory: connectors
```

### Via Direct Reference

Simply reference the agent specification in your prompt:

```
Following the workflow in .claude/agents/mirth-porter.md, port the DatabaseReader connector.
```

## Agent Design Principles

### 1. Single Responsibility
Each agent does one thing well. Don't create Swiss Army knife agents.

### 2. Explicit Phases
Workflows have clear phases with decision points between them.

### 3. Guardrails
Hard rules the agent must never violate (e.g., never modify Java source).

### 4. Structured Output
Agents return consistent, parseable output formats.

### 5. Integration Points
Agents update project tracking (manifest.json, todo.md, lessons.md).

## Creating New Agents

When a workflow becomes repetitive (3+ times), consider creating an agent:

1. Create `.claude/agents/{agent-name}.md`
2. Document:
   - Purpose and when to use
   - Input parameters
   - Workflow phases with decision points
   - Key patterns and guardrails
   - Example invocations
   - Output format
3. Add to this README
4. Reference in CLAUDE.md

### Agent Template

```markdown
# {Agent-Name} Agent

## Purpose
{What this agent does and why}

## When to Use
{Specific scenarios}

## Input Parameters
{Table of parameters}

## Workflow Phases
{Numbered phases with decision points}

## Key Patterns
{Domain-specific patterns to follow}

## Guardrails
{Hard rules - numbered list}

## Example Invocations
{3-4 concrete examples}

## Output Format
{Structured output schema}
```

## Tips for Working with Agents

1. **Be specific**: Provide all required parameters upfront
2. **Use dry-run**: Test with `dryRun: true` before committing to changes
3. **Review output**: Agents produce good starting points, but review their work
4. **Report gaps**: If an agent misses something, document it for improvement
5. **Parallelize**: Run independent agent tasks concurrently when possible
