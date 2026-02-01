/**
 * Cleanup all test channels from the shared database
 */
import { createClients } from './clients/MirthApiClient';
import { loadEnvironment } from './config/environments';

async function cleanup() {
  const env = loadEnvironment();
  const clients = createClients(env.java, env.node);

  console.log('Logging in...');
  await clients.java.login();

  console.log('Getting channels...');
  const channels = await clients.java.getChannels();
  console.log('Found channels:', channels.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));

  for (const ch of channels) {
    console.log('Undeploying ' + ch.id + '...');
    try {
      await clients.java.undeployChannel(ch.id);
    } catch (e) {
      console.log('  (not deployed)');
    }
  }

  // Wait a moment
  console.log('Waiting for undeploy...');
  await new Promise(r => setTimeout(r, 3000));

  for (const ch of channels) {
    console.log('Deleting ' + ch.id + '...');
    try {
      await clients.java.deleteChannel(ch.id);
      console.log('  deleted');
    } catch (e) {
      console.log('  failed:', (e as Error).message);
    }
  }

  console.log('Done');
  await clients.java.logout();
}

cleanup();
