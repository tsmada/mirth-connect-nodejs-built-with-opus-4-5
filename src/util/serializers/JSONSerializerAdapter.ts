/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/json/JSONSerializer.java
 *
 * JSON serializer adapter implementing the IMessageSerializer interface.
 *
 * CRITICAL BEHAVIORAL DIFFERENCE from the old inline JSONSerializer:
 * - toXML() returns null (Java JSONSerializer.toXML() returns null)
 * - fromXML() returns null (Java JSONSerializer.fromXML() returns null)
 * - toJSON()/fromJSON() are pass-through (data is already JSON)
 * - isSerializationRequired() returns false (JSON doesn't need XML conversion)
 *
 * The old inline JSONSerializer incorrectly converted JSON to/from XML using
 * fast-xml-parser. Java's JSONSerializer does NOT do XML conversion — it returns null.
 */

import { BaseSerializer } from '../SerializerFactory.js';
import { TYPE_VARIABLE_MAPPING } from '../../model/DefaultMetaData.js';

export class JSONSerializerAdapter extends BaseSerializer {
  getDataType(): string {
    return 'JSON';
  }

  /**
   * Java JSONSerializer.toXML() returns null — JSON data type does not convert to XML.
   */
  toXML(_message: string): null {
    return null;
  }

  /**
   * Java JSONSerializer.fromXML() returns null — JSON data type does not convert from XML.
   */
  fromXML(_xml: string): null {
    return null;
  }

  /**
   * Pass-through: the message is already JSON.
   */
  override toJSON(message: string): string {
    return message;
  }

  /**
   * Pass-through: the json is already in native format.
   */
  override fromJSON(json: string): string {
    return json;
  }

  /**
   * JSON does not require XML serialization.
   */
  override isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }

  /**
   * Populates metadata with type='JSON'.
   */
  override populateMetaData(_message: string, map: Map<string, unknown>): void {
    map.set(TYPE_VARIABLE_MAPPING, 'JSON');
  }
}
