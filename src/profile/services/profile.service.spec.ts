import { Events } from '@/events/events';
import { Player } from '@/players/models/player';
import { LinkedProfilesService } from '@/players/services/linked-profiles.service';
import { OnlinePlayersService } from '@/players/services/online-players.service';
import { WebsocketEvent } from '@/websocket-event';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Subject } from 'rxjs';
import { ProfileService } from './profile.service';

jest.mock('@/players/services/online-players.service');
jest.mock('@/players/services/linked-profiles.service');

describe('ProfileService', () => {
  let service: ProfileService;
  let onlinePlayersService: jest.Mocked<OnlinePlayersService>;
  let linkedProfilesService: jest.Mocked<LinkedProfilesService>;
  let events: Events;
  let socketEvents: Subject<any>;
  let socket;

  beforeEach(() => {
    socketEvents = new Subject();
    socket = {
      emit: (eventName, data) => socketEvents.next({ eventName, data }),
    };
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        Events,
        OnlinePlayersService,
        LinkedProfilesService,
      ],
    }).compile();

    onlinePlayersService = module.get(OnlinePlayersService);
    linkedProfilesService = module.get(LinkedProfilesService);

    onlinePlayersService.getSocketsForPlayer.mockReturnValue([socket]);

    events = module.get(Events);
    service = module.get<ProfileService>(ProfileService);
    service.onModuleInit();
  });

  afterEach(() => {
    socketEvents.complete();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should update profile on linkedProfilesChanged event', () => {
    socketEvents.subscribe(({ eventName, data }) => {
      expect(eventName).toEqual(WebsocketEvent.profileUpdate);
      expect(data).toMatchObject({
        linkedProfiles: [],
      });
    });

    linkedProfilesService.getLinkedProfiles.mockResolvedValue([]);
    events.linkedProfilesChanged.next({ playerId: 'FAKE_PLAYER_ID' });
  });

  it('should update profile when active game is updated', () => {
    socketEvents.subscribe(({ eventName, data }) => {
      expect(eventName).toEqual(WebsocketEvent.profileUpdate);
      expect(data).toMatchObject({
        activeGameId: null,
      });
    });

    const oldPlayer = new Player();
    oldPlayer.id = 'FAKE_PLAYER_ID';
    oldPlayer.name = 'FAKE_PLAYER_NAME';
    oldPlayer.activeGame = new Types.ObjectId();

    const newPlayer = new Player();
    newPlayer.id = 'FAKE_PLAYER_ID';
    newPlayer.name = 'FAKE_PLAYER_NAME';

    events.playerUpdates.next({
      oldPlayer,
      newPlayer,
    });
  });
});
