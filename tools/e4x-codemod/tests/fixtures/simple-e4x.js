// Simple E4X patterns - all runtime-handled
var msg = new XML(connectorMessage.getRawData());

// Descendant access
var pid = msg..PID;
var obxList = msg..OBX;

// Attribute read
var version = msg.@version;
var type = msg.MSH.@messageType;

// XML literal
var ack = <ACK>
  <MSA>
    <MSA.1>AA</MSA.1>
  </MSA>
</ACK>;

// For each loop
for each (var segment in msg..OBX) {
  logger.info(segment.toString());
}

// Attribute write
msg.@version = "2.5.1";

// XML append
msg += <PID><PID.3>12345</PID.3></PID>;

// Default namespace
default xml namespace = "urn:hl7-org:v3";
