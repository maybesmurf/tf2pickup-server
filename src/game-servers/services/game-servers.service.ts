import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { Mutex } from 'async-mutex';
import { Events } from '@/events/events';
import { GamesService } from '@/games/services/games.service';
import { GameServer, GameServerDocument } from '../models/game-server';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import { filter } from 'rxjs';
import { plainToInstance } from 'class-transformer';
import { GameServerProvider } from '../game-server-provider';
import { Game } from '@/games/models/game';
import { NoFreeGameServerAvailableError } from '../errors/no-free-game-server-available.error';
import { Cron, CronExpression } from '@nestjs/schedule';

type GameServerConstructor = GameServerProvider['implementingClass'];

@Injectable()
export class GameServersService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(GameServersService.name);
  private readonly mutex = new Mutex();
  private readonly providers: GameServerProvider[] = [];
  private readonly discriminators: Map<string, GameServerConstructor> =
    new Map();

  constructor(
    @InjectModel(GameServer.name)
    private gameServerModel: Model<GameServerDocument>,
    private events: Events,
    @Inject(forwardRef(() => GamesService))
    private gamesService: GamesService,
  ) {}

  onModuleInit() {
    this.events.gameChanges
      .pipe(
        filter(
          ({ oldGame, newGame }) =>
            oldGame.isInProgress() && !newGame.isInProgress(),
        ),
      )
      .subscribe(
        async ({ newGame }) => await this.maybeReleaseGameServer(newGame),
      );
  }

  onApplicationBootstrap() {
    this.logger.log(
      `providers: ${this.providers
        .map((p) => p.gameServerProviderName)
        .join(', ')}`,
    );
  }

  registerProvider(provider: GameServerProvider) {
    this.providers.push(provider);
    this.providers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.discriminators.set(
      provider.gameServerProviderName,
      provider.implementingClass,
    );
  }

  async getById(gameServerId: string | Types.ObjectId): Promise<GameServer> {
    const plain = await this.gameServerModel
      .findById(gameServerId)
      .orFail()
      .lean()
      .exec();
    return this.instantiateGameServer(plain);
  }

  async updateGameServer(
    gameServerId: string | Types.ObjectId,
    update: UpdateQuery<GameServerDocument>,
  ): Promise<GameServer> {
    const oldGameServer = await this.getById(gameServerId);
    const newGameServer = this.instantiateGameServer(
      await this.gameServerModel
        .findByIdAndUpdate(gameServerId, update, { new: true })
        .lean()
        .exec(),
    );
    this.events.gameServerUpdated.next({
      oldGameServer,
      newGameServer,
    });
    return newGameServer;
  }

  async findFreeGameServer(): Promise<GameServer> {
    for (const provider of this.providers) {
      try {
        return await provider.findFirstFreeGameServer();
      } catch (error) {
        continue;
      }
    }

    throw new NoFreeGameServerAvailableError();
  }

  async assignGameServer(gameId: string): Promise<GameServer> {
    return this.mutex.runExclusive(async () => {
      const game = await this.gamesService.getById(gameId);
      let gameServer = await this.findFreeGameServer();
      this.logger.log(
        `Using gameserver ${gameServer.name} for game #${game.number}`,
      );
      gameServer = await this.updateGameServer(gameServer.id, {
        game: new Types.ObjectId(game.id),
      });
      await this.gamesService.update(game.id, {
        gameServer: new Types.ObjectId(gameServer.id),
      });
      return gameServer;
    });
  }

  async maybeReleaseGameServer(game: Game): Promise<void> {
    if (!game.gameServer) {
      return;
    }

    const gameServer = await this.getById(game.gameServer);
    if (gameServer.game?.toString() === game.id) {
      await this.updateGameServer(gameServer.id, {
        $unset: {
          game: 1,
        },
      });
    }
  }

  /**
   * It may happen that the gameserver is not released when a game ends.
   * Let's check that no gameserver is assigned to a game that is already over.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkForGameServersToRelease() {
    const gameServers = await this.gameServerModel.find({}).lean().exec();
    await Promise.all(
      gameServers.map(async (gameServer) => {
        if (gameServer.game) {
          const game = await this.gamesService.getById(gameServer.game);
          if (!game.isInProgress()) {
            await this.updateGameServer(gameServer._id, {
              $unset: {
                game: 1,
              },
            });
          }
        }
      }),
    );
  }

  private instantiateGameServer(plain) {
    const cls = this.discriminators.get(plain.provider) ?? GameServer;
    return plainToInstance(cls, plain);
  }
}
