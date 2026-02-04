# 4.4 Delimited Data Parsing Validation

## Purpose

Validates CSV, pipe-delimited, and tab-delimited data parsing including quote handling, escaping, and column name mapping.

## Data Type

- **Type**: DELIMITED
- **Variants**: CSV, PSV (pipe), TSV (tab)

## Input Messages

### patients.csv
Comma-separated patient records:
- Standard CSV format
- 6 columns: MRN, LastName, FirstName, DOB, Gender, Phone
- 3 data rows
- Empty field in last row

### lab-results.psv
Pipe-delimited lab results:
- Pipe (|) as delimiter
- Lab result data with numeric values
- 5 result rows

### demographics.tsv
Tab-delimited demographics:
- Tab character as delimiter
- Address information
- 4 patient records

### quoted-fields.csv
CSV with quoted fields:
- Double-quoted field values
- Comma embedded in quoted field
- Escaped quotes within quoted field

### multiline.csv
CSV with multiline fields:
- Quoted field containing newline
- Tests proper multiline handling

## Test Cases

### Basic Row Access
- Count rows
- Access by row index
- Access columns by number (column1, column2, etc.)
- Access columns by name (with config)

### Delimiter Handling
- Comma-separated (CSV)
- Pipe-separated (PSV)
- Tab-separated (TSV)

### Quote Handling
- Simple quoted fields
- Comma within quoted field
- Escaped quotes ("" -> ")
- Newline within quoted field

### Column Configuration
- Access by generic column names
- Access by configured column names
- Column count verification

### Data Type Operations
- Iterate over rows
- Filter rows by condition
- Access first/last rows
- Handle empty fields

### Numeric Values
- Parse numeric values
- Perform calculations on values

## Data Type Configuration

The delimited data type can be configured with:
- Column delimiter (comma, pipe, tab, custom)
- Row delimiter (newline, custom)
- Quote character (double quote, single quote)
- Escape character
- Column names (for named access)
- Whether first row is header

## Expected Behavior

Both Java Mirth and Node.js Mirth should:
1. Parse delimited data identically
2. Support E4X-style access (msg.row[0].column1)
3. Handle quoted fields correctly
4. Support custom column names
5. Handle empty fields
6. Support row iteration
7. Handle multiline quoted fields
