// Destination transformer with E4X
var msg = new XML(connectorMessage.getTransformedData());
for each (var obx in msg..OBX) {
  logger.info(obx.toString());
}
msg.@processed = "true";
