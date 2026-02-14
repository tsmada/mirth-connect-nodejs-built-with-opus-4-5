import { EDIBatchAdaptor, EDIBatchAdaptorFactory } from '../../../../src/donkey/message/EDIBatchAdaptor.js';

// Realistic X12 270 interchange
const INTERCHANGE_1 =
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *210101*1200*^*00501*000000001*0*P*:~' +
  'GS*HP*SENDER*RECEIVER*20210101*1200*1*X*005010X279A1~' +
  'ST*270*0001~' +
  'BHT*0019*00*12345*20210101*1200~' +
  'SE*3*0001~' +
  'GE*1*1~' +
  'IEA*1*000000001~';

const INTERCHANGE_2 =
  'ISA*00*          *00*          *ZZ*SENDER2        *ZZ*RECEIVER2      *210102*1300*^*00501*000000002*0*P*:~' +
  'GS*HP*SENDER2*RECEIVER2*20210102*1300*2*X*005010X279A1~' +
  'ST*270*0002~' +
  'BHT*0019*00*67890*20210102*1300~' +
  'SE*3*0002~' +
  'GE*1*2~' +
  'IEA*1*000000002~';

const INTERCHANGE_3 =
  'ISA*00*          *00*          *ZZ*SENDER3        *ZZ*RECEIVER3      *210103*1400*^*00501*000000003*0*T*:~' +
  'GS*HP*SENDER3*RECEIVER3*20210103*1400*3*X*005010X279A1~' +
  'ST*271*0003~' +
  'SE*2*0003~' +
  'GE*1*3~' +
  'IEA*1*000000003~';

describe('EDIBatchAdaptor', () => {
  describe('single interchange', () => {
    it('returns one message then null', async () => {
      const adaptor = new EDIBatchAdaptor(INTERCHANGE_1);

      const msg1 = await adaptor.getMessage();
      expect(msg1).toBe(INTERCHANGE_1);

      const msg2 = await adaptor.getMessage();
      expect(msg2).toBeNull();
    });

    it('reports correct sequence ID', async () => {
      const adaptor = new EDIBatchAdaptor(INTERCHANGE_1);

      expect(adaptor.getBatchSequenceId()).toBe(0);
      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(1);
    });

    it('reports batch complete after consumption', async () => {
      const adaptor = new EDIBatchAdaptor(INTERCHANGE_1);

      expect(adaptor.isBatchComplete()).toBe(false);
      await adaptor.getMessage();
      expect(adaptor.isBatchComplete()).toBe(true);
    });
  });

  describe('two interchanges', () => {
    it('returns two messages in order', async () => {
      const raw = INTERCHANGE_1 + '\n' + INTERCHANGE_2;
      const adaptor = new EDIBatchAdaptor(raw);

      const msg1 = await adaptor.getMessage();
      expect(msg1).not.toBeNull();
      expect(msg1!.startsWith('ISA*00')).toBe(true);
      expect(msg1!).toContain('000000001');

      const msg2 = await adaptor.getMessage();
      expect(msg2).not.toBeNull();
      expect(msg2!.startsWith('ISA*00')).toBe(true);
      expect(msg2!).toContain('000000002');

      const msg3 = await adaptor.getMessage();
      expect(msg3).toBeNull();
    });
  });

  describe('three interchanges', () => {
    it('returns correct 1-based sequence IDs', async () => {
      const raw = INTERCHANGE_1 + INTERCHANGE_2 + INTERCHANGE_3;
      const adaptor = new EDIBatchAdaptor(raw);

      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(1);

      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(2);

      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(3);

      expect(adaptor.isBatchComplete()).toBe(true);
    });
  });

  describe('empty input', () => {
    it('returns null immediately for empty string', async () => {
      const adaptor = new EDIBatchAdaptor('');
      expect(await adaptor.getMessage()).toBeNull();
      expect(adaptor.isBatchComplete()).toBe(true);
    });

    it('returns null immediately for whitespace-only input', async () => {
      const adaptor = new EDIBatchAdaptor('   \n\t  ');
      expect(await adaptor.getMessage()).toBeNull();
      expect(adaptor.isBatchComplete()).toBe(true);
    });
  });

  describe('no ISA segment', () => {
    it('treats entire message as single message', async () => {
      const raw = 'GS*HP*SENDER*RECEIVER*20210101*1200*1*X*005010X279A1~ST*270*0001~SE*2*0001~GE*1*1~';
      const adaptor = new EDIBatchAdaptor(raw);

      const msg = await adaptor.getMessage();
      expect(msg).toBe(raw);

      expect(await adaptor.getMessage()).toBeNull();
    });
  });

  describe('pipe delimiter', () => {
    it('handles pipe element delimiter', async () => {
      const pipeInterchange =
        'ISA|00|          |00|          |ZZ|SENDER         |ZZ|RECEIVER       |210101|1200|^|00501|000000001|0|P|:~' +
        'GS|HP|SENDER|RECEIVER|20210101|1200|1|X|005010X279A1~' +
        'IEA|1|000000001~';
      const adaptor = new EDIBatchAdaptor(pipeInterchange);

      const msg = await adaptor.getMessage();
      expect(msg).not.toBeNull();
      expect(msg!.startsWith('ISA|')).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('resets state completely', async () => {
      const adaptor = new EDIBatchAdaptor(INTERCHANGE_1 + INTERCHANGE_2);

      await adaptor.getMessage();
      expect(adaptor.getBatchSequenceId()).toBe(1);
      expect(adaptor.isBatchComplete()).toBe(false);

      adaptor.cleanup();

      expect(adaptor.getBatchSequenceId()).toBe(0);
      expect(adaptor.isBatchComplete()).toBe(true);
      expect(await adaptor.getMessage()).toBeNull();
    });
  });

  describe('EDIBatchAdaptorFactory', () => {
    it('creates adaptor correctly', async () => {
      const factory = new EDIBatchAdaptorFactory();
      const adaptor = factory.createBatchAdaptor(INTERCHANGE_1);

      expect(adaptor).toBeInstanceOf(EDIBatchAdaptor);
      const msg = await adaptor.getMessage();
      expect(msg).toBe(INTERCHANGE_1);
    });
  });
});
