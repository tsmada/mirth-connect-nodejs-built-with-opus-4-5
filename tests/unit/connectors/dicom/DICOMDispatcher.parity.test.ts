/**
 * Parity tests for DICOMDispatcher.replaceConnectorProperties() (CPC-W18-004)
 *
 * Validates that ${variable} placeholders in all 14 DICOM connector properties
 * are resolved from ConnectorMessage maps before each send,
 * matching Java DICOMDispatcher.replaceConnectorProperties() (line 88).
 *
 * Java resolves: host, port, localHost, localPort, applicationEntity,
 * localApplicationEntity, username, passcode, template, keyStore, keyStorePW,
 * trustStore, trustStorePW, keyPW.
 */
import { DICOMDispatcher } from '../../../../src/connectors/dicom/DICOMDispatcher';
import {
  DICOMDispatcherProperties,
  getDefaultDICOMDispatcherProperties,
} from '../../../../src/connectors/dicom/DICOMDispatcherProperties';
import { ConnectorMessage } from '../../../../src/model/ConnectorMessage';
import { Status } from '../../../../src/model/Status';
import { ContentType } from '../../../../src/model/ContentType';
import { GlobalMap, ConfigurationMap, GlobalChannelMapStore } from '../../../../src/javascript/userutil/MirthMap';
import { resetDefaultExecutor } from '../../../../src/javascript/runtime/JavaScriptExecutor';

function createConnectorMessage(overrides?: Partial<{
  channelMap: Record<string, unknown>;
  sourceMap: Record<string, unknown>;
  connectorMap: Record<string, unknown>;
  encodedContent: string;
  rawData: string;
}>): ConnectorMessage {
  const msg = new ConnectorMessage({
    messageId: 1,
    metaDataId: 1,
    channelId: 'test-channel',
    channelName: 'Test Channel',
    connectorName: 'DICOM Sender',
    serverId: 'server-1',
    receivedDate: new Date(),
    status: Status.RECEIVED,
  });

  if (overrides?.channelMap) {
    for (const [k, v] of Object.entries(overrides.channelMap)) {
      msg.getChannelMap().set(k, v);
    }
  }
  if (overrides?.sourceMap) {
    for (const [k, v] of Object.entries(overrides.sourceMap)) {
      msg.getSourceMap().set(k, v);
    }
  }
  if (overrides?.connectorMap) {
    for (const [k, v] of Object.entries(overrides.connectorMap)) {
      msg.getConnectorMap().set(k, v);
    }
  }
  if (overrides?.encodedContent) {
    msg.setContent({
      contentType: ContentType.ENCODED,
      content: overrides.encodedContent,
      dataType: 'DICOM',
      encrypted: false,
    });
  }
  if (overrides?.rawData) {
    msg.setRawData(overrides.rawData);
  }

  return msg;
}

describe('DICOMDispatcher replaceConnectorProperties (CPC-W18-004)', () => {
  let dispatcher: DICOMDispatcher;

  beforeEach(() => {
    GlobalMap.resetInstance();
    ConfigurationMap.resetInstance();
    GlobalChannelMapStore.resetInstance();
    resetDefaultExecutor();

    dispatcher = new DICOMDispatcher({
      name: 'Test DICOM Sender',
      metaDataId: 1,
    });
  });

  describe('resolveVariables - map lookup order', () => {
    it('should resolve ${var} from channelMap', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
      };

      const msg = createConnectorMessage({
        channelMap: { dicomHost: '192.168.1.100' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('192.168.1.100');
    });

    it('should resolve ${var} from sourceMap when not in channelMap', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
      };

      const msg = createConnectorMessage({
        sourceMap: { dicomHost: '10.0.0.5' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('10.0.0.5');
    });

    it('should resolve ${var} from connectorMap when not in channelMap or sourceMap', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
      };

      const msg = createConnectorMessage({
        connectorMap: { dicomHost: '172.16.0.1' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('172.16.0.1');
    });

    it('should prefer channelMap over sourceMap', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
      };

      const msg = createConnectorMessage({
        channelMap: { dicomHost: 'channel-host' },
        sourceMap: { dicomHost: 'source-host' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('channel-host');
    });

    it('should leave unresolved variables as-is', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${unknownVar}',
      };

      const msg = createConnectorMessage();

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('${unknownVar}');
    });

    it('should handle templates with no variables (passthrough)', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '192.168.1.1',
      };

      const msg = createConnectorMessage();

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('192.168.1.1');
    });

    it('should handle empty string (passthrough)', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        username: '',
      };

      const msg = createConnectorMessage();

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.username).toBe('');
    });
  });

  describe('resolveVariables - built-in message variables', () => {
    it('should resolve ${message.encodedData} from encoded content', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        template: '${message.encodedData}',
      };

      const msg = createConnectorMessage({
        encodedContent: 'DICOM_BASE64_DATA',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.template).toBe('DICOM_BASE64_DATA');
    });

    it('should resolve ${message.rawData} from raw data', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        template: '${message.rawData}',
      };

      const msg = createConnectorMessage({
        rawData: 'RAW_DICOM_DATA',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.template).toBe('RAW_DICOM_DATA');
    });

    it('should fall back to rawData when encodedContent is missing for ${message.encodedData}', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        template: '${message.encodedData}',
      };

      const msg = createConnectorMessage({
        rawData: 'FALLBACK_RAW',
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.template).toBe('FALLBACK_RAW');
    });
  });

  describe('all 14 properties resolved', () => {
    it('should resolve host from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), host: '${h}' };
      const msg = createConnectorMessage({ channelMap: { h: 'dicom.example.com' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).host).toBe('dicom.example.com');
    });

    it('should resolve port from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), port: '${p}' };
      const msg = createConnectorMessage({ channelMap: { p: '11112' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).port).toBe('11112');
    });

    it('should resolve localHost from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), localHost: '${lh}' };
      const msg = createConnectorMessage({ channelMap: { lh: '0.0.0.0' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).localHost).toBe('0.0.0.0');
    });

    it('should resolve localPort from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), localPort: '${lp}' };
      const msg = createConnectorMessage({ channelMap: { lp: '5000' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).localPort).toBe('5000');
    });

    it('should resolve applicationEntity from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), applicationEntity: '${ae}' };
      const msg = createConnectorMessage({ channelMap: { ae: 'PACS_SCP' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).applicationEntity).toBe('PACS_SCP');
    });

    it('should resolve localApplicationEntity from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), localApplicationEntity: '${lae}' };
      const msg = createConnectorMessage({ channelMap: { lae: 'MIRTH_SCU' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).localApplicationEntity).toBe('MIRTH_SCU');
    });

    it('should resolve username from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), username: '${user}' };
      const msg = createConnectorMessage({ channelMap: { user: 'dicom_admin' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).username).toBe('dicom_admin');
    });

    it('should resolve passcode from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), passcode: '${pass}' };
      const msg = createConnectorMessage({ channelMap: { pass: 'secret123' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).passcode).toBe('secret123');
    });

    it('should resolve template from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), template: '${tmpl}' };
      const msg = createConnectorMessage({ channelMap: { tmpl: 'DICOM_BINARY' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).template).toBe('DICOM_BINARY');
    });

    it('should resolve keyStore from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), keyStore: '${ks}' };
      const msg = createConnectorMessage({ channelMap: { ks: '/etc/ssl/keystore.p12' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).keyStore).toBe('/etc/ssl/keystore.p12');
    });

    it('should resolve keyStorePW from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), keyStorePW: '${ksPw}' };
      const msg = createConnectorMessage({ channelMap: { ksPw: 'changeit' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).keyStorePW).toBe('changeit');
    });

    it('should resolve trustStore from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), trustStore: '${ts}' };
      const msg = createConnectorMessage({ channelMap: { ts: '/etc/ssl/truststore.jks' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).trustStore).toBe('/etc/ssl/truststore.jks');
    });

    it('should resolve trustStorePW from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), trustStorePW: '${tsPw}' };
      const msg = createConnectorMessage({ channelMap: { tsPw: 'trustpw' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).trustStorePW).toBe('trustpw');
    });

    it('should resolve keyPW from variable', () => {
      const props = { ...getDefaultDICOMDispatcherProperties(), keyPW: '${kpw}' };
      const msg = createConnectorMessage({ channelMap: { kpw: 'keypassword' } });
      expect(dispatcher.replaceConnectorProperties(props, msg).keyPW).toBe('keypassword');
    });
  });

  describe('replaceConnectorProperties - integration', () => {
    it('should resolve all 14 properties at once', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
        port: '${dicomPort}',
        localHost: '${bindAddr}',
        localPort: '${bindPort}',
        applicationEntity: '${remoteAE}',
        localApplicationEntity: '${localAE}',
        username: '${dicomUser}',
        passcode: '${dicomPass}',
        template: '${dicomPayload}',
        keyStore: '${ksPath}',
        keyStorePW: '${ksPw}',
        trustStore: '${tsPath}',
        trustStorePW: '${tsPw}',
        keyPW: '${keyPw}',
      };

      const msg = createConnectorMessage({
        channelMap: {
          dicomHost: 'pacs.hospital.org',
          dicomPort: '11112',
          bindAddr: '10.0.0.1',
          bindPort: '5104',
          remoteAE: 'PACS_ARCHIVE',
          localAE: 'MIRTH_SCU',
          dicomUser: 'admin',
          dicomPass: 'secret',
          dicomPayload: 'BASE64_DICOM_DATA',
          ksPath: '/opt/certs/keystore.p12',
          ksPw: 'keystorepw',
          tsPath: '/opt/certs/truststore.jks',
          tsPw: 'truststorepw',
          keyPw: 'privatekeypw',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      expect(resolved.host).toBe('pacs.hospital.org');
      expect(resolved.port).toBe('11112');
      expect(resolved.localHost).toBe('10.0.0.1');
      expect(resolved.localPort).toBe('5104');
      expect(resolved.applicationEntity).toBe('PACS_ARCHIVE');
      expect(resolved.localApplicationEntity).toBe('MIRTH_SCU');
      expect(resolved.username).toBe('admin');
      expect(resolved.passcode).toBe('secret');
      expect(resolved.template).toBe('BASE64_DICOM_DATA');
      expect(resolved.keyStore).toBe('/opt/certs/keystore.p12');
      expect(resolved.keyStorePW).toBe('keystorepw');
      expect(resolved.trustStore).toBe('/opt/certs/truststore.jks');
      expect(resolved.trustStorePW).toBe('truststorepw');
      expect(resolved.keyPW).toBe('privatekeypw');
    });

    it('should not modify original properties object', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
        port: '${dicomPort}',
        applicationEntity: '${ae}',
        template: '${tmpl}',
      };

      const originalHost = props.host;
      const originalPort = props.port;
      const originalAE = props.applicationEntity;
      const originalTemplate = props.template;

      const msg = createConnectorMessage({
        channelMap: {
          dicomHost: 'resolved.host',
          dicomPort: '11112',
          ae: 'RESOLVED_AE',
          tmpl: 'RESOLVED_DATA',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);

      // Resolved should have new values
      expect(resolved.host).toBe('resolved.host');
      expect(resolved.port).toBe('11112');
      expect(resolved.applicationEntity).toBe('RESOLVED_AE');
      expect(resolved.template).toBe('RESOLVED_DATA');

      // Original should be unchanged
      expect(props.host).toBe(originalHost);
      expect(props.port).toBe(originalPort);
      expect(props.applicationEntity).toBe(originalAE);
      expect(props.template).toBe(originalTemplate);
    });

    it('should resolve multiple variables in a single property', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        template: 'Patient: ${firstName} ${lastName} MRN: ${mrn}',
      };

      const msg = createConnectorMessage({
        channelMap: {
          firstName: 'Jane',
          lastName: 'Smith',
          mrn: '12345',
        },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.template).toBe('Patient: Jane Smith MRN: 12345');
    });

    it('should not touch non-resolved properties', () => {
      const props: DICOMDispatcherProperties = {
        ...getDefaultDICOMDispatcherProperties(),
        host: '${dicomHost}',
        // These should remain unchanged
        stgcmt: true,
        pdv1: true,
        tcpDelay: false,
        priority: 'high',
      };

      const msg = createConnectorMessage({
        channelMap: { dicomHost: 'resolved.host' },
      });

      const resolved = dispatcher.replaceConnectorProperties(props, msg);
      expect(resolved.host).toBe('resolved.host');
      expect(resolved.stgcmt).toBe(true);
      expect(resolved.pdv1).toBe(true);
      expect(resolved.tcpDelay).toBe(false);
      expect(resolved.priority).toBe('high');
    });
  });
});
