---
description: Analyze codebase for tech debt and code quality issues
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# Tech Debt Analysis Command

Analyze the codebase for technical debt. Mode: $ARGUMENTS (default: standard)

## Modes
- **quick**: ESLint complexity + large files + npm outdated (~30s)
- **standard**: All of quick + duplicates + unused exports + coverage (~2 min)
- **deep**: All + Claude recommendations for top 10 issues (~5 min)

## Execution Steps

### Step 1: Determine Mode
Parse the mode from arguments. If no argument provided, use "standard".
Valid modes: quick, standard, deep

### Step 2: Run ESLint with Complexity Rules
Run ESLint to check for complexity issues:
```bash
npm run lint -- --format json 2>/dev/null | head -200 || true
```

Also check for complexity specifically:
```bash
npm run lint -- --rule 'complexity: [warn, 10]' --rule 'max-lines-per-function: [warn, {max: 100}]' 2>&1 | grep -E "(complexity|max-lines)" | head -20 || true
```

### Step 3: Find Large Files (>300 lines)
Find TypeScript files with more than 300 lines:
```bash
find src -name "*.ts" -exec wc -l {} + 2>/dev/null | sort -rn | head -20
```

### Step 4: Check Outdated Dependencies
Check for outdated npm packages:
```bash
npm outdated 2>/dev/null || echo "All dependencies up to date"
```

### Step 5: Run Duplicate Detection (standard/deep only)
If mode is "standard" or "deep", run duplicate code detection:
```bash
npx jscpd src --min-lines 5 --min-tokens 50 --reporters console --silent 2>/dev/null || echo "No duplicates found or jscpd not available"
```

### Step 6: Find Unused Exports (standard/deep only)
If mode is "standard" or "deep", check for unused exports:
```bash
npx knip --reporter compact 2>/dev/null || echo "Knip analysis not available"
```

### Step 7: Check Test Coverage Summary (standard/deep only)
If mode is "standard" or "deep", check test coverage:
```bash
npm run test:coverage -- --coverageReporters=text-summary --silent 2>/dev/null || cat coverage/coverage-summary.json 2>/dev/null || echo "No coverage data available"
```

### Step 8: Deep Analysis (deep mode only)
For deep mode, after gathering all the data above, analyze the top issues found and provide:
- Root cause analysis for the most critical issues
- Specific refactoring recommendations with code examples
- Priority ordering by impact (effort vs. value)
- Suggested order of fixes

## Output Format
Present results grouped by category with severity indicators:
- **[CRIT]** Critical - must fix soon (security, data loss, crashes)
- **[WARN]** Warning - should fix (maintainability, performance)
- **[INFO]** Informational - consider fixing (style, minor improvements)

Structure the output as:

```
Tech Debt Analysis ({mode} mode)
==================================

COMPLEXITY
[severity] file:function - description

LARGE FILES (files >300 lines)
[severity] file - line count

DUPLICATE CODE (if standard/deep)
[severity] description of duplication

UNUSED EXPORTS (if standard/deep)
[severity] file - unused items

OUTDATED DEPENDENCIES
[severity] package current → latest

TEST COVERAGE (if standard/deep)
[severity] Overall: X%

RECOMMENDATIONS (if deep mode)
1. Highest priority fix with rationale
2. Second priority...
```

Include actionable next steps for each category with specific commands or code changes.
