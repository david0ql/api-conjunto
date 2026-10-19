import { ResidentPushService } from './resident-push.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeService() {
  const sendUserNotification = jest.fn().mockResolvedValue(undefined);
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest
      .fn()
      .mockResolvedValue([{ userId: 'r1' }, { userId: 'r2' }]),
  };
  const devices = { createQueryBuilder: jest.fn(() => qb) };
  const apartments = {
    findOne: jest
      .fn()
      .mockResolvedValue({
        id: 'a1',
        number: '301',
        towerData: { name: 'Torre 2' },
      }),
  };
  const links = {
    find: jest
      .fn()
      .mockResolvedValue([{ residentId: 'r1' }, { residentId: 'r2' }]),
  };
  const residents = {
    find: jest.fn().mockResolvedValue([{ id: 'r2' }, { id: 'r3' }]),
  };
  const service = new ResidentPushService(
    devices as never,
    apartments as never,
    links as never,
    residents as never,
    { sendUserNotification } as never,
  );
  return { service, sendUserNotification, residents };
}

const input = {
  referenceId: 'p1',
  title: 'Llegó un paquete',
  body: 'x',
  notificationTypeCode: 'package_arrived',
};

describe('ResidentPushService', () => {
  it('notifies every resident of the apartment once', async () => {
    const { service, sendUserNotification } = makeService();
    service.notifyApartment('a1', input);
    await flush();
    expect(sendUserNotification).toHaveBeenCalledWith({
      userType: 'resident',
      userIds: ['r1', 'r2', 'r3'],
      notificationId: 'p1',
      title: 'Llegó un paquete',
      body: 'x',
      notificationTypeCode: 'package_arrived',
    });
  });

  it('skips records without apartment', async () => {
    const { service, sendUserNotification } = makeService();
    service.notifyApartment(null, input);
    await flush();
    expect(sendUserNotification).not.toHaveBeenCalled();
  });

  it('sends news to every resident with an active device', async () => {
    const { service, sendUserNotification } = makeService();
    service.notifyAllResidents({
      ...input,
      notificationTypeCode: 'news_published',
    });
    await flush();
    expect(sendUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['r1', 'r2'] }),
    );
  });

  it('never throws when the lookup fails', async () => {
    const { service, sendUserNotification, residents } = makeService();
    residents.find.mockRejectedValue(new Error('db down'));
    expect(() => service.notifyApartment('a1', input)).not.toThrow();
    await flush();
    expect(sendUserNotification).not.toHaveBeenCalled();
  });

  it('describes the apartment with its tower', async () => {
    const { service } = makeService();
    await expect(service.describeApartment('a1')).resolves.toBe(
      'Torre 2 · Apto 301',
    );
  });
});
