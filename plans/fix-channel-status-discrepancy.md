# Plan: Fix Channel Status Discrepancy

## Problem Statement

The Node.js Mirth engine has a **dual state tracking bug** where:
- **Mirth.ts** deploys channels directly to the Donkey engine during startup
- **EngineController** maintains a separate `channelStates` Map that's never populated

Result: API endpoint `/api/channels/statuses` returns empty array even when channels are running.

## Root Cause Analysis

### Code Flow During Startup (Current - Broken)
```
Mirth.start()
  → loadAndDeployChannels()
    → this.donkey.deployChannel(runtimeChannel)  ← Channels go to Donkey
    → runtimeChannel.start()                      ← Channel starts

EngineController.channelStates                    ← NEVER UPDATED = EMPTY
```

### API Query Flow (Current - Broken)
```
GET /api/channels/statuses
  → EngineController.getChannelStatuses()
    → channelStates.get(channel.id)               ← Returns undefined!
    → includeUndeployed=false                     ← Skips channel
  → Returns []
```

## Fix Options

### Option A: Mirth.ts Uses EngineController (Recommended)
Change startup to use `EngineController.deployChannel()` instead of directly calling Donkey.

**Pros:**
- Single source of truth (EngineController)
- Consistent deployment path for startup and API calls
- EngineController tracks state correctly

**Cons:**
- Need to refactor EngineController to not duplicate Donkey functionality

### Option B: EngineController Queries Donkey (Alternative)
Remove `channelStates` Map from EngineController, query Donkey directly.

**Pros:**
- Donkey is always the truth
- No state synchronization needed

**Cons:**
- Need Donkey to expose rich state API
- May be slower (no caching)

### Option C: Register with EngineController After Donkey Deploy
After deploying to Donkey, also register with EngineController.

**Pros:**
- Minimal changes

**Cons:**
- Still dual state (can drift)
- Easy to forget registration

## Selected Approach: Option A

Modify `Mirth.ts` to use `EngineController.deployChannel()` which already handles:
1. Building runtime channel
2. Adding to `channelStates`
3. Starting if needed

## Implementation Steps

### Step 1: Update Mirth.ts loadAndDeployChannels()

**File:** `src/server/Mirth.ts`

```typescript
// BEFORE (line 173-205):
private async loadAndDeployChannels(): Promise<void> {
  const channelConfigs = await ChannelController.getAllChannels();
  for (const channelConfig of channelConfigs) {
    const runtimeChannel = buildChannel(channelConfig);
    await this.donkey!.deployChannel(runtimeChannel);
    // ... start logic
  }
}

// AFTER:
private async loadAndDeployChannels(): Promise<void> {
  const channelConfigs = await ChannelController.getAllChannels();
  for (const channelConfig of channelConfigs) {
    try {
      // Use EngineController which handles state tracking
      await EngineController.deployChannel(channelConfig.id);
    } catch (error) {
      console.error(`Failed to deploy channel ${channelConfig.name}:`, error);
    }
  }
}
```

### Step 2: Ensure EngineController Registers with Donkey

**File:** `src/controllers/EngineController.ts`

Add registration with Donkey engine (if not already done):

```typescript
static async deployChannel(channelId: string): Promise<void> {
  // ... existing code builds runtimeChannel ...

  // Register with Donkey engine for runtime
  const donkey = getDonkeyInstance();  // Need to implement
  if (donkey) {
    await donkey.deployChannel(runtimeChannel);
  }

  // ... rest of existing code ...
}
```

### Step 3: Export Donkey Instance

**File:** `src/server/Mirth.ts`

Expose Donkey instance for EngineController:

```typescript
let donkeyInstance: Donkey | null = null;

export function getDonkeyInstance(): Donkey | null {
  return donkeyInstance;
}

// In start():
this.donkey = new Donkey();
donkeyInstance = this.donkey;  // Expose globally
```

### Step 4: Fix Statistics Reporting

**File:** `src/controllers/EngineController.ts`

Replace `createEmptyStatistics()` with real stats from runtime channel:

```typescript
private static createStatusFromState(state: ChannelState): DashboardStatus {
  const stats = state.runtimeChannel?.getStatistics() ?? createEmptyStatistics();
  return {
    channelId: state.channelId,
    name: state.name,
    state: state.state,
    deployedDate: state.deployedDate,
    deployedRevisionDelta: 0,
    statistics: stats,
  };
}
```

## Testing

After fix, verify:

```bash
# Start server
PORT=8081 node dist/index.js

# Test CLI
node dist/cli/index.js login --user admin --password admin
node dist/cli/index.js channels          # Should show deployed channels
node dist/cli/index.js channels stats    # Should show real statistics
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/server/Mirth.ts` | Use EngineController, expose Donkey instance |
| `src/controllers/EngineController.ts` | Register with Donkey, fix stats |
| `src/donkey/Donkey.ts` | May need method to check if channel deployed |

## Risks

- **Startup order dependency**: EngineController must have Donkey reference before deploying
- **Error handling**: Need graceful handling if deployment fails mid-way
- **Backward compatibility**: Ensure API responses match Java Mirth format

## Success Criteria

1. `GET /api/channels/statuses` returns deployed channels with correct state
2. CLI `mirth-cli channels` shows channels
3. Channel state (STARTED/STOPPED/PAUSED) matches actual runtime state
4. Statistics reflect real message counts
