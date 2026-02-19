/**
 * Logging Transports
 *
 * Winston transport wrappers matching Java Mirth's Log4j output format.
 * ConsoleTransport uses process.stdout.write() to avoid hookConsole() interception.
 */

import winston from 'winston';

/**
 * Interface for pluggable log transports.
 */
export interface LogTransport {
  name: string;
  createWinstonTransport(): winston.transport;
}

/**
 * Format a Date in Java Mirth's Log4j timestamp style: yyyy-MM-dd HH:mm:ss,SSS
 */
export function formatMirthTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds},${millis}`;
}

/**
 * Build the text format matching Java Mirth's Log4j pattern:
 * INFO  2026-02-10 14:30:15,042 [http-connector] Channel started
 */
function buildTextFormat(timestampFormat: 'mirth' | 'iso'): winston.Logform.Format {
  return winston.format.printf((info) => {
    const level = info.level.toUpperCase().padStart(5);
    const component = info['component'] as string | undefined;
    const timestamp =
      timestampFormat === 'iso' ? new Date().toISOString() : formatMirthTimestamp(new Date());
    const componentPart = component ? ` [${component}]` : '';
    const errorStack = info['errorStack'] as string | undefined;
    let line = `${level} ${timestamp}${componentPart} ${info.message}`;
    if (errorStack) {
      line += '\n' + errorStack;
    }
    return line;
  });
}

/**
 * Console transport — writes to stdout using process.stdout.write().
 * This bypasses console.log() to avoid infinite loops with hookConsole().
 */
export class ConsoleTransport implements LogTransport {
  name = 'console';

  constructor(
    private format: 'text' | 'json',
    private timestampFormat: 'mirth' | 'iso'
  ) {}

  createWinstonTransport(): winston.transport {
    if (this.format === 'json') {
      return new winston.transports.Console({
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        stderrLevels: [],
      });
    }

    // Text format: use custom stream writing to stdout
    return new winston.transports.Console({
      format: buildTextFormat(this.timestampFormat),
      stderrLevels: [],
    });
  }
}

/**
 * File transport — writes to a log file with rotation support.
 */
export class FileTransport implements LogTransport {
  name = 'file';

  constructor(
    private filePath: string,
    private format: 'text' | 'json'
  ) {}

  createWinstonTransport(): winston.transport {
    const formatCombine =
      this.format === 'json'
        ? winston.format.combine(winston.format.timestamp(), winston.format.json())
        : buildTextFormat('mirth');

    return new winston.transports.File({
      filename: this.filePath,
      format: formatCombine,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    });
  }
}
