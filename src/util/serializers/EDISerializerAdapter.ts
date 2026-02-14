/**
 * Adapter wrapping EDIDataType as an IMessageSerializer.
 *
 * CRITICAL metadata key translation: The standalone EDIDataType.populateMetaData()
 * writes bare keys ('source', 'type', 'version'). The D_MCM tables require
 * 'mirth_source', 'mirth_type', 'mirth_version'. This adapter translates.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerBase.js';
import { EDIDataType } from '../../datatypes/edi/EDIDataType.js';
import {
  SOURCE_VARIABLE_MAPPING,
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../model/DefaultMetaData.js';

export class EDISerializerAdapter extends BaseSerializer {
  private readonly dataType: EDIDataType;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);
    this.dataType = new EDIDataType({
      serializationProperties: serializationProps,
    });
  }

  getDataType(): string {
    return 'EDI/X12';
  }

  toXML(message: string): string {
    return this.dataType.toXML(message);
  }

  fromXML(xml: string): string {
    return this.dataType.fromXML(xml);
  }

  override isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  override transformWithoutSerializing(message: string): string | null {
    return this.dataType.transformWithoutSerializing(message);
  }

  override populateMetaData(message: string, map: Map<string, unknown>): void {
    // EDIDataType.populateMetaData writes bare keys: source, type, version
    const temp: Record<string, unknown> = {};
    this.dataType.populateMetaData(message, temp);

    // Translate to mirth_* keys for D_MCM compatibility
    if (temp['source'] !== undefined) {
      map.set(SOURCE_VARIABLE_MAPPING, temp['source']);
    }
    if (temp['type'] !== undefined) {
      map.set(TYPE_VARIABLE_MAPPING, temp['type']);
    }
    if (temp['version'] !== undefined) {
      map.set(VERSION_VARIABLE_MAPPING, temp['version']);
    }
  }
}
