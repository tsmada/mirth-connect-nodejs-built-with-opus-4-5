/**
 * XML serializer adapter for the IMessageSerializer interface.
 *
 * Wraps XMLDataType from src/datatypes/xml/XMLDataType.ts and provides
 * IMessageSerializer-compliant metadata extraction with mirth_* keys.
 *
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/xml/XMLSerializer.java
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerBase.js';
import { XMLDataType } from '../../datatypes/xml/XMLDataType.js';

export interface XMLAdapterSerializationProperties extends SerializationProperties {
  stripNamespaces?: boolean;
}

export class XMLSerializerAdapter extends BaseSerializer {
  private readonly xmlDataType: XMLDataType;

  constructor(
    serializationProps: XMLAdapterSerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);

    // SerializerFactory default for XML adapter is stripNamespaces=true
    // (matching Java SerializerFactory behavior), while standalone XMLDataType defaults to false.
    const stripNamespaces = serializationProps.stripNamespaces ?? true;

    this.xmlDataType = new XMLDataType({ stripNamespaces });
  }

  getDataType(): string {
    return 'XML';
  }

  isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  toXML(message: string): string {
    return this.xmlDataType.toXML(message);
  }

  fromXML(xml: string): string {
    return this.xmlDataType.fromXML(xml);
  }

  transformWithoutSerializing(message: string): string | null {
    return this.xmlDataType.transformWithoutSerializing(message);
  }

  populateMetaData(_message: string, _map: Map<string, unknown>): void {
    // Java XMLSerializer.populateMetaData() is a no-op.
    // Metadata is only provided via getMetaDataFromMessage().
  }
}
