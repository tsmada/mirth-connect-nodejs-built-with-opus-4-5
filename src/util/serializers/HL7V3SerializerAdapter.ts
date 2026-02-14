/**
 * Adapter wrapping HL7V3Serializer as an IMessageSerializer.
 *
 * The standalone HL7V3Serializer.ts defines local constants VERSION_VARIABLE_MAPPING='version'
 * and TYPE_VARIABLE_MAPPING='type'. These are WRONG for D_MCM tables. This adapter uses
 * DefaultMetaData constants ('mirth_version', 'mirth_type') instead.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerFactory.js';
import { HL7V3Serializer } from '../../datatypes/hl7v3/HL7V3Serializer.js';
import {
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../model/DefaultMetaData.js';

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

  override populateMetaData(message: string, map: Map<string, unknown>): void {
    // HL7V3Serializer.getMetaData returns { version, type } with bare keys.
    // We translate to mirth_* keys for D_MCM compatibility.
    const metadata = this.serializer.getMetaData(message);

    if (metadata.version) {
      map.set(VERSION_VARIABLE_MAPPING, metadata.version);
    }
    if (metadata.type) {
      map.set(TYPE_VARIABLE_MAPPING, metadata.type);
    }
  }
}
