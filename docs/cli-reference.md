[← Back to README](../README.md)

# CLI Reference

The `mirth-cli` command provides a terminal-based interface for monitoring and managing Mirth Connect channels, offering an alternative to the Mirth Administrator GUI.

## Installation

```bash
# Option 1: Install globally (recommended for development)
npm run cli:link

# Verify installation
which mirth-cli        # Should show: ~/.nvm/versions/node/vX.X.X/bin/mirth-cli
mirth-cli --version    # Should show: 0.1.0

# Option 2: Run directly without global install
node dist/cli/index.js <command>

# Option 3: Run via npm script (requires -- to pass arguments)
npm run cli -- <command>

# To uninstall the global link
npm run cli:unlink
```

**Note**: `npm run cli:link` builds the project and creates a global symlink, so you can use `mirth-cli` from anywhere. Changes to the source code take effect immediately after rebuilding (`npm run build`).

## Configuration

```bash
# Set server URL
mirth-cli config set url http://localhost:8081

# Login and save session
mirth-cli login --user admin --password admin

# View current configuration
mirth-cli config
```

Configuration is stored in `~/.mirth-cli.json`.

## Commands

### Authentication
```bash
mirth-cli login                     # Interactive login
mirth-cli login -u admin -p admin   # Login with credentials
mirth-cli logout                    # Clear session
mirth-cli whoami                    # Show current user
```

### Channel Management
```bash
mirth-cli channels                  # List all channels with status
mirth-cli channels list             # Same as above
mirth-cli channels get <id|name>    # Get channel details
mirth-cli channels deploy <id|name> # Deploy a channel
mirth-cli channels undeploy <id|name>
mirth-cli channels start <id|name>
mirth-cli channels stop <id|name>
mirth-cli channels pause <id|name>
mirth-cli channels resume <id|name>
mirth-cli channels stats            # Show statistics for all channels
mirth-cli channels stats <id|name>  # Show statistics for one channel
```

### Message Browsing
```bash
mirth-cli messages list <channelId>              # List recent messages
mirth-cli messages search <channelId>            # Search with filters
  --status <R|F|T|S|Q|E|P>                       # Filter by status
  --from <datetime>                              # Messages from date
  --to <datetime>                                # Messages to date
  --limit <n>                                    # Limit results
mirth-cli messages get <channelId> <messageId>   # Get message details
mirth-cli messages export <channelId>            # Export messages
  --output <file>                                # Output file
  --format <json|xml>                            # Export format
```

### Message Sending
```bash
# Send MLLP message
mirth-cli send mllp localhost:6662 "MSH|^~\&|..."
mirth-cli send mllp localhost:6662 @message.hl7  # From file

# Send HTTP message
mirth-cli send http http://localhost:8083/api @payload.json
  --method POST                                  # HTTP method
  --content-type application/json                # Content type
  --header "Authorization: Bearer token"         # Add headers

# Send HL7 (MLLP shorthand)
mirth-cli send hl7 localhost:6662 @adt.hl7
```

### Server Information
```bash
mirth-cli server info               # Show server version and info
mirth-cli server status             # Show server status
mirth-cli server stats              # Show system statistics
```

### Event Browsing
```bash
mirth-cli events                    # List recent events
mirth-cli events list               # Same as above
mirth-cli events search             # Search with filters
  --from <datetime>                 # Events from date
  --to <datetime>                   # Events to date
  --level <INFO|WARN|ERROR>         # Filter by level
mirth-cli events errors             # Show only error events
```

### Cross-Channel Message Trace
```bash
# Trace a message across VM-connected channels
mirth-cli trace "ADT Receiver" 123

# Verbose mode (full content, 2000 char limit)
mirth-cli trace "ADT Receiver" 123 --verbose

# Trace only backward (find root) or forward (find destinations)
mirth-cli trace "ADT Receiver" 123 --direction backward
mirth-cli trace "ADT Receiver" 123 --direction forward

# Hide message content, show tree structure only
mirth-cli trace "ADT Receiver" 123 --no-content

# JSON output for scripting
mirth-cli trace "ADT Receiver" 123 --json
```

The trace command reconstructs the complete message journey across VM-connected channels (Channel Writer/Reader), showing every hop from source to final destination(s).

**Example output:**
```
Message Trace: ADT Receiver → HL7 Router → EMR Writer, Audit Log
Hops: 4 | Depth: 2 | Latency: 222ms | Errors: 1

● [SENT] ADT Receiver (msg #123)  14:30:45.123
│  RAW: MSH|^~\&|EPIC|... (2,450 chars)
│
├──► [SENT] HL7 Router (msg #456)  +111ms
│    │
│    └──► [SENT] EMR Writer (msg #789)  +222ms
│
└──► [ERROR] Audit Log (msg #101)  +177ms
     ERROR: Connection refused: localhost:5432
```

| Option | Default | Description |
|--------|---------|-------------|
| `-v, --verbose` | false | Full content display (2000 char limit vs 200) |
| `-c, --content <types>` | `raw,transformed,response,error` | Content types to show |
| `--max-depth <n>` | 10 | Maximum trace depth |
| `--direction <dir>` | `both` | `both`, `backward`, or `forward` |
| `--no-content` | - | Hide content, show tree structure only |
| `--json` | - | Output raw JSON |

### Artifact Management (Git-Backed Config-as-Code)
```bash
# Export / Import
mirth-cli artifact export [channel]              # Export channel to git directory
mirth-cli artifact export --all --mask-secrets    # Export all, parameterize credentials
mirth-cli artifact import [channel] --env prod    # Import with prod env vars

# Git operations
mirth-cli artifact git init [path]               # Initialize artifact repo
mirth-cli artifact git status                    # Show sync status
mirth-cli artifact git push -m "message"         # Export + commit + push
mirth-cli artifact git pull --env staging        # Pull + import with staging vars
mirth-cli artifact git log -n 20                 # Show recent sync history

# Analysis
mirth-cli artifact diff <channel>               # Structural diff vs git version
mirth-cli artifact secrets <channel>             # Detect sensitive fields
mirth-cli artifact deps                          # Show dependency graph

# Promotion & Deployment
mirth-cli artifact promote <target-env>          # Promote to environment
mirth-cli artifact deploy --delta                # Deploy only changed artifacts
mirth-cli artifact rollback <ref>                # Rollback to previous state
```

### Interactive Dashboard
```bash
mirth-cli dashboard                 # Launch interactive dashboard with WebSocket
mirth-cli dashboard --no-websocket  # Polling-only mode
mirth-cli dashboard --refresh 10    # Custom polling interval (seconds)
```

The dashboard provides **real-time channel status monitoring** with WebSocket updates and comprehensive keyboard navigation.

**Features:**
- Real-time updates via WebSocket (`/ws/dashboardstatus`)
- Automatic polling fallback when WebSocket unavailable
- Channel groups with expand/collapse
- Multi-channel selection and batch operations
- Search/filter mode (`/`)
- Detail view panel with tabs
- Vim-style navigation (`j`/`k`)
- Help overlay (`?`)

**Keyboard Shortcuts:**

| Key | Action |
|-----|--------|
| `↑`/`k` | Move up |
| `↓`/`j` | Move down |
| `Enter` | Expand group / Show details |
| `Space` | Toggle selection |
| `s` | Start channel(s) |
| `t` | Stop channel(s) |
| `p` | Pause/resume |
| `d` | Deploy |
| `u` | Undeploy |
| `/` | Search |
| `?` | Help |
| `a` | Select all |
| `c` | Clear selection |
| `r` | Refresh |
| `q` | Quit |

## Global Options

All commands support these options:

```bash
--url <url>         # Override server URL
--json              # Output as JSON (for scripting)
-v, --verbose       # Verbose output
```

## Example Session

```bash
# Setup and login
$ mirth-cli config set url http://localhost:8081
✔ Set url = http://localhost:8081

$ mirth-cli login -u admin -p admin
✔ Logged in as admin

# Check channels
$ mirth-cli channels
┌──────────────────────────────────────┬──────────────────┬─────────┬──────┬──────┬─────┐
│ ID                                   │ Name             │ Status  │ Recv │ Sent │ Err │
├──────────────────────────────────────┼──────────────────┼─────────┼──────┼──────┼─────┤
│ 550e8400-e29b-41d4-a716-446655440000 │ MLLP Router      │ STARTED │  150 │  148 │   2 │
│ 6ba7b810-9dad-11d1-80b4-00c04fd430c8 │ HTTP Passthrough │ STOPPED │    0 │    0 │   0 │
└──────────────────────────────────────┴──────────────────┴─────────┴──────┴──────┴─────┘

# View errors
$ mirth-cli messages search 550e8400... --status E
$ mirth-cli messages get 550e8400... 147

# Send test message
$ mirth-cli send mllp localhost:6662 @test.hl7
✔ Message sent successfully
Response: MSA|AA|12345

# JSON output for scripting
$ mirth-cli channels --json | jq '.[] | select(.status == "STARTED")'
```
