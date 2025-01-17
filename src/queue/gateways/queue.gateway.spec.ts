import { Test, TestingModule } from '@nestjs/testing';
import { QueueGateway } from './queue.gateway';
import { QueueService } from '../services/queue.service';
import { MapVoteService } from '../services/map-vote.service';
import { QueueAnnouncementsService } from '../services/queue-announcements.service';
import { FriendsService } from '../services/friends.service';
import { Events } from '@/events/events';
import { Socket } from 'socket.io';
import { Tf2ClassName } from '@/shared/models/tf2-class-name';
import { QueueSlotWrapper } from '../controllers/queue-slot-wrapper';
import { QueueState } from '../queue-state';

jest.mock('../services/queue.service');
jest.mock('socket.io');
jest.mock('../services/map-vote.service');
jest.mock('../services/queue-announcements.service');
jest.mock('../services/friends.service');
jest.mock('../controllers/queue-slot-wrapper');

const mockSubstituteRequests = [
  {
    gameId: 'FAKE_GAME_ID',
    gameNumber: 5,
    gameClass: Tf2ClassName.scout,
    team: 'BLU',
  },
];

describe('QueueGateway', () => {
  let gateway: QueueGateway;
  let queueService: jest.Mocked<QueueService>;
  let mapVoteService: jest.Mocked<MapVoteService>;
  let socket: Socket;
  let queueAnnouncementsService: jest.Mocked<QueueAnnouncementsService>;
  let friendsService: jest.Mocked<FriendsService>;
  let events: Events;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueGateway,
        Events,
        QueueService,
        MapVoteService,
        QueueAnnouncementsService,
        FriendsService,
      ],
    }).compile();

    gateway = module.get<QueueGateway>(QueueGateway);
    queueService = module.get(QueueService);
    mapVoteService = module.get(MapVoteService);
    queueAnnouncementsService = module.get(QueueAnnouncementsService);
    friendsService = module.get(FriendsService);
    events = module.get(Events);
  });

  beforeEach(() => {
    queueService.join.mockResolvedValue([
      {
        id: 5,
        playerId: 'FAKE_PLAYER_ID',
        gameClass: Tf2ClassName.scout,
        ready: false,
      },
    ]);
    queueService.leave.mockReturnValue({
      id: 0,
      playerId: 'FAKE_PLAYER_ID',
      gameClass: Tf2ClassName.scout,
      ready: false,
    });
    queueService.readyUp.mockReturnValue({
      id: 0,
      playerId: 'FAKE_PLAYER_ID',
      gameClass: Tf2ClassName.scout,
      ready: true,
    });
    queueAnnouncementsService.substituteRequests.mockResolvedValue(
      mockSubstituteRequests,
    );

    socket = {
      emit: jest.fn(),
    } as any;
  });

  beforeEach(() => {
    gateway.onModuleInit();
    gateway.afterInit(socket);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('#joinQueue()', () => {
    it('should join the queue', async () => {
      await gateway.joinQueue({ user: { id: 'FAKE_PLAYER_ID' } } as Socket, {
        slotId: 5,
      });
      expect(queueService.join).toHaveBeenCalledWith(5, 'FAKE_PLAYER_ID');
    });
  });

  describe('#leaveQueue()', () => {
    it('should leave the queue', () => {
      gateway.leaveQueue({
        user: { id: 'FAKE_PLAYER_ID' },
      } as Socket);
      expect(queueService.leave).toHaveBeenCalledWith('FAKE_PLAYER_ID');
    });
  });

  describe('#playerReady()', () => {
    it('should ready up the player', () => {
      gateway.playerReady({
        user: { id: 'FAKE_PLAYER_ID' },
      } as Socket);
      expect(queueService.readyUp).toHaveBeenCalledWith('FAKE_PLAYER_ID');
    });
  });

  describe('#markFriend()', () => {
    it('should mark friend', async () => {
      gateway.markFriend({ user: { id: 'FAKE_PLAYER_ID' } } as Socket, {
        friendPlayerId: 'FAKE_FRIEND_ID',
      });
      expect(friendsService.markFriend).toHaveBeenCalledWith(
        'FAKE_PLAYER_ID',
        'FAKE_FRIEND_ID',
      );
    });
  });

  describe('#voteForMap()', () => {
    it('should vote for the map', () => {
      const ret = gateway.voteForMap(
        { user: { id: 'FAKE_PLAYER_ID' } } as Socket,
        { map: 'cp_badlands' },
      );
      expect(mapVoteService.voteForMap).toHaveBeenCalledWith(
        'FAKE_PLAYER_ID',
        'cp_badlands',
      );
      expect(ret).toEqual('cp_badlands');
    });
  });

  describe('when the queueSlotsChange event is fired', () => {
    beforeEach(() => {
      events.queueSlotsChange.next({
        slots: [
          {
            id: 0,
            playerId: 'FAKE_PLAYER_ID',
            ready: true,
            gameClass: Tf2ClassName.soldier,
          },
        ],
      });
    });

    it('should emit the event over the socket', () => {
      expect(socket.emit).toHaveBeenCalledWith('queue slots update', [
        expect.any(QueueSlotWrapper),
      ]);
    });
  });

  describe('when the queueStateChange event is fired', () => {
    beforeEach(() => {
      events.queueStateChange.next({ state: QueueState.ready });
    });

    it('should emit the event over the socket', () => {
      expect(socket.emit).toHaveBeenCalledWith('queue state update', 'ready');
    });
  });

  describe('when the queueFriendshipsChange event is fired', () => {
    beforeEach(() => {
      events.queueFriendshipsChange.next({ friendships: [] });
    });

    it('should emit the event over the socket', () => {
      expect(socket.emit).toHaveBeenCalledWith('friendships update', []);
    });
  });

  describe('when the mapVotesChange event is fired', () => {
    const results = [
      { map: 'cp_process_final', voteCount: 0 },
      { map: 'cp_gullywash_final1', voteCount: 0 },
      { map: 'cp_metalworks', voteCount: 1 },
    ];

    beforeEach(() => {
      events.mapVotesChange.next({ results });
    });

    it('should emit the event over the socket', () => {
      expect(socket.emit).toHaveBeenCalledWith(
        'map vote results update',
        results,
      );
    });
  });

  describe('when the substituteRequestsChange is fired', () => {
    beforeEach(() => {
      events.substituteRequestsChange.next();
    });

    it('should emit the event over the socket', () => {
      expect(socket.emit).toHaveBeenCalledWith(
        'substitute requests update',
        mockSubstituteRequests,
      );
    });
  });
});
