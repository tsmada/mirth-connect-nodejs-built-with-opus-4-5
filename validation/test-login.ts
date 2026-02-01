import { MirthApiClient } from './clients/MirthApiClient';

async function main() {
  const java = new MirthApiClient({
    name: 'Java Mirth',
    baseUrl: 'https://localhost:8443',
    username: 'admin',
    password: 'admin',
    mllpPort: 6661,
    httpTestPort: 8082
  });

  const node = new MirthApiClient({
    name: 'Node.js Mirth',
    baseUrl: 'http://localhost:8081',
    username: 'admin',
    password: 'admin',
    mllpPort: 6662,
    httpTestPort: 8083
  });

  console.log('Testing Java Mirth login...');
  const javaLogin = await java.login();
  console.log('Java login:', javaLogin);

  console.log('Testing Node.js Mirth login...');
  const nodeLogin = await node.login();
  console.log('Node.js login:', nodeLogin);

  if (javaLogin) {
    console.log('\nJava channels:');
    const javaChannels = await java.getChannels();
    console.log('Count:', javaChannels.length);
  }

  if (nodeLogin) {
    console.log('\nNode.js channels:');
    const nodeChannels = await node.getChannels();
    console.log('Count:', nodeChannels.length);
  }

  await java.logout();
  await node.logout();
}

main().catch(console.error);
