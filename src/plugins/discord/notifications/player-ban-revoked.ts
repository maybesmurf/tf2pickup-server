import { MessageEmbed } from 'discord.js';
import { Colors } from './colors';

interface PlayerBanRevokedOptions {
  admin: {
    name: string;
    profileUrl: string;
    avatarUrl: string;
  };
  player: {
    name: string;
    profileUrl: string;
    avatarUrl: string;
  };
  client: {
    name: string;
    iconUrl: string;
  };
  reason: string;
}

export const playerBanRevoked = (options: PlayerBanRevokedOptions) =>
  new MessageEmbed()
    .setColor(Colors.PlayerBanRevoked)
    .setAuthor({
      name: options.admin.name,
      iconURL: options.admin.avatarUrl,
      url: options.admin.profileUrl,
    })
    .setTitle('Player ban revoked')
    .setThumbnail(options.player.avatarUrl)
    .setDescription(
      [
        `Player: **[${options.player.name}](${options.player.profileUrl})**`,
        `Reason: **${options.reason}**`,
      ].join('\n'),
    )
    .setFooter({
      text: options.client.name,
      iconURL: options.client.iconUrl,
    })
    .setTimestamp();
