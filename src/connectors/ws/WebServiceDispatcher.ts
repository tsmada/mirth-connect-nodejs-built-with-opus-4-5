/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/ws/WebServiceDispatcher.java
 *
 * Purpose: WebService (SOAP) destination connector that sends SOAP messages
 *
 * Key behaviors to replicate:
 * - Parse WSDL and create SOAP client
 * - Build SOAP requests from envelope template
 * - Support SOAP 1.1 and 1.2
 * - Handle authentication (Basic)
 * - Support MTOM attachments
 * - Extract response from SOAP envelope
 * - Connection status event dispatching (SENDING/IDLE)
 * - Nuanced error classification (SOAPFault→ERROR, connection→QUEUED)
 * - Redirect handling (up to MAX_REDIRECTS)
 * - DispatchContainer pooling per dispatcherId
 * - onHalt with pending task tracking
 * - handleSOAPResult extensibility hook
 */

import * as soap from 'soap';
import { DestinationConnector } from '../../donkey/channel/DestinationConnector.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import { ContentType } from '../../model/ContentType.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  WebServiceDispatcherProperties,
  getDefaultWebServiceDispatcherProperties,
  AttachmentEntry,
  getAttachmentEntries,
} from './WebServiceDispatcherProperties.js';
import {
  parseWsdlFromUrl,
  ParsedWsdl,
  getEndpointLocation,
  getSoapAction,
} from './WsdlParser.js';
import {
  parseSoapEnvelope,
  SoapVersion,
  getSoapContentType,
  detectSoapVersion,
} from './SoapBuilder.js';

/** Maximum redirect attempts — matches Java's http.maxRedirects (default 20) */
const MAX_REDIRECTS = 20;

export interface WebServiceDispatcherConfig {
  name?: string;
  metaDataId: number;
  enabled?: boolean;
  waitForPrevious?: boolean;
  queueEnabled?: boolean;
  queueSendFirst?: boolean;
  retryCount?: number;
  retryIntervalMillis?: number;
  properties?: Partial<WebServiceDispatcherProperties>;
}

/**
 * Dispatch container to cache SOAP client state.
 * Matches Java's DispatchContainer inner class — pooled per dispatcherId
 * to reuse SOAP dispatch when config hasn't changed.
 */
interface DispatchContainer {
  /** Cached SOAP client */
  client: soap.Client | null;
  /** Current WSDL URL */
  currentWsdlUrl: string | null;
  /** Current username */
  currentUsername: string | null;
  /** Current password */
  currentPassword: string | null;
  /** Current service name */
  currentServiceName: string | null;
  /** Current port name */
  currentPortName: string | null;
  /** Parsed WSDL data */
  parsedWsdl: ParsedWsdl | null;
}

/**
 * WebService (SOAP) Destination Connector
 */
export class WebServiceDispatcher extends DestinationConnector {
  private properties: WebServiceDispatcherProperties;
  private dispatchContainers: Map<number, DispatchContainer> = new Map();
  /** Track in-flight send operations for onHalt */
  private pendingTasks: Set<AbortController> = new Set();

  constructor(config: WebServiceDispatcherConfig) {
    super({
      name: config.name ?? 'Web Service Sender',
      metaDataId: config.metaDataId,
      transportName: 'WS',
      enabled: config.enabled,
      waitForPrevious: config.waitForPrevious,
      queueEnabled: config.queueEnabled,
      queueSendFirst: config.queueSendFirst,
      retryCount: config.retryCount,
      retryIntervalMillis: config.retryIntervalMillis,
    });

    this.properties = {
      ...getDefaultWebServiceDispatcherProperties(),
      ...config.properties,
    };
  }

  /**
   * Get connector properties
   */
  getProperties(): WebServiceDispatcherProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<WebServiceDispatcherProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Called when connector starts
   */
  async onStart(): Promise<void> {
    // Clear any cached clients
    this.dispatchContainers.clear();
    this.pendingTasks.clear();
  }

  /**
   * Called when connector stops
   */
  async onStop(): Promise<void> {
    // Clear cached clients
    this.dispatchContainers.clear();
    this.pendingTasks.clear();
  }

  /**
   * Called when connector is halted (forced stop).
   * Matches Java's onHalt: abort in-flight requests, warn about potential thread leaks,
   * and clean up temp WSDL files (N/A in Node.js — no temp file caching).
   */
  async onHalt(): Promise<void> {
    // Abort all in-flight requests
    for (const controller of this.pendingTasks) {
      controller.abort();
    }

    const numTasks = this.pendingTasks.size;
    if (numTasks > 0) {
      const plural = numTasks === 1 ? '' : 's';
      console.error(
        `Error halting Web Service Sender: ${numTasks} request${plural} aborted.`
      );
    }

    this.pendingTasks.clear();
    this.dispatchContainers.clear();
  }

  /**
   * Send SOAP message.
   * CPC-WS-001: Dispatches SENDING before invoke, IDLE in finally.
   * CPC-WS-002: Nuanced error classification matching Java.
   */
  async send(connectorMessage: ConnectorMessage): Promise<void> {
    // CPC-WS-001: Dispatch SENDING event before invoke
    this.dispatchConnectionEvent(ConnectionStatusEventType.SENDING);

    try {
      const dispatcherId = connectorMessage.getMetaDataId();
      let dispatchContainer = this.dispatchContainers.get(dispatcherId);

      if (!dispatchContainer) {
        dispatchContainer = this.createDispatchContainer();
        this.dispatchContainers.set(dispatcherId, dispatchContainer);
      }

      try {
        const response = await this.executeRequest(
          connectorMessage,
          dispatchContainer
        );

        // CPC-WS-008: Extensibility hook for SOAP result processing
        await this.handleSOAPResult(connectorMessage, response);

        // Store response
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: response,
          dataType: 'XML',
          encrypted: false,
        });

        connectorMessage.setSendDate(new Date());

        if (this.properties.oneWay) {
          connectorMessage.setStatus(Status.SENT);
        } else {
          connectorMessage.setStatus(Status.SENT);
        }
      } catch (error) {
        this.handleSendError(connectorMessage, error);
      }
    } finally {
      // CPC-WS-001: Dispatch IDLE event in finally block
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Handle send errors with nuanced classification matching Java.
   * CPC-WS-002:
   * - SOAPFault → Status.ERROR (permanent failure)
   * - Connection refused / NoRouteToHost → Status.QUEUED (retryable)
   * - Other errors → Status.QUEUED (retryable) with error event
   */
  private handleSendError(
    connectorMessage: ConnectorMessage,
    error: unknown
  ): void {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    if (this.isSoapFault(error)) {
      // SOAPFault → ERROR (permanent, matches Java behavior)
      connectorMessage.setStatus(Status.ERROR);
      connectorMessage.setProcessingError(
        `SOAP Fault: ${errorMessage}`
      );

      // Try to extract fault response
      const faultResponse = this.extractFaultResponse(error);
      if (faultResponse) {
        connectorMessage.setContent({
          contentType: ContentType.RESPONSE,
          content: faultResponse,
          dataType: 'XML',
          encrypted: false,
        });
      }
    } else if (this.isConnectionError(error)) {
      // Connection errors → QUEUED (retryable, matches Java behavior)
      // Java: ConnectException → "Connection refused", NoRouteToHostException → "HTTP transport error"
      connectorMessage.setProcessingError(
        `Connection error: ${errorMessage}`
      );
      // Status stays QUEUED (default) for retry
    } else {
      // Other errors → QUEUED for retry
      connectorMessage.setProcessingError(
        `Error invoking web service: ${errorMessage}`
      );
    }
  }

  /**
   * Check if error is a connection-level error (retryable).
   * Matches Java's ConnectException and NoRouteToHostException checks.
   */
  private isConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('connection refused') ||
      msg.includes('ehostunreach') ||
      msg.includes('no route to host') ||
      msg.includes('enetunreach') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      error.name === 'AbortError'
    );
  }

  /**
   * Get response from the last request
   */
  async getResponse(connectorMessage: ConnectorMessage): Promise<string | null> {
    const response = connectorMessage.getContent(ContentType.RESPONSE);
    return response?.content || null;
  }

  /**
   * Extensibility hook called after successful SOAP invocation.
   * CPC-WS-008: Matches Java's protected handleSOAPResult() method.
   * Subclasses can override to process the SOAP result before response storage.
   */
  protected async handleSOAPResult(
    _connectorMessage: ConnectorMessage,
    _result: string
  ): Promise<void> {
    // Default: no-op, matching Java's empty implementation
  }

  /**
   * Create empty dispatch container
   */
  private createDispatchContainer(): DispatchContainer {
    return {
      client: null,
      currentWsdlUrl: null,
      currentUsername: null,
      currentPassword: null,
      currentServiceName: null,
      currentPortName: null,
      parsedWsdl: null,
    };
  }

  /**
   * Execute SOAP request
   */
  private async executeRequest(
    connectorMessage: ConnectorMessage,
    container: DispatchContainer
  ): Promise<string> {
    // Check if we need to create/recreate the client
    await this.ensureClient(container);

    const envelope = this.properties.envelope;

    // Build headers
    const headers = this.buildHttpHeaders();

    // Determine endpoint location
    let endpointLocation = this.properties.locationURI;

    if (!endpointLocation && container.parsedWsdl) {
      endpointLocation =
        getEndpointLocation(
          container.parsedWsdl.definitionMap,
          this.properties.service,
          this.properties.port
        ) || '';
    }

    // Get SOAP action
    let soapAction = this.properties.soapAction;

    if (!soapAction && container.parsedWsdl) {
      soapAction =
        getSoapAction(
          container.parsedWsdl.definitionMap,
          this.properties.service,
          this.properties.port,
          this.properties.operation
        ) || '';
    }

    // Detect SOAP version from envelope
    const soapVersion = detectSoapVersion(envelope);

    // Add SOAP action header
    if (soapAction) {
      if (soapVersion === SoapVersion.SOAP_1_1) {
        headers['SOAPAction'] = `"${soapAction}"`;
      }
      // For SOAP 1.2, action is in Content-Type header
    }

    // Set content type
    headers['Content-Type'] = getSoapContentType(soapVersion, soapAction);

    // Handle MTOM attachments
    const attachments = this.getAttachments(connectorMessage);

    // If using MTOM, we need special handling
    if (this.properties.useMtom && attachments.length > 0) {
      return await this.sendMtomRequest(
        endpointLocation,
        envelope,
        headers,
        attachments
      );
    }

    // Send raw SOAP request
    return await this.sendSoapRequest(
      endpointLocation,
      envelope,
      headers
    );
  }

  /**
   * Ensure SOAP client is created and up-to-date.
   * CPC-WS-005: Dispatch container pooling — only recreates when config changes.
   */
  private async ensureClient(container: DispatchContainer): Promise<void> {
    const needsRecreate =
      container.client === null ||
      container.currentWsdlUrl !== this.properties.wsdlUrl ||
      container.currentUsername !== this.properties.username ||
      container.currentPassword !== this.properties.password ||
      container.currentServiceName !== this.properties.service ||
      container.currentPortName !== this.properties.port;

    if (!needsRecreate) {
      return;
    }

    // Update container state
    container.currentWsdlUrl = this.properties.wsdlUrl;
    container.currentUsername = this.properties.username;
    container.currentPassword = this.properties.password;
    container.currentServiceName = this.properties.service;
    container.currentPortName = this.properties.port;

    // Parse WSDL if URL provided
    if (this.properties.wsdlUrl) {
      try {
        container.parsedWsdl = await parseWsdlFromUrl(
          this.properties.wsdlUrl,
          {
            username: this.properties.username || undefined,
            password: this.properties.password || undefined,
            timeout: this.properties.socketTimeout,
          }
        );

        // Update definition map in properties
        this.properties.wsdlDefinitionMap = container.parsedWsdl.definitionMap;

        // Create SOAP client using soap library
        const clientOptions: soap.IOptions = {
          wsdl_options: {
            timeout: this.properties.socketTimeout,
          },
        };

        if (this.properties.useAuthentication) {
          clientOptions.wsdl_options!.auth = {
            username: this.properties.username,
            password: this.properties.password,
          };
        }

        container.client = await soap.createClientAsync(
          this.properties.wsdlUrl,
          clientOptions
        );

        // Set endpoint if overridden
        if (this.properties.locationURI) {
          container.client.setEndpoint(this.properties.locationURI);
        }

        // Set authentication on client
        if (this.properties.useAuthentication) {
          container.client.setSecurity(
            new soap.BasicAuthSecurity(
              this.properties.username,
              this.properties.password
            )
          );
        }
      } catch (error) {
        // If WSDL parsing fails, we can still try to send raw SOAP
        container.parsedWsdl = null;
        container.client = null;
      }
    }
  }

  /**
   * Build HTTP headers
   */
  private buildHttpHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    // Add custom headers
    if (!this.properties.useHeadersVariable) {
      for (const [key, values] of this.properties.headers) {
        headers[key] = values.join(', ');
      }
    }

    return headers;
  }

  /**
   * Get attachments for the request
   */
  private getAttachments(
    connectorMessage: ConnectorMessage
  ): AttachmentEntry[] {
    if (!this.properties.useMtom) {
      return [];
    }

    if (this.properties.useAttachmentsVariable) {
      // Get attachments from variable
      const connectorMap = connectorMessage.getConnectorMap();
      const attachments = connectorMap.get(
        this.properties.attachmentsVariable
      );

      if (Array.isArray(attachments)) {
        return attachments.filter(
          (a): a is AttachmentEntry =>
            a && typeof a === 'object' && 'name' in a && 'content' in a
        );
      }

      return [];
    }

    return getAttachmentEntries(this.properties);
  }

  /**
   * Send raw SOAP request without using soap library.
   * CPC-WS-004: Implements redirect handling (up to MAX_REDIRECTS).
   * CPC-WS-007: Tracks AbortController in pendingTasks for onHalt.
   */
  private async sendSoapRequest(
    endpoint: string,
    envelope: string,
    headers: Record<string, string>
  ): Promise<string> {
    let currentEndpoint = endpoint;
    let tryCount = 0;
    let redirect = false;

    do {
      redirect = false;
      tryCount++;

      const controller = new AbortController();
      this.pendingTasks.add(controller);
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.properties.socketTimeout
      );

      try {
        const requestInit: RequestInit = {
          method: 'POST',
          headers: { ...headers },
          body: envelope,
          signal: controller.signal,
          // Disable automatic redirects so we can handle them manually (matching Java)
          redirect: 'manual',
        };

        // Add authentication
        if (this.properties.useAuthentication) {
          const credentials = Buffer.from(
            `${this.properties.username}:${this.properties.password}`
          ).toString('base64');
          (requestInit.headers as Record<string, string>)['Authorization'] =
            `Basic ${credentials}`;
        }

        const response = await fetch(currentEndpoint, requestInit);
        clearTimeout(timeoutId);

        // CPC-WS-004: Handle redirects (3xx) — matches Java's redirect loop
        if (
          tryCount < MAX_REDIRECTS &&
          response.status >= 300 &&
          response.status < 400
        ) {
          const location = response.headers.get('Location');
          if (location) {
            redirect = true;
            currentEndpoint = location;
            continue;
          }
        }

        const responseText = await response.text();

        // Check for HTTP errors
        if (!response.ok && response.status >= 400) {
          // Try to parse as SOAP fault
          try {
            const parsed = parseSoapEnvelope(responseText);
            if (parsed.isFault) {
              throw new SoapFaultError(
                parsed.fault?.faultString || 'Unknown SOAP Fault',
                parsed.fault?.faultCode,
                responseText
              );
            }
          } catch (e) {
            if (e instanceof SoapFaultError) throw e;
          }

          throw new Error(
            `HTTP ${response.status}: ${response.statusText}`
          );
        }

        // Handle one-way operations
        if (this.properties.oneWay) {
          return '';
        }

        // Parse and return response body
        try {
          const parsed = parseSoapEnvelope(responseText);
          if (parsed.isFault) {
            throw new SoapFaultError(
              parsed.fault?.faultString || 'Unknown SOAP Fault',
              parsed.fault?.faultCode,
              responseText
            );
          }
          return responseText;
        } catch (e) {
          if (e instanceof SoapFaultError) throw e;
          // If parsing fails, return raw response
          return responseText;
        }
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(
            `Request timeout after ${this.properties.socketTimeout}ms`
          );
        }

        throw error;
      } finally {
        this.pendingTasks.delete(controller);
      }
    } while (redirect && tryCount < MAX_REDIRECTS);

    // Should not reach here, but in case redirect loop exhausted
    throw new Error(`Maximum redirects (${MAX_REDIRECTS}) exceeded`);
  }

  /**
   * Send MTOM request with attachments
   */
  private async sendMtomRequest(
    endpoint: string,
    envelope: string,
    headers: Record<string, string>,
    attachments: AttachmentEntry[]
  ): Promise<string> {
    // Generate boundary
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;

    // Build multipart/related content
    const parts: string[] = [];

    // Add SOAP envelope as first part
    parts.push(`--${boundary}`);
    parts.push('Content-Type: application/xop+xml; charset=utf-8; type="text/xml"');
    parts.push('Content-Transfer-Encoding: binary');
    parts.push('Content-ID: <root.message@cxf.apache.org>');
    parts.push('');
    parts.push(envelope);

    // Add attachments
    for (const attachment of attachments) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${attachment.mimeType}`);
      parts.push('Content-Transfer-Encoding: base64');
      parts.push(`Content-ID: <${attachment.name}>`);
      parts.push('');
      parts.push(attachment.content);
    }

    parts.push(`--${boundary}--`);

    const body = parts.join('\r\n');

    // Set multipart content type
    headers['Content-Type'] =
      `multipart/related; type="application/xop+xml"; start="<root.message@cxf.apache.org>"; start-info="text/xml"; boundary="${boundary}"`;

    return await this.sendSoapRequest(endpoint, body, headers);
  }

  /**
   * Check if error is a SOAP fault
   */
  private isSoapFault(error: unknown): boolean {
    return error instanceof SoapFaultError;
  }

  /**
   * Extract fault response XML from error
   */
  private extractFaultResponse(error: unknown): string | null {
    if (error instanceof SoapFaultError) {
      return error.responseXml ?? null;
    }
    return null;
  }

  /**
   * Get WSDL operations (for UI)
   */
  async getWsdlOperations(): Promise<string[]> {
    if (!this.properties.wsdlUrl) {
      return [];
    }

    const parsedWsdl = await parseWsdlFromUrl(
      this.properties.wsdlUrl,
      {
        username: this.properties.username || undefined,
        password: this.properties.password || undefined,
        timeout: this.properties.socketTimeout,
      }
    );

    this.properties.wsdlDefinitionMap = parsedWsdl.definitionMap;

    const serviceMap = parsedWsdl.definitionMap.map.get(
      this.properties.service
    );

    if (!serviceMap) return [];

    const portInfo = serviceMap.map.get(this.properties.port);

    return portInfo?.operations || [];
  }
}

/**
 * SOAP Fault Error
 */
export class SoapFaultError extends Error {
  readonly faultCode?: string;
  readonly responseXml?: string;

  constructor(
    message: string,
    faultCode?: string,
    responseXml?: string
  ) {
    super(message);
    this.name = 'SoapFaultError';
    this.faultCode = faultCode;
    this.responseXml = responseXml;
  }
}
