/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/ncpdp/NCPDPReference.java
 *
 * Purpose: NCPDP reference data lookup tables
 *
 * Key behaviors to replicate:
 * - Map field codes to descriptions
 * - Map segment codes to segment names
 * - Map transaction codes to transaction names
 * - Track which fields are repeating (can occur multiple times)
 *
 * Note: The Java file is 42K+ lines. This is a subset of the most commonly used codes.
 * Can be expanded as needed.
 */

import { NCPDPVersion } from './NCPDPProperties.js';

/**
 * NCPDP Reference Data Singleton
 *
 * Provides lookup tables for:
 * - Field IDs to descriptions
 * - Segment IDs to segment names
 * - Transaction codes to transaction names
 * - Repeating field identification
 */
export class NCPDPReference {
  private static instance: NCPDPReference | null = null;

  // D.0 version maps
  private ncpdpD0Map: Map<string, string> = new Map();
  private segmentD0Map: Map<string, string> = new Map();
  private repeatingFieldsD0: Set<string> = new Set();

  // 5.1 version maps
  private ncpdp51Map: Map<string, string> = new Map();
  private segment51Map: Map<string, string> = new Map();
  private repeatingFields51: Set<string> = new Set();

  // Transaction type map (shared between versions)
  private transactionMap: Map<string, string> = new Map();

  private constructor() {
    this.populateNCPDPD0();
    this.populateSegmentsD0();
    this.populateRepeatingFieldsD0();
    this.populateNCPDP51();
    this.populateSegments51();
    this.populateRepeatingFields51();
    this.populateTransactionTypes();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): NCPDPReference {
    if (!NCPDPReference.instance) {
      NCPDPReference.instance = new NCPDPReference();
    }
    return NCPDPReference.instance;
  }

  /**
   * Get transaction name from code
   */
  public getTransactionName(code: string): string {
    return this.transactionMap.get(code) ?? code;
  }

  /**
   * Get segment name from segment ID
   */
  public getSegment(segmentId: string, version: string): string {
    if (version === NCPDPVersion.D0) {
      return this.segmentD0Map.get(segmentId) ?? segmentId;
    }
    return this.segment51Map.get(segmentId) ?? segmentId;
  }

  /**
   * Get field description from field ID
   */
  public getDescription(fieldId: string, version: string): string {
    if (version === NCPDPVersion.D0) {
      return this.ncpdpD0Map.get(fieldId) ?? '';
    }
    return this.ncpdp51Map.get(fieldId) ?? '';
  }

  /**
   * Get field code from description (reverse lookup)
   */
  public getCodeByName(description: string, version: string): string {
    const map = version === NCPDPVersion.D0 ? this.ncpdpD0Map : this.ncpdp51Map;
    for (const [code, desc] of map.entries()) {
      if (desc === description) {
        return code;
      }
    }
    return description;
  }

  /**
   * Get segment ID from segment name (reverse lookup)
   */
  public getSegmentIdByName(name: string, version: string): string {
    const map = version === NCPDPVersion.D0 ? this.segmentD0Map : this.segment51Map;
    for (const [id, segmentName] of map.entries()) {
      if (segmentName === name) {
        return id;
      }
    }
    return name;
  }

  /**
   * Check if a field is a repeating field
   */
  public isRepeatingField(fieldDescription: string, version: string): boolean {
    if (version === NCPDPVersion.D0) {
      return this.repeatingFieldsD0.has(fieldDescription);
    }
    return this.repeatingFields51.has(fieldDescription);
  }

  /**
   * Populate D.0 field codes
   */
  private populateNCPDPD0(): void {
    const map = this.ncpdpD0Map;

    // Common fields shared with 5.1
    map.set('28', 'UnitOfMeasure');
    map.set('1C', 'SmokerNon-SmokerCode');
    map.set('1E', 'PrescriberLocationCode');

    // D.0 specific fields
    map.set('2A', 'MedigapId');
    map.set('2B', 'MedicaidIndicator');
    map.set('2C', 'PregnancyIndicator');
    map.set('2D', 'ProviderAcceptAssignmentIndicator');
    map.set('2E', 'PrimaryCareProviderIdQualifier');
    map.set('2F', 'NetworkReimbursementId');
    map.set('2G', 'CompoundIngredientModifierCodeCount');
    map.set('2H', 'CompoundIngredientModifierCode');
    map.set('2J', 'PrescriberFirstName');
    map.set('2K', 'PrescriberStreetAddress');
    map.set('2M', 'PrescriberCityAddress');
    map.set('2N', 'PrescriberStateAddress');
    map.set('2P', 'PrescriberZipAddress');
    map.set('2Q', 'AdditionalDocumentationTypeId');
    map.set('2R', 'LengthOfNeed');
    map.set('2S', 'LengthOfNeedQualifier');
    map.set('2T', 'PrescriberSupplierDateSigned');
    map.set('2U', 'RequestStatus');
    map.set('2V', 'RequestPeriodBeginDate');
    map.set('2W', 'RequestPeriodRecertDate');
    map.set('2X', 'SupportingDocumentation');
    map.set('2Y', 'PlanSalesTaxAmount');
    map.set('2Z', 'QuestionNumberLetterCount');

    // Facility fields
    map.set('3Q', 'FacilityName');
    map.set('3U', 'FacilityStreetAddress');
    map.set('3V', 'FacilityStateAddress');

    // Question/Answer fields
    map.set('4B', 'QuestionNumberLetter');
    map.set('4C', 'CoordinationOfBenefitsOtherPaymentsCount');
    map.set('4D', 'QuestionPercentResponse');
    map.set('4E', 'PrimaryCareProviderLastName');
    map.set('4F', 'RejectFieldOccurrenceIndicator');
    map.set('4G', 'QuestionDateResponse');
    map.set('4H', 'QuestionDollarAmountResponse');
    map.set('4J', 'QuestionNumericResponse');
    map.set('4K', 'QuestionAlphaNumericResponse');
    map.set('4U', 'AmountOfCoinsurance');
    map.set('4V', 'BasisOfCalculationCoinsurance');
    map.set('4X', 'PatientResidence');

    // Other payer fields
    map.set('5C', 'OtherPayerCoverageType');
    map.set('5E', 'OtherPayerRejectCount');
    map.set('5F', 'ApprovedMessageCodeCount');
    map.set('5J', 'FacilityCityAddress');
    map.set('6C', 'OtherPayerIdQualifier');
    map.set('6D', 'FacilityZipAddress');
    map.set('6E', 'OtherPayerRejectCode');
    map.set('6F', 'ApprovedMessageCode');
    map.set('7C', 'OtherPayerId');
    map.set('7E', 'DurPpsCodeCounter');
    map.set('7F', 'HelpDeskPhoneNumberQualifier');
    map.set('8C', 'FacilityId');
    map.set('8E', 'DurPpsLevelOfEffort');
    map.set('8F', 'HelpDeskPhoneNumber');
    map.set('9F', 'PreferredProductCount');

    // Header fields
    map.set('A1', 'BinNumber');
    map.set('A2', 'VersionReleaseNumber');
    map.set('A3', 'TransactionCode');
    map.set('A4', 'ProcessorControlNumber');
    map.set('A7', 'InternalControlNumber');
    map.set('A9', 'TransactionCount');
    map.set('AK', 'SoftwareVendorCertificationId');
    map.set('AM', 'SegmentIdentification');
    map.set('AN', 'TransactionResponseStatus');

    // Preferred product fields
    map.set('AP', 'PreferredProductIdQualifier');
    map.set('AR', 'PreferredProductId');
    map.set('AS', 'PreferredProductIncentive');
    map.set('AT', 'PreferredProductCopayIncentive');
    map.set('AU', 'PreferredProductDescription');

    // Tax fields
    map.set('AV', 'TaxExemptIndicator');
    map.set('AW', 'FlatSalesTaxAmountPaid');
    map.set('AX', 'PercentageSalesTaxAmountPaid');
    map.set('AY', 'PercentageSalesTaxRatePaid');
    map.set('AZ', 'PercentageSalesTaxBasisPaid');

    // Service provider fields
    map.set('B1', 'ServiceProviderId');
    map.set('B2', 'ServiceProviderIdQualifier');
    map.set('BE', 'ProfessionalServiceFeeSubmitted');
    map.set('BM', 'NarrativeMessage');

    // Patient/Cardholder fields
    map.set('C1', 'GroupId');
    map.set('C2', 'CardholderId');
    map.set('C3', 'PersonCode');
    map.set('C4', 'DateOfBirth');
    map.set('C5', 'PatientGenderCode');
    map.set('C6', 'PatientRelationshipCode');
    map.set('C7', 'PlaceOfService');
    map.set('C8', 'OtherCoverageCode');
    map.set('C9', 'EligibilityClarificationCode');
    map.set('CA', 'PatientFirstName');
    map.set('CB', 'PatientLastName');
    map.set('CC', 'CardholderFirstName');
    map.set('CD', 'CardholderLastName');
    map.set('CE', 'HomePlan');
    map.set('CF', 'EmployerName');
    map.set('CG', 'EmployerStreetAddress');
    map.set('CH', 'EmployerCityAddress');
    map.set('CI', 'EmployerStateProvinceAddress');
    map.set('CJ', 'EmployerZipPostalZone');
    map.set('CK', 'EmployerPhoneNumber');
    map.set('CL', 'EmployerContactName');
    map.set('CM', 'PatientStreetAddress');
    map.set('CN', 'PatientCityAddress');
    map.set('CO', 'PatientStateProvinceAddress');
    map.set('CP', 'PatientZipPostalZone');
    map.set('CQ', 'PatientPhoneNumber');
    map.set('CR', 'CarrierId');
    map.set('CW', 'AlternateId');
    map.set('CX', 'PatientIdQualifier');
    map.set('CY', 'PatientId');
    map.set('CZ', 'EmployerId');

    // Claim fields
    map.set('D1', 'DateOfService');
    map.set('D2', 'PrescriptionServiceReferenceNumber');
    map.set('D3', 'FillNumber');
    map.set('D5', 'DaysSupply');
    map.set('D6', 'CompoundCode');
    map.set('D7', 'ProductServiceId');
    map.set('D8', 'DispenseAsWrittenProductSelectionCode');
    map.set('D9', 'IngredientCostSubmitted');
    map.set('DB', 'PrescriberId');
    map.set('DC', 'DispensingFeeSubmitted');
    map.set('DE', 'DatePrescriptionWritten');
    map.set('DF', 'NumberOfRefillsAuthorized');
    map.set('DI', 'LevelOfService');
    map.set('DJ', 'PrescriptionOriginCode');
    map.set('DK', 'SubmissionClarificationCode');
    map.set('DL', 'PrimaryCareProviderId');
    map.set('DN', 'BasisOfCostDetermination');
    map.set('DO', 'DiagnosisCode');
    map.set('DQ', 'UsualAndCustomaryCharge');
    map.set('DR', 'PrescriberLastName');
    map.set('DT', 'SpecialPackagingIndicator');
    map.set('DU', 'GrossAmountDue');
    map.set('DV', 'OtherPayerAmountPaid');
    map.set('DX', 'PatientPaidAmountSubmitted');
    map.set('DY', 'DateOfInjury');
    map.set('DZ', 'ClaimReferenceId');

    // Product fields
    map.set('E1', 'ProductServiceIdQualifier');
    map.set('E2', 'RouteOfAdministration');
    map.set('E3', 'IncentiveAmountSubmitted');
    map.set('E4', 'ReasonForServiceCode');
    map.set('E5', 'ProfessionalServiceCode');
    map.set('E6', 'ResultOfServiceCode');
    map.set('E7', 'QuantityDispensed');
    map.set('E8', 'OtherPayerDate');
    map.set('E9', 'ProviderId');
    map.set('EA', 'OriginallyPrescribedProductServiceCode');
    map.set('EB', 'OriginallyPrescribedQuantity');

    // Compound fields
    map.set('EC', 'CompoundIngredientComponentCount');
    map.set('ED', 'CompoundIngredientQuantity');
    map.set('EE', 'CompoundIngredientDrugCost');
    map.set('EF', 'CompoundDosageFormDescriptionCode');
    map.set('EG', 'CompoundDispensingUnitFormIndicator');
    map.set('EH', 'CompoundRouteOfAdministration');
    map.set('EJ', 'OrigPrescribedProductServiceIdQualifier');
    map.set('EK', 'ScheduledPrescriptionIdNumber');
    map.set('EM', 'PrescriptionServiceReferenceNumberQualifier');
    map.set('EN', 'AssociatedPrescriptionServiceReferenceNumber');
    map.set('EP', 'AssociatedPrescriptionServiceDate');
    map.set('EQ', 'PatientSalesTaxAmount');
    map.set('ER', 'ProcedureModifierCode');
    map.set('ET', 'QuantityPrescribed');
    map.set('EU', 'PriorAuthorizationTypeCode');
    map.set('EV', 'PriorAuthorizationNumberSubmitted');
    map.set('EW', 'IntermediaryAuthorizationTypeId');
    map.set('EX', 'IntermediaryAuthorizationId');
    map.set('EY', 'ProviderIdQualifier');
    map.set('EZ', 'PrescriberIdQualifier');

    // Response fields
    map.set('F1', 'HeaderResponseStatus');
    map.set('F3', 'AuthorizationNumber');
    map.set('F4', 'Message');
    map.set('F5', 'PatientPayAmount');
    map.set('F6', 'IngredientCostPaid');
    map.set('F7', 'DispensingFeePaid');
    map.set('F9', 'TotalAmountPaid');
    map.set('FA', 'RejectCount');
    map.set('FB', 'RejectCode');
    map.set('FC', 'AccumulatedDeductibleAmount');
    map.set('FD', 'RemainingDeductibleAmount');
    map.set('FE', 'RemainingBenefitAmount');
    map.set('FH', 'AmountAppliedToPeriodicDeductible');
    map.set('FI', 'AmountOfCopayCo-Insurance');
    map.set('FJ', 'AmountAttributedToProductSelection');
    map.set('FK', 'AmountExceedingPeriodicBenefitMaximum');
    map.set('FL', 'IncentiveAmountPaid');
    map.set('FM', 'BasisOfReimbursementDetermination');
    map.set('FN', 'AmountAttributedToSalesTax');
    map.set('FO', 'PlanId');
    map.set('FQ', 'AdditionalMessageInformation');
    map.set('FS', 'ClinicalSignificanceCode');
    map.set('FT', 'OtherPharmacyIndicator');
    map.set('FU', 'PreviousDateOfFill');
    map.set('FV', 'QuantityOfPreviousFill');
    map.set('FW', 'DatabaseIndicator');
    map.set('FX', 'OtherPrescriberIndicator');
    map.set('FY', 'DurFreeTextMessage');

    // Additional fields
    map.set('GE', 'PercentageSalesTaxAmountSubmitted');
    map.set('H1', 'MeasurementTime');
    map.set('H2', 'MeasurementDimension');
    map.set('H3', 'MeasurementUnit');
    map.set('H4', 'MeasurementValue');
    map.set('H5', 'PrimaryCareProviderLocationCode');
    map.set('H6', 'DurCo-AgentId');
    map.set('H7', 'OtherAmountClaimedSubmittedCount');
    map.set('H8', 'OtherAmountClaimedSubmittedQualifier');
    map.set('H9', 'OtherAmountClaimedSubmitted');
    map.set('HA', 'FlatSalesTaxAmountSubmitted');
    map.set('HB', 'OtherPayerAmountPaidCount');
    map.set('HC', 'OtherPayerAmountPaidQualifier');
    map.set('HD', 'DispensingStatus');
    map.set('HE', 'PercentageSalesTaxRateSubmitted');
    map.set('HF', 'QuantityIntendedToBeDispensed');
    map.set('HG', 'DaysSupplyIntendedToBeDispensed');
    map.set('HH', 'BasisOfCalculationDispensingFee');
    map.set('HJ', 'BasisOfCalculationCopay');
    map.set('HK', 'BasisOfCalculationFlatSalesTax');
    map.set('HM', 'BasisOfCalculationPercentageSalesTax');

    // Professional service fields
    map.set('J1', 'ProfessionalServiceFeePaid');
    map.set('J2', 'OtherAmountPaidCount');
    map.set('J3', 'OtherAmountPaidQualifier');
    map.set('J4', 'OtherAmountPaid');
    map.set('J5', 'OtherPayerAmountRecognized');
    map.set('J6', 'DurPpsResponseCodeCounter');
    map.set('J7', 'PayerIdQualifier');
    map.set('J8', 'PayerId');
    map.set('J9', 'DurCo-AgentIdQualifier');
    map.set('JE', 'PercentageSalesTaxBasisSubmitted');

    // Coupon fields
    map.set('KE', 'CouponType');
    map.set('ME', 'CouponNumber');
    map.set('NE', 'CouponValueAmount');

    // Prior authorization fields
    map.set('PA', 'RequestType');
    map.set('PB', 'RequestPeriodDate-Begin');
    map.set('PC', 'RequestPeriodDate-End');
    map.set('PD', 'BasisOfRequest');
    map.set('PE', 'AuthorizedRepresentativeFirstName');
    map.set('PF', 'AuthorizedRepresentativeLastName');
    map.set('PG', 'AuthorizedRepresentativeStreetAddress');
    map.set('PH', 'AuthorizedRepresentativeCityAddress');
    map.set('PJ', 'AuthorizedRepresentativeStateProvinceAddress');
    map.set('PK', 'AuthorizedRepresentativeZipPostalZone');
    map.set('PM', 'PrescriberPhoneNumber');
    map.set('PP', 'PriorAuthorizationSupportingDocumentation');
    map.set('PR', 'PriorAuthorizationProcessedDate');
    map.set('PS', 'PriorAuthorizationEffectiveDate');
    map.set('PT', 'PriorAuthorizationExpirationDate');
    map.set('PW', 'PriorAuthorizationNumberOfRefillsAuthorized');
    map.set('PX', 'PriorAuthorizationQuantityAccumulated');
    map.set('PY', 'PriorAuthorizationNumber-Assigned');
    map.set('RA', 'PriorAuthorizationQuantity');
    map.set('RB', 'PriorAuthorizationDollarsAuthorized');

    // More compound fields
    map.set('RE', 'CompoundProductIdQualifier');
    map.set('SE', 'ProcedureModifierCodeCount');
    map.set('TE', 'CompoundProductId');
    map.set('UE', 'CompoundIngredientBasisOfCostDetermination');
    map.set('VE', 'DiagnosisCodeCount');
    map.set('WE', 'DiagnosisCodeQualifier');
    map.set('XE', 'ClinicalInformationCounter');
    map.set('ZE', 'MeasurementDate');

    // DUR/PPS fields
    map.set('E4', 'ReasonForServiceCode');
    map.set('E5', 'ProfessionalServiceCode');
    map.set('E6', 'ResultOfServiceCode');
    map.set('J9', 'DurCo-AgentIdQualifier');
    map.set('H6', 'DurCo-AgentId');

    // Benefit stage fields
    map.set('MU', 'BenefitStageCount');
    map.set('MV', 'BenefitStageQualifier');
    map.set('MW', 'BenefitStageAmount');
  }

  /**
   * Populate 5.1 field codes (many overlap with D.0)
   */
  private populateNCPDP51(): void {
    const map = this.ncpdp51Map;

    // Most fields are same as D.0, copying the relevant ones
    map.set('28', 'UnitOfMeasure');
    map.set('1C', 'SmokerNon-SmokerCode');
    map.set('1E', 'PrescriberLocationCode');
    map.set('2C', 'PregnancyIndicator');
    map.set('2E', 'PrimaryCareProviderIdQualifier');
    map.set('2F', 'NetworkReimbursementId');
    map.set('4C', 'CoordinationOfBenefitsOtherPaymentsCount');
    map.set('4E', 'PrimaryCareProviderLastName');
    map.set('4F', 'RejectFieldOccurrenceIndicator');
    map.set('5C', 'OtherPayerCoverageType');
    map.set('5E', 'OtherPayerRejectCount');
    map.set('5F', 'ApprovedMessageCodeCount');
    map.set('6C', 'OtherPayerIdQualifier');
    map.set('6E', 'OtherPayerRejectCode');
    map.set('6F', 'ApprovedMessageCode');
    map.set('7C', 'OtherPayerId');
    map.set('7E', 'DurPpsCodeCounter');
    map.set('7F', 'HelpDeskPhoneNumberQualifier');
    map.set('8C', 'FacilityId');
    map.set('8E', 'DurPpsLevelOfEffort');
    map.set('8F', 'HelpDeskPhoneNumber');
    map.set('9F', 'PreferredProductCount');

    // Header fields
    map.set('A1', 'BinNumber');
    map.set('A2', 'VersionReleaseNumber');
    map.set('A3', 'TransactionCode');
    map.set('A4', 'ProcessorControlNumber');
    map.set('A9', 'TransactionCount');
    map.set('AK', 'SoftwareVendorCertificationId');
    map.set('AM', 'SegmentIdentification');
    map.set('AN', 'TransactionResponseStatus');
    map.set('AP', 'PreferredProductIdQualifier');
    map.set('AR', 'PreferredProductId');
    map.set('AS', 'PreferredProductIncentive');
    map.set('AT', 'PreferredProductCopayIncentive');
    map.set('AU', 'PreferredProductDescription');
    map.set('AV', 'TaxExemptIndicator');
    map.set('AW', 'FlatSalesTaxAmountPaid');
    map.set('AX', 'PercentageSalesTaxAmountPaid');
    map.set('AY', 'PercentageSalesTaxRatePaid');
    map.set('AZ', 'PercentageSalesTaxBasisPaid');
    map.set('B1', 'ServiceProviderId');
    map.set('B2', 'ServiceProviderIdQualifier');
    map.set('BE', 'ProfessionalServiceFeeSubmitted');

    // Patient/Cardholder fields
    map.set('C1', 'GroupId');
    map.set('C2', 'CardholderId');
    map.set('C3', 'PersonCode');
    map.set('C4', 'DateOfBirth');
    map.set('C5', 'PatientGenderCode');
    map.set('C6', 'PatientRelationshipCode');
    map.set('C7', 'PatientLocation');
    map.set('C8', 'OtherCoverageCode');
    map.set('C9', 'EligibilityClarificationCode');
    map.set('CA', 'PatientFirstName');
    map.set('CB', 'PatientLastName');
    map.set('CC', 'CardholderFirstName');
    map.set('CD', 'CardholderLastName');
    map.set('CE', 'HomePlan');
    map.set('CF', 'EmployerName');
    map.set('CG', 'EmployerStreetAddress');
    map.set('CH', 'EmployerCityAddress');
    map.set('CI', 'EmployerStateProvinceAddress');
    map.set('CJ', 'EmployerZipPostalZone');
    map.set('CK', 'EmployerPhoneNumber');
    map.set('CL', 'EmployerContactName');
    map.set('CM', 'PatientStreetAddress');
    map.set('CN', 'PatientCityAddress');
    map.set('CO', 'PatientStateProvinceAddress');
    map.set('CP', 'PatientZipPostalZone');
    map.set('CQ', 'PatientPhoneNumber');
    map.set('CR', 'CarrierId');
    map.set('CW', 'AlternateId');
    map.set('CX', 'PatientIdQualifier');
    map.set('CY', 'PatientId');
    map.set('CZ', 'EmployerId');

    // Claim fields
    map.set('D1', 'DateOfService');
    map.set('D2', 'PrescriptionServiceReferenceNumber');
    map.set('D3', 'FillNumber');
    map.set('D5', 'DaysSupply');
    map.set('D6', 'CompoundCode');
    map.set('D7', 'ProductServiceId');
    map.set('D8', 'DispenseAsWrittenProductSelectionCode');
    map.set('D9', 'IngredientCostSubmitted');
    map.set('DB', 'PrescriberId');
    map.set('DC', 'DispensingFeeSubmitted');
    map.set('DE', 'DatePrescriptionWritten');
    map.set('DF', 'NumberOfRefillsAuthorized');
    map.set('DI', 'LevelOfService');
    map.set('DJ', 'PrescriptionOriginCode');
    map.set('DK', 'SubmissionClarificationCode');
    map.set('DL', 'PrimaryCareProviderId');
    map.set('DN', 'BasisOfCostDetermination');
    map.set('DO', 'DiagnosisCode');
    map.set('DQ', 'UsualAndCustomaryCharge');
    map.set('DR', 'PrescriberLastName');
    map.set('DT', 'UnitDoseIndicator');
    map.set('DU', 'GrossAmountDue');
    map.set('DV', 'OtherPayerAmountPaid');
    map.set('DX', 'PatientPaidAmountSubmitted');
    map.set('DY', 'DateOfInjury');
    map.set('DZ', 'ClaimReferenceId');

    // Product fields
    map.set('E1', 'ProductServiceIdQualifier');
    map.set('E3', 'IncentiveAmountSubmitted');
    map.set('E4', 'ReasonForServiceCode');
    map.set('E5', 'ProfessionalServiceCode');
    map.set('E6', 'ResultOfServiceCode');
    map.set('E7', 'QuantityDispensed');
    map.set('E8', 'OtherPayerDate');
    map.set('E9', 'ProviderId');
    map.set('EA', 'OriginallyPrescribedProductServiceCode');
    map.set('EB', 'OriginallyPrescribedQuantity');
    map.set('EC', 'CompoundIngredientComponentCount');
    map.set('ED', 'CompoundIngredientQuantity');
    map.set('EE', 'CompoundIngredientDrugCost');
    map.set('EF', 'CompoundDosageFormDescriptionCode');
    map.set('EG', 'CompoundDispensingUnitFormIndicator');
    map.set('EH', 'CompoundRouteOfAdministration');
    map.set('EJ', 'OrigPrescribedProductServiceIdQualifier');
    map.set('EK', 'ScheduledPrescriptionIdNumber');
    map.set('EM', 'PrescriptionServiceReferenceNumberQualifier');
    map.set('EN', 'AssociatedPrescriptionServiceReferenceNumber');
    map.set('EP', 'AssociatedPrescriptionServiceDate');
    map.set('ER', 'ProcedureModifierCode');
    map.set('ET', 'QuantityPrescribed');
    map.set('EU', 'PriorAuthorizationTypeCode');
    map.set('EV', 'PriorAuthorizationNumberSubmitted');
    map.set('EW', 'IntermediaryAuthorizationTypeId');
    map.set('EX', 'IntermediaryAuthorizationId');
    map.set('EY', 'ProviderIdQualifier');
    map.set('EZ', 'PrescriberIdQualifier');

    // Response fields
    map.set('F1', 'HeaderResponseStatus');
    map.set('F3', 'AuthorizationNumber');
    map.set('F4', 'Message');
    map.set('F5', 'PatientPayAmount');
    map.set('F6', 'IngredientCostPaid');
    map.set('F7', 'DispensingFeePaid');
    map.set('F9', 'TotalAmountPaid');
    map.set('FA', 'RejectCount');
    map.set('FB', 'RejectCode');
    map.set('FC', 'AccumulatedDeductibleAmount');
    map.set('FD', 'RemainingDeductibleAmount');
    map.set('FE', 'RemainingBenefitAmount');
    map.set('FH', 'AmountAppliedToPeriodicDeductible');
    map.set('FI', 'AmountOfCopayCo-Insurance');
    map.set('FJ', 'AmountAttributedToProductSelection');
    map.set('FK', 'AmountExceedingPeriodicBenefitMaximum');
    map.set('FL', 'IncentiveAmountPaid');
    map.set('FM', 'BasisOfReimbursementDetermination');
    map.set('FN', 'AmountAttributedToSalesTax');
    map.set('FO', 'PlanId');
    map.set('FQ', 'AdditionalMessageInformation');
    map.set('FS', 'ClinicalSignificanceCode');
    map.set('FT', 'OtherPharmacyIndicator');
    map.set('FU', 'PreviousDateOfFill');
    map.set('FV', 'QuantityOfPreviousFill');
    map.set('FW', 'DatabaseIndicator');
    map.set('FX', 'OtherPrescriberIndicator');
    map.set('FY', 'DurFreeTextMessage');
    map.set('GE', 'PercentageSalesTaxAmountSubmitted');

    // Measurement/Clinical fields
    map.set('H1', 'MeasurementTime');
    map.set('H2', 'MeasurementDimension');
    map.set('H3', 'MeasurementUnit');
    map.set('H4', 'MeasurementValue');
    map.set('H5', 'PrimaryCareProviderLocationCode');
    map.set('H6', 'DurCo-AgentId');
    map.set('H7', 'OtherAmountClaimedSubmittedCount');
    map.set('H8', 'OtherAmountClaimedSubmittedQualifier');
    map.set('H9', 'OtherAmountClaimedSubmitted');
    map.set('HA', 'FlatSalesTaxAmountSubmitted');
    map.set('HB', 'OtherPayerAmountPaidCount');
    map.set('HC', 'OtherPayerAmountPaidQualifier');
    map.set('HD', 'DispensingStatus');
    map.set('HE', 'PercentageSalesTaxRateSubmitted');
    map.set('HF', 'QuantityIntendedToBeDispensed');
    map.set('HG', 'DaysSupplyIntendedToBeDispensed');
    map.set('HH', 'BasisOfCalculationDispensingFee');
    map.set('HJ', 'BasisOfCalculationCopay');
    map.set('HK', 'BasisOfCalculationFlatSalesTax');
    map.set('HM', 'BasisOfCalculationPercentageSalesTax');

    // Professional service fields
    map.set('J1', 'ProfessionalServiceFeePaid');
    map.set('J2', 'OtherAmountPaidCount');
    map.set('J3', 'OtherAmountPaidQualifier');
    map.set('J4', 'OtherAmountPaid');
    map.set('J5', 'OtherPayerAmountRecognized');
    map.set('J6', 'DurPpsResponseCodeCounter');
    map.set('J7', 'PayerIdQualifier');
    map.set('J8', 'PayerId');
    map.set('J9', 'DurCo-AgentIdQualifier');
    map.set('JE', 'PercentageSalesTaxBasisSubmitted');

    // Coupon fields
    map.set('KE', 'CouponType');
    map.set('ME', 'CouponNumber');
    map.set('NE', 'CouponValueAmount');

    // Prior authorization fields
    map.set('PA', 'RequestType');
    map.set('PB', 'RequestPeriodDate-Begin');
    map.set('PC', 'RequestPeriodDate-End');
    map.set('PD', 'BasisOfRequest');
    map.set('PE', 'AuthorizedRepresentativeFirstName');
    map.set('PF', 'AuthorizedRepresentativeLastName');
    map.set('PG', 'AuthorizedRepresentativeStreetAddress');
    map.set('PH', 'AuthorizedRepresentativeCityAddress');
    map.set('PJ', 'AuthorizedRepresentativeStateProvinceAddress');
    map.set('PK', 'AuthorizedRepresentativeZipPostalZone');
    map.set('PM', 'PrescriberPhoneNumber');
    map.set('PP', 'PriorAuthorizationSupportingDocumentation');
    map.set('PR', 'PriorAuthorizationProcessedDate');
    map.set('PS', 'PriorAuthorizationEffectiveDate');
    map.set('PT', 'PriorAuthorizationExpirationDate');
    map.set('PW', 'PriorAuthorizationNumberOfRefillsAuthorized');
    map.set('PX', 'PriorAuthorizationQuantityAccumulated');
    map.set('PY', 'PriorAuthorizationNumber-Assigned');
    map.set('RA', 'PriorAuthorizationQuantity');
    map.set('RB', 'PriorAuthorizationDollarsAuthorized');
    map.set('RE', 'CompoundProductIdQualifier');
    map.set('SE', 'ProcedureModifierCodeCount');
    map.set('TE', 'CompoundProductId');
    map.set('UE', 'CompoundIngredientBasisOfCostDetermination');
    map.set('VE', 'DiagnosisCodeCount');
    map.set('WE', 'DiagnosisCodeQualifier');
    map.set('XE', 'ClinicalInformationCounter');
    map.set('ZE', 'MeasurementDate');
  }

  /**
   * Populate D.0 segment mappings
   */
  private populateSegmentsD0(): void {
    const segments = this.segmentD0Map;

    segments.set('AM01', 'Patient');
    segments.set('AM02', 'PharmacyProvider');
    segments.set('AM03', 'Prescriber');
    segments.set('AM04', 'Insurance');
    segments.set('AM05', 'CoordinationOfBenefitsOtherPayments');
    segments.set('AM06', 'WorkersCompensation');
    segments.set('AM07', 'Claim');
    segments.set('AM08', 'DUR');
    segments.set('AM09', 'Coupon');
    segments.set('AM10', 'Compound');
    segments.set('AM11', 'Pricing');
    segments.set('AM12', 'PriorAuthorization');
    segments.set('AM13', 'Clinical');
    segments.set('AM14', 'AdditionalDocumentation');
    segments.set('AM15', 'Facility');
    segments.set('AM16', 'Narrative');
    segments.set('AM20', 'ResponseMessage');
    segments.set('AM21', 'ResponseStatus');
    segments.set('AM22', 'ResponseClaim');
    segments.set('AM23', 'ResponseDUR');
    segments.set('AM24', 'ResponsePriorAuthorization');
    segments.set('AM25', 'ResponseInsurance');
    segments.set('AM26', 'ResponsePreferredProduct');
  }

  /**
   * Populate 5.1 segment mappings
   */
  private populateSegments51(): void {
    const segments = this.segment51Map;

    segments.set('AM01', 'Patient');
    segments.set('AM02', 'PharmacyProvider');
    segments.set('AM03', 'Prescriber');
    segments.set('AM04', 'Insurance');
    segments.set('AM05', 'CoordinationOfBenefitsOtherPayments');
    segments.set('AM06', 'WorkersCompensation');
    segments.set('AM07', 'Claim');
    segments.set('AM08', 'DUR');
    segments.set('AM09', 'Coupon');
    segments.set('AM10', 'Compound');
    segments.set('AM11', 'Pricing');
    segments.set('AM12', 'PriorAuthorization');
    segments.set('AM13', 'Clinical');
    segments.set('AM20', 'ResponseMessage');
    segments.set('AM21', 'ResponseStatus');
    segments.set('AM22', 'ResponseClaim');
    segments.set('AM23', 'ResponseDUR');
    segments.set('AM24', 'ResponsePriorAuthorization');
    segments.set('AM25', 'ResponseInsurance');
    segments.set('AM26', 'ResponsePreferredProduct');
  }

  /**
   * Populate D.0 repeating fields
   */
  private populateRepeatingFieldsD0(): void {
    const fields = this.repeatingFieldsD0;

    fields.add('ProcedureModifierCode');
    fields.add('OtherPayerCoverageType');
    fields.add('OtherPayerIdQualifier');
    fields.add('OtherPayerId');
    fields.add('OtherPayerDate');
    fields.add('OtherPayerAmountPaidQualifier');
    fields.add('OtherPayerAmountPaid');
    fields.add('OtherPayerRejectCode');
    fields.add('OtherAmountClaimedSubmittedQualifier');
    fields.add('OtherAmountClaimedSubmitted');
    fields.add('CompoundProductIdQualifier');
    fields.add('CompoundProductId');
    fields.add('CompoundIngredientQuantity');
    fields.add('CompoundIngredientDrugCost');
    fields.add('CompoundIngredientBasisOfCostDetermination');
    fields.add('DiagnosisCodeQualifier');
    fields.add('DiagnosisCode');
    fields.add('RejectCode');
    fields.add('RejectFieldOccurrenceIndicator');
    fields.add('ApprovedMessageCode');
    fields.add('PreferredProductIdQualifier');
    fields.add('PreferredProductId');
    fields.add('PreferredProductIncentive');
    fields.add('PreferredProductCopayIncentive');
    fields.add('PreferredProductDescription');
    fields.add('OtherAmountPaidQualifier');
    fields.add('OtherAmountPaid');
    fields.add('SubmissionClarificationCode');
    fields.add('BenefitStageAmount');
    fields.add('BenefitStageQualifier');
    fields.add('CompoundIngredientModifierCode');
    fields.add('QuestionNumberLetter');
    fields.add('QuestionPercentResponse');
    fields.add('QuestionDateResponse');
    fields.add('QuestionDollarAmountResponse');
    fields.add('QuestionNumericResponse');
    fields.add('QuestionAlphaNumericResponse');
  }

  /**
   * Populate 5.1 repeating fields
   */
  private populateRepeatingFields51(): void {
    const fields = this.repeatingFields51;

    fields.add('ProcedureModifierCode');
    fields.add('OtherPayerCoverageType');
    fields.add('OtherPayerIdQualifier');
    fields.add('OtherPayerId');
    fields.add('OtherPayerDate');
    fields.add('OtherPayerAmountPaidQualifier');
    fields.add('OtherPayerAmountPaid');
    fields.add('OtherPayerRejectCode');
    fields.add('OtherAmountClaimedSubmittedQualifier');
    fields.add('OtherAmountClaimedSubmitted');
    fields.add('CompoundProductIdQualifier');
    fields.add('CompoundProductId');
    fields.add('CompoundIngredientQuantity');
    fields.add('CompoundIngredientDrugCost');
    fields.add('CompoundIngredientBasisOfCostDetermination');
    fields.add('DiagnosisCodeQualifier');
    fields.add('DiagnosisCode');
    fields.add('RejectCode');
    fields.add('RejectFieldOccurrenceIndicator');
    fields.add('ApprovedMessageCode');
    fields.add('PreferredProductIdQualifier');
    fields.add('PreferredProductId');
    fields.add('PreferredProductIncentive');
    fields.add('PreferredProductCopayIncentive');
    fields.add('PreferredProductDescription');
    fields.add('OtherAmountPaidQualifier');
    fields.add('OtherAmountPaid');
    fields.add('SubmissionClarificationCode');
  }

  /**
   * Populate transaction type mappings
   */
  private populateTransactionTypes(): void {
    const types = this.transactionMap;

    types.set('E1', 'EligibilityVerification');
    types.set('B1', 'Billing');
    types.set('B2', 'Reversal');
    types.set('B3', 'Rebill');
    types.set('P1', 'PARequestBilling');
    types.set('P2', 'PAReversal');
    types.set('P3', 'PAInquiry');
    types.set('P4', 'PARequestReversal');
    types.set('N1', 'InformationReporting');
    types.set('N2', 'InformationReportingReversal');
    types.set('S1', 'ServiceBilling');
    types.set('S2', 'ServiceReversal');
    types.set('S3', 'ServiceRebill');
    types.set('C1', 'ControlledSubstanceReporting');
    types.set('C2', 'ControlledSubstanceReportingReversal');
  }
}

/**
 * Get singleton reference instance (convenience function)
 */
export function getNCPDPReference(): NCPDPReference {
  return NCPDPReference.getInstance();
}
