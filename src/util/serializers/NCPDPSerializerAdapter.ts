/**
 * NCPDP serializer adapter for SerializerFactory integration.
 *
 * Wraps the standalone NCPDPSerializer and translates metadata keys
 * to use the standard mirth_ prefix (mirth_source, mirth_type, mirth_version)
 * matching Java's DefaultMetaData constants.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerFactory.js';
import { NCPDPSerializer } from '../../datatypes/ncpdp/NCPDPSerializer.js';
import {
  NCPDPSerializationProperties,
  NCPDPDeserializationProperties,
} from '../../datatypes/ncpdp/NCPDPProperties.js';
import {
  SOURCE_VARIABLE_MAPPING,
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../model/DefaultMetaData.js';

export class NCPDPSerializerAdapter extends BaseSerializer {
  private readonly delegate: NCPDPSerializer;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);
    this.delegate = new NCPDPSerializer(
      serializationProps as Partial<NCPDPSerializationProperties>,
      deserializationProps as Partial<NCPDPDeserializationProperties>
    );
  }

  getDataType(): string {
    return 'NCPDP';
  }

  toXML(message: string): string {
    return this.delegate.toXML(message);
  }

  fromXML(xml: string): string {
    return this.delegate.fromXML(xml);
  }

  /**
   * NCPDP does not require serialization for the toXML direction.
   * Matches Java: NCPDPSerializer.isSerializationRequired() returns false.
   */
  isSerializationRequired(): boolean {
    return false;
  }

  /**
   * Extract metadata from an NCPDP message, translating keys to mirth_ prefix.
   *
   * The standalone NCPDPSerializer uses plain keys (source, type, version).
   * Java's DefaultMetaData expects mirth_source, mirth_type, mirth_version.
   */
  getMetaDataFromMessage(message: string): Record<string, string> {
    const raw = this.delegate.getMetaDataFromMessage(message);
    const translated: Record<string, string> = {};

    if (raw.source) {
      translated[SOURCE_VARIABLE_MAPPING] = raw.source;
    }
    if (raw.type) {
      translated[TYPE_VARIABLE_MAPPING] = raw.type;
    }
    if (raw.version) {
      translated[VERSION_VARIABLE_MAPPING] = raw.version;
    }

    return translated;
  }
}
