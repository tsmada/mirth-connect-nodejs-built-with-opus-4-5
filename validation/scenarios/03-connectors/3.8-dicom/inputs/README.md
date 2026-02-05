# DICOM Test Files

This directory should contain test DICOM files for validation.

## Creating a Test DICOM File

You can create a minimal test DICOM file using the `dcmjs` library:

```javascript
const dcmjs = require('dcmjs');

const dataset = {
  PatientID: 'TEST001',
  PatientName: 'Test^Patient',
  StudyInstanceUID: '1.2.3.4.5.6.7.8.9',
  SeriesInstanceUID: '1.2.3.4.5.6.7.8.9.1',
  SOPInstanceUID: '1.2.3.4.5.6.7.8.9.1.1',
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', // CT Image Storage
  Modality: 'CT',
  Rows: 64,
  Columns: 64,
  BitsAllocated: 16,
  BitsStored: 12,
  HighBit: 11,
  PixelRepresentation: 0,
  PhotometricInterpretation: 'MONOCHROME2',
  PixelData: new Uint16Array(64 * 64).buffer
};

// Write to file using dcmjs
```

## Using Existing Test Files

Many DICOM test files are available from:
- https://www.dicomlibrary.com/
- https://www.cancerimagingarchive.net/

For validation, we use a synthetic 64x64 CT image.
