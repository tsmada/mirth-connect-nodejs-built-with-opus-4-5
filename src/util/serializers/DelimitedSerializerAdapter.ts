/**
 * Adapter wrapping DelimitedDataType as an IMessageSerializer.
 *
 * The previous factory mapping routed DELIMITED to RawSerializer, which just
 * wrapped data in CDATA without any CSV/pipe/tab parsing. This adapter properly
 * delegates to DelimitedDataType for full delimited-text-to-XML conversion.
 *
 * Metadata keys use DefaultMetaData constants (mirth_type) for D_MCM compatibility.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerBase.js';
import { DelimitedDataType } from '../../datatypes/delimited/DelimitedDataType.js';
import { TYPE_VARIABLE_MAPPING } from '../../model/DefaultMetaData.js';

export class DelimitedSerializerAdapter extends BaseSerializer {
  private readonly dataType: DelimitedDataType;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);
    this.dataType = new DelimitedDataType({
      serializationProperties: serializationProps,
      deserializationProperties: deserializationProps,
    });
  }

  getDataType(): string {
    return 'DELIMITED';
  }

  toXML(message: string): string {
    return this.dataType.toXML(message);
  }

  fromXML(xml: string): string {
    return this.dataType.fromXML(xml);
  }

  override isSerializationRequired(_toXml?: boolean): boolean {
    return true;
  }

  override populateMetaData(_message: string, map: Map<string, unknown>): void {
    map.set(TYPE_VARIABLE_MAPPING, 'Delimited');
  }
}
