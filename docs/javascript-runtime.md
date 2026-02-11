[← Back to README](../README.md)

# JavaScript Runtime

## E4X Support

All user scripts containing E4X syntax are automatically transpiled:

```javascript
// Original E4X (Mirth script)
var patient = msg.PID['PID.5']['PID.5.1'].toString();
msg.PID['PID.5']['PID.5.1'] = patient.toUpperCase();

// Automatically transpiled to modern JavaScript
var patient = msg.get('PID').get('PID.5').get('PID.5.1').toString();
msg.get('PID').get('PID.5').get('PID.5.1').setValue(patient.toUpperCase());
```

## Scope Variables

All standard Mirth scope variables are available:

| Variable | Description |
|----------|-------------|
| `$c` / `channelMap` | Channel-scoped variables |
| `$s` / `sourceMap` | Source connector variables |
| `$g` / `globalMap` | Global variables (all channels) |
| `$gc` / `globalChannelMap` | Global channel variables |
| `$cfg` / `configurationMap` | Configuration variables |
| `$r` / `responseMap` | Response variables |
| `$co` / `connectorMap` | Connector variables |
| `msg` | Current message |
| `logger` | Logging utility |

## Message Status Codes

| Code | Status | Description |
|------|--------|-------------|
| R | RECEIVED | Message received by source |
| F | FILTERED | Message filtered out |
| T | TRANSFORMED | Message transformed |
| S | SENT | Message sent successfully |
| Q | QUEUED | Message queued for retry |
| E | ERROR | Processing error |
| P | PENDING | Awaiting processing |
