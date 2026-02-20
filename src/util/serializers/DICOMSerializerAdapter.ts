/**
 * DICOM serializer adapter for SerializerFactory integration.
 *
 * Wraps the standalone DICOMSerializer for toXML/fromXML delegation.
 * populateMetaData() is a no-op (matches Java); metadata is only
 * provided via getMetaDataFromMessage() inherited from BaseSerializer.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerBase.js';
import { DICOMSerializer } from '../../datatypes/dicom/DICOMSerializer.js';
import { DICOMDataTypeProperties } from '../../datatypes/dicom/DICOMDataTypeProperties.js';

export class DICOMSerializerAdapter extends BaseSerializer {
  private readonly delegate: DICOMSerializer;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);
    this.delegate = new DICOMSerializer(deserializationProps as Partial<DICOMDataTypeProperties>);
  }

  getDataType(): string {
    return 'DICOM';
  }

  toXML(message: string): string {
    return this.delegate.toXML(message);
  }

  fromXML(xml: string): string {
    return this.delegate.fromXML(xml);
  }

  /**
   * Java DICOMSerializer.isSerializationRequired() returns false.
   * DICOM data flows through the pipeline as-is (base64 binary); the
   * toXML/fromXML methods are only called when the pipeline explicitly
   * requests serialization (e.g., for transformer access).
   */
  isSerializationRequired(): boolean {
    return false;
  }

  /**
   * Java DICOMSerializer.populateMetaData() is a no-op.
   * Metadata is only provided via getMetaDataFromMessage().
   */
  populateMetaData(_message: string, _map: Map<string, unknown>): void {
    // no-op — matches Java
  }
}
