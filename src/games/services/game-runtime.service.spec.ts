import { Test, TestingModule } from '@nestjs/testing';
import { GameRuntimeService } from './game-runtime.service';
import { GamesService } from './games.service';
import { GameServersService } from '@/game-servers/services/game-servers.service';
import { ServerConfiguratorService } from './server-configurator.service';
import { PlayersService } from '@/players/services/players.service';
import { say } from '../utils/rcon-commands';
import { Tf2Team } from '../models/tf2-team';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mongooseTestingModule } from '@/utils/testing-mongoose-module';
import { Player, PlayerDocument, playerSchema } from '@/players/models/player';
import { Game, GameDocument, gameSchema } from '../models/game';
import { GameServer } from '@/game-servers/models/game-server';
import { Events } from '@/events/events';
import { SlotStatus } from '../models/slot-status';
import { Tf2ClassName } from '@/shared/models/tf2-class-name';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Connection, Error as MongooseError, Types } from 'mongoose';
import { GameServerNotAssignedError } from '../errors/game-server-not-assigned.error';
import { Rcon } from 'rcon-client/lib';
import { staticGameServerProviderName } from '@/game-servers/providers/static-game-server/static-game-server-provider-name';
import { NotImplementedError } from '@/game-servers/errors/not-implemented.error';

jest.mock('./games.service');
jest.mock('@/game-servers/services/game-servers.service');
jest.mock('./server-configurator.service');
jest.mock('@/players/services/players.service');
jest.mock('rcon-client/lib');

describe('GameRuntimeService', () => {
  let service: GameRuntimeService;
  let mongod: MongoMemoryServer;
  let playersService: PlayersService;
  let gamesService: GamesService;
  let gameServersService: jest.Mocked<GameServersService>;
  let serverConfiguratorService: jest.Mocked<ServerConfiguratorService>;
  let mockGameServer: jest.Mocked<GameServer>;
  let mockPlayers: PlayerDocument[];
  let mockGame: GameDocument;
  let events: Events;
  let connection: Connection;

  beforeAll(async () => (mongod = await MongoMemoryServer.create()));
  afterAll(async () => await mongod.stop());

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        mongooseTestingModule(mongod),
        MongooseModule.forFeature([
          { name: Game.name, schema: gameSchema },
          { name: Player.name, schema: playerSchema },
        ]),
      ],
      providers: [
        GameRuntimeService,
        GamesService,
        GameServersService,
        ServerConfiguratorService,
        PlayersService,
        Events,
      ],
    }).compile();

    service = module.get<GameRuntimeService>(GameRuntimeService);
    playersService = module.get(PlayersService);
    gamesService = module.get(GamesService);
    gameServersService = module.get(GameServersService);
    serverConfiguratorService = module.get(ServerConfiguratorService);
    events = module.get(Events);
    connection = module.get(getConnectionToken());
  });

  beforeEach(async () => {
    mockGameServer = {
      id: new Types.ObjectId().toString(),
      name: 'FAKE_GAME_SERVER',
      address: 'FAKE_ADDRESS',
      port: '1234',
      createdAt: new Date(),
      provider: staticGameServerProviderName,
      rcon: jest.fn().mockRejectedValue('not implemented'),
      getLogsecret: jest.fn().mockRejectedValue(new NotImplementedError()),
      start: jest.fn().mockResolvedValue(mockGameServer),
      serialize: jest.fn(),
    };

    gameServersService.getById.mockResolvedValue(mockGameServer as any);

    mockPlayers = await Promise.all([
      // @ts-expect-error
      playersService._createOne(),
      // @ts-expect-error
      playersService._createOne(),
    ]);

    // @ts-expect-error
    mockGame = await gamesService._createOne(mockPlayers);

    mockGame.gameServer = new Types.ObjectId(mockGameServer.id);
    await mockGame.save();

    serverConfiguratorService.configureServer.mockResolvedValue({
      connectString: 'FAKE_CONNECT_STRING',
      stvConnectString: 'FAKE_STV_CONNECT_STRING',
    });
  });

  afterEach(async () => {
    // @ts-expect-error
    await gamesService._reset();
    // @ts-expect-error
    await playersService._reset();
    await connection.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('#reconfigure()', () => {
    it('should configure the server again', async () => {
      const ret = await service.reconfigure(mockGame.id);
      expect(serverConfiguratorService.configureServer).toHaveBeenCalledWith(
        mockGame.id,
      );
      expect(ret.connectString).toEqual('FAKE_CONNECT_STRING');
    });

    it('should bump connect info version', async () => {
      const v = mockGame.connectInfoVersion;
      const ret = await service.reconfigure(mockGame.id);
      expect(ret.connectInfoVersion > v).toBe(true);
    });

    describe('when the given game does not exist', () => {
      it('should throw an error', async () => {
        await expect(
          service.reconfigure(new Types.ObjectId().toString()),
        ).rejects.toThrow(MongooseError.DocumentNotFoundError);
      });
    });

    describe('when the game has no game server assigned', () => {
      let anotherGame: GameDocument;

      beforeEach(async () => {
        // @ts-expect-error
        anotherGame = await gamesService._createOne(mockPlayers);
      });

      it('should throw an error', async () => {
        await expect(service.reconfigure(anotherGame.id)).rejects.toThrowError(
          'this game has no server assigned',
        );
      });
    });

    describe('when an rcon error occurs', () => {
      beforeEach(() => {
        serverConfiguratorService.configureServer.mockRejectedValue(
          new Error('FAKE_RCON_ERROR'),
        );
      });

      it('should handle the error', async () => {
        await expect(service.reconfigure(mockGame.id)).resolves.toBeTruthy();
      });
    });
  });

  describe('#forceEnd()', () => {
    it('should set the game state', async () => {
      const ret = await service.forceEnd(mockGame.id);
      expect(ret.state).toEqual('interrupted');
      expect(ret.error).toEqual('ended by admin');
    });

    it('should free the players', async () => {
      await service.forceEnd(mockGame.id);
      const players = await Promise.all(
        mockGame.slots
          .map((s) => s.player)
          .map((playerId) => playersService.getById(playerId)),
      );
      expect(players.every((player) => player.activeGame === undefined)).toBe(
        true,
      );
    });

    it('should emit the gameChanges event', async () =>
      new Promise<void>((resolve) => {
        events.gameChanges.subscribe(({ newGame, adminId }) => {
          expect(newGame.id).toEqual(mockGame.id);
          expect(adminId).toEqual('FAKE_ADMIN_ID');
          resolve();
        });

        service.forceEnd(mockGame.id, 'FAKE_ADMIN_ID');
      }));

    // eslint-disable-next-line jest/expect-expect
    it('should emit the substituteRequestsChange event', async () =>
      new Promise<void>((resolve) => {
        events.substituteRequestsChange.subscribe(resolve);
        service.forceEnd(mockGame.id);
      }));

    describe('when the given game does not exist', () => {
      it('should reject', async () => {
        await expect(
          service.forceEnd(new Types.ObjectId().toString()),
        ).rejects.toThrow(MongooseError.DocumentNotFoundError);
      });
    });

    describe('when an rcon error occurs', () => {
      beforeEach(() => {
        serverConfiguratorService.configureServer.mockRejectedValue(
          new Error('FAKE_RCON_ERROR'),
        );
      });

      it('should handle the error', async () => {
        await expect(service.forceEnd(mockGame.id)).resolves.toBeTruthy();
      });
    });

    describe('if one of the players is waiting to be substituted', () => {
      beforeEach(async () => {
        mockGame.slots[0].status = SlotStatus.waitingForSubstitute;
        await mockGame.save();
      });

      it('should set his status back to active', async () => {
        const ret = await service.forceEnd(mockGame.id);
        expect(ret.slots[0].status).toEqual(SlotStatus.active);
      });
    });
  });

  describe('#replacePlayer()', () => {
    let rcon: jest.Mocked<Rcon>;

    beforeEach(() => {
      rcon = new (Rcon as any)();
      mockGameServer.rcon.mockResolvedValue(rcon);
    });

    describe('when the given game does not exist', () => {
      it('should throw an error', async () => {
        await expect(
          service.replacePlayer(
            new Types.ObjectId().toString(),
            'FAKE_REPLACEE_ID',
            null,
          ),
        ).rejects.toThrow(MongooseError.DocumentNotFoundError);
      });
    });

    describe('when the given game has no game server assigned', () => {
      let anotherGame: GameDocument;

      beforeEach(async () => {
        // @ts-expect-error
        anotherGame = await gamesService._createOne(mockPlayers);
      });

      it('should throw an error', async () => {
        await expect(
          service.replacePlayer(
            anotherGame.id,
            mockPlayers[0].id,
            mockPlayers[1].id,
          ),
        ).rejects.toThrow(GameServerNotAssignedError);
      });
    });

    it.todo('should execute the correct commands');

    describe('when an rcon error occurs', () => {
      beforeEach(() => {
        rcon.send.mockRejectedValue(new Error('fake rcon error'));
      });

      it('should close the RCON connection', async () => {
        await service.replacePlayer(mockGame.id, mockPlayers[0].id, {
          player: new Types.ObjectId(),
          team: Tf2Team.red,
          gameClass: Tf2ClassName.soldier,
        });
        expect(rcon.end).toHaveBeenCalled();
      });
    });

    it('should close the RCON connection', async () => {
      const spy = jest.spyOn(rcon, 'end');
      await service.replacePlayer(mockGame.id, mockPlayers[0].id, {
        player: new Types.ObjectId(),
        team: Tf2Team.red,
        gameClass: Tf2ClassName.soldier,
      });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('#sayChat()', () => {
    let rcon: jest.Mocked<Rcon>;

    beforeEach(() => {
      rcon = new (Rcon as any)();
      mockGameServer.rcon.mockResolvedValue(rcon);
    });

    describe('when the given game server does not exist', () => {
      beforeEach(() => {
        gameServersService.getById.mockRejectedValue(
          new MongooseError.DocumentNotFoundError(''),
        );
      });

      it('should throw an error', async () => {
        await expect(
          service.sayChat(mockGameServer.id, 'some message'),
        ).rejects.toThrow(MongooseError.DocumentNotFoundError);
      });
    });

    it('should execute the correct commands', async () => {
      await service.sayChat(mockGameServer.id, 'some message');
      expect(rcon.send).toHaveBeenCalledWith(say('some message'));
    });

    describe('when an rcon error occurs', () => {
      beforeEach(() => {
        rcon.send.mockRejectedValue(new Error('fake rcon error'));
      });

      it('should close the RCON connection', async () => {
        await service.sayChat(mockGameServer.id, 'some message');
        expect(rcon.end).toHaveBeenCalled();
      });
    });
  });
});
