/**
 * DICOM serializer adapter for SerializerFactory integration.
 *
 * Wraps the standalone DICOMSerializer and translates base metadata keys
 * to use the standard mirth_ prefix (mirth_type, mirth_version).
 * DICOM-specific additive keys (sopClassUid, patientName, modality, etc.)
 * are kept as-is since they extend beyond Java's DefaultMetaData.
 */

import {
  BaseSerializer,
  SerializationProperties,
  DeserializationProperties,
} from '../SerializerFactory.js';
import { DICOMSerializer } from '../../datatypes/dicom/DICOMSerializer.js';
import { DICOMDataTypeProperties } from '../../datatypes/dicom/DICOMDataTypeProperties.js';
import {
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../model/DefaultMetaData.js';

export class DICOMSerializerAdapter extends BaseSerializer {
  private readonly delegate: DICOMSerializer;

  constructor(
    serializationProps: SerializationProperties = {},
    deserializationProps: DeserializationProperties = {}
  ) {
    super(serializationProps, deserializationProps);
    this.delegate = new DICOMSerializer(
      deserializationProps as Partial<DICOMDataTypeProperties>
    );
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
   * DICOM requires serialization — binary data must be converted to/from XML.
   */
  isSerializationRequired(): boolean {
    return true;
  }

  /**
   * Extract metadata from a DICOM message (base64-encoded binary).
   *
   * Base keys (type, version) are translated to mirth_ prefix.
   * DICOM-specific keys (sopClassUid, patientName, modality, etc.) are
   * kept as additive metadata that doesn't exist in Java's DefaultMetaData.
   */
  getMetaDataFromMessage(message: string): Record<string, string> {
    const raw = this.delegate.getMetaDataFromMessage(message);
    const result: Record<string, string> = {};

    // Base keys with mirth_ prefix
    result[TYPE_VARIABLE_MAPPING] = raw.type || 'DICOM';
    result[VERSION_VARIABLE_MAPPING] = raw.version || '';

    // DICOM-specific additive keys
    if (raw.sopClassUid) result.sopClassUid = raw.sopClassUid;
    if (raw.sopInstanceUid) result.sopInstanceUid = raw.sopInstanceUid;
    if (raw.patientName) result.patientName = raw.patientName;
    if (raw.patientId) result.patientId = raw.patientId;
    if (raw.studyInstanceUid) result.studyInstanceUid = raw.studyInstanceUid;
    if (raw.seriesInstanceUid) result.seriesInstanceUid = raw.seriesInstanceUid;
    if (raw.modality) result.modality = raw.modality;

    return result;
  }
}
