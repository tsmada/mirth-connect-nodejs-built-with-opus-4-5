/**
 * Debug script to test MLLP scenario flow step by step.
 * Run with: npx ts-node debug-mllp.ts
 *
 * IMPORTANT: Both Java Mirth and Node.js Mirth share the same MySQL database.
 * This means channels are shared between engines. The validation approach:
 * 1. Create TWO separate channels (different IDs) - one for Java, one for Node
 * 2. Java channel listens on port 6661, Node channel on port 6662
 * 3. Import both channels to the shared database (via either API - they share DB)
 * 4. Deploy Java channel on Java Mirth, Node channel on Node.js Mirth
 * 5. Send same message to both, compare ACK responses
 */
import * as fs from 'fs';
import * as path from 'path';
import { environment } from './config/environments';
import { createClients } from './clients/MirthApiClient';
import { MLLPClient } from './clients/MLLPClient';

async function debug() {
  console.log('=== MLLP Debug Script (Shared Database Mode) ===\n');
  console.log('Both engines share the same MySQL database.');
  console.log('Creating separate channels for each engine with different ports.\n');

  const clients = createClients(environment.java, environment.node);

  // Step 1: Login
  console.log('Step 1: Logging in...');
  console.log(`  Java API: ${environment.java.baseUrl}`);
  console.log(`  Node API: ${environment.node.baseUrl}`);
  const javaLogin = await clients.java.login();
  const nodeLogin = await clients.node.login();
  console.log(`  Java login: ${javaLogin ? 'SUCCESS' : 'FAILED'}`);
  console.log(`  Node login: ${nodeLogin ? 'SUCCESS' : 'FAILED'}`);

  if (!javaLogin || !nodeLogin) {
    console.error('Login failed, aborting');
    return;
  }

  // Step 2: Load channel XML template
  console.log('\nStep 2: Loading channel XML template...');
  const channelPath = path.join(__dirname, '..', 'tests', 'fixtures', 'example-channels', 'Simple Channel - MLLP to File.xml');
  const channelXml = fs.readFileSync(channelPath, 'utf8');
  console.log(`  Loaded ${channelXml.length} bytes`);

  // Extract original ID
  const idMatch = channelXml.match(/<id>([^<]+)<\/id>/);
  const originalId = idMatch ? idMatch[1] : 'unknown';
  console.log(`  Original channel ID: ${originalId}`);

  // Step 3: Create engine-specific channels
  console.log('\nStep 3: Creating engine-specific channel configurations...');

  const javaPort = environment.java.mllpPort; // 6661
  const nodePort = environment.node.mllpPort; // 6662

  // Generate valid UUID-format channel IDs
  const parts = originalId.split('-');
  const javaChannelId = parts.length === 5
    ? `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4].substring(0, 6)}000001`
    : '00000000-0000-0000-0000-000000000001';
  const nodeChannelId = parts.length === 5
    ? `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4].substring(0, 6)}000002`
    : '00000000-0000-0000-0000-000000000002';

  // Create Java channel (port 6661)
  // Keep name short to avoid DB column truncation (limit ~40 chars)
  const javaChannelXml = channelXml
    .replace(new RegExp(`<id>${originalId}</id>`), `<id>${javaChannelId}</id>`)
    .replace(/<name>([^<]+)<\/name>/, '<name>MLLP Test Java</name>')
    .replace(/\$\{listenerPort\}/g, String(javaPort))
    .replace(/\$\{listenerAddress\}/g, '0.0.0.0')
    .replace(/\$\{fileOutboxPath\}/g, '/tmp/mirth-validation/java')
    .replace(/\$\{filePrefix\}/g, 'msg-');

  // Create Node channel (port 6662)
  const nodeChannelXml = channelXml
    .replace(new RegExp(`<id>${originalId}</id>`), `<id>${nodeChannelId}</id>`)
    .replace(/<name>([^<]+)<\/name>/, '<name>MLLP Test Node</name>')
    .replace(/\$\{listenerPort\}/g, String(nodePort))
    .replace(/\$\{listenerAddress\}/g, '0.0.0.0')
    .replace(/\$\{fileOutboxPath\}/g, '/tmp/mirth-validation/node')
    .replace(/\$\{filePrefix\}/g, 'msg-');

  console.log(`  Java channel: ${javaChannelId} (port ${javaPort})`);
  console.log(`  Node channel: ${nodeChannelId} (port ${nodePort})`);

  // Step 4: Clean up existing channels (via Java API - shared DB)
  console.log('\nStep 4: Cleaning up existing test channels...');
  try {
    await clients.java.undeployChannel(javaChannelId);
    await clients.java.deleteChannel(javaChannelId);
    console.log('  Deleted existing Java test channel');
  } catch (e) {
    console.log('  No existing Java test channel');
  }

  try {
    await clients.java.undeployChannel(nodeChannelId);
    await clients.java.deleteChannel(nodeChannelId);
    console.log('  Deleted existing Node test channel');
  } catch (e) {
    console.log('  No existing Node test channel');
  }

  await new Promise(r => setTimeout(r, 1000));

  // Step 5: Import both channels (via Java API - they go to shared DB)
  console.log('\nStep 5: Importing channels to shared database...');

  // List existing channels first
  const existingChannels = await clients.java.getChannels();
  console.log(`  Existing channels: ${existingChannels.map((c: { id: string }) => c.id).join(', ') || 'none'}`);

  const javaImport = await clients.java.importChannel(javaChannelXml, true);
  console.log(`  Java channel import: ${javaImport ? 'SUCCESS' : 'FAILED'}`);

  const nodeImport = await clients.java.importChannel(nodeChannelXml, true);
  console.log(`  Node channel import: ${nodeImport ? 'SUCCESS' : 'FAILED'}`);

  if (!javaImport || !nodeImport) {
    console.error('\nChannel import failed, aborting');
    await clients.java.logout();
    await clients.node.logout();
    return;
  }

  // Step 6: Deploy channels on respective engines
  console.log('\nStep 6: Deploying channels...');

  // Deploy Java channel on Java Mirth
  const javaDeploy = await clients.java.deployChannel(javaChannelId);
  console.log(`  Java channel on Java engine: ${javaDeploy ? 'SUCCESS' : 'FAILED'}`);

  // Deploy Node channel on Node.js Mirth
  const nodeDeploy = await clients.node.deployChannel(nodeChannelId);
  console.log(`  Node channel on Node engine: ${nodeDeploy ? 'SUCCESS' : 'FAILED'}`);

  // Step 7: Wait for channels to start
  console.log('\nStep 7: Waiting for channels to start...');

  let javaReady = false;
  let nodeReady = false;

  for (let i = 0; i < 30; i++) {
    const javaStatus = await clients.java.getChannelStatus(javaChannelId);
    const nodeStatus = await clients.node.getChannelStatus(nodeChannelId);

    const javaState = javaStatus?.state || 'unknown';
    const nodeState = nodeStatus?.state || 'unknown';

    if (!javaReady || !nodeReady) {
      console.log(`  Attempt ${i + 1}: Java=${javaState}, Node=${nodeState}`);
    }

    if (javaState === 'STARTED') javaReady = true;
    if (nodeState === 'STARTED') nodeReady = true;

    if (javaReady && nodeReady) {
      console.log('  Both channels started!');
      break;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  if (!javaReady) {
    console.error('  Java channel did not start');
  }
  if (!nodeReady) {
    console.error('  Node channel did not start');
  }

  // Step 8: Test MLLP connections
  console.log('\nStep 8: Testing MLLP connections...');

  const testMessage = 'MSH|^~\\&|TEST|FACILITY|DEST|FACILITY|20240115||ADT^A01|123456|P|2.5\rPID|1||PATIENT123||DOE^JOHN||19800101|M\r';

  let javaAck: string | null = null;
  let nodeAck: string | null = null;

  if (javaReady) {
    console.log(`  Sending to Java Mirth on port ${javaPort}...`);
    try {
      const javaMLLP = new MLLPClient({ host: 'localhost', port: javaPort, timeout: 10000 });
      const javaResponse = await javaMLLP.send(testMessage);
      javaAck = javaResponse.ackCode || 'unknown';
      console.log(`  Java ACK: ${javaAck}`);
      if (javaResponse.rawResponse) {
        console.log(`  Java response (first 100 chars): ${javaResponse.rawResponse.substring(0, 100).replace(/\r/g, '\\r')}...`);
      }
    } catch (e) {
      console.log(`  Java MLLP error: ${(e as Error).message}`);
    }
  }

  if (nodeReady) {
    console.log(`  Sending to Node.js Mirth on port ${nodePort}...`);
    try {
      const nodeMLLP = new MLLPClient({ host: 'localhost', port: nodePort, timeout: 10000 });
      const nodeResponse = await nodeMLLP.send(testMessage);
      nodeAck = nodeResponse.ackCode || 'unknown';
      console.log(`  Node ACK: ${nodeAck}`);
      if (nodeResponse.rawResponse) {
        console.log(`  Node response (first 100 chars): ${nodeResponse.rawResponse.substring(0, 100).replace(/\r/g, '\\r')}...`);
      }
    } catch (e) {
      console.log(`  Node MLLP error: ${(e as Error).message}`);
    }
  }

  // Step 9: Compare results
  console.log('\nStep 9: Comparison...');
  if (javaAck && nodeAck) {
    if (javaAck === nodeAck) {
      console.log(`  MATCH: Both engines returned ACK code '${javaAck}'`);
    } else {
      console.log(`  MISMATCH: Java='${javaAck}', Node='${nodeAck}'`);
    }
  } else {
    console.log('  Could not compare - one or both engines did not respond');
  }

  // Step 10: Cleanup
  console.log('\nStep 10: Cleaning up...');
  try {
    await clients.java.undeployChannel(javaChannelId);
    await clients.java.deleteChannel(javaChannelId);
    console.log('  Java test channel: cleaned up');
  } catch (e) {
    console.log(`  Java cleanup error: ${(e as Error).message}`);
  }

  try {
    await clients.node.undeployChannel(nodeChannelId);
    await clients.java.deleteChannel(nodeChannelId); // Use Java API to delete from shared DB
    console.log('  Node test channel: cleaned up');
  } catch (e) {
    console.log(`  Node cleanup error: ${(e as Error).message}`);
  }

  // Logout
  await clients.java.logout();
  await clients.node.logout();

  console.log('\n=== Debug Complete ===');
}

debug().catch(console.error);
