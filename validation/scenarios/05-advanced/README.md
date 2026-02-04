# Advanced Validation Scenarios (Priority 5)

This category tests advanced Mirth Connect features that build on top of the basic message flow, connector, and data type functionality. These scenarios require more complex channel configurations and test edge cases that are critical for production deployments.

## Overview

| Scenario | Name | Description |
|----------|------|-------------|
| 5.1 | Response Transformers | Response map modification, status changes, content transformation |
| 5.2 | Channel Routing | VMRouter, inter-channel communication, DestinationSet |
| 5.3 | Multi-Destination Flow | Parallel destinations, filtering, response aggregation |
| 5.4 | Error Handling Patterns | Filter rejection, transformer errors, queue behavior |
| 5.5 | Preprocessor/Postprocessor | Deploy scripts, message preprocessing |
| 5.6 | Database Interactions | DatabaseConnection, queries, transactions |

## Prerequisites

Before running Priority 5 scenarios:

1. **Complete Priority 1-4 validation**: These scenarios depend on basic message flow, connectors, and data type handling working correctly.

2. **Database setup**: Scenario 5.6 requires the MySQL validation database with test tables:
   ```sql
   CREATE DATABASE IF NOT EXISTS mirth_validation;
   USE mirth_validation;

   CREATE TABLE patient_lookup (
     patient_id VARCHAR(50) PRIMARY KEY,
     first_name VARCHAR(100),
     last_name VARCHAR(100),
     dob DATE,
     mrn VARCHAR(50)
   );

   INSERT INTO patient_lookup VALUES
     ('12345', 'John', 'Doe', '1980-01-15', 'MRN001'),
     ('67890', 'Jane', 'Smith', '1975-06-20', 'MRN002');
   ```

3. **Multiple channel deployment**: Scenarios 5.2 and 5.3 require deploying multiple interconnected channels.

## Port Allocation

Priority 5 scenarios use ports in the 6670-6699 range:

| Scenario | Port Range | Purpose |
|----------|------------|---------|
| 5.1 | 6670-6672 | Response transformer channel |
| 5.2 | 6673-6678 | Router source and destination channels |
| 5.3 | 6679-6683 | Multi-destination channel |
| 5.4 | 6684-6686 | Error handling channel |
| 5.5 | 6687-6688 | Processor channel |
| 5.6 | 6689-6690 | Database script channel |

## Running the Scenarios

```bash
# Run all Priority 5 scenarios
npm run validate -- --priority 5

# Run specific scenario
npm run validate -- --scenario 5.1
npm run validate -- --scenario 5.2

# Run with verbose output
npm run validate -- --priority 5 --verbose
```

## Validation Approach

### Response Transformers (5.1)
- Deploy channel with response transformer
- Send message, capture response
- Compare response map variables between engines
- Compare final response content

### Channel Routing (5.2)
- Deploy source channel + 2 destination channels
- Send message to source
- Verify it routes to correct destination(s)
- Compare routing decisions between engines

### Multi-Destination Flow (5.3)
- Deploy channel with 3 destinations
- Use mock servers to capture messages
- Verify all destinations receive messages
- Test response aggregation logic

### Error Handling (5.4)
- Send messages that trigger various error conditions
- Verify error status codes match
- Verify queue behavior on errors
- Compare error messages in logs

### Preprocessor/Postprocessor (5.5)
- Deploy channel with preprocessor that modifies messages
- Verify preprocessor transformations apply
- Verify postprocessor runs after processing

### Database Interactions (5.6)
- Deploy channel that queries database in transformer
- Send message with patient ID
- Verify database query executes correctly
- Compare enriched output between engines

## Known Differences

Some differences between Java and Node.js Mirth are expected and documented:

1. **Timing-related**: Exact timestamps may differ
2. **Thread IDs**: Java thread names vs Node.js async context
3. **Error message formatting**: Minor text differences in error messages

These differences are normalized during comparison and should not cause test failures.

## Troubleshooting

### Scenario 5.2 routing fails
- Ensure all three channels (source + 2 destinations) are deployed
- Verify VM channel IDs match between engine configurations

### Scenario 5.6 database connection fails
- Verify MySQL is running and accessible
- Check database credentials in channel configuration
- Ensure test tables exist with sample data
