// Patterns requiring extended transforms (not runtime-handled)
var msg = new XML(connectorMessage.getRawData());

// Namespace constructor - UNSUPPORTED by runtime
var hl7Ns = new Namespace("urn:hl7-org:v3");
var prefixedNs = new Namespace("hl7", "urn:hl7-org:v3");

// QName constructor - UNSUPPORTED by runtime
var qn = new QName(hl7Ns, "ClinicalDocument");
var simpleQn = new QName("localName");

// XML settings - UNSUPPORTED by runtime
XML.ignoreWhitespace = true;
XML.ignoreComments = false;
XML.prettyPrinting = true;

// importClass - handled by shim but deprecated
importClass(java.util.Date);
importClass(Packages.com.mirth.connect.server.util.ServerUtil);

// Mixed: some runtime-handled + some unsupported
var pid = msg..PID;
var ns = new Namespace("urn:hl7-org:v3");
msg.@version = "2.5";
