import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
  CACHE_MANAGER,
} from '@nestjs/common';
import { QueueSlot } from '@/queue/queue-slot';
import { PlayersService } from '@/players/services/players.service';
import { QueueConfigService } from './queue-config.service';
import { PlayerBansService } from '@/players/services/player-bans.service';
import { QueueState } from '../queue-state';
import { readyUpTimeout, readyStateTimeout } from '@configs/queue';
import { Events } from '@/events/events';
import { Error } from 'mongoose';
import { NoSuchPlayerError } from '../errors/no-such-player.error';
import { PlayerHasNotAcceptedRulesError } from '../errors/player-has-not-accepted-rules.error';
import { PlayerIsBannedError } from '../errors/player-is-banned.error';
import { PlayerInvolvedInGameError } from '../errors/player-involved-in-game.error';
import { NoSuchSlotError } from '../errors/no-such-slot.error';
import { SlotOccupiedError } from '../errors/slot-occupied.error';
import { CannotLeaveAtThisQueueStateError } from '../errors/cannot-leave-at-this-queue-state.error';
import { PlayerNotInTheQueueError } from '../errors/player-not-in-the-queue.error';
import { WrongQueueStateError } from '../errors/wrong-queue-state.error';
import { CannotJoinAtThisQueueStateError } from '../errors/cannot-join-at-this-queue-state.error';
import { Mutex } from 'async-mutex';
import { Cache } from 'cache-manager';

interface Queue {
  slots: QueueSlot[];
  state: QueueState;
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  slots: QueueSlot[] = [];
  state: QueueState = QueueState.waiting;

  private logger = new Logger(QueueService.name);
  private timer?: NodeJS.Timer;
  private immediates: NodeJS.Immediate[] = [];
  private mutex = new Mutex();

  get requiredPlayerCount(): number {
    return this.slots.length;
  }

  get playerCount(): number {
    return this.slots.filter((s) => !!s.playerId).length;
  }

  get readyPlayerCount() {
    return this.slots.filter((s) => s.ready).length;
  }

  constructor(
    @Inject(forwardRef(() => PlayersService))
    private playersService: PlayersService,
    private queueConfigService: QueueConfigService,
    private playerBansService: PlayerBansService,
    private events: Events,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async onModuleInit() {
    this.resetSlots();
    this.events.queueSlotsChange.subscribe(() =>
      this.immediates.push(setImmediate(() => this.maybeUpdateState())),
    );
    this.events.queueStateChange.subscribe(({ state }) =>
      this.onStateChange(state),
    );
    this.events.playerDisconnects.subscribe(({ playerId }) =>
      this.kick(playerId),
    );
    this.events.playerBanAdded.subscribe(({ ban }) =>
      this.kick(ban.player.toString()),
    );

    this.events.queueSlotsChange.subscribe(() => this.cacheQueue());
    this.events.queueStateChange.subscribe(() => this.cacheQueue());

    const queue: Queue = await this.cache.get('queue');
    if (queue) {
      this.slots = queue.slots;
      this.state = queue.state;
    }
  }

  onModuleDestroy() {
    clearTimeout(this.timer);
    this.immediates.forEach((i) => clearImmediate(i));
  }

  getSlotById(id: number): QueueSlot {
    return this.slots.find((s) => s.id === id);
  }

  findSlotByPlayerId(playerId: string): QueueSlot {
    return this.slots.find((s) => s.playerId === playerId);
  }

  isInQueue(playerId: string): boolean {
    return !!this.slots.find((s) => s.playerId === playerId);
  }

  reset() {
    this.logger.debug('queue reset');
    this.resetSlots();
    this.events.queueSlotsChange.next({ slots: this.slots });
  }

  /**
   * Player joins the queue.
   *
   * @param {number} slotId Slot id to take.
   * @param {string} playerId ID of the player who joins the queue.
   */
  async join(slotId: number, playerId: string): Promise<QueueSlot[]> {
    return await this.mutex.runExclusive(async () => {
      try {
        if (this.state === QueueState.launching) {
          throw new CannotJoinAtThisQueueStateError(this.state);
        }

        const player = await this.playersService.getById(playerId);
        if (!player.hasAcceptedRules) {
          throw new PlayerHasNotAcceptedRulesError(playerId);
        }

        const bans = await this.playerBansService.getPlayerActiveBans(playerId);
        if (bans.length > 0) {
          throw new PlayerIsBannedError(playerId);
        }

        if (player.activeGame) {
          throw new PlayerInvolvedInGameError(playerId);
        }

        const targetSlot = this.getSlotById(slotId);
        if (!targetSlot) {
          throw new NoSuchSlotError(slotId);
        }

        if (targetSlot.playerId) {
          throw new SlotOccupiedError(slotId);
        }

        // remove player from any slot(s) he could be occupying
        const oldSlots = this.slots.filter((s) => s.playerId === playerId);
        oldSlots.forEach((s) => this.clearSlot(s));

        targetSlot.playerId = playerId;

        if (
          this.state === QueueState.ready ||
          this.playerCount === this.requiredPlayerCount
        ) {
          targetSlot.ready = true;
        }

        this.logger.debug(
          `player ${player.name} joined the queue (slotId=${targetSlot.id}, gameClass=${targetSlot.gameClass})`,
        );

        // is player joining instead of only changing slots?
        if (oldSlots.length === 0) {
          this.events.playerJoinsQueue.next({ playerId });
        }

        const slots = [targetSlot, ...oldSlots];
        this.events.queueSlotsChange.next({ slots });
        return slots;
      } catch (error) {
        if (error instanceof Error.DocumentNotFoundError) {
          throw new NoSuchPlayerError(playerId);
        } else {
          throw error;
        }
      }
    });
  }

  leave(playerId: string): QueueSlot {
    const slot = this.findSlotByPlayerId(playerId);
    if (slot) {
      if (slot.ready && this.state !== QueueState.waiting) {
        throw new CannotLeaveAtThisQueueStateError(this.state);
      }

      this.clearSlot(slot);
      this.logger.debug(`slot ${slot.id} (gameClass=${slot.gameClass}) free`);
      this.events.playerLeavesQueue.next({ playerId, reason: 'manual' });
      this.events.queueSlotsChange.next({ slots: [slot] });
      return slot;
    } else {
      throw new PlayerNotInTheQueueError(playerId);
    }
  }

  kick(...playerIds: string[]) {
    if (this.state === QueueState.launching) {
      return;
    }

    const updatedSlots: QueueSlot[] = [];

    for (const playerId of playerIds) {
      const slot = this.findSlotByPlayerId(playerId);
      if (slot) {
        this.clearSlot(slot);
        this.events.playerLeavesQueue.next({ playerId, reason: 'kicked' });
        this.logger.debug(
          `slot ${slot.id} (gameClass=${slot.gameClass}) free (player was kicked)`,
        );
        updatedSlots.push(slot);
      }
    }

    this.events.queueSlotsChange.next({ slots: updatedSlots });
  }

  readyUp(playerId: string): QueueSlot {
    if (this.state !== QueueState.ready) {
      throw new WrongQueueStateError(this.state);
    }

    const slot = this.findSlotByPlayerId(playerId);
    if (slot) {
      slot.ready = true;
      this.logger.debug(
        `slot ${slot.id} ready (${this.readyPlayerCount}/${this.requiredPlayerCount})`,
      );
      this.events.queueSlotsChange.next({ slots: [slot] });
      return slot;
    } else {
      throw new PlayerNotInTheQueueError(playerId);
    }
  }

  private maybeUpdateState() {
    // check whether we can change state
    switch (this.state) {
      case QueueState.waiting:
        if (this.playerCount === this.requiredPlayerCount) {
          this.setState(QueueState.ready);
        }
        break;

      case QueueState.ready:
        if (this.playerCount === 0) {
          this.setState(QueueState.waiting);
        } else if (this.readyPlayerCount === this.requiredPlayerCount) {
          this.setState(QueueState.launching);
        }
        break;

      case QueueState.launching:
        this.setState(QueueState.waiting);
        break;
    }
  }

  private onStateChange(state: QueueState) {
    switch (state) {
      case QueueState.ready:
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.onReadyUpTimeout(), readyUpTimeout);
        break;

      case QueueState.launching:
      case QueueState.waiting:
        clearTimeout(this.timer);
        break;
    }
  }

  private resetSlots() {
    const defaultSlot: Partial<QueueSlot> = {
      playerId: null,
      ready: false,
    };

    let lastId = 0;
    this.slots = this.queueConfigService.queueConfig.classes.reduce(
      (prev, curr) => {
        const tmpSlots = [];
        for (
          let i = 0;
          i < curr.count * this.queueConfigService.queueConfig.teamCount;
          ++i
        ) {
          tmpSlots.push({
            id: lastId++,
            gameClass: curr.name,
            canMakeFriendsWith: curr.canMakeFriendsWith,
            ...defaultSlot,
          });
        }

        return prev.concat(tmpSlots);
      },
      [],
    );
  }

  private clearSlot(slot: QueueSlot) {
    slot.playerId = null;
    slot.ready = false;
  }

  private onReadyUpTimeout() {
    if (this.readyPlayerCount < this.requiredPlayerCount) {
      this.kickUnreadyPlayers();
    }

    const nextTimeout = readyStateTimeout - readyUpTimeout;

    if (nextTimeout > 0) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.unreadyQueue(), nextTimeout);
    } else {
      this.unreadyQueue();
    }
  }

  private kickUnreadyPlayers() {
    this.logger.debug('kicking players that are not ready');
    const slots = this.slots.filter((s) => !s.ready);
    this.kick(...slots.map((s) => s.playerId));
  }

  private unreadyQueue() {
    const slots = this.slots.filter((s) => !!s.playerId);
    slots.forEach((s) => (s.ready = false));
    this.events.queueSlotsChange.next({ slots });
    this.setState(QueueState.waiting);
  }

  private setState(state: QueueState) {
    this.state = state;
    this.events.queueStateChange.next({ state });
  }

  private async cacheQueue() {
    await this.cache.set(
      'queue',
      { slots: this.slots, state: this.state },
      { ttl: 180 },
    );
  }
}
