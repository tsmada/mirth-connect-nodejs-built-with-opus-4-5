/**
 * OpenTelemetry auto-instrumentation bootstrap.
 *
 * MUST be loaded before all other imports via:
 *   node --import ./dist/instrumentation.js dist/index.js
 *
 * This monkey-patches http, mysql2, express, net, dns, and undici
 * to produce traces and metrics automatically.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { PeriodicExportingMetricReader, type MetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'mirth-connect-node',
  [ATTR_SERVICE_VERSION]: '0.1.0',
  'deployment.environment': process.env['NODE_ENV'] ?? 'development',
  'service.instance.id': process.env['MIRTH_SERVER_ID'] ?? 'standalone',
});

// OTLP metrics exporter (push to collector/agent)
const metricReaders: MetricReader[] = [
  new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 60_000,
  }),
];

// Optional Prometheus scrape endpoint (pull)
const promPort = process.env['MIRTH_OTEL_PROMETHEUS_PORT'];
if (promPort) {
  metricReaders.push(
    new PrometheusExporter({ port: parseInt(promPort, 10) }) as unknown as MetricReader,
  );
}

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter(),
  metricReader: metricReaders[0]!,
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs instrumentation is too noisy for file-heavy channels
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Graceful shutdown on SIGTERM (container orchestrator)
process.on('SIGTERM', () => {
  void sdk.shutdown();
});

/**
 * Exported for Mirth.ts to call during graceful shutdown.
 * Flushes pending spans and metrics before process exit.
 */
export async function shutdown(): Promise<void> {
  await sdk.shutdown();
}
