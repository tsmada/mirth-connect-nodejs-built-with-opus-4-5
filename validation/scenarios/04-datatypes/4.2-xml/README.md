# 4.2 XML Parsing Validation

## Purpose

Validates XML message parsing with namespaces, XPath-like E4X queries, attribute access, and CDATA handling.

## Data Type

- **Type**: XML
- **Encoding**: UTF-8

## Input Messages

### patient-simple.xml
Simple XML patient document without namespaces:
- Root Patient element
- Child elements for demographics
- Attributes for coded values
- Multiple given names (repeating element)

### patient-namespaced.xml
XML patient document with HL7v3 namespace:
- Default namespace declaration
- Same structure as simple but with namespace
- Tests wildcard namespace access (*::)

### cda-document.xml
Clinical Document Architecture (CDA) document:
- Complex nested structure
- Multiple namespaces
- Header with document metadata
- recordTarget with patient information
- Author information

### patient-cdata.xml
XML with CDATA sections:
- CDATA block containing special characters
- Tests proper CDATA extraction
- Mixed content elements

## Test Cases

### Basic Element Access
- Access root element name
- Access direct child elements
- Access nested elements
- Access element text content

### Attribute Access
- Access single attribute
- Access element with both text and attribute
- Access coded value attributes

### Repeating Elements
- Count repeating children
- Access by index
- Iterate with for-each

### Namespace Handling
- Wildcard namespace access (*::)
- Access elements with default namespace
- Navigate complex namespaced structures

### CDATA Handling
- Extract CDATA content
- Preserve special characters in CDATA
- Handle mixed content

### Element Existence
- Check if element exists
- Check for non-existent elements

## Expected Behavior

Both Java Mirth and Node.js Mirth should:
1. Parse XML documents identically
2. Support E4X dot notation for element access
3. Support @attribute syntax
4. Handle namespaces with wildcard (*::) syntax
5. Extract CDATA content correctly
6. Support descendants (..) operator
7. Support children() iteration
