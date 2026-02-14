/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/raw/RawSerializer.java
 *
 * Raw serializer adapter implementing the IMessageSerializer interface.
 *
 * CRITICAL BEHAVIORAL DIFFERENCE from the old inline RawSerializer:
 * - toXML() returns null (Java RawSerializer returns null — NO CDATA wrapping!)
 * - fromXML() returns null (matches Java)
 * - toJSON()/fromJSON() return null (inherited from BaseSerializer)
 * - isSerializationRequired() returns false
 * - getMetaDataFromMessage() returns empty Map (Raw has no metadata)
 *
 * The old inline RawSerializer incorrectly wrapped in <raw><![CDATA[...]]></raw>.
 * Java's RawSerializer.toXML() literally returns null.
 */

import { BaseSerializer } from '../SerializerFactory.js';

export class RawSerializerAdapter extends BaseSerializer {
  getDataType(): string {
    return 'RAW';
  }

  /**
   * Java RawSerializer.toXML() returns null — Raw data type does not convert to XML.
   * The old inline class incorrectly wrapped in CDATA.
   */
  toXML(_message: string): null {
    return null;
  }

  /**
   * Java RawSerializer.fromXML() returns null — Raw data type does not convert from XML.
   */
  fromXML(_xml: string): null {
    return null;
  }

  /**
   * Raw does not require XML serialization.
   */
  override isSerializationRequired(_toXml?: boolean): boolean {
    return false;
  }
}
