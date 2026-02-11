[← Back to README](../README.md)

# Migration & Shadow Mode

## Incremental Takeover Strategy

**The key differentiator: Node.js Mirth can seamlessly replace Java Mirth without any migration.**

The only difference between the Java and Node.js engines is the **operational mode** — a single environment variable that determines how the Node.js runtime interacts with the database:

| Mode | Command | Use Case |
|------|---------|----------|
| **Takeover** | `MIRTH_MODE=takeover npm start` | Connect to existing Java Mirth database. Zero migration. |
| **Standalone** | `MIRTH_MODE=standalone npm start` | Fresh installation with auto-created schema. |
| **Auto** | `npm start` | Auto-detect: uses existing DB if found, else creates new. |

### Migration Path: Java → Node.js

```
Week 1: Run Node.js Mirth in TAKEOVER mode alongside Java Mirth
        ↓ Both engines share the same MySQL database
        ↓ Use Java Mirth as primary, Node.js for testing

Week 2: Gradually route traffic to Node.js endpoints
        ↓ Compare behavior, validate messages

Week 3: Switch primary to Node.js
        ↓ Keep Java Mirth as fallback

Week 4: Decommission Java Mirth
        ↓ Node.js runs standalone
```

### Why This Matters

- **Zero Data Migration**: Point Node.js at your existing MySQL database — all channels, messages, users, and configuration are immediately available
- **Rollback Safety**: If issues arise, switch back to Java Mirth instantly (same database)
- **Gradual Adoption**: Test channel-by-channel before full cutover
- **Same Admin GUI**: Mirth Administrator works identically with both engines

---

## Shadow Mode (Safe Takeover)

> **Node.js-only feature** — Shadow mode has no equivalent in Java Mirth.

Shadow mode enables a safe, progressive cutover from Java Mirth to Node.js Mirth. When enabled, the Node.js engine deploys all channels in a **read-only observer state** — no ports are bound, no polling starts, and no messages are processed. The operator then promotes channels one-by-one, stopping each on Java Mirth first, until the full cutover is complete.

### Why Shadow Mode?

Running two engines against the same database without shadow mode causes:
- **Port conflicts** — Both engines try to bind the same MLLP/HTTP/TCP ports
- **Duplicate processing** — File and database receivers poll the same sources
- **Data corruption** — Both engines write to the same message tables simultaneously

Shadow mode prevents all of this by keeping the Node.js engine passive until the operator explicitly activates each channel.

### Quick Start

```bash
# Start Node.js Mirth in shadow mode (connects to existing Java Mirth database)
MIRTH_MODE=takeover MIRTH_SHADOW_MODE=true PORT=8081 node dist/index.js

# Check shadow status
mirth-cli shadow status
# → SHADOW MODE ACTIVE: 12 channels deployed, 0 promoted

# Stop a channel on Java Mirth first, then promote it on Node.js
mirth-cli shadow promote "ADT Receiver"
# → Channel ADT Receiver promoted and started (port 6661 bound)

# Test the channel, then promote the next one
mirth-cli shadow promote "HL7 Router"

# When ready, cut over all remaining channels at once
mirth-cli shadow cutover
# → All channels promoted, shadow mode disabled

# Shut down Java Mirth
```

### Shadow Mode CLI Commands

```bash
mirth-cli shadow status              # Show shadow state + promoted channels
mirth-cli shadow promote <channel>   # Promote single channel to active
mirth-cli shadow promote --all       # Promote all channels (full cutover)
mirth-cli shadow demote <channel>    # Stop + return channel to shadow
mirth-cli shadow cutover             # Interactive guided cutover
```

### Shadow Mode API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/system/shadow` | GET | Shadow status, promoted channels list |
| `/api/system/shadow/promote` | POST | Promote channel (`{channelId}`) or full cutover (`{all: true}`) |
| `/api/system/shadow/demote` | POST | Stop + demote channel back to shadow |

### How It Works

| Shadow State | Behavior |
|---|---|
| **Global shadow, no promotions** | All channels deployed but stopped. All mutating API requests return 409 Conflict. Dashboard shows historical statistics. |
| **Per-channel promoted** | Promoted channels start normally (ports bind, polling begins). Non-promoted channels remain in shadow. |
| **Full cutover** | All channels active. Shadow mode disabled. VMRouter and DataPruner initialized. |

### Safety Guardrails

- **Port conflicts surface naturally** — If Java Mirth still has a port bound, the promote fails with `EADDRINUSE` and the channel is auto-demoted back to shadow
- **Recovery task is safe** — It only runs inside `Channel.start()`, which is skipped in shadow mode
- **DataPruner is deferred** — Not initialized until full cutover, preventing deletion of Java's messages
- **VMRouter is deferred** — Not wired until full cutover, preventing cross-channel routing interference
- **Health probes are shadow-aware** — Stopped shadow channels return 200 with `status: shadow` instead of 503

### Environment Variable

| Variable | Default | Description |
|----------|---------|-------------|
| `MIRTH_SHADOW_MODE` | `false` | Enable shadow mode for safe takeover observation |

This is separate from `MIRTH_MODE` (which controls schema behavior). Typical usage: `MIRTH_MODE=takeover MIRTH_SHADOW_MODE=true`.
