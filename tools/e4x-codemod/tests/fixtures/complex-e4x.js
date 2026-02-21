// Complex E4X patterns - nested, chained, mixed
var msg = new XML(connectorMessage.getRawData());

// Filter predicate
var wbcResults = msg.OBX.(OBX.3 == 'WBC');
var abnormals = msg.OBX.(OBX.8 == 'H' || OBX.8 == 'L');

// Wildcard operators
var allAttrs = msg.MSH.@*;
var allChildren = msg.PID.*;

// Chained operations
var value = msg..OBX.(OBX.3 == 'WBC')..OBX.5;

// Delete property
delete msg.PID['PID.6'];

// XML constructor variants
var doc = new XML('<root><child>text</child></root>');

// Computed attribute
var attrName = 'version';
var tag = <element version={msg.@version}>content</element>;

// Empty XMLList
var emptyList = <></>;

// Nested XML literals with expressions
var response = <Response>
  <Status>{statusCode}</Status>
  <Message>{msg..MSA['MSA.1'].toString()}</Message>
</Response>;
