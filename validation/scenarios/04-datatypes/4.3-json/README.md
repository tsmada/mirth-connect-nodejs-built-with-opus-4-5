# 4.3 JSON Parsing Validation

## Purpose

Validates JSON message handling including nested objects, arrays, various data types, and JavaScript operations.

## Data Type

- **Type**: JSON
- **Encoding**: UTF-8

## Input Messages

### patient-fhir.json
FHIR R4 Patient resource:
- Standard FHIR structure
- Identifier array with system/value
- Name array with family/given
- Address and telecom arrays
- Boolean active flag

### patient-nested.json
Deeply nested patient structure:
- Multiple levels of object nesting
- Arrays at various depths
- Emergency contacts array

### lab-results.json
Lab results with numeric values:
- Numeric observation values
- Null values for optional fields
- Reference ranges
- Interpretation codes

### bundle.json
FHIR Bundle with multiple resources:
- Bundle wrapper structure
- Multiple entry resources
- Patient, Observation, DiagnosticReport

## Test Cases

### Basic Property Access
- Access root properties
- Access string values
- Access numeric values
- Access boolean values
- Access date strings

### Array Access
- Access by index
- Get array length
- Iterate over arrays
- Filter arrays

### Nested Object Access
- Deep property chains
- Arrays within objects
- Objects within arrays

### Null Handling
- Check for null values
- Optional field access

### Property Existence
- hasOwnProperty checks
- Object.keys enumeration

### Bundle Processing
- Access entry array
- Navigate to nested resources

## Expected Behavior

Both Java Mirth and Node.js Mirth should:
1. Parse JSON documents identically
2. Support dot notation for property access
3. Support bracket notation for array access
4. Handle null values consistently
5. Support JavaScript array methods (filter, map, etc.)
6. Support property existence checks
7. Handle deeply nested structures
