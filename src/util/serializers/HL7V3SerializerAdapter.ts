/**
 * Adapter wrapping HL7V3Serializer as an IMessageSerializer.
 *
 * populateMetaData() is a no-op (matches Java); metadata is only
 * provided via getMetaDataFromMessage() inherited from BaseSerializer.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerBase.js';
import { HL7V3Serializer } from '../../datatypes/hl7v3/HL7V3Serializer.js';

export class HL7V3SerializerAdapter extends BaseSerializer {
  private readonly serializer: HL7V3Serializer;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);
    this.serializer = new HL7V3Serializer(serializationProps);
  }

  getDataType(): string {
    return 'HL7V3';
  }

  toXML(message: string): string {
    return this.serializer.toXML(message);
  }

  fromXML(xml: string): string {
    return this.serializer.fromXML(xml);
  }

  override isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  override transformWithoutSerializing(message: string): string | null {
    return this.serializer.transformWithoutSerializing(message);
  }

  override populateMetaData(_message: string, _map: Map<string, unknown>): void {
    // Java HL7V3Serializer.populateMetaData() is a no-op.
    // Metadata is only provided via getMetaDataFromMessage().
  }
}
