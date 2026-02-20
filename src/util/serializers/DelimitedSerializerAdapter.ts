/**
 * Adapter wrapping DelimitedDataType as an IMessageSerializer.
 *
 * The previous factory mapping routed DELIMITED to RawSerializer, which just
 * wrapped data in CDATA without any CSV/pipe/tab parsing. This adapter properly
 * delegates to DelimitedDataType for full delimited-text-to-XML conversion.
 *
 * populateMetaData() is a no-op (matches Java); metadata is only
 * provided via getMetaDataFromMessage() inherited from BaseSerializer.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerBase.js';
import { DelimitedDataType } from '../../datatypes/delimited/DelimitedDataType.js';

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

  override isSerializationRequired(toXml?: boolean): boolean {
    if (toXml === undefined || toXml === true) {
      const p = this.serializationProps as Record<string, unknown>;
      return (
        (p.columnDelimiter !== undefined && p.columnDelimiter !== ',') ||
        (p.recordDelimiter !== undefined && p.recordDelimiter !== '\\n') ||
        p.columnWidths != null ||
        (p.quoteToken !== undefined && p.quoteToken !== '"') ||
        (p.escapeWithDoubleQuote !== undefined && p.escapeWithDoubleQuote !== true) ||
        (p.quoteEscapeToken !== undefined && p.quoteEscapeToken !== '\\\\') ||
        p.columnNames != null ||
        p.numberedRows === true ||
        (p.ignoreCR !== undefined && p.ignoreCR !== true)
      );
    } else {
      const p = this.deserializationProps as Record<string, unknown>;
      return (
        (p.columnDelimiter !== undefined && p.columnDelimiter !== ',') ||
        (p.recordDelimiter !== undefined && p.recordDelimiter !== '\\n') ||
        p.columnWidths != null ||
        (p.quoteToken !== undefined && p.quoteToken !== '"') ||
        (p.escapeWithDoubleQuote !== undefined && p.escapeWithDoubleQuote !== true) ||
        (p.quoteEscapeToken !== undefined && p.quoteEscapeToken !== '\\\\')
      );
    }
  }

  override populateMetaData(_message: string, _map: Map<string, unknown>): void {
    // Java DelimitedSerializer.populateMetaData() is a no-op.
    // Metadata is only provided via getMetaDataFromMessage().
  }
}
