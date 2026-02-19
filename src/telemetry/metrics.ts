/**
 * Custom Mirth Connect metrics for OpenTelemetry.
 *
 * These complement the auto-instrumented Express/MySQL/HTTP spans
 * with Mirth-specific business metrics.
 *
 * Usage:
 *   import { messagesProcessed, messageDuration } from '../telemetry/metrics.js';
 *   messagesProcessed.add(1, { 'channel.name': channelName, 'message.status': 'SENT' });
 *   messageDuration.record(elapsed, { 'channel.name': channelName });
 */

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('mirth-connect', '0.1.0');

// --- Counters ---

/** Total messages processed (final pipeline completion) */
export const messagesProcessed = meter.createCounter('mirth.messages.processed', {
  description: 'Total messages processed through the pipeline',
  unit: '{message}',
});

/** Total messages that ended in ERROR status */
export const messagesErrored = meter.createCounter('mirth.messages.errors', {
  description: 'Total messages that resulted in error',
  unit: '{message}',
});

/** Total messages pruned by the DataPruner */
export const messagesPruned = meter.createCounter('mirth.pruner.messages.deleted', {
  description: 'Total messages deleted by the data pruner',
  unit: '{message}',
});

// --- Histograms ---

/** End-to-end message processing duration (dispatchRawMessage) */
export const messageDuration = meter.createHistogram('mirth.message.duration', {
  description: 'Time to process a message through the full pipeline',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
  },
});

// --- UpDownCounters ---

/** Current queue depth (source + destination queues combined) */
export const queueDepth = meter.createUpDownCounter('mirth.queue.depth', {
  description: 'Current number of messages in processing queues',
  unit: '{message}',
});

/** Current active WebSocket connections */
export const wsConnections = meter.createUpDownCounter('mirth.ws.connections', {
  description: 'Current active WebSocket connections',
  unit: '{connection}',
});

// --- Observable Gauges (registered with callbacks at init time) ---

/**
 * Register observable gauges that read from runtime state.
 * Call once during server startup, passing accessor functions.
 */
export function registerObservableGauges(accessors: {
  getDeployedChannelCount: () => number;
  getStartedChannelCount: () => number;
  getDbPoolActive: () => number;
  getDbPoolIdle: () => number;
}): void {
  meter
    .createObservableGauge('mirth.channels.deployed', {
      description: 'Number of currently deployed channels',
      unit: '{channel}',
    })
    .addCallback((result) => {
      result.observe(accessors.getDeployedChannelCount());
    });

  meter
    .createObservableGauge('mirth.channels.started', {
      description: 'Number of currently started (active) channels',
      unit: '{channel}',
    })
    .addCallback((result) => {
      result.observe(accessors.getStartedChannelCount());
    });

  meter
    .createObservableGauge('mirth.db.pool.active', {
      description: 'Number of active database connections in pool',
      unit: '{connection}',
    })
    .addCallback((result) => {
      result.observe(accessors.getDbPoolActive());
    });

  meter
    .createObservableGauge('mirth.db.pool.idle', {
      description: 'Number of idle database connections in pool',
      unit: '{connection}',
    })
    .addCallback((result) => {
      result.observe(accessors.getDbPoolIdle());
    });

  // Process memory gauges — essential for memory leak detection
  meter
    .createObservableGauge('mirth.process.heap_used', {
      description: 'V8 heap memory used by the process',
      unit: 'By',
    })
    .addCallback((result) => {
      result.observe(process.memoryUsage().heapUsed);
    });

  meter
    .createObservableGauge('mirth.process.heap_total', {
      description: 'V8 total heap size allocated',
      unit: 'By',
    })
    .addCallback((result) => {
      result.observe(process.memoryUsage().heapTotal);
    });

  meter
    .createObservableGauge('mirth.process.rss', {
      description: 'Resident set size (total memory allocated for the process)',
      unit: 'By',
    })
    .addCallback((result) => {
      result.observe(process.memoryUsage().rss);
    });

  meter
    .createObservableGauge('mirth.process.external', {
      description: 'Memory used by C++ objects bound to JavaScript objects',
      unit: 'By',
    })
    .addCallback((result) => {
      result.observe(process.memoryUsage().external);
    });
}
