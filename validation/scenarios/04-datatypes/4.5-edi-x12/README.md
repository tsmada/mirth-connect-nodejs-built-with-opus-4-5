# 4.5 EDI/X12 Parsing Validation

## Purpose

Validates healthcare EDI transaction parsing including eligibility inquiries, claims, and remittance advice.

## Data Type

- **Type**: EDI/X12
- **Standard**: ASC X12

## Input Messages

### 270-eligibility-inquiry.x12
Healthcare eligibility inquiry (270):
- ISA/IEA envelope segments
- GS/GE functional group
- BHT hierarchical transaction set trailer
- NM1 name segments (payer, subscriber)
- Standard X12 formatting

### 271-eligibility-response.x12
Healthcare eligibility response (271):
- Eligibility benefit information (EB segments)
- Coverage details
- Benefit amounts
- Date ranges

### 837p-professional-claim.x12
Professional claim (837P):
- Billing provider information
- Patient demographics
- Claim header (CLM segment)
- Service lines (SV1 segments)
- Diagnosis codes

### 835-remittance.x12
Electronic remittance advice (835):
- Payment information (BPR segment)
- Claim payment details (CLP segments)
- Adjustment codes
- Provider information

## Test Cases

### Envelope Parsing
- ISA segment field access
- Sender/Receiver identification
- Control numbers
- GS functional group parsing

### Transaction Set Header
- ST segment transaction type
- ST control number
- BHT hierarchical information

### Name Segments (NM1)
- Entity identifier codes
- Name fields (last, first)
- Identification numbers
- Multiple NM1 segment access

### Eligibility Response (271)
- EB eligibility benefit segments
- Coverage level codes
- Benefit amounts
- Service type codes

### Claims (837P)
- CLM claim information
- Claim amounts
- SV1 service line details
- Procedure codes

### Remittance (835)
- BPR payment information
- CLP claim payment details
- Payment amounts
- Adjustment handling

### Loop Navigation
- Access segments within loops
- Multiple segment instances
- Hierarchical structure navigation

## EDI Structure

```
ISA*...*~          <- Interchange header
  GS*...*~         <- Functional group header
    ST*...*~       <- Transaction set header
      BHT*...*~    <- Beginning of hierarchical transaction
      ...          <- Transaction content
    SE*...*~       <- Transaction set trailer
  GE*...*~         <- Functional group trailer
IEA*...*~          <- Interchange trailer
```

## Expected Behavior

Both Java Mirth and Node.js Mirth should:
1. Parse EDI transactions identically
2. Support segment access (msg['ISA'])
3. Support element access within segments (msg['ISA']['ISA06'])
4. Support component access (msg['SV1']['SV101-1'])
5. Handle repeating segments as arrays
6. Support iteration over segment groups
7. Handle various X12 transaction types
