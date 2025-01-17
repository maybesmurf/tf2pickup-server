import { Events } from '@/events/events';
import { mongooseTestingModule } from '@/utils/testing-mongoose-module';
import { WebsocketEvent } from '@/websocket-event';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Socket } from 'socket.io';
import { Player, playerSchema } from '../models/player';
import { PlayersService } from '../services/players.service';
import { PlayersGateway } from './players.gateway';

jest.mock('../services/players.service');
jest.mock('@/shared/serialize', () => ({
  serialize: jest.fn().mockImplementation((value) => value),
}));

describe('PlayersGateway', () => {
  let gateway: PlayersGateway;
  let mongod: MongoMemoryServer;
  let socket: Socket;
  let events: Events;
  let playersService: PlayersService;

  beforeAll(async () => (mongod = await MongoMemoryServer.create()));
  afterAll(async () => await mongod.stop());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        mongooseTestingModule(mongod),
        MongooseModule.forFeature([
          {
            name: Player.name,
            schema: playerSchema,
          },
        ]),
      ],
      providers: [PlayersGateway, Events, PlayersService],
    }).compile();

    gateway = module.get<PlayersGateway>(PlayersGateway);
    events = module.get(Events);
    playersService = module.get(PlayersService);

    socket = {
      emit: jest.fn(),
    } as unknown as Socket;
    gateway.afterInit(socket);
    gateway.onModuleInit();
  });

  // @ts-expect-error
  afterEach(async () => await playersService._reset());

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('should emit playerConnected', async () =>
    new Promise<void>((resolve) => {
      const socket = { id: 'fasldfhasdkjfh' };
      gateway.playerConnected.subscribe((s) => {
        expect(s).toEqual(socket as any);
        resolve();
      });
      gateway.handleConnection(socket as any);
    }));

  it('should emit playerDisconnected', async () =>
    new Promise<void>((resolve) => {
      const socket = { id: 'fklsdafhf984' };
      gateway.playerDisconnected.subscribe((s) => {
        expect(s).toEqual(socket as any);
        resolve();
      });
      gateway.handleDisconnect(socket as any);
    }));

  describe('when a player becomes online', () => {
    let player: Player;

    beforeEach(async () => {
      // @ts-expect-error
      player = await playersService._createOne();
    });

    it('should emit ws event', () =>
      new Promise<void>((resolve) => {
        socket.emit = jest.fn().mockImplementation((...args) => {
          expect(args[0]).toEqual(WebsocketEvent.playerConnected);
          expect(args[1].id).toEqual(player.id);
          resolve();
        });
        events.playerConnects.next({ playerId: player.id });
      }));
  });

  describe('when a player disconnects', () => {
    let player: Player;

    beforeEach(async () => {
      // @ts-expect-error
      player = await playersService._createOne();
    });

    it('should emit ws event', () =>
      new Promise<void>((resolve) => {
        socket.emit = jest.fn().mockImplementation((...args) => {
          expect(args[0]).toEqual(WebsocketEvent.playerDisconnected);
          expect(args[1].id).toEqual(player.id);
          resolve();
        });
        events.playerDisconnects.next({ playerId: player.id });
      }));
  });
});
