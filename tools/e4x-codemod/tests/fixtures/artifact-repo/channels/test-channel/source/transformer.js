// Source transformer with E4X
var msg = new XML(connectorMessage.getRawData());
var pid = msg..PID;
var mrn = pid['PID.3']['PID.3.1'].toString();
$c('patientMRN', mrn);
