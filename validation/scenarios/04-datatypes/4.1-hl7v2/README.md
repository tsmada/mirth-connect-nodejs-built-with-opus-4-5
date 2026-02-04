# 4.1 HL7v2 Parsing Validation

## Purpose

Validates HL7v2 message parsing, segment access, field extraction, and escape sequence handling.

## Data Type

- **Type**: HL7V2
- **Version**: 2.5.1

## Input Messages

### adt-a01.hl7
Standard ADT^A01 (Admit) message with:
- MSH segment with standard encoding
- EVN segment with admit event
- PID segment with full patient demographics
- PV1 segment with visit information
- IN1 segment with insurance information

### oru-r01.hl7
Standard ORU^R01 (Lab Result) message with:
- MSH segment
- PID segment with patient info
- OBR segment with order information
- Multiple OBX segments with lab results (CBC panel)

### adt-a08-escaped.hl7
ADT^A08 (Update) message with escape sequences:
- Escaped ampersand (\T\) in patient name
- Escaped caret (\S\) in physician name
- Escaped pipe (\F\) in notes field

## Test Cases

### MSH Segment Access
- Extract message type (ADT)
- Extract trigger event (A01)
- Extract sending application
- Extract message control ID

### PID Segment Access
- Extract patient ID
- Extract patient name components (family, given, middle)
- Extract date of birth
- Extract gender

### PV1 Segment Access
- Extract patient class
- Extract room number

### Repeating Segments (ORU)
- Count OBX segments
- Access specific OBX by index
- Iterate over all OBX segments
- Extract observation values and units

### Escape Sequence Handling
- Ampersand escape (\T\ -> &)
- Caret escape (\S\ -> ^)
- Pipe escape (\F\ -> |)

## Expected Behavior

Both Java Mirth and Node.js Mirth should:
1. Parse messages identically
2. Return same field values for same E4X path expressions
3. Handle escape sequences identically
4. Support array-style access for repeating segments
5. Support for-each iteration over repeating segments
