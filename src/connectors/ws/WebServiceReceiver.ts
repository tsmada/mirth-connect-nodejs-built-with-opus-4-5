/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/ws/WebServiceReceiver.java
 *
 * Purpose: WebService (SOAP) source connector that receives SOAP messages
 *
 * Key behaviors to replicate:
 * - Host SOAP endpoint using Express
 * - Parse incoming SOAP requests
 * - Route to channel for processing
 * - Return SOAP response
 * - Support authentication
 * - Connection status event dispatching (IDLE/RECEIVING)
 * - onUndeploy cleanup hook
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { SourceConnector } from '../../donkey/channel/SourceConnector.js';
import { ListenerInfo } from '../../api/models/DashboardStatus.js';
import { ConnectionStatusEventType } from '../../plugins/dashboardstatus/ConnectionLogItem.js';
import {
  WebServiceReceiverProperties,
  getDefaultWebServiceReceiverProperties,
  getServicePath,
  SoapBinding,
} from './WebServiceReceiverProperties.js';
import {
  parseSoapEnvelope,
  buildSoapEnvelope,
  buildSoapFaultEnvelope,
  SoapVersion,
  getSoapContentType,
  detectSoapVersion,
} from './SoapBuilder.js';

export interface WebServiceReceiverConfig {
  name?: string;
  waitForDestinations?: boolean;
  queueSendFirst?: boolean;
  properties?: Partial<WebServiceReceiverProperties>;
}

/**
 * Request context for SOAP processing
 */
interface SoapRequestContext {
  /** Remote client address */
  remoteAddress: string;
  /** Remote client port */
  remotePort: number;
  /** Local server address */
  localAddress: string;
  /** Local server port */
  localPort: number;
  /** HTTP headers */
  headers: Record<string, string | string[] | undefined>;
  /** SOAP action from header */
  soapAction?: string;
  /** Content type */
  contentType?: string;
}

/**
 * WebService (SOAP) Source Connector
 */
export class WebServiceReceiver extends SourceConnector {
  private properties: WebServiceReceiverProperties;
  private app: Express | null = null;
  private server: HttpServer | null = null;
  private processingCount = 0;

  constructor(config: WebServiceReceiverConfig) {
    super({
      name: config.name ?? 'Web Service Listener',
      transportName: 'WS',
      waitForDestinations: config.waitForDestinations,
      queueSendFirst: config.queueSendFirst,
    });

    this.properties = {
      ...getDefaultWebServiceReceiverProperties(),
      ...config.properties,
    };
  }

  /**
   * Get connector properties
   */
  getProperties(): WebServiceReceiverProperties {
    return this.properties;
  }

  /**
   * Set/update connector properties
   */
  setProperties(properties: Partial<WebServiceReceiverProperties>): void {
    this.properties = { ...this.properties, ...properties };
  }

  /**
   * Start the SOAP endpoint.
   * CPC-WS-003: Dispatches IDLE event after server starts (matching Java's onStart).
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.app = express();

    // Parse raw body
    this.app.use(
      express.raw({
        type: ['text/xml', 'application/soap+xml', 'application/xml'],
        limit: '50mb',
      })
    );

    // Also support text parsing
    this.app.use(
      express.text({
        type: ['text/xml', 'application/soap+xml', 'application/xml'],
        limit: '50mb',
      })
    );

    // Setup authentication if configured
    if (
      this.properties.authProperties &&
      this.properties.authProperties.authType !== 'NONE'
    ) {
      this.app.use(
        getServicePath(this.properties),
        this.createAuthMiddleware()
      );
    }

    // Setup SOAP endpoint
    const servicePath = getServicePath(this.properties);

    // Handle WSDL requests (GET with ?wsdl)
    this.app.get(servicePath, (req: Request, res: Response) => {
      if (
        req.query.wsdl !== undefined ||
        req.query.WSDL !== undefined
      ) {
        res.type('text/xml');
        res.send(this.generateWsdl());
      } else {
        res.status(405).send('Method Not Allowed');
      }
    });

    // Handle SOAP requests (POST)
    this.app.post(
      servicePath,
      async (req: Request, res: Response) => {
        await this.handleSoapRequest(req, res);
      }
    );

    // Create and start server
    this.server = createServer(this.app);

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(
        this.properties.port,
        this.properties.host,
        () => {
          this.running = true;
          resolve();
        }
      );

      this.server!.on('error', reject);
    });

    // CPC-WS-003: Dispatch IDLE event after server starts — matches Java's onStart
    this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
  }

  /**
   * Stop the SOAP endpoint
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.running = false;
          this.app = null;
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Called on halt (forced stop). Delegates to stop().
   * Matches Java's onHalt which just calls onStop.
   */
  async halt(): Promise<void> {
    await this.stop();
  }

  /**
   * CPC-WS-006: Undeploy cleanup hook.
   * Matches Java's onUndeploy which calls configuration.configureConnectorUndeploy(this).
   * In the Node.js port, this ensures the server is stopped and resources are freed.
   */
  async onUndeploy(): Promise<void> {
    if (this.running) {
      await this.stop();
    }
    this.app = null;
    this.server = null;
  }

  /**
   * Handle incoming SOAP request.
   * CPC-MCE-006: Dispatches CONNECTED on arrival, RECEIVING during parse, IDLE in finally.
   * CPC-WS-003: Event lifecycle matches Java's WebServiceReceiver.
   */
  private async handleSoapRequest(
    req: Request,
    res: Response
  ): Promise<void> {
    this.processingCount++;

    // CPC-MCE-006: Dispatch CONNECTED when a new SOAP request arrives
    this.dispatchConnectionEvent(ConnectionStatusEventType.CONNECTED);

    // CPC-WS-003: Dispatch RECEIVING event during body parsing
    this.dispatchConnectionEvent(ConnectionStatusEventType.RECEIVING);

    try {
      // Get request body as string
      let soapRequest: string;

      if (Buffer.isBuffer(req.body)) {
        soapRequest = req.body.toString('utf-8');
      } else if (typeof req.body === 'string') {
        soapRequest = req.body;
      } else {
        res.status(400);
        res.type('text/xml');
        res.send(
          this.buildFaultResponse(
            'Client',
            'Invalid request body',
            SoapVersion.SOAP_1_1
          )
        );
        return;
      }

      // Build request context
      const context: SoapRequestContext = {
        remoteAddress: req.ip || req.socket.remoteAddress || '',
        remotePort: req.socket.remotePort || 0,
        localAddress: req.socket.localAddress || '',
        localPort: req.socket.localPort || this.properties.port,
        headers: req.headers as Record<string, string | string[] | undefined>,
        soapAction: this.extractSoapAction(req),
        contentType: req.headers['content-type'],
      };

      // Detect SOAP version
      const soapVersion = detectSoapVersion(soapRequest);

      // Parse SOAP envelope
      let parsedEnvelope;
      try {
        parsedEnvelope = parseSoapEnvelope(soapRequest);
      } catch (parseError) {
        res.status(400);
        res.type('text/xml');
        res.send(
          this.buildFaultResponse(
            'Client',
            `Invalid SOAP envelope: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            soapVersion
          )
        );
        return;
      }

      // Build source map with SOAP context
      const sourceMap = new Map<string, unknown>([
        ['remoteAddress', context.remoteAddress],
        ['remotePort', context.remotePort],
        ['localAddress', context.localAddress],
        ['localPort', context.localPort],
        ['headers', context.headers],
        ['soapAction', context.soapAction],
        ['contentType', context.contentType],
        ['soapVersion', soapVersion],
        ['soapBody', parsedEnvelope.body],
        ['soapHeaders', parsedEnvelope.headers],
      ]);

      // Process message through channel
      const response = await this.processMessage(soapRequest, sourceMap);

      // Build SOAP response
      if (response) {
        res.status(200);
        res.type(getSoapContentType(soapVersion));

        // Check if response is already a SOAP envelope
        if (response.includes('Envelope')) {
          res.send(response);
        } else {
          // Wrap in SOAP envelope
          const envelope = buildSoapEnvelope(response, {
            version: soapVersion,
          });
          res.send(envelope);
        }
      } else {
        // No response (one-way)
        res.status(202).send();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      res.status(500);
      res.type('text/xml');
      res.send(
        this.buildFaultResponse(
          'Server',
          `Internal Server Error: ${errorMessage}`,
          SoapVersion.SOAP_1_1
        )
      );
    } finally {
      this.processingCount--;
      // CPC-WS-003: Dispatch IDLE event after processing completes
      this.dispatchConnectionEvent(ConnectionStatusEventType.IDLE);
    }
  }

  /**
   * Process message through channel
   */
  private async processMessage(
    rawData: string,
    sourceMap: Map<string, unknown>
  ): Promise<string | null> {
    if (!this.channel) {
      throw new Error('Channel not set');
    }

    // Dispatch raw message to channel
    const message = await this.channel.dispatchRawMessage(rawData, sourceMap);

    // Get the source connector message response
    const sourceConnectorMessage = message.getConnectorMessages().get(0);
    if (sourceConnectorMessage) {
      const responseContent = sourceConnectorMessage.getResponseContent();
      if (responseContent) {
        return responseContent.content;
      }
    }

    return null;
  }

  /**
   * Extract SOAP action from request
   */
  private extractSoapAction(req: Request): string | undefined {
    // SOAP 1.1: SOAPAction header
    const soapActionHeader = req.headers['soapaction'];
    if (soapActionHeader) {
      // Remove quotes if present
      return String(soapActionHeader).replace(/^"|"$/g, '');
    }

    // SOAP 1.2: action parameter in Content-Type
    const contentType = req.headers['content-type'];
    if (contentType) {
      const match = contentType.match(/action="([^"]+)"/);
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  /**
   * Build SOAP fault response
   */
  private buildFaultResponse(
    faultCode: string,
    faultString: string,
    version: SoapVersion
  ): string {
    return buildSoapFaultEnvelope(
      {
        faultCode,
        faultString,
      },
      { version }
    );
  }

  /**
   * Generate basic WSDL
   */
  private generateWsdl(): string {
    const serviceName = this.properties.serviceName;
    const host = this.properties.host === '0.0.0.0' ? 'localhost' : this.properties.host;
    const port = this.properties.port;
    const servicePath = getServicePath(this.properties);
    const location = `http://${host}:${port}${servicePath}`;

    // Determine binding based on soapBinding property
    // Note: getSoapBindingValue could be used for more advanced WSDL generation
    const soapNs =
      this.properties.soapBinding === SoapBinding.SOAP12HTTP
        ? 'http://schemas.xmlsoap.org/wsdl/soap12/'
        : 'http://schemas.xmlsoap.org/wsdl/soap/';

    return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns:soap12="${soapNs}"
             xmlns:tns="http://ws.connectors.connect.mirth.com/"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             targetNamespace="http://ws.connectors.connect.mirth.com/"
             name="${serviceName}">

  <types>
    <xsd:schema>
      <xsd:element name="acceptMessage" type="xsd:string"/>
      <xsd:element name="acceptMessageResponse" type="xsd:string"/>
    </xsd:schema>
  </types>

  <message name="acceptMessageRequest">
    <part name="parameters" element="tns:acceptMessage"/>
  </message>

  <message name="acceptMessageResponse">
    <part name="parameters" element="tns:acceptMessageResponse"/>
  </message>

  <portType name="${serviceName}PortType">
    <operation name="acceptMessage">
      <input message="tns:acceptMessageRequest"/>
      <output message="tns:acceptMessageResponse"/>
    </operation>
  </portType>

  <binding name="${serviceName}Binding" type="tns:${serviceName}PortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="acceptMessage">
      <soap:operation soapAction="acceptMessage"/>
      <input>
        <soap:body use="literal"/>
      </input>
      <output>
        <soap:body use="literal"/>
      </output>
    </operation>
  </binding>

  <service name="${serviceName}">
    <port name="${serviceName}Port" binding="tns:${serviceName}Binding">
      <soap:address location="${location}"/>
    </port>
  </service>

</definitions>`;
  }

  /**
   * Create authentication middleware
   */
  private createAuthMiddleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const authProps = this.properties.authProperties;

      if (!authProps || authProps.authType === 'NONE') {
        next();
        return;
      }

      if (authProps.authType === 'BASIC') {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Basic ')) {
          res.setHeader(
            'WWW-Authenticate',
            `Basic realm="${authProps.realm || 'WebService'}"`
          );
          res.status(401);
          res.type('text/xml');
          res.send(
            this.buildFaultResponse(
              'Client.Authentication',
              'Authentication required',
              SoapVersion.SOAP_1_1
            )
          );
          return;
        }

        try {
          const base64Credentials = authHeader.substring(6);
          const credentials = Buffer.from(
            base64Credentials,
            'base64'
          ).toString('utf-8');
          const [username, password] = credentials.split(':');

          if (authProps.credentials) {
            const expectedPassword = authProps.credentials.get(
              username || ''
            );

            if (expectedPassword !== undefined && expectedPassword === password) {
              next();
              return;
            }
          }
        } catch {
          // Fall through to unauthorized
        }

        res.setHeader(
          'WWW-Authenticate',
          `Basic realm="${authProps.realm || 'WebService'}"`
        );
        res.status(401);
        res.type('text/xml');
        res.send(
          this.buildFaultResponse(
            'Client.Authentication',
            'Invalid credentials',
            SoapVersion.SOAP_1_1
          )
        );
        return;
      }

      // Unsupported auth type
      next();
    };
  }

  /**
   * Get the endpoint URL
   */
  getEndpointUrl(): string {
    const host =
      this.properties.host === '0.0.0.0'
        ? 'localhost'
        : this.properties.host;
    return `http://${host}:${this.properties.port}${getServicePath(this.properties)}`;
  }

  /**
   * Get the WSDL URL
   */
  getWsdlUrl(): string {
    return `${this.getEndpointUrl()}?wsdl`;
  }

  /**
   * Get listener information for dashboard display.
   * Returns null if the connector is not running.
   */
  getListenerInfo(): ListenerInfo | null {
    if (!this.running || !this.server) {
      return null;
    }

    return {
      port: this.properties.port,
      host: this.properties.host || '0.0.0.0',
      connectionCount: this.processingCount, // Number of requests being processed
      maxConnections: 0,  // No limit by default
      transportType: 'WS',
      listening: this.server.listening,
    };
  }
}
