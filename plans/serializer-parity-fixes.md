<!-- Completed: 2026-02-14 | Status: Implemented -->
# Serializer Parity Fixes

## Context

The `serializer-parity-checker` agent scanned all 9 data type serializers against Java Mirth and found **38 findings** (10 critical, 15 major, 13 minor). The most impactful issues:

1. **5 data types not registered in SerializerFactory** — `getSerializer('EDI/X12')` returns null, crashing channels on deploy
2. **All 8 data types with metadata extraction use wrong key names** — `source` instead of Java's `mirth_source`, causing silent D_MCM custom metadata corruption in takeover mode
3. **IMessageSerializer interface missing 5 of 8 Java methods** — `toJSON`, `fromJSON`, `populateMetaData`, `isSerializationRequired`, `transformWithoutSerializing`
4. **Raw/JSON `toXML()` returns content instead of null** — Java Raw/JSON serializers return null from `toXML()`

### Strategy: Adapter-Based Unification

The `SerializerFactory` currently has inline serializer classes that duplicate (less completely) the standalone implementations in `src/datatypes/`. The fix: **replace inline classes with adapter classes** that delegate to the standalone implementations. The standalone classes are more complete, better tested (14 test suites), and closer to Java behavior.

### False Positive Findings (2)

- **SPC-BAG-001** (HL7v2 batch adaptor): Already exists at `src/donkey/message/HL7BatchAdaptor.ts`
- **SPC-MED-006** (HL7v3 metadata keys): Marked minor but actually needs the same `mirth_` prefix fix as all others

### Adjusted Counts: 36 real findings (10 critical, 14 major, 12 minor)

---

## Wave 0: Interface + Constants Foundation

**Sequential, single agent. Must complete before Wave 1.**

### New Files

| File | Purpose |
|------|---------|
| `src/model/DefaultMetaData.ts` | Constants matching Java `DefaultMetaData.java`: `SOURCE_VARIABLE_MAPPING = 'mirth_source'`, `TYPE_VARIABLE_MAPPING = 'mirth_type'`, `VERSION_VARIABLE_MAPPING = 'mirth_version'` |

### Modified Files

| File | Changes |
|------|---------|
| `src/util/SerializerFactory.ts` | Expand `IMessageSerializer` interface to add 5 methods: `toJSON`, `fromJSON`, `isSerializationRequired`, `transformWithoutSerializing`, `populateMetaData`, `getMetaDataFromMessage`. Add optional methods with default implementations to `BaseSerializer` |
| `src/model/index.ts` | Re-export `DefaultMetaData` |

### Findings Addressed

SPC-MSM-001 (critical: interface missing 5 methods)

---

## Wave 1: Factory Registration + Adapter Classes (Parallel, 4 agents)

**Create adapters wrapping standalone datatypes, register in factory.**

### Agent 1: HL7v2 + XML Adapters

Branch: `fix/serializer-parity-hl7v2-xml`

| File | Action |
|------|--------|
| `src/util/serializers/HL7v2SerializerAdapter.ts` | NEW — Wraps `HL7v2Parser`/`HL7v2Serializer`/`extractMetaData()`. Keys: `mirth_source`, `mirth_type`, `mirth_version` |
| `src/util/serializers/XMLSerializerAdapter.ts` | NEW — Wraps `XMLDataType`. `getMetaDataFromMessage` returns `{mirth_version: "1.0", mirth_type: "XML-Message"}` |
| `tests/unit/util/serializers/HL7v2SerializerAdapter.test.ts` | NEW |
| `tests/unit/util/serializers/XMLSerializerAdapter.test.ts` | NEW |

Findings: SPC-MED-001 (critical), SPC-MED-002 (major), SPC-MSM-002 (major), SPC-PDM-001 (major), SPC-MSP-001 (minor)

**Key detail:** `stripNamespaces` defaults to `true` in adapter (matching Java), not `false` (standalone default).

### Agent 2: JSON + Raw Adapters

Branch: `fix/serializer-parity-json-raw`

| File | Action |
|------|--------|
| `src/util/serializers/JSONSerializerAdapter.ts` | NEW — `toXML()`/`fromXML()` return **null** (matches Java). `toJSON()`/`fromJSON()` are pass-through. `isSerializationRequired()` returns `false`. Metadata: `{mirth_type: "JSON"}` |
| `src/util/serializers/RawSerializerAdapter.ts` | NEW — `toXML()`/`fromXML()` return **null** (matches Java, no CDATA wrapping). `isSerializationRequired()` returns `false` |
| `tests/unit/util/serializers/JSONSerializerAdapter.test.ts` | NEW |
| `tests/unit/util/serializers/RawSerializerAdapter.test.ts` | NEW |

Findings: SPC-RTF-002 (critical), SPC-FRG-002 (major), SPC-MSM-003 (major), SPC-MED-003 (major)

### Agent 3: Delimited + EDI + HL7v3 Adapters

Branch: `fix/serializer-parity-del-edi-hl7v3`

| File | Action |
|------|--------|
| `src/util/serializers/DelimitedSerializerAdapter.ts` | NEW — Wraps `DelimitedDataType` (full CSV/pipe/tab parsing, NOT RawSerializer) |
| `src/util/serializers/EDISerializerAdapter.ts` | NEW — Wraps `EDIDataType`. Metadata keys: `mirth_source`, `mirth_type`, `mirth_version` |
| `src/util/serializers/HL7V3SerializerAdapter.ts` | NEW — Wraps `HL7V3Serializer`. Metadata keys: `mirth_type`, `mirth_version` |
| `tests/unit/util/serializers/` | NEW — 3 test files |

Findings: SPC-FRG-001 (critical), SPC-FRG-003 (critical), SPC-FRG-004 (critical), SPC-MED-005 (critical), SPC-MED-006 (minor, escalated)

**Key detail for HL7v3:** The standalone `HL7V3Serializer.ts` defines `VERSION_VARIABLE_MAPPING = 'version'` and `TYPE_VARIABLE_MAPPING = 'type'` at lines 34-35. The adapter must use `DefaultMetaData.VERSION_VARIABLE_MAPPING` (`mirth_version`) instead.

### Agent 4: NCPDP + DICOM Adapters

Branch: `fix/serializer-parity-ncpdp-dicom`

| File | Action |
|------|--------|
| `src/util/serializers/NCPDPSerializerAdapter.ts` | NEW — Wraps `NCPDPSerializer`. Metadata keys: `mirth_source`, `mirth_type`, `mirth_version`. Adds `useStrictValidation` property |
| `src/util/serializers/DICOMSerializerAdapter.ts` | NEW — Wraps `DICOMSerializer`. Base metadata keys use `mirth_` prefix; keeps extra DICOM-specific keys (sopClassUid, patientName, etc.) as additive |
| `tests/unit/util/serializers/` | NEW — 2 test files |

Findings: SPC-FRG-005 (critical), SPC-FRG-006 (critical), SPC-MED-007 (critical), SPC-MED-008 (major), SPC-MSP-002 (major)

### Post-Merge: Team Lead updates SerializerFactory

| File | Changes |
|------|---------|
| `src/util/SerializerFactory.ts` | Remove inline classes (HL7v2Serializer, XMLSerializer, JSONSerializer, RawSerializer ~370 lines). Import 9 adapters. Update `dataTypes` Map to 9 entries. Add `getDefaultSerializationProperties`/`getDefaultDeserializationProperties` cases for EDI/X12, HL7V3, NCPDP, DICOM |
| `src/util/serializers/index.ts` | NEW — barrel export |
| `tests/unit/util/SerializerFactory.test.ts` | Update: test all 9 types, verify `mirth_` metadata keys, verify Raw/JSON `toXML` returns null |

---

## Wave 2: Response Validation + EDI Batch + Minor Gaps (Parallel, 2 agents)

### Agent 1: HL7v2 Response Validator

Branch: `fix/serializer-parity-hl7v2-response`

| File | Action |
|------|--------|
| `src/datatypes/hl7v2/HL7v2ResponseValidator.ts` | NEW — Implements `ResponseValidator` interface from `src/donkey/message/ResponseValidator.ts`. Validates ACK code (AA/AE/AR), optionally validates MSA-2 message control ID |
| `src/datatypes/hl7v2/HL7v2ResponseValidationProperties.ts` | NEW — 6 properties: successfulACKCode, errorACKCode, rejectedACKCode, validateMessageControlId, originalMessageControlId, originalIdMapVariable |
| `tests/unit/datatypes/hl7v2/HL7v2ResponseValidator.test.ts` | NEW |

Findings: SPC-RGG-001 (major), SPC-RGG-002 (major), SPC-RVP-001 (major)

**Note:** Wiring into ChannelBuilder (replacing `DefaultResponseValidator` for HL7v2 channels) is a separate pipeline task — this wave creates the implementation.

### Agent 2: EDI Batch Adaptor

Branch: `fix/serializer-parity-edi-batch`

| File | Action |
|------|--------|
| `src/donkey/message/EDIBatchAdaptor.ts` | NEW — Implements `BatchAdaptor` interface. Splits on ISA segments (X12 interchange envelope). Pattern: same as `HL7BatchAdaptor.ts` |
| `tests/unit/donkey/message/EDIBatchAdaptor.test.ts` | NEW |

Findings: SPC-BAG-006 (major)

---

## Deferred Findings (8)

| Finding | Severity | Reason |
|---------|----------|--------|
| SPC-BAG-002 | Minor | XML batch — JS-delegate pattern, rarely used |
| SPC-BAG-003 | Minor | JSON batch — JS-delegate pattern, rarely used |
| SPC-BAG-004 | Minor | Raw batch — JS-delegate pattern, rarely used |
| SPC-BAG-005 | Minor | Delimited batch — JS-delegate pattern, rarely used |
| SPC-BAG-007 | Minor | NCPDP batch — JS-delegate pattern, rarely used |
| SPC-SIG-001–004 | Minor | `isSerializationRequired(toXml)` parameter — adapters pass through to standalone which already handles this |
| SPC-EHG-001 | Minor | HL7v2 escape sequences — strict parser only, document as known limitation |

---

## Critical Files Reference

| File | Purpose |
|------|---------|
| `src/util/SerializerFactory.ts` | Core factory — remove inline classes, register 9 adapters |
| `src/datatypes/hl7v2/HL7v2MetaData.ts` | HL7v2 metadata extraction (adapter wraps this, translates keys) |
| `src/datatypes/edi/EDIDataType.ts:155-161` | EDI metadata uses `source`/`type`/`version` — adapter translates to `mirth_*` |
| `src/datatypes/ncpdp/NCPDPSerializer.ts:410-443` | NCPDP metadata uses wrong keys — adapter translates |
| `src/datatypes/hl7v3/HL7V3Serializer.ts:34-35` | HL7v3 constants `VERSION_VARIABLE_MAPPING = 'version'` — adapter uses `mirth_version` |
| `src/datatypes/dicom/DICOMSerializer.ts:665-676` | DICOM metadata uses `type`/`version` — adapter translates |
| `src/donkey/message/ResponseValidator.ts` | Existing interface (HL7v2ResponseValidator will implement this) |
| `src/donkey/message/HL7BatchAdaptor.ts` | Already exists — confirms SPC-BAG-001 is false positive |
| `src/donkey/message/BatchAdaptor.ts` | Interface for EDIBatchAdaptor |
| `src/javascript/runtime/ScopeBuilder.ts:222` | Where `SerializerFactory` is injected into JS scope |

---

## Verification

### Unit Tests
```bash
# Run all tests after each wave merge
npm test

# Specific adapter tests
npx jest tests/unit/util/serializers/
npx jest tests/unit/datatypes/hl7v2/HL7v2ResponseValidator.test.ts
npx jest tests/unit/donkey/message/EDIBatchAdaptor.test.ts
```

### Integration Checks
```bash
# Verify all 9 data types registered
node -e "
  const { SerializerFactory } = require('./dist/util/SerializerFactory.js');
  const types = ['HL7V2','XML','JSON','RAW','DELIMITED','EDI/X12','HL7V3','NCPDP','DICOM'];
  for (const t of types) {
    const s = SerializerFactory.getSerializer(t);
    console.log(t, s ? 'OK' : 'MISSING');
  }
"

# Verify metadata keys use mirth_ prefix
node -e "
  const { SerializerFactory } = require('./dist/util/SerializerFactory.js');
  const s = SerializerFactory.getSerializer('HL7V2');
  const map = s.getMetaDataFromMessage('MSH|^~\\&|APP|FAC|...');
  console.log('Keys:', [...map.keys()]); // Should be mirth_source, mirth_type, mirth_version
"
```

### Regression
- Current passing: 5,289 tests
- Expected after: ~5,450 tests (5,289 + ~160 new)
- Zero regressions expected — adapters delegate to already-tested standalone classes

---

## Scope Summary

| Metric | Value |
|--------|-------|
| New files | ~20 (9 adapters + barrel + constants + 12 test files) |
| Modified files | 3 (SerializerFactory.ts, model/index.ts, SerializerFactory.test.ts) |
| Lines added | ~1,700 |
| Lines removed | ~370 (inline factory classes) |
| New tests | ~160 |
| Agents | 7 (1 + 4 + 2) across 3 waves |
| Findings fixed | 30 of 38 |
| Findings deferred | 8 (all minor) |
