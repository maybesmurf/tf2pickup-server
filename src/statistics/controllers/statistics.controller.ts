import { Controller, Get } from '@nestjs/common';
import { StatisticsService } from '../services/statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private statisticsService: StatisticsService) {}

  @Get('played-maps-count')
  async getPlayedMapsCount() {
    return await this.statisticsService.getPlayedMapsCount();
  }

  @Get('game-launch-time-spans')
  async getGameLaunchDays() {
    return await this.statisticsService.getGameLaunchTimeSpans();
  }

  @Get('game-launches-per-day')
  async getGameLaunchesPerDay() {
    return await this.statisticsService.getGameLaunchesPerDay();
  }
}
