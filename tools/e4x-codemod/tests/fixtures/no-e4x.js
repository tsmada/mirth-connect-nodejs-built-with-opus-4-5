// Pure JavaScript - no E4X syntax
var msg = JSON.parse(connectorMessage.getRawData());

var patientName = msg.patient.name;
var mrn = msg.patient.mrn;

if (mrn && mrn.length > 0) {
  $c('patientMRN', mrn);
  $c('patientName', patientName);
}

// Comparison operators (should NOT be detected as XML)
if (patientName.length > 5 && mrn < 99999) {
  logger.info('Valid patient');
}

// Template literals (should NOT be detected as XML)
var greeting = `Hello ${patientName}`;

// Regex with / (should NOT be detected as XML)
var pattern = /^[A-Z]{2}\d+$/;
var result = mrn.match(pattern);

return message;
