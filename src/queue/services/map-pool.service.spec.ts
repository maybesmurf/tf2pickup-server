import { Events } from '@/events/events';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MapPoolService } from './map-pool.service';
import {
  MapPoolEntry,
  MapPoolEntryDocument,
  mapPoolEntrySchema,
} from '../models/map-pool-entry';
import { mongooseTestingModule } from '@/utils/testing-mongoose-module';
import { skip } from 'rxjs/operators';
import { Connection, Model } from 'mongoose';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';

describe('MapPoolService', () => {
  let service: MapPoolService;
  let mongod: MongoMemoryServer;
  let mapModel: Model<MapPoolEntryDocument>;
  let events: Events;
  let connection: Connection;

  beforeAll(async () => (mongod = await MongoMemoryServer.create()));
  afterAll(async () => await mongod.stop());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        mongooseTestingModule(mongod),
        MongooseModule.forFeature([
          {
            name: MapPoolEntry.name,
            schema: mapPoolEntrySchema,
          },
        ]),
      ],
      providers: [MapPoolService, Events],
    }).compile();

    service = module.get<MapPoolService>(MapPoolService);
    mapModel = module.get(getModelToken(MapPoolEntry.name));
    events = module.get(Events);
    connection = module.get(getConnectionToken());
  });

  afterEach(async () => {
    await mapModel.deleteMany({});
    await connection.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('#onModuleInit()', () => {
    describe('when there are no maps in the pool', () => {
      it('should set the default map pool', async () => {
        await service.onModuleInit();
        expect(await mapModel.countDocuments()).toBeGreaterThan(0);
      });
    });

    describe('when there are maps in the pool already', () => {
      beforeEach(async () => {
        await mapModel.create({ name: 'cp_badlands' });
      });

      it('should not alter the map pool', async () => {
        await service.onModuleInit();
        expect(await mapModel.countDocuments()).toBeGreaterThan(0);
      });

      it('should list the maps', async () => {
        await service.onModuleInit();
        expect(await service.getMaps()).toMatchObject([
          { name: 'cp_badlands', cooldown: 0 },
        ]);
      });

      it('should emit an event', async () =>
        new Promise<void>((resolve) => {
          events.mapPoolChange.subscribe(({ maps }) => {
            expect(maps).toMatchObject([{ name: 'cp_badlands', cooldown: 0 }]);
            resolve();
          });

          service.onModuleInit();
        }));
    });
  });

  describe('#addMap()', () => {
    it('should add the map', async () => {
      const map = await service.addMap(new MapPoolEntry('cp_obscure_final'));
      expect(map).toMatchObject({ name: 'cp_obscure_final', cooldown: 0 });
      expect(await service.getMaps()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'cp_obscure_final' }),
        ]),
      );
    });

    it('should emit the event', async () =>
      new Promise<void>((resolve) => {
        events.mapPoolChange.subscribe(({ maps }) => {
          expect(maps.find((m) => m.name === 'cp_obscure_final')).toBeTruthy();
          resolve();
        });

        service.addMap(new MapPoolEntry('cp_obscure_final'));
      }));
  });

  describe('#removeMap()', () => {
    beforeEach(async () => {
      await service.addMap(new MapPoolEntry('cp_obscure_final'));
    });

    it('should remove the map', async () => {
      const map = await service.removeMap('cp_obscure_final');
      expect(map).toMatchObject({ name: 'cp_obscure_final' });
    });

    it('should emit the event', async () =>
      new Promise<void>((resolve) => {
        events.mapPoolChange.subscribe(({ maps }) => {
          expect(maps.find((m) => m.name === 'cp_obscure_final')).toBe(
            undefined,
          );
          resolve();
        });

        service.removeMap('cp_obscure_final');
      }));
  });

  describe('#setMaps()', () => {
    it('should set all maps at once', async () => {
      const maps = await service.setMaps([
        new MapPoolEntry('cp_badlands'),
        new MapPoolEntry('cp_obscure_final'),
      ]);
      expect(await service.setMaps(maps)).toEqual([
        expect.objectContaining({ name: 'cp_badlands' }),
        expect.objectContaining({ name: 'cp_obscure_final' }),
      ]);
    });

    it('should emit the event', async () =>
      new Promise<void>((resolve) => {
        events.mapPoolChange.subscribe(({ maps }) => {
          expect(maps).toEqual([
            expect.objectContaining({ name: 'cp_badlands' }),
            expect.objectContaining({ name: 'cp_obscure_final' }),
          ]);
          resolve();
        });

        service.setMaps([
          new MapPoolEntry('cp_badlands'),
          new MapPoolEntry('cp_obscure_final'),
        ]);
      }));
  });
});
